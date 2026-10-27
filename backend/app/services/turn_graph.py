"""对话状态机（LangGraph）：understand → propose → guard。

为什么要有这一层：
  · understand：把"这句话想改什么"交给模型（没 Key / 失败就回落规则）；
  · propose  ：把模型的参数变成「提案」（带 ops 与预览），仍然不执行；
  · guard    ：事实校验 —— 我们没有的数据（酒店星级/房价、天气、人流、门票）
               一律不许出现在回复里，改成"我没有这项数据 + 替代方案"。

LangGraph 只负责串这三步；真正干活的是 agent.py。没装 langgraph 时按同样顺序
顺序执行，行为完全一致（所以这是"可替换的编排"，不是关键路径依赖）。
"""
from __future__ import annotations

import re
from typing import Any, TypedDict

from . import agent, llm
from .ai_schemas import TURN_SYSTEM_PROMPT, TURN_TOOL, build_turn_user_prompt

try:  # 可选依赖：装了就用图跑，没装就顺序跑
    from langgraph.graph import END, START, StateGraph

    HAS_LANGGRAPH = True
except Exception:  # pragma: no cover - 依赖缺失时走顺序执行
    HAS_LANGGRAPH = False

# 没有数据源的领域：命中就把回复换成「如实说明」。
# 规则统一放在 agent.BOUNDARIES 里（同一套正则），这里只负责"拦下来"。
NO_DATA_RULES = [(pattern, message) for pattern, _label, message in agent.BOUNDARIES]


class TurnState(TypedDict, total=False):
    text: str
    ctx: dict[str, Any]
    args: dict[str, Any] | None
    source: str
    proposal: agent.Proposal


async def _understand(state: TurnState) -> TurnState:
    """先问模型；模型不可用就交给规则（source=rules）。"""
    text = state["text"]
    ctx = state["ctx"]
    if not llm.is_configured():
        return {"args": None, "source": "rules"}

    digest = (
        f"{ctx['days']} 天 · 整体方式{agent.MODE_LABELS.get(ctx['mode'], ctx['mode'])} · "
        f"{len(ctx['used_names'])} 个已选地点"
    )
    result = await llm.call_tool(
        TURN_TOOL,
        TURN_SYSTEM_PROMPT,
        build_turn_user_prompt(
            text,
            city=ctx.get("city_name", "上海"),
            digest=digest,
            candidates=sorted(agent._poi_index(ctx.get("city_pois") or []).keys()),
            history=ctx.get("history") or [],
        ),
        timeout=25.0,
        temperature=0.1,
    )
    if result.ok and isinstance(result.arguments, dict):
        return {"args": result.arguments, "source": "llm"}
    return {"args": None, "source": "rules"}


async def _propose(state: TurnState) -> TurnState:
    text = state["text"]
    ctx = state["ctx"]
    args = state.get("args")
    if args:
        proposal = agent.proposal_from_llm_args(
            args,
            index=agent._poi_index(ctx.get("city_pois") or []),
            used_names=set(ctx.get("used_names") or ()),
        )
        if proposal is not None:
            return {"proposal": proposal, "source": "llm"}
    proposal = agent.build_proposal(
        text,
        used_names=set(ctx.get("used_names") or ()),
        city_pois=ctx.get("city_pois") or [],
        days=ctx["days"],
        mode=ctx["mode"],
        weights=ctx["weights"],
        has_places=ctx["has_places"],
    )
    return {"proposal": proposal, "source": "rules"}


def guard_proposal(proposal: agent.Proposal, text: str) -> agent.Proposal:
    """事实校验：没有数据源的领域必须"承认 + 给替代"，不许编数字。"""
    # 1) 回复里不该出现"某某酒店 4 星/800 一晚"这类外部事实，但用户自己给的预算要保留
    reply = proposal.reply or ""
    reply = re.sub(r"(?<!预算)\d+\s*星(?:级)?", "（星级我没有数据）", reply)
    reply = re.sub(r"\d+\s*(?:℃|度)", "（气温我没有数据）", reply)
    proposal.reply = agent._short(reply)

    # 2) 用户问的是我们没有的数据领域 → 直接改成标准话术，并且不在这轮改路书
    for pattern, message in NO_DATA_RULES:
        if pattern.search(text):
            proposal.kind = "answer"
            proposal.reply = message
            proposal.preview = []
            proposal.ops = {}
            proposal.question = None
            proposal.options = []
            proposal.warnings = list({*(proposal.warnings or []), "无数据源"})
            break
    return proposal


async def _guard(state: TurnState) -> TurnState:
    return {"proposal": guard_proposal(state["proposal"], state["text"])}


_compiled = None


def _build():
    global _compiled
    if _compiled is not None:
        return _compiled
    graph = StateGraph(TurnState)
    graph.add_node("understand", _understand)
    graph.add_node("propose", _propose)
    graph.add_node("guard", _guard)
    graph.add_edge(START, "understand")
    graph.add_edge("understand", "propose")
    graph.add_edge("propose", "guard")
    graph.add_edge("guard", END)
    _compiled = graph.compile()
    return _compiled


async def run_turn(text: str, ctx: dict[str, Any]) -> tuple[agent.Proposal, str]:
    """跑一轮：返回 (提案, 来源)。装了 LangGraph 走图，否则顺序执行。"""
    if HAS_LANGGRAPH:
        try:
            result = await _build().ainvoke({"text": text, "ctx": ctx})
            return result["proposal"], result.get("source", "rules")
        except Exception:  # 图运行异常不要影响主流程
            pass

    state: TurnState = {"text": text, "ctx": ctx}
    state.update(await _understand(state))
    state.update(await _propose(state))
    state.update(await _guard(state))
    return state["proposal"], state.get("source", "rules")


