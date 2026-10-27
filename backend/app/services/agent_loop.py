"""有界工具循环（Agent 核心）：模型自己决定"查一下 / 算一遍 / 下结论"。

流程（最多 3 步工具调用）：
    search_pois  —— 查地点（不许凭记忆编地名）
    preview_plan —— 用真求解器试算，拿到费用/路上时间/是否超限
    propose_changes —— 最终提案（ops + 短回复）

规则不再参与意图判断：没有 Key 或调用失败时才由 turn_graph 回落到规则。
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..models import Destination, PlanOptions, PlanRequest, TripLimits, Weights
from . import agent, llm
from .ai_schemas import (
    AGENT_SYSTEM_PROMPT,
    PREVIEW_TOOL,
    SEARCH_TOOL,
    TURN_TOOL,
    build_turn_user_prompt,
)
from .planner import create_plan

MAX_TOOL_STEPS = 3
HOTEL_HINT = re.compile(r"酒店|住宿|民宿|宾馆|宾馆")


def _index(ctx: dict[str, Any]) -> dict[str, dict]:
    return agent._poi_index(ctx.get("city_pois") or [])


async def _run_tool(name: str, args: dict, ctx: dict[str, Any], index: dict[str, dict]) -> dict:
    if name == "search_pois":
        keyword = str(args.get("keyword") or "").strip()
        limit = int(args.get("limit") or 6)
        if HOTEL_HINT.search(keyword):
            return {
                "items": [],
                "note": "本地库没有酒店数据（星级/房价都没有），只能把已知酒店名设为起点",
            }
        hits = [
            {"name": item["name"], "stayMin": item.get("stayMin")}
            for key, item in index.items()
            if keyword and keyword in key
        ]
        return {"items": hits[:limit], "total": len(hits)}

    if name == "preview_plan":
        names = [str(n) for n in (args.get("destinations") or [])]
        picked = [index[n] for n in names if n in index]
        if not picked:
            return {"error": "这些地点不在候选库里", "available": list(index)[:12]}
        destinations = [
            Destination(
                id=f"pv{i}",
                name=item["name"],
                lng=float(item["lng"]),
                lat=float(item["lat"]),
                selected=True,
                stayMin=int(item.get("stayMin") or 60),
            )
            for i, item in enumerate(picked)
        ]
        limits = None
        if args.get("budgetCap") or args.get("transitCapMin"):
            limits = TripLimits(
                budgetCap=args.get("budgetCap"),
                transitCapMin=args.get("transitCapMin"),
            )
        req = PlanRequest(
            hotel=ctx["hotel"],
            destinations=destinations,
            days=int(args.get("days") or ctx["days"]),
            mode=str(args.get("mode") or ctx["mode"]),
            weights=Weights(**ctx["weights"]),
            options=PlanOptions(**ctx["options"]),
            limits=limits,
        )
        plan = await create_plan(req)
        stats = (plan.solver or {}).get("totalStats") or {}
        day = plan.days[0] if plan.days else None
        return {
            "cost": stats.get("totalCost"),
            "transitMin": stats.get("totalTransitMin"),
            "walkKm": stats.get("totalWalkKm"),
            "order": [s.name for s in (day.stops if day else [])],
            "returnTime": getattr(day, "returnTime", None),
            "violations": ((plan.solver or {}).get("limits") or {}).get("violations") or [],
            "mode": str(args.get("mode") or ctx["mode"]),
        }

    return {"error": f"未知工具 {name}"}


async def run(ctx: dict[str, Any]) -> tuple[agent.Proposal, list[dict]]:
    """跑一轮 agent。返回 (提案, 证据)。没有 Key 时抛 RuntimeError 由上层回落规则。"""
    if not llm.is_configured():
        raise RuntimeError("未配置 LLM Key")

    text = str(ctx["text"])
    index = _index(ctx)
    digest = (
        f"{ctx['days']} 天 · 整体方式{agent.MODE_LABELS.get(ctx['mode'], ctx['mode'])} · "
        f"{len(ctx['used_names'])} 个已选地点"
        + (f"（{'、'.join(sorted(ctx['used_names'])[:8])}）" if ctx["used_names"] else "")
    )
    messages: list[dict] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": build_turn_user_prompt(
                text,
                city=ctx.get("city_name", "上海"),
                digest=digest,
                candidates=sorted(index.keys()),
                history=ctx.get("history") or [],
            ),
        },
    ]
    evidence: list[dict] = []

    for _ in range(MAX_TOOL_STEPS):
        resp = await llm.chat_tools(messages, [SEARCH_TOOL, PREVIEW_TOOL, TURN_TOOL], timeout=30.0)
        calls = resp.get("tool_calls") or []
        if not calls:
            reply = str(resp.get("content") or "").strip()
            return agent.Proposal(kind="answer", reply=agent._short(reply or "我在，说说你想怎么改？")), evidence

        call = calls[0]
        name = call.get("name")
        args = call.get("arguments") or {}

        if name == "propose_changes":
            proposal = agent.proposal_from_llm_args(args, index=index, used_names=set(ctx["used_names"]))
            if proposal is not None:
                return proposal, evidence
            break

        result = await _run_tool(str(name), args, ctx, index)
        evidence.append({"tool": name, "args": args, "result": result})
        messages.append(
            {"role": "assistant", "content": f"（调用 {name}：{json.dumps(args, ensure_ascii=False)}）"}
        )
        messages.append(
            {"role": "user", "content": "工具结果：" + json.dumps(result, ensure_ascii=False)[:900]}
        )

    # 步数用尽 / 模型没给提案：强制收口
    messages.append({"role": "user", "content": "请立刻调用 propose_changes 给出最终提案。"})
    resp = await llm.chat_tools(messages, [TURN_TOOL], force="propose_changes", timeout=30.0)
    for call in resp.get("tool_calls") or []:
        proposal = agent.proposal_from_llm_args(
            call.get("arguments") or {}, index=index, used_names=set(ctx["used_names"])
        )
        if proposal is not None:
            return proposal, evidence
    return agent.Proposal(kind="answer", reply="这轮我没想出可执行的改动，能再说具体点吗？"), evidence
