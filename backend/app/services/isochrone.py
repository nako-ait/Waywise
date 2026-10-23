"""等时圈（isochrone）与酒店交通便利度。

两件事一起做，因为它们用的是同一份数据：
  1) **等时圈多边形**：有高德 Web 服务 Key 时优先调用高德的等时圈接口拿真实路网边界；
     没有 Key（或调用失败）时退化为「等速圆」—— 按该交通方式的平均速度 × 绕行系数
     反推直线可达距离，沿 48 个方位角采样成多边形。前端会标明当前用的是哪种。
  2) **交通便利度**：用一次 v3/distance 批量请求算出酒店到全部预置 POI 的真实耗时，
     统计 15/30/45 分钟各自能覆盖多少个热门 POI —— 这比画个圆更有说服力，
     因为它是**真实路网耗时**，不是直线距离除速度。
"""
from __future__ import annotations

import math

import httpx

from ..config import settings
from ..models import Hotel, IsochroneBand, IsochronePoi, IsochroneResponse
from .amap_client import (
    AMAP_BASE,
    HTTP_TIMEOUT,
    distance_from_center,
    has_web_key,
    parse_polyline,
)
from .modes import get_mode
from .poi_store import load_pois

# 每条带最多列出的 POI 明细（全部列出来界面会太长）
MAX_POIS_PER_BAND = 12


def circle_polygon(
    hotel: Hotel, minutes: int, mode: str, bearings: int = 48
) -> list[tuple[float, float]]:
    """等速圆近似：沿 48 个方位角取「直线可达距离」，连成闭合多边形。

    直线可达距离 = 平均速度 × 时间 ÷ 绕行系数（绕行系数把路网弯曲折回直线尺度）。
    """
    spec = get_mode(mode)
    reach_km = spec.speed_kmh * (minutes / 60.0) / max(spec.detour, 1e-6)
    lat_scale = 111.32
    lng_scale = 111.32 * math.cos(math.radians(hotel.lat))
    polygon: list[tuple[float, float]] = []
    for i in range(bearings):
        bearing = 2 * math.pi * i / bearings
        dlat = (reach_km / lat_scale) * math.cos(bearing)
        dlng = (reach_km / max(lng_scale, 1e-6)) * math.sin(bearing)
        polygon.append((round(hotel.lng + dlng, 6), round(hotel.lat + dlat, 6)))
    if polygon:
        polygon.append(polygon[0])  # 闭合
    return polygon


async def amap_isochrone_polygon(hotel: Hotel, minutes: int, mode: str) -> list[tuple[float, float]]:
    """高德等时圈接口。

    注意：高德「等时圈」需要 Web 服务 Key 且在部分账号/配额下不可用，
    因此这里做了严格防御 —— 只要返回结构不符合预期就抛异常，由调用方回退到等速圆。
    """
    spec = get_mode(mode)
    # type: 1=驾车 2=步行（高德等时圈接口的取值），与 v3/distance 的 type 含义不同
    iso_type = 2 if spec.key == "walk" else 1
    params = {
        "key": settings.amap_web_key,
        "origin": f"{hotel.lng:.6f},{hotel.lat:.6f}",
        "time": minutes * 60,
        "type": iso_type,
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.get(f"{AMAP_BASE}/v3/direction/isochrone", params=params)
        resp.raise_for_status()
        data = resp.json()
    if str(data.get("status")) != "1":
        raise RuntimeError(f"amap isochrone error: {data.get('info')}")

    payload = data.get("data") or {}
    geometry = payload.get("geometry") or payload.get("polyline") or []
    if isinstance(geometry, str):
        polygon = parse_polyline(geometry)
    else:
        polygon = [(float(p[0]), float(p[1])) for p in geometry if len(p) >= 2]
    if len(polygon) < 3:
        raise RuntimeError("amap isochrone returned an unusable polygon")
    if polygon[0] != polygon[-1]:
        polygon.append(polygon[0])
    return polygon


async def build_isochrones(hotel: Hotel, minutes: list[int], mode: str) -> IsochroneResponse:
    """组装等时圈响应：多边形 + 每条带内可达的 POI。"""
    spec = get_mode(mode)
    warnings: list[str] = []
    pois = load_pois()
    points = [(p.lng, p.lat) for p in pois]

    reach, data_source = await distance_from_center((hotel.lng, hotel.lat), points, spec.key)
    if data_source != "amap":
        warnings.append("未配置 AMAP_WEB_KEY：POI 可达时间用离线估算（直线距离 × 绕行系数）")

    bands: list[IsochroneBand] = []
    for band_minutes in sorted({int(m) for m in minutes if int(m) > 0}):
        # 可达 POI：耗时不超过该带的都算
        inside = [
            (index, value)
            for index, value in enumerate(reach)
            if value[0] <= band_minutes
        ]
        inside.sort(key=lambda item: item[1][0])
        band_pois = [
            IsochronePoi(
                name=pois[index].name,
                lng=pois[index].lng,
                lat=pois[index].lat,
                minutes=value[0],
                km=value[1],
                tags=list(pois[index].tags)[:3],
            )
            for index, value in inside[:MAX_POIS_PER_BAND]
        ]

        polygon: list[tuple[float, float]] = []
        source = "offline-circle"
        if has_web_key():
            try:
                polygon = await amap_isochrone_polygon(hotel, band_minutes, spec.key)
                source = "amap-isochrone"
            except (httpx.HTTPError, RuntimeError, ValueError, KeyError, TypeError) as exc:
                warnings.append(f"{band_minutes} 分钟等时圈调用高德失败，已退化为等速圆：{exc}")
        if not polygon:
            polygon = circle_polygon(hotel, band_minutes, spec.key)

        bands.append(
            IsochroneBand(
                minutes=band_minutes,
                polygon=polygon,
                poiCount=len(inside),
                pois=band_pois,
                source=source,
            )
        )

    return IsochroneResponse(
        mode=spec.key,
        modeLabel=spec.label,
        dataSource=data_source,
        bands=bands,
        poiTotal=len(pois),
        warnings=warnings,
    )
