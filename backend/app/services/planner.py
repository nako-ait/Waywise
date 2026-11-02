"""规划编排：距离矩阵 → 分天（多日）→ 每天求解 → 逐段精修 → 时间轴 → 统计 → 解释。

模块 2 交付单日路径，模块 3 在这里接上多日分天（services/vrp.py）。
单日与多日共用同一套「一天怎么排」的实现（_plan_one_day），所以口径永远一致。
"""
from __future__ import annotations

import asyncio
import time
from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, timedelta

from ..config import settings
from ..models import (
    Destination,
    Hotel,
    PlanDay,
    PlanDayStats,
    PlanRequest,
    PlanResponse,
    PlanStop,
    TransitOption,
    TransitRide,
    TransportLeg,
)
from . import amap_client, cache
from .amap_client import Matrix, build_matrix, leg_route
from .modes import get_mode
from .solver import solve
from .transport_policy import select_leg_routes
from .timeutil import hhmm_to_min, min_to_hhmm, parse_business_hours
from .tsp_core import (
    NodeSpec,
    SolveRequest,
    is_window_feasible,
    node_window,
    normalize_weights,
)
from .vrp import split_into_days


def _finish_matrix(matrix: Matrix, full: Matrix, end_index: int | None, mode: str) -> Matrix:
    """Split-depot formulation: departure row remains the origin; depot incoming
    arcs represent the chosen terminal. Free-end incoming arcs have zero cost.
    This gives both OR-Tools and the fallback the same open-path objective.
    """
    if mode == "return":
        return matrix
    changes = {}
    for name in ("durations", "distances", "costs", "walk_km", "transfers"):
        original = getattr(matrix, name)
        values = [list(row) for row in original]
        for i in range(matrix.size):
            values[i][0] = getattr(full, name)[i][end_index] if mode == "custom" and end_index is not None and i else 0
        changes[name] = values
    return replace(matrix, **changes)


def _selected(req: PlanRequest) -> list[Destination]:
    """取参与规划的目的地：优先用 selected 标记；都没标记时把整份列表当作已选（方便 curl 直接调）。"""
    picked = [d for d in req.destinations if d.selected]
    return picked if picked else list(req.destinations)


def _leg_provenance(leg) -> dict:
    return {"costSource": leg.cost_source, "costApprox": leg.cost_approx,
            "queriedAt": leg.queried_at, "cacheHit": leg.cache_hit,
            "drivingMin": leg.driving_min, "accessWalkMin": leg.access_walk_min}


def _build_nodes(
    picked: list[Destination], req: PlanRequest
) -> tuple[list[NodeSpec], list[dict]]:
    """构造求解节点，并提前剔除「营业时间窗口装不下停留时间」的点。"""
    day_start = hhmm_to_min(req.options.dayStartTime, 9 * 60)
    day_end = hhmm_to_min(req.options.dayEndTime, 21 * 60)
    must_visit = set(req.options.mustVisitIds or [])

    nodes: list[NodeSpec] = []
    pre_dropped: list[dict] = []
    for offset, dest in enumerate(picked, start=1):
        window = parse_business_hours(dest.openTime, dest.closeTime)
        node = NodeSpec(
            index=offset,
            label=dest.name,
            stay_min=int(dest.stayMin or 60),
            open_min=window[0] if window else None,
            close_min=window[1] if window else None,
            must_visit=(dest.id in must_visit) if must_visit else True,
            tags=tuple(dest.tags or ()),
        )
        if not is_window_feasible(node, day_start, day_end):
            lo, hi = node_window(node, day_start, day_end)
            node.dropped_reason = (
                f"营业时间 {dest.openTime or '—'}~{dest.closeTime or '—'} 容不下 "
                f"{node.stay_min} 分钟停留（行程窗口 {min_to_hhmm(lo)}~{min_to_hhmm(hi)}）"
            )
            pre_dropped.append({"id": dest.id, "name": dest.name, "reason": node.dropped_reason})
            continue
        nodes.append(node)

    return nodes, pre_dropped


