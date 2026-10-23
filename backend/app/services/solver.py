"""OR-Tools 单日 TSP：带时间窗与权重目标函数的路径求解。

模型要点（答辩可以直接讲这一页）：
  · 节点：0 = 酒店（起点+终点），1..N = 选中目的地
  · 弧成本：加权成本矩阵（w1×时间 + w2×换乘惩罚 + w3×费用 + w4×步行），单位分钟当量
  · 时间维度：AddDimension 累计「交通耗时 + 停留时间」，使用 PATH_CHEAPEST_ARC
    构造初解 + GUIDED_LOCAL_SEARCH 做邻域搜索
  · 时间窗：CumulVar 限制在 [max(营业开始, 出发时间), 营业结束 - 停留]
  · 迟到惩罚：终点 CumulVar 加软上界，超时按分钟当量罚款
  · 漏点惩罚：AddDisjunction 让求解器在时间不够时「丢点而不是无解」

OR-Tools 装不上时自动降级到 tsp_fallback（贪心 + 2-opt），接口契约完全一致。
"""
from __future__ import annotations

import time
from dataclasses import replace

from .amap_client import sub_matrix
from .tsp_core import (
    UNVISITED_PENALTY_MIN,
    SolveRequest,
    SolveResult,
    build_weighted_matrix,
    node_window,
    objective_of,
    schedule,
)
from .tsp_fallback import solve_fallback

# OR-Tools 只接受整数成本，×100 保留两位小数精度
SCALE = 100
# 必去点一旦被丢弃就是违约，给一个天文数字级惩罚（等价硬约束）
MUST_VISIT_PENALTY = 10 ** 7
# 迟到惩罚：每迟到 1 分钟罚 20 分钟当量（作用在「回到酒店」的时刻上）
LATE_PENALTY_COEFF = 20
# 允许超时返回的硬上限：给 2 小时弹性，超出部分罚分，而不是直接判无解
OVERTIME_SLACK_MIN = 120


def _solve_ortools(req: SolveRequest, allow_drop: bool) -> SolveResult | None:
    """调用 OR-Tools 求解；无解返回 None。"""
    # 延迟导入：OR-Tools 缺失时应用仍可启动，只是走兜底求解器
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2

    if not req.nodes:
        return SolveResult(order=[], solver="ortools-gls", weighted=[], notes=["没有需要排序的点"])

    matrix = req.matrix
    size = matrix.size
    weighted = build_weighted_matrix(req)
    stay = [0.0] * size
    for node in req.nodes:
        stay[node.index] = float(node.stay_min)

    manager = pywrapcp.RoutingIndexManager(size, 1, [req.start_index], [req.start_index])
    routing = pywrapcp.RoutingModel(manager)

    # ---- 弧成本：加权目标函数 ----
    def cost_callback(from_index: int, to_index: int) -> int:
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        return int(round(weighted[i][j] * SCALE))

    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(cost_callback))

    # ---- 时间维度：交通耗时 + 上一站停留 ----
    def time_callback(from_index: int, to_index: int) -> int:
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        return int(round((matrix.durations[i][j] + stay[i]) * SCALE))

    capacity = int(round((req.day_end_min - req.day_start_min) * SCALE))
    if capacity <= 0:
        return None
    # 硬上限留出弹性，超过正常收工时间的部分由「迟到惩罚」承担
    hard_capacity = capacity + int(OVERTIME_SLACK_MIN * SCALE)
    routing.AddDimension(
        routing.RegisterTransitCallback(time_callback),
        hard_capacity,   # 允许等待的最大松弛
        hard_capacity,   # 全天时间硬上限
        True,            # 起点时刻归零
        "Time",
    )
    time_dim = routing.GetDimensionOrDie("Time")

    # ---- 每个点的营业时间窗（硬约束：不能进已经关门的景点） ----
    for node in req.nodes:
        lo, hi = node_window(node, req.day_start_min, req.day_end_min)
        index = manager.NodeToIndex(node.index)
        earliest = max(0, int(round((lo - req.day_start_min) * SCALE)))
        latest = min(hard_capacity, int(round((hi - node.stay_min - req.day_start_min) * SCALE)))
        if earliest > latest:
            # 窗口容不下这次停留：无法给它安排合法时间，只能靠 disjunction 丢弃
            if not allow_drop:
                return None
            continue
        time_dim.CumulVar(index).SetRange(earliest, latest)

    # ---- 迟到惩罚：回到酒店晚于计划收工时间，按分钟罚款 ----
    end_index = routing.End(0)
    time_dim.CumulVar(end_index).SetRange(0, hard_capacity)
    time_dim.SetCumulVarSoftUpperBound(end_index, capacity, LATE_PENALTY_COEFF)

    # ---- 不属于本轮的节点：给 0 惩罚的 disjunction，允许直接跳过 ----
    # ⚠️ OR-Tools 默认要求访问每一个节点，不给 disjunction 就"必须去"。
    #    多日模式下矩阵是所有天的点合起来的，不跳过别的天的点就会出现
    #    「第 1 天绕去第 2 天的目的地」这种荒唐结果（而且 order 里会出现本日不存在的下标）。
    active = {node.index for node in req.nodes}
    for index in range(size):
        if index == req.start_index or index in active:
            continue
        routing.AddDisjunction([manager.NodeToIndex(index)], 0)

    # ---- 漏点惩罚：允许求解器丢点，而不是直接无解 ----
    if allow_drop:
        for node in req.nodes:
            index = manager.NodeToIndex(node.index)
            penalty = MUST_VISIT_PENALTY if node.must_visit else int(UNVISITED_PENALTY_MIN * SCALE)
            routing.AddDisjunction([index], penalty)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.seconds = max(1, int(req.time_limit_s))
    params.log_search = False

    solution = routing.SolveWithParameters(params)
    if solution is None:
        return None

    # ---- 还原访问顺序与到达时刻 ----
    order: list[int] = []
    arrivals: dict[int, float] = {}
    index = routing.Start(0)
    guard = 0
    while not routing.IsEnd(index) and guard < size + 5:
        node = manager.IndexToNode(index)
        arrivals[node] = solution.Value(time_dim.CumulVar(index)) / SCALE + req.day_start_min
        if node != req.start_index:
            order.append(node)
        index = solution.Value(routing.NextVar(index))
        guard += 1

    visited = set(order)
    dropped = [node.index for node in req.nodes if node.index not in visited]
    return_min = req.day_start_min + solution.Value(time_dim.CumulVar(end_index)) / SCALE
    notes: list[str] = []
    if dropped:
        notes.append(f"{len(dropped)} 个点因时间窗/时长冲突未排入本日行程")
    if allow_drop:
        notes.append("已启用漏点惩罚模式（时间不够时丢点而不是无解）")
    if return_min > req.day_end_min + 0.5:
        notes.append(f"按当前设置，回到酒店约 {int(return_min)} 分钟当量，晚于计划收工时间")

    return SolveResult(
        order=order,
        dropped=dropped,
        objective=round(objective_of(req, weighted, order), 2),
        solver="ortools-gls",
        weighted=weighted,
        arrivals=arrivals,
        return_min=return_min,
        notes=notes,
    )


