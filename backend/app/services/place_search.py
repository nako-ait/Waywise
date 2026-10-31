"""Online origin search. Credentials and upstream URLs stay server-side."""
from __future__ import annotations

import math
import re

import httpx
from fastapi import HTTPException

from ..config import settings
from ..models import PoiPreset
from . import keyring


async def search_online_places(keyword: str, city: str, limit: int) -> list[PoiPreset]:
    key = (keyring.amap_key.get() or settings.amap_web_key).strip()
    if not key:
        raise HTTPException(503, "服务器尚未配置地点搜索")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get("https://restapi.amap.com/v3/place/text", params={
                "key": key, "keywords": keyword, "city": city,
                "citylimit": "true", "offset": limit, "page": 1,
                "extensions": "base", "output": "JSON",
            })
        if response.status_code != 200:
            raise HTTPException(502, "地点搜索服务暂不可用，请稍后重试")
        data = response.json()
    except httpx.TimeoutException:
        raise HTTPException(504, "地点搜索超时，请稍后重试") from None
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "地点搜索连接失败，请稍后重试") from None
    if not isinstance(data, dict):
        raise HTTPException(502, "地点搜索返回格式异常")
    if str(data.get("status")) != "1":
        info = str(data.get("info", ""))
        # Only a bounded vendor error identifier, never its raw payload/URL/key.
        code = info if re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", info) and key not in info else "UNKNOWN"
        raise HTTPException(502, f"高德地点搜索未成功（{code}），请检查搜索权限或配额")
    raw = data.get("pois")
    if not isinstance(raw, list):
        raise HTTPException(502, "地点搜索返回格式异常")
    items = []
    for poi in raw[:limit]:
        if not isinstance(poi, dict) or not isinstance(poi.get("name"), str):
            continue
        try:
            lng, lat = map(float, str(poi.get("location", "")).split(","))
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lng) and math.isfinite(lat) and -180 <= lng <= 180 and -90 <= lat <= 90):
            continue
        name = poi["name"].strip()
        if not name:
            continue
        items.append(PoiPreset(
            name=name, lng=lng, lat=lat,
            district=poi.get("adname") if isinstance(poi.get("adname"), str) else None,
            address=poi.get("address") if isinstance(poi.get("address"), str) else None,
            amapId=poi.get("id") if isinstance(poi.get("id"), str) else None,
            tags=list(dict.fromkeys(str(poi.get("type", "")).split(";")))[:3] if isinstance(poi.get("type"), str) else [],
        ))
    if raw and not items:
        raise HTTPException(502, "地点搜索结果缺少有效坐标，请稍后重试")
    return items