@dataclass
class _RawStop:
    """时间轴推演的中间态：时刻全部用当日分钟数，最后再转 HH:mm。"""

    index: int
    dest: Destination
    arrive: float
    leave: float
    stay: float
    leg: object  # LegRoute


@dataclass
class _DayResult:
    """一天的结果，供 create_plan 汇总。"""

    day: PlanDay
    polylines: list[list[tuple[float, float]]]
    dropped: list[dict]
    notes: list[str]
    solver_name: str
    objective: float
    lunch_stop: str | None
    explanation: str


def _pick_lunch_index(result, lunch_window: tuple[str, str]) -> int | None:
    """挑「最适合吃午饭」的那一站。

    优先：到达时刻正好落在午餐窗口内的第一站；
    其次：窗口开始前到达的最后一站（早一点吃）；
    最后：第一站兜底。
    """
    if not result.order:
        return None
    start = hhmm_to_min(lunch_window[0], 11 * 60 + 30)
    end = hhmm_to_min(lunch_window[1], 13 * 60 + 30)
    in_window = [i for i in result.order if start <= result.arrivals.get(i, -1) <= end]
    if in_window:
        return in_window[0]
    before = [i for i in result.order if result.arrivals.get(i, 0) < start]
    if before:
        return before[-1]
    return result.order[0]