def solve(req: SolveRequest) -> SolveResult:
    """统一入口：先试 OR-Tools（硬约束 → 允许丢点），失败则降级到纯 Python 求解器。

    这里先做一次**矩阵/节点契约检查**：OR-Tools 要求「矩阵里的每个节点都必须被访问」，
    所以如果传进来的矩阵包含不在 nodes 里的点（多日模式下就是别的天的目的地），
    求解器会把它们也塞进路线里。检测到不一致时，内部自动取子矩阵并做下标映射，
    返回的顺序仍然是**原矩阵的下标空间** —— 调用方不需要关心这件事。
    """
    matrix_size = len(req.matrix.points)
    active = {node.index for node in req.nodes}
    if active and (
        matrix_size - 1 != len(active)
        or any(index not in active for index in range(1, matrix_size))
    ):
        indexes = [req.start_index] + sorted(active)
        local_of_global = {global_index: local for local, global_index in enumerate(indexes)}
        global_of_local = {local: global_index for local, global_index in enumerate(indexes)}
        sub_req = replace(
            req,
            matrix=sub_matrix(req.matrix, indexes),
            nodes=[replace(node, index=local_of_global[node.index]) for node in req.nodes],
            start_index=0,
        )
        sub_result = solve(sub_req)
        return replace(
            sub_result,
            order=[global_of_local[i] for i in sub_result.order if i in global_of_local],
            dropped=[global_of_local[i] for i in sub_result.dropped if i in global_of_local],
            arrivals={
                global_of_local[i]: value
                for i, value in sub_result.arrivals.items()
                if i in global_of_local
            },
            weighted=[],  # 加权矩阵属于子空间，跨下标空间复用会误导调用方
            notes=list(sub_result.notes) + ["已按本日节点取子矩阵求解"],
        )

    started = time.perf_counter()
    result: SolveResult | None = None
    notes: list[str] = []

    try:
        result = _solve_ortools(req, allow_drop=False)
        if result is None:
            # 时间窗过紧导致无解 → 允许丢点，把冲突点单独报给用户
            result = _solve_ortools(req, allow_drop=True)
            if result is not None:
                notes.append("存在时间窗冲突，已按漏点惩罚自动取舍")
    except ImportError:
        notes.append("未安装 OR-Tools，使用内置兜底求解器")
        result = None
    except Exception as exc:  # noqa: BLE001 - 求解器任何异常都不该让接口 500
        notes.append(f"OR-Tools 求解异常（{type(exc).__name__}），已降级：{exc}")
        result = None

    if result is None:
        result = solve_fallback(req)
        result.notes = list(result.notes) + notes

    # 用统一的时间轴推演复核一次，保证返回给前端的时间是自洽的
    arrivals, feasible, return_min = schedule(req, result.order)
    if feasible and arrivals:
        result.arrivals = arrivals
    elif not feasible:
        result.notes.append("注意：当前顺序在时间窗上不可行（可尝试减少目的地或放宽时间）")
    if result.return_min is None:
        result.return_min = return_min

    result.elapsed_ms = int((time.perf_counter() - started) * 1000)
    return result
