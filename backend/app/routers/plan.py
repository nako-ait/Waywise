"""路线规划接口（模块 2）。

POST /api/plan          单日路线编译
POST /api/plan/prewarm  演示前预热缓存（把距离矩阵与所有分段路径算一遍）
GET  /api/plan/modes    交通方式清单（前端按钮组直接用）
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import PlanRequest, PlanResponse
from ..services.modes import MODE_SPECS, all_modes
from ..services.planner import create_plan, prewarm

router = APIRouter(prefix="/plan", tags=["plan"])

# 单次上限：OR-Tools 本身能吃更多，但演示场景用不到，
# 而且目的地越多，逐段精确路径的高德调用量增长得越快。
MAX_DESTINATIONS = 20


@router.get("/modes")
def list_modes() -> list[dict]:
    """五种交通方式的参数（颜色/图标/速度/费率），前端据此渲染按钮与路线配色。"""
    return all_modes()


@router.post("", response_model=PlanResponse)
async def post_plan(req: PlanRequest) -> PlanResponse:
    """编译路书：酒店出发 → 选中目的地 → 返回酒店。"""
    if req.mode not in MODE_SPECS:
        raise HTTPException(status_code=400, detail=f"不支持的交通方式：{req.mode}")
    if len(req.destinations) > MAX_DESTINATIONS:
        raise HTTPException(
            status_code=400, detail=f"单次最多 {MAX_DESTINATIONS} 个目的地，当前 {len(req.destinations)} 个"
        )
    if req.days < 1:
        raise HTTPException(status_code=400, detail="days 至少为 1")
    return await create_plan(req)


@router.post("/prewarm")
async def post_prewarm(req: PlanRequest) -> dict:
    """演示前预热：把该方案的距离矩阵与所有两两分段路径写入缓存。

    现场演示时高德请求全部命中本地 SQLite，速度快且不怕限流。
    """
    return await prewarm(req)