async def _plan_one_day(
    *,
    req: PlanRequest,
    matrix: Matrix,
    points: list[tuple[float, float]],
    nodes: list[NodeSpec],
    index_to_dest: dict[int, Destination],
    weights: dict[str, float],
    day_start_min: int,
    day_end_min: int,
    lunch_min: int,
    date_str: str,
    title: str,
) -> _DayResult:
    """排好一天：求解 → 逐段精确路径 → 时间轴 → 统计。"""
    notes: list[str] = []
    mode_spec = get_mode(req.mode)
    has_terminal_leg = req.endMode != "last_stop"
    terminal_point = (req.endPoint.lng, req.endPoint.lat) if req.endMode == "custom" and req.endPoint else None

    # ---- 求解 ----
    # 注意：多日模式下传进来的是「全部点」的矩阵，而 nodes 只有本日的点。
    # solver.solve() 内部会自动按 nodes 取子矩阵并做下标映射，
    # 所以这里拿到 result.order / result.dropped 已经是全局下标，直接用即可。
    solve_req = SolveRequest(
        matrix=matrix,
        nodes=nodes,
        start_index=0,
        weights=weights,
        day_start_min=day_start_min,
        day_end_min=day_end_min,
        time_limit_s=settings.solver_time_limit_s,
    )

    # 午餐：两遍求解。
    # 第一遍快速探出「哪一站最适合吃午饭」，第二遍把午餐分钟数并进那一站的服务时间。
    # 为什么不事后在时间轴上加 60 分钟？那样求解器算时间窗时是「乐观」的，会出现
    # 「16:45 关门的豫园被排到 17:06」这种自相矛盾的结果 —— 求解口径必须和时间轴一致。
    base_stay = {node.index: node.stay_min for node in nodes}
    lunch_index: int | None = None
    if lunch_min > 0 and nodes:
        probe = replace(solve_req, time_limit_s=settings.solver_probe_time_limit_s)
        lunch_index = _pick_lunch_index(solve(probe), req.options.lunchWindow)
        if lunch_index is not None:
            nodes = [
                replace(node, stay_min=node.stay_min + lunch_min)
                if node.index == lunch_index
                else node
                for node in nodes
            ]
            solve_req = replace(solve_req, nodes=nodes)

    result = solve(solve_req)
    notes.extend(result.notes)

    order = list(result.order)
    stay_of_global = {node.index: node.stay_min for node in nodes}

    dropped: list[dict] = []
    for index in result.dropped:
        dest = index_to_dest.get(index)
        if dest is None:
            continue
        dropped.append(
            {
                "id": dest.id,
                "name": dest.name,
                "reason": "时间窗与全天时长冲突，求解器判定排不进来",
                "day": title,
            }
        )

    # 交通方式必须按实际路线选择；逐段覆盖视为用户明确指定。
    # 更换方式后重新推演营业时间、午餐和回程，避免展示已不可执行的时间轴。
    leg_modes_req = req.legModes or {}
    nodes_by_index = {node.index: node for node in nodes}
    while True:
        raw_stops: list[_RawStop] = []
        if not order:
            legs, leg_mode_keys, route_notes = [], [], []
            break
        order_with_hotel = [0] + order + ([0] if has_terminal_leg else [])
        pairs = list(zip(order_with_hotel, order_with_hotel[1:]))
        keys = [index_to_dest[index].id for index in order] + (["__return__"] if has_terminal_leg else [])
        preferred_modes = [get_mode(leg_modes_req.get(key, mode_spec.key)).key for key in keys]
        windows = [
            (*node_window(nodes_by_index[index], day_start_min, day_end_min), stay_of_global[index])
            for index in order
        ] + ([(day_start_min, day_end_min, 0)] if has_terminal_leg else [])
        legs, leg_mode_keys, route_notes = await select_leg_routes(
            points=points, pairs=pairs, preferred_modes=preferred_modes,
            locked=[key in leg_modes_req for key in keys], matrix=matrix, weights=weights,
            windows=windows, start_min=day_start_min,
            end_point=terminal_point,
        )
        now = float(day_start_min)
        invalid_index: int | None = None
        reason = ""
        for leg, node_index in zip(legs, order):
            node = nodes_by_index[node_index]
            opening, closing = node_window(node, day_start_min, day_end_min)
            stay = float(stay_of_global[node_index])
            arrive = max(now + leg.duration_min, float(opening))
            leave = arrive + stay
            if leave > closing + 1e-6:
                invalid_index = node_index
                reason = (
                    f"按交通路线推演，{min_to_hhmm(arrive)} 到达、"
                    f"{min_to_hhmm(leave)} 完成停留，超过营业/行程截止 {min_to_hhmm(closing)}"
                )
                break
            raw_stops.append(_RawStop(
                index=node_index, dest=index_to_dest[node_index], arrive=arrive,
                leave=leave, stay=stay, leg=leg,
            ))
            now = leave
        finish_min = now + (legs[-1].duration_min if has_terminal_leg else 0)
        if invalid_index is None and finish_min > day_end_min + 1e-6:
            invalid_index = order[-1]
            finish_action = "回酒店" if req.endMode == "return" else "到达指定终点" if req.endMode == "custom" else "结束行程"
            reason = (
                f"按交通路线推演将于 {min_to_hhmm(finish_min)} {finish_action}，"
                f"超过 {min_to_hhmm(day_end_min)}；保留终段交通时间后无法排入"
            )
        if invalid_index is None:
            break
        dest = index_to_dest[invalid_index]
        dropped.append({"id": dest.id, "name": dest.name, "reason": reason, "day": title})
        notes.append(f"「{dest.name}」未排入：{reason}，请调整地点、停留或出行时间")
        order.remove(invalid_index)
        # 被移除的地点若包含午餐，将午餐转移到仍在行程中的合适站点，再校验。
        if invalid_index == lunch_index:
            lunch_index = _pick_lunch_index(replace(result, order=order), req.options.lunchWindow)
            nodes = [replace(
                node, stay_min=base_stay[node.index] + (lunch_min if node.index == lunch_index else 0),
            ) for node in nodes]
            nodes_by_index = {node.index: node for node in nodes}
            stay_of_global = {node.index: node.stay_min for node in nodes}
    notes.extend(route_notes)

    stops = [
        PlanStop(
            id=stop.dest.id,
            name=stop.dest.name,
            lng=stop.dest.lng,
            lat=stop.dest.lat,
            arriveTime=min_to_hhmm(stop.arrive),
            leaveTime=min_to_hhmm(stop.leave),
            stayMin=int(round(stop.stay)),
            lunchMin=lunch_min if stop.index == lunch_index else 0,
            transportFromPrev=TransportLeg(
                mode=leg_mode_keys[index] if index < len(leg_mode_keys) else mode_spec.key,
                durationMin=round(stop.leg.duration_min, 1),
                cost=round(stop.leg.cost, 2),
                distanceKm=round(stop.leg.distance_km, 2),
                walkKm=round(stop.leg.walk_km, 3),
                transfers=int(getattr(stop.leg, "transfers", 0)),
                approx=bool(stop.leg.approx),
                dataSource=stop.leg.data_source,
                **_leg_provenance(stop.leg),
                transitOptions=_transit_options_of(stop.leg),
                transitLabel=getattr(stop.leg, "transit_label", None),
                isAutoOptimized=bool(getattr(stop.leg, "is_auto_optimized", False)),
                optimizationReason=getattr(stop.leg, "optimization_reason", None),
                optimizationHint=getattr(stop.leg, "optimization_hint", None),
                transportMode=leg_mode_keys[index] if index < len(leg_mode_keys) else mode_spec.key,
            ),
        )
        for index, stop in enumerate(raw_stops)
    ]

    stats = PlanDayStats(
        totalWalkKm=round(sum(leg.walk_km for leg in legs), 2),
        totalTransitMin=round(sum(leg.duration_min for leg in legs), 1),
        totalCost=round(sum(leg.cost for leg in legs), 2),
    )

    return_min = result.return_min
    polylines = [[(round(p[0], 6), round(p[1], 6)) for p in leg.polyline] for leg in legs]
    lunch_stop = next((s.name for s in stops if s.lunchMin > 0), None)

    # 回程段（最后一站 → 酒店）单独回传给前端，时间轴才能像其他段一样显示时长/里程
    return_leg: TransportLeg | None = None
    if has_terminal_leg and legs and order:
        back = legs[-1]
        return_leg = TransportLeg(
            mode=leg_mode_keys[-1] if leg_mode_keys else mode_spec.key,
            durationMin=round(back.duration_min, 1),
            cost=round(back.cost, 2),
            distanceKm=round(back.distance_km, 2),
            walkKm=round(back.walk_km, 3),
            transfers=int(getattr(back, "transfers", 0)),
            approx=bool(back.approx),
            dataSource=back.data_source,
            **_leg_provenance(back),
            transitOptions=_transit_options_of(back),
            transitLabel=getattr(back, "transit_label", None),
            isAutoOptimized=bool(getattr(back, "is_auto_optimized", False)),
            optimizationReason=getattr(back, "optimization_reason", None),
            optimizationHint=getattr(back, "optimization_hint", None),
            transportMode=leg_mode_keys[-1] if leg_mode_keys else mode_spec.key,
        )

    # ---- 回程时刻以「逐段实算」为准 ----
    # 时间轴上每一段都来自 leg_route()（真实路径规划），如果这里改用求解器的
    # 矩阵估算值，就会出现「16:54 离开 + 回程 218 分钟 = 14:24 到酒店」这种自相矛盾。
    # 两者口径不同（矩阵用于排序、方向 API 用于展示），展示必须以实算为准。
    solver_return = result.return_min
    computed_return = raw_stops[-1].leave + (legs[-1].duration_min if has_terminal_leg else 0) if raw_stops else None
    return_min = computed_return if computed_return is not None else solver_return
    if not raw_stops:
        return_min = None
        if req.endMode == "custom":
            notes.append("没有排出经过所选地点到达指定终点的可执行行程，请增加时间或减少地点")
    if (
        computed_return is not None
        and solver_return is not None
        and abs(computed_return - solver_return) > 20
    ):
        notes.append(
            f"距离矩阵与逐段实算相差约 {abs(computed_return - solver_return):.0f} 分钟，"
            f"时间轴按逐段实算展示"
        )
    overtime_min = max(0.0, (return_min or day_end_min) - day_end_min)

    explanation = _explain_day(
        req=req,
        stops=stops,
        stats=stats,
        dropped=dropped,
        solver_name=result.solver,
        lunch_min=lunch_min,
        lunch_stop=lunch_stop,
        return_min=return_min,
        overtime_min=overtime_min,
    )

    return _DayResult(
        day=PlanDay(
            date=date_str,
            endMode=req.endMode,
            endPoint=req.endPoint if req.endMode == "custom" else req.hotel if req.endMode == "return" else (
                Hotel(name=stops[-1].name, lng=stops[-1].lng, lat=stops[-1].lat) if stops else None
            ),
            title=title,
            stops=stops,
            stats=stats,
            returnTime=min_to_hhmm(return_min) if return_min else None,
            overtimeMin=round(overtime_min, 1),
            returnLeg=return_leg,
            polylines=polylines,
        ),
        polylines=polylines,
        dropped=dropped,
        notes=notes,
        solver_name=result.solver,
        objective=result.objective,
        lunch_stop=lunch_stop,
        explanation=explanation,
    )


