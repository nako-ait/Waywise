"""高德 Web 服务 API 客户端：距离矩阵构建 + 逐段精确路径 + 离线降级。

两类数据，两种成本策略：
  1) **距离矩阵（N×N）**：用 `v3/distance` 按「一个终点 × 最多 100 个起点」批量取
     驾车距离/时长（type=1）与步行距离/时长（type=3）。N 个点只需 N 次请求，
     原始矩阵落 SQLite 缓存；五种交通方式再由这张原始矩阵换算而来。
  2) **逐段精确路径**：只对最终选中的顺序逐段调用 `v3/direction/*`，
     拿到真实 duration / distance / 费用 / 折线，调用量 = 段数（≈N+1），非常可控。

没有配置 AMAP_WEB_KEY 时全部走离线估算（haversine × 绕行系数 ÷ 平均速度），
返回值里带 `data_source="offline"`，前端会显示「离线估算」徽标，绝不假装是真数据。
"""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field

import httpx

from ..config import settings
from . import cache, keyring
from .modes import ModeSpec, fare_for, get_mode, transfers_for, walk_km_for

AMAP_BASE = "https://restapi.amap.com"
SHANGHAI_CITYCODE = "021"
HTTP_TIMEOUT = 8.0
# 距离矩阵最多 100 个起点，留点余量
MAX_ORIGINS_PER_CALL = 90

LatLng = tuple[float, float]


def _amap_key() -> str:
    """本次请求携带的高德 Web 服务 Key 优先，其次用 .env 里的。"""
    return keyring.amap_key.get() or settings.amap_web_key


# --------------------------------------------------------------------------- #
# 基础工具
# --------------------------------------------------------------------------- #
def haversine_km(a: LatLng, b: LatLng) -> float:
    """两点球面距离（公里）。"""
    r = 6371.0088
    dlat = math.radians(b[1] - a[1])
    dlng = math.radians(b[0] - a[0])
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.sin(dlng / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def has_web_key() -> bool:
    return bool(_amap_key().strip())


def _round_points(points: list[LatLng]) -> list[list[float]]:
    """给缓存 key 用：坐标保留 5 位小数（约 1 米），避免浮点抖动导致缓存击穿。"""
    return [[round(p[0], 5), round(p[1], 5)] for p in points]


def parse_polyline(raw: str | None) -> list[LatLng]:
    """高德 polyline 是 'lng,lat;lng,lat' 字符串，转成 [[lng,lat], ...]。"""
    if not raw:
        return []
    out: list[LatLng] = []
    for pair in raw.split(";"):
        if not pair:
            continue
        try:
            lng_s, lat_s = pair.split(",")
            lng, lat = float(lng_s), float(lat_s)
        except ValueError:
            continue
        if lng and lat:
            out.append((lng, lat))
    return out


def _f(value: object, default: float = 0.0) -> float:
    """高德大量字段是字符串，统一安全转 float。"""
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# 距离矩阵
# --------------------------------------------------------------------------- #
@dataclass
class Matrix:
    points: list[LatLng]
    mode: str
    durations: list[list[float]]   # 分钟
    distances: list[list[float]]   # 公里
    costs: list[list[float]]       # 元
    walk_km: list[list[float]]     # 公里
    transfers: list[list[int]]     # 次
    data_source: str = "offline"   # amap | offline
    cache_hit: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.points)


async def _fetch_distance_column(
    client: httpx.AsyncClient, points: list[LatLng], dest_index: int, dtype: int
) -> dict[int, tuple[float, float]]:
    """取「所有起点 -> 第 dest_index 个点」的一列，返回 {起点下标: (公里, 分钟)}。"""
    dest = points[dest_index]
    result: dict[int, tuple[float, float]] = {}
    for chunk_start in range(0, len(points), MAX_ORIGINS_PER_CALL):
        chunk = list(enumerate(points))[chunk_start : chunk_start + MAX_ORIGINS_PER_CALL]
        params = {
            "origins": "|".join(f"{lng:.6f},{lat:.6f}" for _, (lng, lat) in chunk),
            "destination": f"{dest[0]:.6f},{dest[1]:.6f}",
            "type": dtype,
            "key": _amap_key(),
        }
        resp = await client.get(f"{AMAP_BASE}/v3/distance", params=params)
        resp.raise_for_status()
        data = resp.json()
        if str(data.get("status")) != "1":
            raise RuntimeError(f"amap distance error: {data.get('info')}")
        for item in data.get("results", []):
            idx = int(item.get("origin_id", 0)) - 1 + chunk_start
            km = _f(item.get("distance")) / 1000.0
            minutes = _f(item.get("duration")) / 60.0
            result[idx] = (km, minutes)
    return result


