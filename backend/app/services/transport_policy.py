"""按实际候选路线选择交通；矩阵距离只决定要查询什么，不决定最终步行方式。"""
from __future__ import annotations

import asyncio
import math
from dataclasses import replace

from .amap_client import LegRoute, Matrix, derive_cell, haversine_km, leg_route
from .modes import get_mode
from .tsp_core import WALK_MIN_PER_KM, YUAN_TO_MIN, normalize_weights

MAX_AUTO_WALK_MIN = 20.0
DEFAULT_DAY_WALK_KM = 6.0
SHORT_ROUTE_PROBE_KM = 3.0
Candidate = tuple[str, LegRoute]


def _score(candidate: Candidate, weights: dict, preferred: str) -> float:
    mode, route = candidate
    spec = get_mode(mode)
    value = (
        weights["time"] * route.duration_min
        + weights["cost"] * route.cost * YUAN_TO_MIN
        + weights["walking"] * route.walk_km * WALK_MIN_PER_KM
        + weights["convenience"] * (route.transfers * 8 + spec.comfort_min)
    )
    return value * (0.96 if mode == preferred else 1.0)


def _verified(route: LegRoute) -> bool:
    return route.data_source == "amap" and not route.approx


def _pool(candidates: dict[str, LegRoute]) -> list[Candidate]:
    items = list(candidates.items())
    verified = [item for item in items if _verified(item[1])]
    # 查询失败后的乐观估算不能击败已经查到的真实路线。
    return verified or items


def _choose(
    candidates: dict[str, LegRoute], preferred: str, weights: dict,
    walk_limit: float, max_minutes: float = math.inf,
) -> Candidate:
    pool = _pool(candidates)
    feasible = [item for item in pool if item[1].duration_min <= max_minutes + 1e-6]
    pool = feasible or pool
    walking = next((route for mode, route in pool if mode == "walk"), None)
    if walking and walking.duration_min > walk_limit:
        alternatives = [
            item for item in pool
            if item[0] != "walk" and item[1].walk_km < walking.walk_km
            and item[1].duration_min <= max(walking.duration_min * 1.5, walking.duration_min + 15)
        ]
        if alternatives:
            pool = alternatives
    return min(pool, key=lambda item: _score(item, weights, preferred))


def _fits(choices: list[Candidate], windows: list[tuple[float, float, float]], start: float) -> bool:
    now = start
    for (_, route), (opening, closing, stay) in zip(choices, windows):
        now = max(now + route.duration_min, opening) + stay
        if now > closing + 1e-6:
            return False
    return True


