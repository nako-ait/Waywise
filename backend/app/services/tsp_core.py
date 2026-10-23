"""TSP 求解的公共部分：目标函数、时间窗、时间轴推演。

OR-Tools 求解器（solver.py）与纯 Python 兜底求解器（tsp_fallback.py）共用这里的一切，
保证两条路径的最优性判据完全一致 —— 兜底时路线质量可能略差，但口径不会变。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .amap_client import Matrix
from .modes import get_mode

# 步行 1 公里 ≈ 13.3 分钟（4.5 km/h）
WALK_MIN_PER_KM = 60.0 / 4.5
# 花钱的「心理成本」折算：1 元 ≈ 3 分钟当量，让权重滑杆有可比尺度
YUAN_TO_MIN = 3.0
# 漏掉一个用户选中的点，惩罚 10 小时当量（≈ 逼着求解器尽量都排进去）
UNVISITED_PENALTY_MIN = 600.0

DEFAULT_WEIGHTS: dict[str, float] = {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5}


@dataclass
class NodeSpec:
    """一个待排点的约束与元信息。"""

    index: int                  # 在矩阵中的下标（0 固定是酒店）
    label: str
    stay_min: int = 60
    open_min: int | None = None   # 营业开始（当日分钟）
    close_min: int | None = None  # 营业结束（当日分钟）
    must_visit: bool = True
    tags: tuple[str, ...] = ()
    dropped_reason: str | None = None


@dataclass
class SolveRequest:
    matrix: Matrix
    nodes: list[NodeSpec]
    start_index: int = 0
    weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    day_start_min: int = 9 * 60
    day_end_min: int = 21 * 60
    time_limit_s: float = 2.0


@dataclass
class SolveResult:
    order: list[int]                                  # 访问顺序（不含起点）
    dropped: list[int] = field(default_factory=list)  # 没排进去的点（矩阵下标）
    objective: float = 0.0                            # 加权目标值（分钟当量）
    solver: str = ""
    elapsed_ms: int = 0
    weighted: list[list[float]] = field(default_factory=list)
    arrivals: dict[int, float] = field(default_factory=dict)  # 矩阵下标 -> 到达时刻（当日分钟）
    return_min: float | None = None                           # 回到酒店的时刻（当日分钟）
    notes: list[str] = field(default_factory=list)


def normalize_weights(raw: dict | None) -> dict[str, float]:
    """把 0~1 的滑杆值裁剪到合法区间；全 0 时回落到默认权重。"""
    merged = {key: float((raw or {}).get(key, default)) for key, default in DEFAULT_WEIGHTS.items()}
    merged = {key: min(max(value, 0.0), 1.0) for key, value in merged.items()}
    if sum(merged.values()) <= 0:
        return dict(DEFAULT_WEIGHTS)
    return merged


def node_window(node: NodeSpec, day_start: int, day_end: int) -> tuple[int, int]:
    """营业时间与行程时间的交集 [最早可到, 最晚可到+停留]。"""
    lo = day_start if node.open_min is None else max(day_start, node.open_min)
    hi = day_end if node.close_min is None else min(day_end, node.close_min)
    return lo, hi


def is_window_feasible(node: NodeSpec, day_start: int, day_end: int) -> bool:
    """营业时间窗口是否容得下这次停留。"""
    lo, hi = node_window(node, day_start, day_end)
    return (hi - lo) >= node.stay_min


def build_weighted_matrix(req: SolveRequest) -> list[list[float]]:
    """加权成本矩阵（单位：分钟当量）。

    总成本 = w1×交通时间 + w2×换乘惩罚 + w3×费用折算 + w4×步行折算
    换乘惩罚只算「换乘次数 × 每次惩罚 + 方式不适感」，交通时间本身保持纯净，
    这样时间轴里展示的耗时就是用户真实感受到的耗时，两套口径不会互相污染。
    """
    weights = normalize_weights(req.weights)
    matrix = req.matrix
    spec = get_mode(matrix.mode)
    size = matrix.size
    weighted = [[0.0] * size for _ in range(size)]
    for i in range(size):
        for j in range(size):
            if i == j:
                continue
            transfer_penalty = matrix.transfers[i][j] * spec.transfer_min
            weighted[i][j] = (
                weights["time"] * matrix.durations[i][j]
                + weights["convenience"] * (transfer_penalty + spec.comfort_min)
                + weights["cost"] * matrix.costs[i][j] * YUAN_TO_MIN
                + weights["walking"] * matrix.walk_km[i][j] * WALK_MIN_PER_KM
            )
    return weighted


def schedule(req: SolveRequest, order: list[int]) -> tuple[dict[int, float], bool, float]:
    """按给定顺序推演时间轴。

    规则：到达时刻 = max(上一站离开 + 交通耗时, 营业开始)；离开 = 到达 + 停留；
    离开不得晚于营业结束；最后必须能在收工时间前回到酒店。

    注意：午餐时间已经并进「午餐站」的 stay_min（见 planner 的两遍求解），
    所以这里不需要任何额外的时间偏移 —— 求解器与时间轴用的是同一套停留时间。
    返回 (到达时刻表, 是否满足所有约束, 回到酒店的时刻)。
    """
    matrix = req.matrix
    node_by_index = {node.index: node for node in req.nodes}
    arrivals: dict[int, float] = {}
    current = req.start_index
    now = float(req.day_start_min)

    for index in order:
        node = node_by_index[index]
        now += matrix.durations[current][index]
        lo, hi = node_window(node, req.day_start_min, req.day_end_min)
        arrive = max(now, float(lo))
        leave = arrive + node.stay_min
        if leave > hi:
            return arrivals, False, leave
        arrivals[index] = arrive
        now = leave
        current = index

    back = now + matrix.durations[current][req.start_index]
    return arrivals, back <= req.day_end_min, back


def objective_of(req: SolveRequest, weighted: list[list[float]], order: list[int]) -> float:
    """按加权矩阵累计目标值（不含未访问惩罚）。"""
    if not order:
        return 0.0
    total = weighted[req.start_index][order[0]]
    for prev, nxt in zip(order, order[1:]):
        total += weighted[prev][nxt]
    total += weighted[order[-1]][req.start_index]
    return total