async def create_plan(req: PlanRequest) -> PlanResponse:
    token = amap_client.routing_city.set((req.cityName or "").strip())
    try:
        return await _create_plan(req)
    finally:
        amap_client.routing_city.reset(token)


async def _create_plan(req: PlanRequest) -> PlanResponse:
    """编译路书：单日直接排；多日先地理聚类分天，再每天各自求 TSP。"""
    started = time.perf_counter()
    picked = _selected(req)
    hotel_point = (req.hotel.lng, req.hotel.lat)
    mode_spec = get_mode(req.mode)
    warnings: list[str] = []

    if not picked:
        return PlanResponse(
            days=[PlanDay(date=date.today().isoformat(), stops=[], stats=PlanDayStats())],
            explanation="还没有选中任何目的地：在地图上点选候选点，或直接用「一键载入演示线路」。",
            polylines=[],
            solver={"name": "noop", "dataSource": "none", "elapsedMs": 0, "warnings": warnings},
        )

    # ---------- 1. 距离矩阵（所有点一起算，分天后再取子矩阵） ----------
    points = [hotel_point] + [(d.lng, d.lat) for d in picked]
    full_points = points + ([(req.endPoint.lng, req.endPoint.lat)] if req.endMode == "custom" and req.endPoint else [])
    full_matrix: Matrix = await build_matrix(full_points, mode_spec.key)
    matrix = amap_client.sub_matrix(full_matrix, list(range(len(points)))) if len(full_points) > len(points) else full_matrix
    warnings.extend(matrix.warnings)

    # ---------- 2. 建模 ----------
    nodes, pre_dropped = _build_nodes(picked, req)
    weights = normalize_weights(req.weights.model_dump())
    day_start_min = hhmm_to_min(req.options.dayStartTime, 9 * 60)
    day_end_min = hhmm_to_min(req.options.dayEndTime, 21 * 60)
    lunch_min = int(req.options.lunchBreakMin or 0)
    index_to_dest = {offset: dest for offset, dest in enumerate(picked, start=1)}
    stay_by_index = lambda index: next(  # noqa: E731 - 就地小函数，读起来更直观
        (n.stay_min for n in nodes if n.index == index), 60
    )

    # ---------- 3. 分天 ----------
    day_count = max(1, req.days)
    if day_count > 1 and len(nodes) > 1:
        split = split_into_days(
            points,
            matrix,
            day_count,
            stay_by_index=stay_by_index,
            day_budget_min=float(day_end_min - day_start_min),
        )
        groups = split.groups
        warnings.extend(split.notes)
    else:
        groups = [[node.index for node in nodes]]
    active_indexes = {node.index for node in nodes}
    groups = [[index for index in group if index in active_indexes] for group in groups]
    groups = [group for group in groups if group]

    # ---------- 4. 逐天排 ----------
    day_results: list[_DayResult] = []
    for day_index, group in enumerate(groups):
        if not group:
            continue
        day_nodes = [node for node in nodes if node.index in set(group)]
        day_req = req if day_index == len(groups) - 1 else req.model_copy(update={"endMode": "return", "endPoint": None})
        day_matrix = _finish_matrix(matrix, full_matrix, len(points) if req.endMode == "custom" else None, day_req.endMode)
        day_results.append(
            await _plan_one_day(
                req=day_req,
                matrix=day_matrix,
                points=points,
                nodes=day_nodes,
                index_to_dest=index_to_dest,
                weights=weights,
                day_start_min=day_start_min,
                day_end_min=day_end_min,
                lunch_min=lunch_min,
                date_str=(date.today() + timedelta(days=day_index)).isoformat(),
                title=_day_title(day_index + 1, day_nodes, index_to_dest),
            )
        )

    if not day_results:
        return PlanResponse(
            days=[PlanDay(date=date.today().isoformat(), stops=[], stats=PlanDayStats(),
                          endMode=req.endMode, endPoint=req.endPoint if req.endMode == "custom" else req.hotel if req.endMode == "return" else None)],
            explanation="本日没有可排入行程的目的地，请检查营业时间与停留时长设置。",
            polylines=[],
            solver={"name": "noop", "dataSource": matrix.data_source, "warnings": warnings,
                    "dropped": pre_dropped, "endMode": req.endMode, "cityName": req.cityName,
                    "visitedCount": 0, "requestedCount": len(picked)},
        )

    for result in day_results:
        # 去重：午餐探测与最终求解会给出同一条 note
        warnings.extend(note for note in result.notes if note not in warnings)

    dropped = list(pre_dropped)
    for result in day_results:
        dropped.extend(result.dropped)

    total_stats = PlanDayStats(
        totalWalkKm=round(sum(r.day.stats.totalWalkKm for r in day_results), 2),
        totalTransitMin=round(sum(r.day.stats.totalTransitMin for r in day_results), 1),
        totalCost=round(sum(r.day.stats.totalCost for r in day_results), 2),
    )

    total_stats = total_stats  # noqa: PLW0127 - 仅提示：下面按 limits 做校验
    limits = getattr(req, "limits", None)
    limit_report: dict | None = None
    if limits is not None and (limits.budgetCap is not None or limits.transitCapMin is not None):
        violations: list[str] = []
        if limits.budgetCap is not None and total_stats.totalCost > limits.budgetCap:
            violations.append(
                f"费用约 ¥{total_stats.totalCost:.0f}，超出你给的 ¥{limits.budgetCap:.0f} 预算"
            )
        if limits.transitCapMin is not None and total_stats.totalTransitMin > limits.transitCapMin:
            violations.append(
                f"路上约 {total_stats.totalTransitMin:.0f} 分钟，超出你给的 {limits.transitCapMin:.0f} 分钟上限"
            )
        limit_report = {
            "budgetCap": limits.budgetCap,
            "transitCapMin": limits.transitCapMin,
            "actualCost": total_stats.totalCost,
            "actualTransitMin": total_stats.totalTransitMin,
            "violations": violations,
        }
        warnings.extend(violations)

    return PlanResponse(
        days=[r.day for r in day_results],
        explanation=_explain_overall(
            req=req,
            results=day_results,
            total=total_stats,
            dropped=dropped,
            data_source=matrix.data_source,
            weights=weights,
            warnings=warnings,
        ),
        # 兼容模块 2 的前端契约：顶层 polylines = 第 1 天的折线（多日请读 days[i].polylines）
        polylines=day_results[0].polylines,
        solver={
            "routingVersion": amap_client.ROUTING_DATA_VERSION,
            "cityName": req.cityName,
            "endMode": req.endMode,
            "name": day_results[0].solver_name,
            "objectiveMinutes": round(sum(r.objective for r in day_results), 2),
            "dataSource": matrix.data_source,
            "elapsedMs": int((time.perf_counter() - started) * 1000),
            "dropped": dropped,
            "weights": weights,
            "mode": mode_spec.key,
            "modeLabel": mode_spec.label,
            "dayCount": len(day_results),
            "requestedDays": day_count,
            "visitedCount": sum(len(r.day.stops) for r in day_results),
            "requestedCount": len(picked),
            "totalStats": total_stats.model_dump(),
            "limits": limit_report,
            "warnings": warnings,
            "cache": cache.stats(),
            "legsApprox": sum(
                1 for r in day_results for leg in r.polylines if len(leg) <= 2
            ),
            "splitMethod": "kmeans+balance" if day_count > 1 else "single-day",
        },
    )


