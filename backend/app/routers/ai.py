"""AI 能力接口（模块 4）。

GET  /api/ai/health    探活：Key 配了没、能不能真的调通
POST /api/ai/parse     自然语言 → 目的地列表（Function Calling → 地理编码 → 自动标点）
POST /api/ai/replan    一句话重规划（解析约束 → 合并权重/时间 → 重新求解）
POST /api/ai/explain   路线解释（把已算好的路书讲成人话）

三个接口都有「无 Key 降级」路径，因此现场没有 API Key 也能完整演示。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import (
    AiExplainRequest,
    AiExplainResponse,
    AiParseRequest,
    AiParseResponse,
    AiReplanRequest,
    AiReplanResponse,
)
from ..services import ai_service, llm

router = APIRouter(prefix="/ai", tags=["ai"])

MAX_TEXT_LEN = 500


def _validate_text(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="请输入一句话，例如「我想去外滩、豫园、武康路」")
    if len(cleaned) > MAX_TEXT_LEN:
        raise HTTPException(status_code=400, detail=f"输入太长（上限 {MAX_TEXT_LEN} 字）")
    return cleaned


@router.get("/health")
async def ai_health() -> dict:
    """探活：确认 Key 与网络是否真的可用（会真的发一次极小的请求）。"""
    return await llm.probe()


@router.post("/parse", response_model=AiParseResponse)
async def post_parse(req: AiParseRequest) -> AiParseResponse:
    return await ai_service.parse_places(_validate_text(req.text))


@router.post("/replan", response_model=AiReplanResponse)
async def post_replan(req: AiReplanRequest) -> AiReplanResponse:
    req.text = _validate_text(req.text)
    return await ai_service.replan(req)


@router.post("/explain", response_model=AiExplainResponse)
async def post_explain(req: AiExplainRequest) -> AiExplainResponse:
    if not req.plan.days:
        raise HTTPException(status_code=400, detail="路书为空，先编译一份再解释")
    return await ai_service.explain(req.plan, req.question)