async def _raw_matrix(
    client: httpx.AsyncClient, points: list[LatLng], dtype: int
) -> list[list[tuple[float, float]]] | None:
    """完整 N×N 原始矩阵（公里, 分钟），带 SQLite 缓存。失败返回 None 由调用方降级。"""
    key = cache.make_key(f"dist-matrix-t{dtype}", _round_points(points))
    cached = cache.get(key)
    if cached is not None:
        return [
            [tuple(cell) for cell in row]  # type: ignore[misc]
            for row in cached
        ]

    n = len(points)
    matrix: list[list[tuple[float, float]]] = [[(0.0, 0.0)] * n for _ in range(n)]
    try:
        semaphore = asyncio.Semaphore(4)  # 温和并发，避免触发 QPS 限制

        async def one(dest_index: int) -> None:
            async with semaphore:
                column = await _fetch_distance_column(client, points, dest_index, dtype)
            for origin_index, value in column.items():
                matrix[origin_index][dest_index] = value

        await asyncio.gather(*(one(j) for j in range(n)))
    except (httpx.HTTPError, RuntimeError, ValueError):
        return None

    cache.set(key, [[list(cell) for cell in row] for row in matrix])
    return matrix


def _offline_raw(points: list[LatLng], spec: ModeSpec) -> list[list[tuple[float, float]]]:
    """离线估算：(直线距离 × 绕行系数, 该方式平均速度下的耗时)。"""
    n = len(points)
    matrix: list[list[tuple[float, float]]] = [[(0.0, 0.0)] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            km = haversine_km(points[i], points[j]) * spec.detour
            matrix[i][j] = (km, km / spec.speed_kmh * 60.0)
    return matrix


def sub_matrix(matrix: Matrix, indexes: list[int]) -> Matrix:
    """取子矩阵，indexes[0] 必须是酒店。

    多日模式的关键：每天只把「本日的点 + 酒店」放进 OR-Tools 模型。
    （只给别的天的点加 0 惩罚 disjunction 是不够的 —— OR-Tools 仍可能把它们塞进路线里。）
    """
    return Matrix(
        points=[matrix.points[i] for i in indexes],
        mode=matrix.mode,
        durations=[[matrix.durations[i][j] for j in indexes] for i in indexes],
        distances=[[matrix.distances[i][j] for j in indexes] for i in indexes],
        costs=[[matrix.costs[i][j] for j in indexes] for i in indexes],
        walk_km=[[matrix.walk_km[i][j] for j in indexes] for i in indexes],
        transfers=[[matrix.transfers[i][j] for j in indexes] for i in indexes],
        data_source=matrix.data_source,
        cache_hit=matrix.cache_hit,
        warnings=list(matrix.warnings),
    )


def derive_cell(    spec: ModeSpec, km_road: float, dur_road: float, straight_km: float
) -> tuple[float, float, float, float, int]:
    """由「路网距离/耗时」推导某种交通方式的一天一站数据。

    返回 (耗时分钟, 距离公里, 费用元, 步行公里, 换乘次数)。
    这是全局唯一的折算口径：距离矩阵、等时圈、逐段路径降级都走这里，保证口径一致。
    """
    if spec.key == "walk":
        km = km_road if km_road > 0 else straight_km * spec.detour
        minutes = dur_road if (km_road > 0 and dur_road > 0) else km / spec.speed_kmh * 60.0
        return minutes, km, 0.0, km, 0

    km = km_road if km_road > 0 else straight_km * spec.detour
    minutes = dur_road if (km_road > 0 and dur_road > 0) else km / spec.speed_kmh * 60.0
    if spec.key in ("transit", "subway"):
        # 公共交通走行距离略长于驾车路网；耗时按驾车时长折算，
        # 换乘惩罚单独进目标函数，不污染 durations（时间轴要展示真实交通耗时）
        km *= 1.15
        transfers = transfers_for(spec, km)
        minutes *= 1.55
    else:
        transfers = 0
    return minutes, km, fare_for(spec, km), walk_km_for(spec, km), transfers


async def build_matrix(points: list[LatLng], mode: str) -> Matrix:
    """构建指定交通方式的完整 N×N 矩阵（时长/距离/费用/步行/换乘）。"""
    spec = get_mode(mode)
    n = len(points)
    warnings: list[str] = []
    data_source = "offline"
    cache_hit = False

    walk_raw: list[list[tuple[float, float]]] | None = None
    drive_raw: list[list[tuple[float, float]]] | None = None

    if has_web_key() and n > 1:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            drive_raw = await _raw_matrix(client, points, 1)   # 驾车
            walk_raw = await _raw_matrix(client, points, 3)    # 步行
        if spec.key == "walk" and walk_raw is None:
            warnings.append(
                "高德步行距离矩阵获取失败，已退回离线步行估算（不会用驾车数据顶替："
                "驾车耗时约为步行的 1/5，会让求解器严重低估走路时间）"
            )
        if spec.key != "walk" and drive_raw is None:
            warnings.append("高德驾车距离矩阵获取失败，已退回离线估算")
        if drive_raw is not None or walk_raw is not None:
            data_source = "amap"
    elif not has_web_key():
        warnings.append("未配置 AMAP_WEB_KEY，使用离线估算（直线距离 × 绕行系数）")

    offline = _offline_raw(points, spec)

    durations = [[0.0] * n for _ in range(n)]
    distances = [[0.0] * n for _ in range(n)]
    costs = [[0.0] * n for _ in range(n)]
    walk_km = [[0.0] * n for _ in range(n)]
    transfers = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            straight_km = haversine_km(points[i], points[j])
            if spec.key == "walk":
                # ⚠️ 步行**绝不能**用驾车矩阵兜底：驾车耗时约为步行的 1/5，
                #    会让求解器以为「15 公里步行只要 40 分钟」，算出「14:24 回酒店」
                #    这种与逐段实算（20:31）自相矛盾的结果。宁可退回离线步行模型。
                km_road, dur_road = (walk_raw or offline)[i][j]
            else:
                km_road, dur_road = (drive_raw or offline)[i][j]
            minutes, km, cost, walk, transfer = derive_cell(spec, km_road, dur_road, straight_km)
            durations[i][j] = round(minutes, 2)
            distances[i][j] = round(km, 3)
            costs[i][j] = round(cost, 2)
            walk_km[i][j] = round(walk, 3)
            transfers[i][j] = transfer

    return Matrix(
        points=points,
        mode=spec.key,
        durations=durations,
        distances=distances,
        costs=costs,
        walk_km=walk_km,
        transfers=transfers,
        data_source=data_source,
        cache_hit=cache_hit,
        warnings=warnings,
    )


async def distance_from_center(
    center: LatLng, points: list[LatLng], mode: str
) -> tuple[list[tuple[float, float, float]], str]:
    """中心点到一批目标点：(分钟, 公里, 元)，以及数据来源。

    专供等时圈 / 酒店交通便利度使用，**只调用 1 次高德接口**：
    把 center 当唯一终点、所有目标点当起点批量请求（v3/distance 支持 1 终点 × 多起点）。
    高德的路网距离在城市尺度上近似对称，这个近似对「便利度」这种聚合指标完全够用。
    """
    spec = get_mode(mode)
    if not points:
        return [], "offline"

    pairs: list[tuple[float, float]] = []
    data_source = "offline"

    if has_web_key():
        key = cache.make_key(
            f"from-center-t{spec.amap_distance_type}",
            {"c": [round(center[0], 5), round(center[1], 5)], "p": _round_points(points)},
        )
        cached = cache.get(key)
        if cached is not None:
            pairs = [(float(item[0]), float(item[1])) for item in cached]
            data_source = "amap"
        else:
            try:
                async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                    column = await _fetch_distance_column(
                        client, [center] + list(points), 0, spec.amap_distance_type
                    )
                pairs = [column.get(i + 1, (0.0, 0.0)) for i in range(len(points))]
                if any(km > 0 for km, _ in pairs):
                    cache.set(key, [[km, minutes] for km, minutes in pairs])
                    data_source = "amap"
                else:
                    pairs = []
            except (httpx.HTTPError, RuntimeError, ValueError):
                pairs = []

    if not pairs:
        pairs = [
            (
                haversine_km(center, point) * spec.detour,
                haversine_km(center, point) * spec.detour / spec.speed_kmh * 60.0,
            )
            for point in points
        ]

    out: list[tuple[float, float, float]] = []
    for point, (km_road, dur_road) in zip(points, pairs):
        straight = haversine_km(center, point)
        minutes, km, cost, _walk, _transfers = derive_cell(spec, km_road, dur_road, straight)
        out.append((round(minutes, 1), round(km, 3), round(cost, 2)))
    return out, data_source


# --------------------------------------------------------------------------- #
# 地理编码（把自然语言里的地名变成 GCJ-02 坐标）
# --------------------------------------------------------------------------- #
async def geocode_name(name: str, city: str = SHANGHAI_CITYCODE) -> tuple[float, float, str] | None:
    """地名 -> (经度, 纬度, 格式化地址)。无 Key 或失败返回 None（上层会报「未识别」而不是猜坐标）。"""
    if not has_web_key() or not name.strip():
        return None

    key = cache.make_key("geocode", {"name": name.strip(), "city": city})
    cached = cache.get(key)
    if cached:
        return (float(cached[0]), float(cached[1]), str(cached[2]))

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{AMAP_BASE}/v3/geocode/geo",
                params={"key": _amap_key(), "address": name.strip(), "city": city},
            )
            resp.raise_for_status()
            data = resp.json()
        if str(data.get("status")) != "1":
            return None
        geocodes = data.get("geocodes") or []
        if not geocodes:
            return None
        location = str(geocodes[0].get("location") or "")
        lng_text, _, lat_text = location.partition(",")
        result = (float(lng_text), float(lat_text), str(geocodes[0].get("formatted_address") or ""))
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None

    cache.set(key, list(result))
    return result