def _day_title(day_number: int, day_nodes: list[NodeSpec], index_to_dest: dict[int, Destination]) -> str:
    """给每天起个可读的标题：「第 2 天 · 江景」。"""
    tags: list[str] = []
    for node in day_nodes:
        dest = index_to_dest.get(node.index)
        if dest and dest.tags:
            tags.extend(dest.tags)
    if tags:
        return f"第{day_number}天 · {Counter(tags).most_common(1)[0][0]}"
    return f"第{day_number}天"


def _transit_options_of(leg) -> list[TransitOption] | None:
    """把 leg_route 解析出的候选方案转成响应模型（最多留 3 条，前端够对比了）。

    用户能在这里直接看到「直达」和「公交+地铁换乘」两类方案的区别。
    """
    raw = getattr(leg, "transit_options", None)
    if not raw:
        return None
    options: list[TransitOption] = []
    for item in raw[:3]:
        try:
            options.append(
                TransitOption(
                    durationMin=float(item.get("durationMin", 0)),
                    cost=float(item.get("cost", 0)),
                    walkKm=float(item.get("walkKm", 0)),
                    distanceKm=float(item.get("distanceKm", 0)),
                    transfers=int(item.get("transfers", 0)),
                    direct=bool(item.get("direct", False)),
                    label=str(item.get("label", "")),
                    rides=[TransitRide(**ride) for ride in item.get("rides") or []],
                )
            )
        except (TypeError, ValueError):
            continue
    return options or None


