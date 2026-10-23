"""POI 演示数据加载与本地检索。

设计动机：高德 Web 服务 API 有 QPS/日调用量限制，演示现场被限流会非常尴尬。
因此把上海热门 POI 固化成 JSON，默认走本地检索，仅当需要补充数据时才打网络。
"""
from __future__ import annotations

import json
from functools import lru_cache

from ..config import settings
from ..models import PoiPreset


@lru_cache(maxsize=1)
def load_pois() -> list[PoiPreset]:
    """读取 data/shanghai_pois.json（进程内缓存一次）"""
    path = settings.poi_file
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [PoiPreset(**item) for item in raw]


def reload_pois() -> list[PoiPreset]:
    """清缓存后重载（改完 JSON 无需重启）"""
    load_pois.cache_clear()
    return load_pois()


def search_pois(keyword: str, limit: int = 10) -> list[PoiPreset]:
    """名称前缀 > 名称包含 > 标签 > 区名 的简单打分检索"""
    kw = keyword.strip().lower()
    if not kw:
        return []

    scored: list[tuple[int, PoiPreset]] = []
    for poi in load_pois():
        name = poi.name.lower()
        if name == kw:
            score = 100
        elif name.startswith(kw):
            score = 80
        elif kw in name:
            score = 60
        elif any(kw in tag.lower() for tag in poi.tags):
            score = 40
        elif poi.district and kw in poi.district.lower():
            score = 20
        else:
            continue
        scored.append((score, poi))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [poi for _, poi in scored[:limit]]
