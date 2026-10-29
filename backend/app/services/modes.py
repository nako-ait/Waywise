"""五种交通方式的参数表。

同一张表同时服务两件事：
  1) 没有高德 Web 服务 Key 时的离线估算（haversine × 绕行系数 ÷ 平均速度）；
  2) 权重目标函数里的「费用 / 换乘 / 舒适度」折算。

参数按 2024~2025 年上海市内平均水平取值，写死在代码里，便于答辩讲解与现场调参。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

TravelMode = Literal["walk", "transit", "subway", "taxi", "drive"]


@dataclass(frozen=True)
class ModeSpec:
    key: str
    label: str
    color: str
    speed_kmh: float          # 市内平均旅行速度（含起停与等待）
    detour: float             # 绕行系数 = 路网距离 / 直线距离
    fare_base: float          # 起步价（元）
    fare_per_km: float        # 超出起步里程后的单价（元/公里）
    fare_free_km: float       # 起步价包含的里程（公里）
    walk_ratio: float         # 该方式下的接驳步行系数
    walk_cap_km: float        # 单段接驳步行的上限（公里）
    transfer_min: float       # 每次换乘的等效惩罚（分钟）
    transfer_km: float        # 平均多少公里换乘一次
    comfort_min: float        # 方式本身的不适感折算（分钟）
    amap_distance_type: int   # 高德 v3/distance 的 type：1=驾车，3=步行
    amap_direction: str       # 高德 v3/direction 下的路径：walking / driving / transit
    # 进出站固定代价（分钟）：地铁/公交不是门到门的 —— 要下到站台、候车、出站再走。
    # 这笔开销**只加进距离矩阵**（影响排序决策），不加进展示耗时
    # （展示用 leg_route 的真实结果，那段已经含了接驳步行，否则会重复计算）。
    access_penalty_min: float = 0.0


MODE_SPECS: dict[str, ModeSpec] = {
    "walk": ModeSpec(
        key="walk", label="步行", color="#475569",
        speed_kmh=4.5, detour=1.25, fare_base=0.0, fare_per_km=0.0, fare_free_km=0.0,
        walk_ratio=1.0, walk_cap_km=999.0, transfer_min=0.0, transfer_km=0.0, comfort_min=0.0,
        amap_distance_type=3, amap_direction="walking", access_penalty_min=0.0,
    ),
    "transit": ModeSpec(
        key="transit", label="公交", color="#475569",
        speed_kmh=17.0, detour=1.45, fare_base=2.0, fare_per_km=0.12, fare_free_km=10.0,
        walk_ratio=0.35, walk_cap_km=1.2, transfer_min=9.0, transfer_km=5.0, comfort_min=3.0,
        amap_distance_type=1, amap_direction="transit", access_penalty_min=10.0,
    ),
    "subway": ModeSpec(
        key="subway", label="地铁", color="#475569",
        speed_kmh=30.0, detour=1.5, fare_base=3.0, fare_per_km=0.10, fare_free_km=6.0,
        walk_ratio=0.30, walk_cap_km=1.4, transfer_min=7.0, transfer_km=7.0, comfort_min=4.0,
        amap_distance_type=1, amap_direction="transit", access_penalty_min=10.0,
    ),
    "taxi": ModeSpec(
        key="taxi", label="打车", color="#475569",
        speed_kmh=24.0, detour=1.35, fare_base=16.0, fare_per_km=2.7, fare_free_km=3.0,
        walk_ratio=0.05, walk_cap_km=0.25, transfer_min=0.0, transfer_km=0.0, comfort_min=1.0,
        amap_distance_type=1, amap_direction="driving", access_penalty_min=0.0,
    ),
    "drive": ModeSpec(
        key="drive", label="驾车", color="#475569",
        speed_kmh=28.0, detour=1.35, fare_base=0.0, fare_per_km=0.8, fare_free_km=0.0,
        walk_ratio=0.15, walk_cap_km=0.6, transfer_min=0.0, transfer_km=0.0, comfort_min=2.0,
        amap_distance_type=1, amap_direction="driving", access_penalty_min=0.0,
    ),
}

DEFAULT_MODE = "transit"


def get_mode(mode: str | None) -> ModeSpec:
    """取方式参数；未知方式一律回落到公交，保证不崩。"""
    return MODE_SPECS.get(mode or DEFAULT_MODE, MODE_SPECS[DEFAULT_MODE])


def all_modes() -> list[dict]:
    """给前端下拉/按钮组用的方式清单。"""
    return [asdict(spec) for spec in MODE_SPECS.values()]


def fare_for(spec: ModeSpec, km: float) -> float:
    """按里程折算票价（不足起步里程只收起步价）。"""
    if km <= 0:
        return 0.0
    extra = max(0.0, km - spec.fare_free_km)
    return round(spec.fare_base + extra * spec.fare_per_km, 2)


def transfers_for(spec: ModeSpec, km: float) -> int:
    """估算换乘次数：只有公交/地铁才模型化。"""
    if spec.transfer_km <= 0:
        return 0
    return max(0, int(km / spec.transfer_km) - 1)


def walk_km_for(spec: ModeSpec, km: float) -> float:
    """该方式下的接驳步行里程。

    步行主要由「两端到站 + 站内换乘」构成，**与线路长度不成正比** ——
    坐 20 公里地铁不会因此走 6 公里路。所以用 min(比例 × 里程, 单段上限) 约束上界。
    （接上真实高德数据后，这一段会被每段真实的 walking_distance 覆盖。）
    """
    return round(min(km * spec.walk_ratio, spec.walk_cap_km), 3)
