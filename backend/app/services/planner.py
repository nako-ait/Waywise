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
from .timeutil import hhmm_to_min, min_to_hhmm, parse_business_hours
from .tsp_core import (
    NodeSpec,
    SolveRequest,
    is_window_feasible,
    node_window,
    normalize_weights,
)
from .vrp import split_into_days


def _selected(req: PlanRequest) -> list[Destination]:
    """取参与规划的目的地：优先用 selected 标记；都没标记时把整份列表当作已选（方便 curl 直接调）。"""
    picked = [d for d in req.destinations if d.selected]
    return picked if picked else list(req.destinations)


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

    # ---- 逐段精确路径（只对最终顺序取，调用量 = 段数） ----
    order_with_hotel = [0] + order + [0]
    legs = (
        await asyncio.gather(
            *[
                leg_route(
                    points[a],
                    points[b],
                    mode_spec.key,
                    matrix,
                    a,
                    b,
                    # 权重传下去：公交段要据此挑「最优线路」（直达优先 + 分钟当量最优）
                    dict(req.weights.model_dump()),
                )
                for a, b in zip(order_with_hotel, order_with_hotel[1:])
            ]
        )
        if len(order_with_hotel) > 1
        else []
    )

    # ---- 时间轴推演（注意停留时间要取「含午餐」的那份） ----
    raw_stops: list[_RawStop] = []
    now = float(day_start_min)
    for leg, node_index in zip(legs, order):
        dest = index_to_dest[node_index]
        node = next(n for n in nodes if n.index == node_index)
        stay = float(stay_of_global.get(node_index, node.stay_min))
        arrive = max(
            now + leg.duration_min, float(node_window(node, day_start_min, day_end_min)[0])
        )
        raw_stops.append(
            _RawStop(index=node_index, dest=dest, arrive=arrive, leave=arrive + stay, stay=stay, leg=leg)
        )
        now = arrive + stay

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
                mode=mode_spec.key,
                durationMin=round(stop.leg.duration_min, 1),
                cost=round(stop.leg.cost, 2),
                distanceKm=round(stop.leg.distance_km, 2),
                walkKm=round(stop.leg.walk_km, 3),
                transfers=int(getattr(stop.leg, "transfers", 0)),
                approx=bool(stop.leg.approx),
                dataSource=stop.leg.data_source,
                transitOptions=_transit_options_of(stop.leg),
                transitLabel=getattr(stop.leg, "transit_label", None),
            ),
        )
        for stop in raw_stops
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
    if legs and order:
        back = legs[-1]
        return_leg = TransportLeg(
            mode=mode_spec.key,
            durationMin=round(back.duration_min, 1),
            cost=round(back.cost, 2),
            distanceKm=round(back.distance_km, 2),
            walkKm=round(back.walk_km, 3),
            transfers=int(getattr(back, "transfers", 0)),
            approx=bool(back.approx),
            dataSource=back.data_source,
            transitOptions=_transit_options_of(back),
            transitLabel=getattr(back, "transit_label", None),
        )

    # ---- 回程时刻以「逐段实算」为准 ----
    # 时间轴上每一段都来自 leg_route()（真实路径规划），如果这里改用求解器的
    # 矩阵估算值，就会出现「16:54 离开 + 回程 218 分钟 = 14:24 到酒店」这种自相矛盾。
    # 两者口径不同（矩阵用于排序、方向 API 用于展示），展示必须以实算为准。
    solver_return = result.return_min
    computed_return = raw_stops[-1].leave + legs[-1].duration_min if (raw_stops and legs) else None
    return_min = computed_return if computed_return is not None else solver_return
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
    matrix: Matrix = await build_matrix(points, mode_spec.key)
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

    # ---------- 4. 逐天排 ----------
    day_results: list[_DayResult] = []
    for day_index, group in enumerate(groups):
        if not group:
            continue
        day_nodes = [node for node in nodes if node.index in set(group)]
        day_results.append(
            await _plan_one_day(
                req=req,
                matrix=matrix,
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
            days=[PlanDay(date=date.today().isoformat(), stops=[], stats=PlanDayStats())],
            explanation="本日没有可排入行程的目的地，请检查营业时间与停留时长设置。",
            polylines=[],
            solver={"name": "noop", "dataSource": matrix.data_source, "warnings": warnings},
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

    spec = get_mode(req.mode)
    parts = [
        f"以{spec.icon}{spec.label}为主要交通方式，依次游览 {len(stops)} 个目的地后返回酒店：",
        " → ".join(stop.name for stop in stops) + "。",
    ]
    first = stops[0]
    if first.transportFromPrev:
        parts.append(
            f"把「{first.name}」放在第一站，是因为它到酒店只要 "
            f"{first.transportFromPrev.durationMin:.0f} 分钟"
            f"（{first.transportFromPrev.distanceKm:.1f} km），开局最省路上时间。"
        )
    parts.append(
        f"全天交通 {stats.totalTransitMin:.0f} 分钟、步行 {stats.totalWalkKm:.2f} km、"
        f"花费 {stats.totalCost:.1f} 元。"
    )
    if return_min:
        parts.append(f"预计 {min_to_hhmm(return_min)} 回到酒店。")
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
    spec = get_mode(req.mode)
    weight_hint = "、".join(
        f"{label}{weights[key]:.1f}"
        for key, label in (
            ("time", "时间"),
            ("convenience", "换乘"),
            ("cost", "花费"),
            ("walking", "步行"),
        )
    )
    source_hint = "高德实时路况" if data_source == "amap" else "离线估算（未配置高德 Web 服务 Key）"

    parts: list[str] = []
    if len(results) > 1:
        parts.append(
            f"「{req.hotel.name}」出发的 {len(results)} 日路书：先按地理位置把 "
            f"{total_requested(results)} 个目的地聚成 {len(results)} 天，"
            f"再对每天分别求最优顺序（每天从酒店出发、回到酒店）。"
        )
    else:
        parts.append(f"「{req.hotel.name}」出发的一日路书，以{spec.icon}{spec.label}为主要交通方式。")

    for result in results:
        stops = result.day.stops
        if not stops:
            continue
        parts.append(
            f"{result.day.title}：{' → '.join(s.name for s in stops)}"
            f"（{stops[0].arriveTime}–{result.day.returnTime or '—'}，"
            f"步行 {result.day.stats.totalWalkKm} km、花费 {result.day.stats.totalCost} 元）。"
        )

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