def _explain_day(
    *,
    req: PlanRequest,
    stops: list[PlanStop],
    stats: PlanDayStats,
    dropped: list[dict],
    solver_name: str,
    lunch_min: float,
    lunch_stop: str | None,
    return_min: float | None,
    overtime_min: float,
) -> str:
    """单日解释。"""
    if not stops:
        return "本日没有可排入行程的目的地。"

    parts = [
        f"按实际路线逐段选择交通，依次游览 {len(stops)} 个目的地：",
        " → ".join(stop.name for stop in stops) + "。",
    ]
    first = stops[0]
    if first.transportFromPrev:
        parts.append(
            f"第一站为「{first.name}」，从起点出发约需 "
            f"{first.transportFromPrev.durationMin:.0f} 分钟"
            f"（{first.transportFromPrev.distanceKm:.1f} km）。"
        )
    parts.append(
        f"全天交通 {stats.totalTransitMin:.0f} 分钟、步行 {stats.totalWalkKm:.2f} km、"
        f"花费 {stats.totalCost:.1f} 元。"
    )
    if return_min:
        finish = "返回起点" if req.endMode == "return" else f"到达「{req.endPoint.name}」" if req.endMode == "custom" and req.endPoint else f"在「{stops[-1].name}」结束"
        parts.append(f"预计 {min_to_hhmm(return_min)} {finish}。")
    if overtime_min > 0.5:
        parts.append(f"比计划收工时间晚了 {overtime_min:.0f} 分钟。")
    if lunch_min > 0:
        parts.append(f"午餐 {int(lunch_min)} 分钟安排在「{lunch_stop}」。" if lunch_stop else "")
    if dropped:
        parts.append("未排入：" + "、".join(item["name"] for item in dropped) + "。")
    parts.append(f"（求解器：{solver_name}）")
    return "".join(parts)