# --------------------------------------------------------------------------- #
# 逐段精确路径（给最终路线用）
# --------------------------------------------------------------------------- #
@dataclass
class LegRoute:
    duration_min: float
    distance_km: float
    cost: float
    walk_km: float
    polyline: list[LatLng]
    approx: bool = False
    data_source: str = "offline"
    transfers: int = 0
    # 公交/地铁的全部候选方案（最优在前），没坐过车时为 None
    transit_options: list[dict] | None = None
    # 当前采用那一条的可读摘要："步行 602m → 地铁8号线 → 地铁9号线"
    transit_label: str | None = None


def _polyline_from_steps(steps: list[dict]) -> list[LatLng]:
    path: list[LatLng] = []
    for step in steps or []:
        path.extend(parse_polyline(step.get("polyline")))
    return path


# --------------------------------------------------------------------------- #
# 公交 / 地铁：多方案解析与「最优线路」选择
# --------------------------------------------------------------------------- #
# 换乘与步行的"时间当量"，和求解器的目标函数保持同一套口径
TRANSFER_PENALTY_MIN = 8.0    # 一次换乘折算 8 分钟
WALK_KM_AS_MIN = 13.3         # 1 公里步行 ≈ 13.3 分钟（4.5 km/h）
COST_YUAN_AS_MIN = 3.0        # 1 元折算 3 分钟
DIRECT_TOLERANCE_MIN = 5.0    # 直达方案比最优多不超过 5 分钟当量时，优先直达

