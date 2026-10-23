"""多日拆分：地理聚类分天 → 时间均衡 → 每天各自求 TSP。

为什么不是「一次性 VRP」：
  本项目的约束里，酒店是**每天共同的起点和终点**（晚上回同一家酒店），
  所以问题天然可分解为「先分天，再每天 TSP」。这样有三个好处：
    1) 规模小，OR-Tools 秒级收敛，演示不会卡；
    2) 分天结果可解释（"第 1 天在黄浦-静安，第 2 天在浦东"），符合游客直觉；
    3) 每天都能独立套用营业时间窗与午餐约束，不用把 7 天的时间轴塞进一个模型。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .amap_client import LatLng, Matrix, haversine_km
from .cluster import centroid, group_spread_km, kmeans


@dataclass
class DaySplit:
    """分天结果。groups[i] 是第 i 天包含的矩阵下标（不含酒店 0）。"""

    groups: list[list[int]] = field(default_factory=list)
    method: str = "kmeans+balance"
    notes: list[str] = field(default_factory=list)
    balance_gap_min: float = 0.0
    spreads_km: list[float] = field(default_factory=list)


def estimate_day_minutes(
    group: list[int],
    matrix: Matrix,
    stay_by_index,
    start_index: int = 0,
) -> float:
    """用最近邻顺序估算一天的总时长（交通 + 停留），作为均衡的代价函数。

    这里不需要精确最优 —— 均衡只是给 OR-Tools 一个合理的初始分组，
    真正的最优顺序由每天的 TSP 负责。
    """
    if not group:
        return 0.0
    remaining = set(group)
    current = start_index
    total = 0.0
    while remaining:
        nxt = min(remaining, key=lambda j: matrix.durations[current][j])
        total += matrix.durations[current][nxt] + stay_by_index(nxt)
        current = nxt
        remaining.discard(nxt)
    total += matrix.durations[current][start_index]
    return total


def _variance(values: list[float]) -> float:
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / len(values)


def split_into_days(
    points: list[LatLng],
    matrix: Matrix,
    days: int,
    *,
    stay_by_index,
    day_budget_min: float,
    max_per_day: int | None = None,
) -> DaySplit:
    """把目的地分成 days 天：KMeans 地理聚类 + 时间均衡。"""
    dest_indexes = list(range(1, len(points)))
    notes: list[str] = []

    if days <= 1 or len(dest_indexes) <= 1:
        return DaySplit(groups=[dest_indexes], method="single-day", notes=notes)

    k = min(days, len(dest_indexes))
    labels = kmeans([points[i] for i in dest_indexes], k)
    cluster_count = max(labels) + 1
    groups: list[list[int]] = [[] for _ in range(max(k, cluster_count))]
    for position, label in enumerate(labels):
        groups[label].append(dest_indexes[position])

    # 聚类可能产生空簇：把多出来的空天留给均衡阶段填充
    if max_per_day is None:
        max_per_day = max(1, int(len(dest_indexes) / max(1, k) * 2))

    loads = [estimate_day_minutes(g, matrix, stay_by_index) for g in groups]
    before_gap = max(loads) - min(loads) if loads else 0.0

    # ---- 时间均衡：把最重的一天里的「边缘点」挪给最轻的一天 ----
    for _ in range(200):
        loads = [estimate_day_minutes(g, matrix, stay_by_index) for g in groups]
        heaviest = max(range(len(groups)), key=lambda i: loads[i])
        lightest = min(range(len(groups)), key=lambda i: loads[i])
        if heaviest == lightest or len(groups[heaviest]) <= 1:
            break
        if len(groups[lightest]) >= max_per_day:
            break

        light_center = centroid(points, groups[lightest])
        candidate = min(
            groups[heaviest],
            key=lambda idx: haversine_km(points[idx], light_center),
        )
        new_heavy = [i for i in groups[heaviest] if i != candidate]
        new_light = groups[lightest] + [candidate]
        heavy_load = estimate_day_minutes(new_heavy, matrix, stay_by_index)
        light_load = estimate_day_minutes(new_light, matrix, stay_by_index)

        trial = list(loads)
        trial[heaviest] = heavy_load
        trial[lightest] = light_load
        # 只接受「更均衡」且不会把轻的那天也顶爆的移动
        if _variance(trial) < _variance(loads) - 1e-9 and light_load <= day_budget_min * 1.15:
            groups[heaviest] = new_heavy
            groups[lightest] = new_light
            continue
        break

    # 丢掉真的空的天（例如请求 5 天但只有 3 个目的地）
    groups = [g for g in groups if g]

    final_loads = [estimate_day_minutes(g, matrix, stay_by_index) for g in groups]
    spread = [group_spread_km(points, g) for g in groups]
    gap = (max(final_loads) - min(final_loads)) if final_loads else 0.0

    notes.append(
        "地理聚类分天："
        + " / ".join(
            f"第{i + 1}天 {len(g)} 点（约 {int(load)} 分钟，跨度 {spread[i]} km）"
            for i, (g, load) in enumerate(zip(groups, final_loads))
        )
    )
    if len(groups) < days:
        notes.append(f"请求 {days} 天，实际只有 {len(groups)} 天有行程（目的地数量不足）")

    return DaySplit(
        groups=groups,
        method="kmeans+balance",
        notes=notes,
        balance_gap_min=round(gap, 1),
        spreads_km=spread,
    )