def _explain_overall(
    *,
    req: PlanRequest,
    results: list[_DayResult],
    total: PlanDayStats,
    dropped: list[dict],
    data_source: str,
    weights: dict[str, float],
    warnings: list[str],
) -> str:
    """整体解释：多日时先说分天逻辑，再给总量与权重说明。"""
    weight_hint = "、".join(
        f"{label}{weights[key]:.1f}"
        for key, label in (
            ("time", "时间"),
            ("convenience", "换乘"),
            ("cost", "花费"),
            ("walking", "步行"),
        )
    )
    source_hint = "高德路线（费用与接驳为估算，路况为查询时参考）" if data_source == "amap" else "离线估算（未配置高德 Web 服务 Key）"

    parts: list[str] = []
    if len(results) > 1:
        parts.append(
            f"「{req.hotel.name}」出发的 {len(results)} 日路书：先按地理位置把 "
            f"{total_requested(results)} 个目的地聚成 {len(results)} 天，"
            f"再对每天分别求最优顺序（前几天返回起点，最后一天按终点设置结束）。"
        )
    else:
        parts.append(f"「{req.hotel.name}」出发的一日路书，交通方式按实际路线与偏好逐段选择。")

    for result in results:
        stops = result.day.stops
        if not stops:
            continue
        parts.append(
            f"{result.day.title}：{' → '.join(s.name for s in stops)}"
            f"（{stops[0].arriveTime}–{result.day.returnTime or '—'}，"
            f"步行 {result.day.stats.totalWalkKm} km、花费 {result.day.stats.totalCost} 元）。"
        )
        if result.day.endMode == "custom" and result.day.endPoint:
            parts.append(f"终点为「{result.day.endPoint.name}」，已包含最后一段交通。")
        elif result.day.endMode == "last_stop":
            parts.append(f"在「{stops[-1].name}」结束，不安排回程。")

    parts.append(
        f"全部行程合计：交通 {total.totalTransitMin:.0f} 分钟、步行 {total.totalWalkKm:.2f} km、"
        f"花费 {total.totalCost:.1f} 元。"
    )
    parts.append(f"排序依据的权重是 {weight_hint}；里程与耗时来源：{source_hint}。")
    if dropped:
        names = "、".join(item["name"] for item in dropped)
        parts.append(f"以下目的地本次没有排入（{names}）：时间窗冲突或全天时长不够。")
    if warnings:
        parts.append("提示：" + "；".join(dict.fromkeys(warnings)) + "。")
    return "".join(parts)


