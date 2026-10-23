"""POI 数据接口：给前端快速加点 / 演示兜底用。"""
from __future__ import annotations

from fastapi import APIRouter, Query

from ..models import PoiPreset
from ..services.poi_store import load_pois, search_pois

router = APIRouter(prefix="/poi", tags=["poi"])


@router.get("/presets", response_model=list[PoiPreset])
def list_presets() -> list[PoiPreset]:
    """全量上海预置 POI（演示数据，前端可缓存到 localStorage）"""
    return load_pois()


@router.get("/search", response_model=list[PoiPreset])
def search(
    q: str = Query(..., min_length=1, description="关键词，如「外滩」「咖啡」「徐汇」"),
    limit: int = Query(10, ge=1, le=50),
) -> list[PoiPreset]:
    """本地模糊检索，零网络开销、零限流风险"""
    return search_pois(q, limit=limit)
