"""纯 Python 兜底求解器：贪心构造 + 2-opt 改进。

存在的意义：OR-Tools 在部分 Python 版本上没有 wheel，装不上时整个 Demo 就废了。
这里的实现只有几十行，保证「任何环境都能出路线」，只是最优性略差。
"""
from __future__ import annotations

from .tsp_core import (
    SolveRequest,
    SolveResult,
    build_weighted_matrix,
    is_window_feasible,
    node_window,
    objective_of,
    schedule,
)


def _construct(req: SolveRequest, weighted: list[list[float]]) -> list[int]:
    """贪心：每次挑「能按时到达、且加权成本最低」的下一个点；

    如果没有能按时到达的点，就退化为「挑最近的」，保证不会提前收场。
    """
    matrix = req.matrix
    remaining = {node.index for node in req.nodes}
    node_by_index = {node.index: node for node in req.nodes}
    order: list[int] = []
    current = req.start_index
    now = float(req.day_start_min)

    while remaining:
        best: tuple[float, int] | None = None
        for index in remaining:
            node = node_by_index[index]
            lo, hi = node_window(node, req.day_start_min, req.day_end_min)
            arrive = max(now + matrix.durations[current][index], float(lo))
            feasible = arrive + node.stay_min <= hi
            cost = weighted[current][index]
            # 不可行的点排到最后再考虑（加一个巨大的软惩罚项）
            score = cost if feasible else cost + 10_000
            if best is None or score < best[0]:
                best = (score, index)
        if best is None:
            break
        _, chosen = best
        node = node_by_index[chosen]
        lo, _hi = node_window(node, req.day_start_min, req.day_end_min)
        arrive = max(now + matrix.durations[current][chosen], float(lo))
        order.append(chosen)
        now = arrive + node.stay_min
        current = chosen
        remaining.discard(chosen)

    return order


def _two_opt(req: SolveRequest, weighted: list[list[float]], order: list[int]) -> list[int]:
    """2-opt：反转子段。只在时间窗仍然可行、且目标值下降时才接受。"""
    # 独立终点和单行道路会使两个景点的先后顺序成本不同，也需要比较反转。
    if len(order) < 2:
        return order
    best = list(order)
    best_obj = objective_of(req, weighted, best)
    improved = True
    rounds = 0
    while improved and rounds < 60:
        improved = False
        rounds += 1
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
                _arrivals, feasible, _back = schedule(req, candidate)
                if not feasible:
                    continue
                obj = objective_of(req, weighted, candidate)
                if obj + 1e-6 < best_obj:
                    best, best_obj, improved = candidate, obj, True
        # 只有确实变短才继续下一轮
    return best


def solve_fallback(req: SolveRequest) -> SolveResult:
    """贪心 + 2-opt 求解，返回与 OR-Tools 路径完全同构的结果。"""
    weighted = build_weighted_matrix(req)
    order = _construct(req, weighted)
    order = _two_opt(req, weighted, order)

    arrivals, feasible, return_min = schedule(req, order)
    notes: list[str] = ["使用内置兜底求解器（贪心 + 2-opt）"]
    dropped = [node.index for node in req.nodes if node.index not in set(order)]
    if not feasible:
        notes.append("时间窗过紧，部分点未能按时到达")

    return SolveResult(
        order=order,
        dropped=dropped,
        objective=round(objective_of(req, weighted, order), 2),
        solver="python-greedy-2opt",
        weighted=weighted,
        arrivals=arrivals,
        return_min=return_min,
        notes=notes,
    )


def prefixed_infeasible(req: SolveRequest) -> list[int]:
    """营业时间窗口本身就装不下停留时间的点（可在求解前直接剔除）。"""
    return [
        node.index
        for node in req.nodes
        if not is_window_feasible(node, req.day_start_min, req.day_end_min)
    ]