def total_requested(results: list[_DayResult]) -> int:
    """所有天实际排入的站点总数（用于解释文案）。"""
    return sum(len(r.day.stops) for r in results)


async def prewarm(req: PlanRequest) -> dict:
    token = amap_client.routing_city.set((req.cityName or "").strip())
    try:
        return await _prewarm(req)
    finally:
        amap_client.routing_city.reset(token)


async def _prewarm(req: PlanRequest) -> dict:
    """演示前预热：把距离矩阵与每一段路径都算一遍并写进缓存。

    现场演示时所有高德请求都会命中 SQLite 缓存，既快又不怕限流。
    离线估算模式下不调用任何远程接口，因此没有可预热的内容。
    """
    picked = _selected(req)
    if not picked:
        return {"warmed": 0, "message": "没有选中目的地，无需预热"}
    if not amap_client.has_web_key():
        return {
            "warmed": 0,
            "message": "未配置 AMAP_WEB_KEY：当前用离线估算，不调用高德接口，因此无需预热",
            "mode": req.mode,
        }

    points = [(req.hotel.lng, req.hotel.lat)] + [(d.lng, d.lat) for d in picked]
    if req.endMode == "custom" and req.endPoint:
        points.append((req.endPoint.lng, req.endPoint.lat))
    matrix = await build_matrix(points, req.mode)
    legs = await asyncio.gather(
        *[
            leg_route(points[i], points[j], req.mode)
            for i in range(len(points))
            for j in range(len(points))
            if i != j
        ]
    )
    return {
        "warmed": len(legs),
        "points": len(points),
        "mode": req.mode,
        "dataSource": matrix.data_source,
        "cache": cache.stats(),
    }
