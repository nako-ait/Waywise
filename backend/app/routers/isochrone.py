"""等时圈接口（模块 3）：酒店交通便利度可视化。

POST /api/isochrone  以酒店为中心，返回 15/30/45 分钟等时圈多边形与带内可达 POI。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import IsochroneRequest, IsochroneResponse
from ..services.isochrone import build_isochrones
from ..services.modes import MODE_SPECS

router = APIRouter(prefix="/isochrone", tags=["isochrone"])

MAX_BANDS = 4


@router.post("", response_model=IsochroneResponse)
async def post_isochrone(req: IsochroneRequest) -> IsochroneResponse:
    if req.mode not in MODE_SPECS:
        raise HTTPException(status_code=400, detail=f"不支持的交通方式：{req.mode}")
    if not req.minutes:
        raise HTTPException(status_code=400, detail="至少给一个时间分钟数")
    if len(req.minutes) > MAX_BANDS:
        raise HTTPException(status_code=400, detail=f"最多 {MAX_BANDS} 条等时圈")
    if any(m <= 0 or m > 180 for m in req.minutes):
        raise HTTPException(status_code=400, detail="等时圈分钟数需在 1~180 之间")
    return await build_isochrones(req.hotel, req.minutes, req.mode)