KIND_MAP = {
    "地铁线路": "地铁",
    "普通公交线路": "公交",
    "快速公交系统": "快速公交",
    "有轨电车": "有轨电车",
    "机场巴士": "机场巴士",
    "轮渡": "轮渡",
}


def _short_line_name(name: str) -> str:
    """「地铁8号线(市光路--沈杜公路)」→「地铁8号线」：界面和摘要里只留线路名。"""
    return (name or "").split("(")[0].split("（")[0].strip() or (name or "")


def _parse_transit_option(transit: dict) -> dict | None:
    """把一个高德 transit 方案解析成结构化数据。

    高德的 `transits[]` 一次给 5 个方案，每个方案是「步行段 + 乘车段」混排 ——
    **公交+地铁的组合方案本来就在里面**，只是以前我们只取 transits[0] 把多方案丢了。
    注意：响应里**没有** transfer_count 字段（实测为 None），换乘次数必须自己按乘车段数-1 算。
    """
    segments = transit.get("segments") or []
    if not segments:
        return None

    rides: list[dict] = []
    parts: list[str] = []
    walk_m = 0.0
    path: list[LatLng] = []

    for seg in segments:
        walking = seg.get("walking") or {}
        walk_dist = _f(walking.get("distance"))
        if walk_dist > 0:
            walk_m += walk_dist
            parts.append(f"步行 {walk_dist:.0f}m")
            path.extend(_polyline_from_steps(walking.get("steps") or []))
        for line in (seg.get("bus") or {}).get("buslines") or []:
            raw_name = str(line.get("name") or "")
            kind = KIND_MAP.get(str(line.get("type") or ""), "公交")
            rides.append({
                "kind": kind,
                "line": _short_line_name(raw_name),
                "fullLine": raw_name,
                "fromStop": str((line.get("departure_stop") or {}).get("name") or ""),
                "toStop": str((line.get("arrival_stop") or {}).get("name") or ""),
                "stops": int(_f(line.get("via_num"))),
                "distanceKm": round(_f(line.get("distance")) / 1000.0, 2),
                "durationMin": round(_f(line.get("duration")) / 60.0, 1),
            })
            parts.append(_short_line_name(raw_name))
            path.extend(parse_polyline(line.get("polyline")))

    if not rides and walk_m <= 0:
        return None

    km = _f(transit.get("distance")) / 1000.0
    transfers = max(0, len(rides) - 1)
    return {
        "durationMin": round(_f(transit.get("duration")) / 60.0, 1),
        "cost": round(_f(transit.get("cost")), 2),
        "walkKm": round(walk_m / 1000.0 if walk_m else km * 0.1, 3),
        "distanceKm": round(km, 2),
        "transfers": transfers,
        "direct": transfers == 0 and bool(rides),
        # 直达 / 换乘 1 次 这类判定文案由前端展示，这里给出线路链
        "label": " → ".join(parts),
        "rides": rides,
        "polyline": path,
    }