async def select_leg_routes(
    *, points: list[tuple[float, float]], pairs: list[tuple[int, int]],
    preferred_modes: list[str], locked: list[bool], matrix: Matrix,
    weights: dict, windows: list[tuple[float, float, float]], start_min: float,
    end_point: tuple[float, float] | None = None,
) -> tuple[list[LegRoute], list[str], list[str]]:
    """逐段手动覆盖不变；自动方式按真实耗时、费用、换乘和全天步行负担选择。

    windows 包含终点的 (开门, 关门, 停留)，最后一项是回酒店的时间限制。
    未取得真实路线时允许离线估算，但必须保留 approx/data_source 与提示。
    """
    if not pairs:
        return [], [], []
    weights = normalize_weights(weights)
    less_walking = max(0.0, (weights["walking"] - 0.5) * 2)
    walk_limit = MAX_AUTO_WALK_MIN - less_walking * 5
    day_walk_limit = DEFAULT_DAY_WALK_KM - less_walking * 3
    candidates: list[dict[str, LegRoute]] = [{} for _ in pairs]
    requested: set[tuple[int, str]] = set()
    notes: list[str] = []

    def endpoints(i: int):
        a, b = pairs[i]
        return points[a], end_point if b == 0 and end_point is not None else points[b]

    async def fetch(jobs: list[tuple[int, str]]) -> None:
        jobs = list(dict.fromkeys(job for job in jobs if job not in requested))
        requested.update(jobs)
        results = await asyncio.gather(*[
            leg_route(*endpoints(i), mode,
                      matrix, pairs[i][0], pairs[i][1], weights)
            for i, mode in jobs
        ], return_exceptions=True)
        for (i, mode), route in zip(jobs, results):
            if isinstance(route, LegRoute) and all(math.isfinite(value) and value >= 0 for value in (
                route.duration_min, route.distance_km, route.walk_km, route.cost,
            )):
                # 优化标记属于本次决策，不能修改缓存或共享候选对象。
                candidates[i][mode] = replace(
                    route, is_auto_optimized=False, optimization_reason=None, optimization_hint=None,
                )
            else:
                notes.append(f"第 {i + 1} 段{get_mode(mode).label}查询失败，未将其当作可用路线")

    def alternatives(i: int) -> list[tuple[int, str]]:
        preferred = preferred_modes[i]
        # 自驾不能在中途被自动换成打车，否则车辆会遗留在上一站。
        modes = ["drive"] if preferred == "drive" else [
            "subway" if preferred == "subway" else "transit", "taxi",
        ]
        return [(i, mode) for mode in modes]

    jobs = []
    for i, ((a, b), preferred) in enumerate(zip(pairs, preferred_modes)):
        jobs.append((i, preferred))
        if not locked[i] and preferred != "walk" and matrix.distances[a][b] < SHORT_ROUTE_PROBE_KM:
            jobs.append((i, "walk"))
    await fetch(jobs)

    # 整体方式只是偏好。每个自动乘车段都比较公共交通与打车，
    # 短步行也要响应时间/换乘等偏好，不能因原先选了步行而跳过比较。
    await fetch([
        job for i, preferred in enumerate(preferred_modes)
        if not locked[i] and preferred != "drive"
        for job in alternatives(i)
    ])

    # 即使上游异常也不能让整条路书 500；后备估算必须明确标示。
    for i, preferred in enumerate(preferred_modes):
        if preferred not in candidates[i]:
            a, b = endpoints(i)
            minutes, km, cost, walk, transfers = derive_cell(
                get_mode(preferred), 0, 0, haversine_km(a, b),
            )
            candidates[i][preferred] = LegRoute(
                minutes, km, cost, walk, [a, b], approx=True,
                data_source="offline", transfers=transfers,
            )

    # 以查回来的实际步行耗时触发比较，能识别跨江绕行；手动长步行也提供替代建议。
    await fetch([
        job for i, group in enumerate(candidates)
        if "walk" in group and group["walk"].duration_min > walk_limit
        for job in alternatives(i)
    ])

    choices: list[Candidate] = []
    now = start_min
    for i, (preferred, (opening, closing, stay)) in enumerate(zip(preferred_modes, windows)):
        if locked[i]:
            chosen = (preferred, candidates[i][preferred])
        else:
            max_minutes = closing - stay - now
            chosen = _choose(candidates[i], preferred, weights, walk_limit, max_minutes)
            if chosen[1].duration_min > max_minutes + 1e-6:
                await fetch(alternatives(i))
                chosen = _choose(candidates[i], preferred, weights, walk_limit, max_minutes)
        choices.append(chosen)
        now = max(now + chosen[1].duration_min, opening) + stay

    # 每段都很短仍可能累计过量：补查替代方式，按减少步行的代价逐段调整。
    total_walk = sum(route.walk_km for _, route in choices)
    if total_walk > day_walk_limit and weights["walking"] > 0:
        await fetch([
            job for i, (_, route) in enumerate(choices) if not locked[i] and route.walk_km > 0
            for job in alternatives(i)
        ])
        while total_walk > day_walk_limit + 1e-6:
            improvements = []
            for i, current in enumerate(choices):
                if locked[i]:
                    continue
                for candidate in _pool(candidates[i]):
                    saved = current[1].walk_km - candidate[1].walk_km
                    if saved <= 1e-6 or (_verified(current[1]) and not _verified(candidate[1])):
                        continue
                    trial = list(choices)
                    trial[i] = candidate
                    if _fits(trial, windows, start_min):
                        delta = _score(candidate, weights, preferred_modes[i]) - _score(current, weights, preferred_modes[i])
                        improvements.append((delta / saved, i, candidate))
            if not improvements:
                break
            _, index, replacement = min(improvements, key=lambda item: (item[0], item[1]))
            total_walk += replacement[1].walk_km - choices[index][1].walk_km
            choices[index] = replacement

    for i, ((mode, route), preferred) in enumerate(zip(choices, preferred_modes)):
        label = get_mode(mode).label
        basis = "实际路线" if _verified(route) else "离线估算"
        if not locked[i] and mode != preferred:
            route.is_auto_optimized = True
            route.optimization_reason = (
                f"按{basis}比较耗时、费用、换乘及全天步行负担，"
                f"这段改用{label}（约 {route.duration_min:.0f} 分钟，¥{route.cost:.0f}）"
            )
            notes.append(f"第 {i + 1} 段：{route.optimization_reason}")
        if mode == "walk" and route.duration_min > walk_limit:
            other = [item for item in _pool(candidates[i]) if item[0] != "walk"]
            hint = f"这段步行需 {route.duration_min:.0f} 分钟"
            if locked[i]:
                hint = "已保留你指定的步行；" + hint
            if other:
                other_mode, other_route = min(other, key=lambda item: _score(item, weights, preferred))
                source = "约" if _verified(other_route) else "离线估算约"
                hint += f"；可选{get_mode(other_mode).label}，{source} {other_route.duration_min:.0f} 分钟、¥{other_route.cost:.0f}"
            else:
                hint += "；未取得可替代的已核验交通方案，请确认后再出发"
            route.optimization_hint = hint
            notes.append(f"第 {i + 1} 段：{hint}")
    if total_walk > day_walk_limit + 1e-6:
        reason = ("当前未提高少走路偏好，已保留按费用/时间等偏好选择的交通，请确认体力安排"
                  if weights["walking"] <= 0 else
                  "受手动选择、时间窗或可用路线限制，未能进一步减少，请确认体力安排")
        notes.append(
            f"全天交通步行约 {total_walk:.1f} 公里，超过建议的 {day_walk_limit:g} 公里；"
            + reason
        )
    return [route for _, route in choices], [mode for mode, _ in choices], notes
