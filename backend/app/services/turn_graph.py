"""对话状态机（LangGraph）：agent → verify → END。

v1.12 的核心变化：
  · **意图解析交给模型**（agent_loop 的工具循环），规则只在"没有 Key / 调用失败"时兜底；
  · **verify 不再覆盖用户的行程改动**：只核对"模型说了具体数字但没有任何工具证据"，
    把没依据的数字抹掉；用户自己的预算、工具算出来的费用都算有依据。

没有装 langgraph 时按同样顺序执行，行为一致。
"""
from __future__ import annotations

import re
from typing import Any, TypedDict

from . import agent, agent_loop

try:  # 可选依赖：装了就用图，没装就顺序跑
    from langgraph.graph import END, START, StateGraph

    HAS_LANGGRAPH = True
except Exception:  # pragma: no cover
    HAS_LANGGRAPH = False

NUMBER_CLAIMS = [
    re.compile(r"[¥￥]\s?(\d+(?:\.\d+)?)"),
    re.compile(r"(\d+)\s*星"),
    re.compile(r"(\d+)\s*(?:℃|度)"),
]


class TurnState(TypedDict, total=False):
    text: str
    ctx: dict[str, Any]
    proposal: agent.Proposal
    source: str
    evidence: list[dict]


async def _agent_node(state: TurnState) -> TurnState:
    ctx = dict(state["ctx"])
    ctx["text"] = state["text"]
    try:
        proposal, evidence = await agent_loop.run(ctx)
        return {"proposal": proposal, "source": "llm", "evidence": evidence}
    except Exception as exc:  # 没 Key、超时、模型异常 → 规则兜底
        proposal = agent.build_proposal(
            state["text"],
            used_names=set(ctx.get("used_names") or ()),
            city_pois=ctx.get("city_pois") or [],
            days=ctx["days"],
            mode=ctx["mode"],
            weights=ctx["weights"],
            has_places=ctx["has_places"],
        )
        # 把真实失败原因透出到前端小灰字，而不是只报一句笼统的"无 Key 或调用失败"
        detail = " ".join(f"{type(exc).__name__}: {exc}".split())[:160]
        proposal.warnings = [f"大模型未生效（{detail}）", *(proposal.warnings or [])]
        return {
            "proposal": proposal,
            "source": "rules",
            "evidence": [{"tool": "fallback", "result": {"error": detail}}],
        }


def _allowed_numbers(ctx: dict, proposal: agent.Proposal, evidence: list[dict]) -> set[str]:
    """哪些数字算"有依据"：用户给的预算/时长、工具算出的费用与时长、权重、天数。"""
    allowed: set[str] = set()

    for value in ((proposal.ops or {}).get("limits") or {}).values():
        if isinstance(value, (int, float)):
            allowed.add(f"{float(value):.0f}")
            allowed.add(f"{float(value):g}")

    for item in evidence:
        result = item.get("result") or {}
        for key in ("cost", "transitMin", "walkKm"):
            value = result.get(key)
            if isinstance(value, (int, float)):
                allowed.add(f"{float(value):.0f}")
                allowed.add(f"{float(value):g}")

    for value in ((proposal.ops or {}).get("weights") or {}).values():
        if isinstance(value, (int, float)):
            allowed.add(f"{float(value):.1f}")

    allowed.add(str(ctx.get("days", "")))
    return {item for item in allowed if item}


def verify_proposal(proposal: agent.Proposal, ctx: dict, evidence: list[dict]) -> agent.Proposal:
    """只核对"没依据的数字"，不动用户的行程改动。"""
    reply = proposal.reply or ""
    allowed = _allowed_numbers(ctx, proposal, evidence)
    missing = False
    for pattern in NUMBER_CLAIMS:
        for match in pattern.finditer(reply):
            if match.group(1) not in allowed:
                missing = True
                break
        if missing:
            break

    if missing:
        reply = re.sub(r"[¥￥]\s?\d+(?:\.\d+)?", "（具体费用我没有可靠来源）", reply)
        reply = re.sub(r"\d+\s*星(?:级)?", "（星级我没有可靠来源）", reply)
        reply = re.sub(r"\d+\s*(?:℃|度)", "（气温我没有可靠来源）", reply)
        proposal.reply = agent._short(reply)
        proposal.warnings = list({*(proposal.warnings or []), "已过滤无依据数字"})
    return proposal


async def _verify_node(state: TurnState) -> TurnState:
    evidence = state.get("evidence") or []
    ctx = {**state["ctx"], "text": state["text"]}
    proposal = await agent_loop.prepare_transport_proposal(state["proposal"], ctx, evidence)
    return {"proposal": verify_proposal(proposal, ctx, evidence), "evidence": evidence}


_compiled = None


def _build():
    global _compiled
    if _compiled is not None:
        return _compiled
    graph = StateGraph(TurnState)
    graph.add_node("agent", _agent_node)
    graph.add_node("verify", _verify_node)
    graph.add_edge(START, "agent")
    graph.add_edge("agent", "verify")
    graph.add_edge("verify", END)
    _compiled = graph.compile()
    return _compiled


async def run_turn(text: str, ctx: dict[str, Any]) -> tuple[agent.Proposal, str]:
    """跑一轮：返回 (提案, 来源)。source=llm 表示模型参与；rules 表示兜底。"""
    payload: TurnState = {"text": text, "ctx": ctx}
    if HAS_LANGGRAPH:
        try:
            result = await _build().ainvoke(payload)
            return result["proposal"], result.get("source", "rules")
        except Exception:
            pass

    state = payload
    state.update(await _agent_node(state))
    state.update(await _verify_node(state))
    return state["proposal"], state.get("source", "rules")


__all__ = ["HAS_LANGGRAPH", "run_turn", "verify_proposal"]