def _transit_strategy_for(weights: dict | None) -> int:
    """用户权重 → 高德公交换乘策略：0 最快捷 / 1 最经济 / 2 最少换乘 / 3 最少步行。

    先让高德按偏好筛一遍，再由 select_transit_option 做「直达优先」的最终裁决 ——
    两层配合，比只靠任意一层都更贴近用户预期。
    """
    if not weights:
        return 0
    ranked = sorted(
        (
            (float(weights.get("time", 0.6)), 0),
            (float(weights.get("cost", 0.4)), 1),
            (float(weights.get("convenience", 0.5)), 2),
            (float(weights.get("walking", 0.5)), 3),
        ),
        key=lambda item: (-item[0], item[1]),
    )
    return ranked[0][1]


def _option_score(option: dict, weights: dict | None) -> float:
    """按用户权重把方案折算成"分钟当量"，用于挑最优线路。"""
    w = weights or {}
    w_time = float(w.get("time", 0.6))
    w_cost = float(w.get("cost", 0.4))
    w_walk = float(w.get("walking", 0.5))
    w_conv = float(w.get("convenience", 0.5))
    return (
        w_time * float(option["durationMin"])
        + w_conv * float(option["transfers"]) * TRANSFER_PENALTY_MIN
        + w_walk * float(option["walkKm"]) * WALK_KM_AS_MIN
        + w_cost * float(option["cost"]) * COST_YUAN_AS_MIN
    )


