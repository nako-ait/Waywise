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
    AiApplyRequest,
    AiApplyResponse,
    AiTurnRequest,
    AiTurnResponse,
    AiExplainRequest,
    AiExplainResponse,
    AiParseRequest,
    AiParseResponse,
    AiReplanRequest,
    AiReplanResponse,
)
from ..services import agent, ai_service, llm, turn_graph

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


@router.post("/turn", response_model=AiTurnResponse)
async def post_turn(req: AiTurnRequest) -> AiTurnResponse:
    """先出提案（不执行）：告诉用户准备改什么，等确认。有 Key 时由模型出提案。"""
    text = _validate_text(req.text)
    proposal, source = await turn_graph.run_turn(
        text,
        {
            "used_names": {d.name for d in req.destinations},
            "city_pois": req.cityPois,
            "days": req.days,
            "mode": req.mode,
            "weights": req.weights.model_dump(),
            "options": req.options.model_dump(),
            "hotel": req.hotel,
            "endMode": req.endMode,
            "endPoint": req.endPoint,
            "destinations": [d.model_dump() for d in req.destinations],
            "legModes": req.legModes,
            "limits": req.limits.model_dump() if req.limits else None,
            "has_places": any(d.selected for d in req.destinations),
            "city_name": req.cityName,
            "history": req.history,
        },
    )
    warnings = list(proposal.warnings)
    if source == 'rules':
        warnings.append('未使用大模型：无 Key 或调用失败，已用规则兜底')
    return AiTurnResponse(
        kind=proposal.kind,
        source=source,
        reply=proposal.reply,
        preview=proposal.preview,
        question=proposal.question,
        options=proposal.options,
        ops=proposal.ops,
        warnings=warnings,
    )


@router.post("/apply", response_model=AiApplyResponse)
async def post_apply(req: AiApplyRequest) -> AiApplyResponse:
    """确认之后才改参数、跑求解器，并返回一行变更回执。"""
    plan, changes, caption = await agent.apply_ops(req, req.ops)
    return AiApplyResponse(plan=plan, changes=changes, caption=caption)


@router.post("/replan", response_model=AiReplanResponse)
async def post_replan(req: AiReplanRequest) -> AiReplanResponse:
    req.text = _validate_text(req.text)
    return await ai_service.replan(req)


@router.post("/explain", response_model=AiExplainResponse)
async def post_explain(req: AiExplainRequest) -> AiExplainResponse:
    if not req.plan.days:
        raise HTTPException(status_code=400, detail="路书为空，先编译一份再解释")
    return await ai_service.explain(req.plan, req.question)