def select_transit_option(
    options: list[dict], weights: dict | None = None
) -> tuple[dict | None, list[dict]]:
    """挑「最优线路」：按分钟当量最优，**直达方案在容差内优先**。

    规则说清楚（避免走极端）：
      1. 先按用户权重把每个方案折算成"分钟当量"，取最小的那个作为候选；
      2. 如果最优方案不是直达，而**直达方案只差不超过 5 分钟当量**，就改选直达 ——
         少折腾一次换乘值这 5 分钟，这也是乘客的真实体感；
      3. 全部方案都会按当量排序返回，所以「公交+地铁」的组合方案永远看得见，
         不会因为选了直达就把换乘方案藏起来。
    """
    usable = [opt for opt in options if opt and (opt["rides"] or opt["walkKm"] > 0)]
    if not usable:
        return None, []

    scored = sorted(usable, key=lambda opt: (_option_score(opt, weights), opt["durationMin"]))
    chosen = scored[0]

    if not chosen["direct"]:
        direct = [opt for opt in scored if opt["direct"]]
        if direct and (
            _option_score(direct[0], weights) - _option_score(chosen, weights)
            <= DIRECT_TOLERANCE_MIN
        ):
            chosen = direct[0]

    # 选中项排最前，其余按分钟当量排序（前端按这个顺序展示对比）
    ranked = sorted(usable, key=lambda opt: (opt is not chosen, _option_score(opt, weights)))
    return chosen, ranked


def _transit_polyline(transit: dict) -> tuple[list[LatLng], float]:
    """公交/地铁的折线藏在 segments[] 里：步行段 + 线路段。

    ⚠️ 步行里程只统计 `segments[].walking.distance`。
    高德的 `walking_distance` 本来就等于这些分段之和，两者相加会让步行里程翻倍
    —— 这是接上真实 Key 之后才暴露出来的统计偏差（离线估算时看不出来）。
    """
    path: list[LatLng] = []
    walk_m = 0.0
    has_segment_walk = False
    for seg in transit.get("segments", []) or []:
        walking = seg.get("walking") or {}
        if walking.get("distance") is not None:
            has_segment_walk = True
            walk_m += _f(walking.get("distance"))
        path.extend(_polyline_from_steps(walking.get("steps") or []))
        bus = seg.get("bus") or {}
        for line in bus.get("buslines") or []:
            path.extend(parse_polyline(line.get("polyline")))
    if not has_segment_walk:
        walk_m = _f(transit.get("walking_distance"))
    return path, walk_m / 1000.0


async def _fetch_direction(
    client: httpx.AsyncClient, a: LatLng, b: LatLng, spec: ModeSpec, weights: dict | None = None
) -> LegRoute | None:
    origin = f"{a[0]:.6f},{a[1]:.6f}"
    destination = f"{b[0]:.6f},{b[1]:.6f}"
    common = {"origin": origin, "destination": destination, "key": _amap_key()}

    if spec.amap_direction == "transit":
        # strategy 让高德按用户偏好先筛一遍：0 最快捷 / 1 最经济 / 2 最少换乘 / 3 最少步行
        params = {
            **common,
            "city": SHANGHAI_CITYCODE,
            "cityd": SHANGHAI_CITYCODE,
            "strategy": _transit_strategy_for(weights),
        }
        url = f"{AMAP_BASE}/v3/direction/transit/integrated"
    else:
        params = common
        url = f"{AMAP_BASE}/v3/direction/{spec.amap_direction}"

    resp = await client.get(url, params=params)
    resp.raise_for_status()
    data = resp.json()
    if str(data.get("status")) != "1":
        return None

    route = data.get("route") or {}
    if spec.amap_direction == "transit":
        transits = route.get("transits") or []
        if not transits:
            return None
        # 解析全部方案 → 直达优先挑最优 → 用选中的那条的时长/里程/折线
        parsed = [opt for opt in (_parse_transit_option(t) for t in transits) if opt]
        chosen, ranked = select_transit_option(parsed, weights)
        if chosen is None:
            return None
        path = chosen["polyline"]
        km = chosen["distanceKm"]
        return LegRoute(
            duration_min=chosen["durationMin"],
            distance_km=km,
            cost=chosen["cost"] or fare_for(spec, km),
            walk_km=chosen["walkKm"],
            polyline=path or [a, b],
            approx=not path,
            data_source="amap",
            transfers=chosen["transfers"],
            # 去掉内部用的 polyline 字段后再回传（前端不需要几千个点）
            transit_options=[{k: v for k, v in opt.items() if k != "polyline"} for opt in ranked],
            transit_label=chosen["label"],
        )

    paths = route.get("paths") or []
    if not paths:
        return None
    p = paths[0]
    km = _f(p.get("distance")) / 1000.0
    path = _polyline_from_steps(p.get("steps") or [])
    cost = _f(p.get("tolls")) if spec.key != "walk" else 0.0
    cost = fare_for(spec, km) if spec.key in ("taxi", "drive") else cost + fare_for(spec, km)
    return LegRoute(
        duration_min=_f(p.get("duration")) / 60.0,
        distance_km=km,
        cost=round(cost, 2),
        walk_km=km if spec.key == "walk" else round(km * spec.walk_ratio, 3),
        polyline=path or [a, b],
        approx=not path,
        data_source="amap",
    )


async def leg_route(
    a: LatLng,
    b: LatLng,
    mode: str,
    matrix: Matrix | None = None,
    i: int = 0,
    j: int = 0,
    weights: dict | None = None,
) -> LegRoute:
    """一段路的精确信息；无 Key 或请求失败时退回矩阵/离线估算（折线为直线）。

    `weights` 只影响公交/地铁方案的挑选（送达高德的 strategy + 直达优先裁决）。
    """
    spec = get_mode(mode)

    if has_web_key():
        key = cache.make_key(
            "leg",
            {
                "a": [round(a[0], 5), round(a[1], 5)],
                "b": [round(b[0], 5), round(b[1], 5)],
                "mode": spec.key,
                # 公交方案的选择依赖权重，所以权重也要进缓存键，
                # 否则换个偏好会直接复用上一份"最优线路"
                "strategy": _transit_strategy_for(weights) if spec.amap_direction == "transit" else 0,
            },
        )
        cached = cache.get(key)
        if cached:
            return LegRoute(
                duration_min=cached["durationMin"],
                distance_km=cached["distanceKm"],
                cost=cached["cost"],
                walk_km=cached["walkKm"],
                polyline=[(float(p[0]), float(p[1])) for p in cached["polyline"]],
                approx=cached.get("approx", False),
                data_source=cached.get("dataSource", "amap"),
                transfers=int(cached.get("transfers", 0)),
                transit_options=cached.get("transitOptions"),
                transit_label=cached.get("transitLabel"),
            )
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                leg = await _fetch_direction(client, a, b, spec, weights)
            if leg is not None:
                cache.set(
                    key,
                    {
                        "durationMin": round(leg.duration_min, 2),
                        "distanceKm": leg.distance_km,
                        "cost": leg.cost,
                        "walkKm": round(leg.walk_km, 3),
                        "polyline": [[round(p[0], 6), round(p[1], 6)] for p in leg.polyline],
                        "approx": leg.approx,
                        "dataSource": leg.data_source,
                        "transfers": leg.transfers,
                        "transitOptions": leg.transit_options,
                        "transitLabel": leg.transit_label,
                    },
                )
                return leg
        except (httpx.HTTPError, ValueError, KeyError):
            pass

    # 降级：用矩阵里的估算值 + 直线折线
    if matrix is not None:
        return LegRoute(
            duration_min=matrix.durations[i][j],
            distance_km=matrix.distances[i][j],
            cost=matrix.costs[i][j],
            walk_km=matrix.walk_km[i][j],
            transfers=matrix.transfers[i][j],
            polyline=[a, b],
            approx=True,
            data_source=matrix.data_source,
        )
    straight = haversine_km(a, b)
    km = straight * spec.detour
    return LegRoute(
        duration_min=km / spec.speed_kmh * 60.0,
        distance_km=km,
        cost=fare_for(spec, km),
        walk_km=walk_km_for(spec, km),
        polyline=[a, b],
        approx=True,
        data_source="offline",
    )

