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

from ..models import PlanOptions, PlanRequest, TripLimits, Weights
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


def _base_request(ctx: dict) -> PlanRequest:
    return PlanRequest(
        hotel=ctx["hotel"], destinations=ctx.get("destinations") or [],
        days=ctx["days"], mode=ctx["mode"], weights=Weights(**ctx["weights"]),
        options=PlanOptions(**ctx["options"]), legModes=ctx.get("legModes"),
        limits=TripLimits(**ctx["limits"]) if ctx.get("limits") else None,
    )


def _summary(plan, label: str) -> dict:
    # 按实际交通段累加，显式包含每天的返程，避免模型混用去程与全天口径。
    legs = [leg for day in plan.days for leg in (
        *[stop.transportFromPrev for stop in day.stops], day.returnLeg,
    ) if leg is not None]
    modes = sorted({leg.transportMode or leg.mode for leg in legs})
    return {
        "label": label, "includesReturn": True,
        "cost": round(sum(leg.cost for leg in legs), 2),
        "transitMin": round(sum(leg.durationMin for leg in legs), 1),
        "walkKm": round(sum(leg.walkKm for leg in legs), 2),
        "transfers": sum(leg.transfers for leg in legs), "actualModes": modes,
        "costApprox": any(leg.costApprox for leg in legs),
        "approx": any(leg.approx or leg.dataSource != "amap" for leg in legs),
        "days": [{"order": [s.name for s in day.stops], "returnTime": day.returnTime}
                 for day in plan.days],
        "dropped": (plan.solver or {}).get("dropped") or [],
        "violations": ((plan.solver or {}).get("limits") or {}).get("violations") or [],
    }


async def _preview_request(req: PlanRequest, *, compare: bool) -> dict:
    chosen = _summary(await create_plan(req), "按偏好自动选择")
    alternatives = []
    if compare and req.mode != "drive":
        # 比较公共交通基准时锁定自动段；已有的逐段手动选择保持不变。
        locks = {d.id: "transit" for d in req.destinations if d.selected}
        locks["__return__"] = "transit"
        locks.update(req.legModes or {})
        public_req = req.model_copy(update={"mode": "transit", "legModes": locks})
        public_plan = await create_plan(public_req)
        alternatives.append(_summary(public_plan, "公共交通方案"))
        # 自动选择也可能全是公共交通。此时额外展示一段打车的真实对照，
        # 让用户看见减少耗时/步行需要增加多少费用，而非两条相同结果。
        if "taxi" not in chosen["actualModes"]:
            candidates = []
            for day in public_plan.days:
                candidates.extend((stop.transportFromPrev.durationMin, stop.id)
                                  for stop in day.stops if stop.transportFromPrev
                                  and stop.id not in (req.legModes or {}))
                if len(public_plan.days) == 1 and day.returnLeg and "__return__" not in (req.legModes or {}):
                    candidates.append((day.returnLeg.durationMin, "__return__"))
            if candidates:
                _, key = max(candidates)
                mixed_req = public_req.model_copy(update={"legModes": {**locks, key: "taxi"}})
                alternatives.append(_summary(await create_plan(mixed_req), "公共交通＋一段打车"))
    return {**chosen, "alternatives": alternatives, "requestKey": req.model_dump_json()}


def _requested_modes(text: str) -> set[str]:
    """“少走路/不要长距离步行”是步行负担要求，不能当成选择步行。"""
    modes = set()
    for pattern, mode in [(r"公共交通", "transit"), *agent.nlp_rules.MODE_KEYWORDS]:
        for match in re.finditer(pattern, text):
            prefix = re.split(r"[，。；、,;]", text[:match.start()])[-1]
            if re.search(r"(?:不要|不想|不坐|不打|不用|别|避免|少)[^，。；]{0,12}$", prefix):
                continue
            modes.add(mode)
    return modes


async def prepare_transport_proposal(proposal: agent.Proposal, ctx: dict, evidence: list[dict]) -> agent.Proposal:
    """在展示提案前核验最终参数，方案数字由程序提供，不依赖模型复述。"""
    if proposal.kind != "act" or not proposal.ops:
        return proposal
    explicit = _requested_modes(str(ctx.get("text") or ""))
    # 模型不能凭“合理安排/少走路”擅自指定一个整体方式。
    if proposal.ops.get("mode") not in explicit:
        proposal.ops.pop("mode", None)
    proposal.preview = agent._preview_from_ops(proposal.ops)
    # 只改停留时长（没有交通/天数等其它变化）时，直接给针对性回执，不套用交通试算文案
    if proposal.ops.get("stayChanges") and not any(
        key in proposal.ops
        for key in ("mode", "weights", "days", "times", "limits", "addPlaces", "removeNames")
    ):
        stays = "；".join(f"「{s['name']}」停留 {s['stayMin']} 分钟" for s in proposal.ops["stayChanges"])
        proposal.reply = f"准备把{stays}，确认后重新生成时间安排。"
        return proposal
    proposal.reply = "准备按你的偏好逐段安排交通，确认后生成；含返程的时间、步行量和费用见下方。"
    try:
        req, _, _ = agent.request_from_ops(_base_request(ctx), proposal.ops)
        if not any(d.selected for d in req.destinations):
            proposal.reply = "准备更新这些设置，确认后生效。"
            return proposal
        key = req.model_dump_json()
        result = next((item["result"] for item in reversed(evidence)
                       if item.get("tool") == "preview_plan"
                       and item.get("result", {}).get("requestKey") == key
                       and item["result"].get("alternatives")), None)
        if result is None:
            result = await _preview_request(req, compare=not explicit)
            evidence.append({"tool": "preview_plan", "result": result})
        if not explicit and req.mode != "drive":
            proposal.preview.append("逐段比较公共交通和打车，短途比较步行")
        displayed = set()
        for summary in [result, *(result.get("alternatives") or [])]:
            signature = json.dumps({k: v for k, v in summary.items()
                                    if k not in {"label", "alternatives", "requestKey"}}, sort_keys=True)
            if signature in displayed:
                continue
            displayed.add(signature)
            mode_labels = "＋".join("公共交通" if m == "transit" else agent.MODE_LABELS.get(m, m)
                                    for m in summary["actualModes"]) or "无交通段"
            basis = "离线估算" if summary["approx"] else "路线试算"
            proposal.preview.append(
                f"{summary['label']}（{mode_labels}，{basis}，含返程）："
                f"交通约{summary['transitMin']:.0f}分钟，接驳步行约{summary['walkKm']:.1f}公里，"
                f"费用约¥{summary['cost']:.0f}，换乘{summary['transfers']}次"
            )
            if summary["dropped"]:
                proposal.preview.append(f"{summary['label']}：有{len(summary['dropped'])}个地点未排入，不能按同一完整行程比较")
            proposal.preview.extend(f"{summary['label']}：{v}" for v in summary["violations"])
        if result.get("alternatives"):
            public = result["alternatives"][0]
            for candidate in [result, *result["alternatives"][1:]]:
                visits = lambda s: sorted(name for day in s["days"] for name in day["order"])
                if visits(candidate) == visits(public) and candidate["approx"] == public["approx"]:
                    walk_saved = public["walkKm"] - candidate["walkKm"]
                    added_cost = candidate["cost"] - public["cost"]
                    saved_time = public["transitMin"] - candidate["transitMin"]
                    if (walk_saved > 0.05 or saved_time > 1) and added_cost > 0.5:
                        benefits = []
                        if saved_time > 1:
                            benefits.append(f"省约{saved_time:.0f}分钟")
                        if walk_saved > 0.05:
                            benefits.append(f"少走约{walk_saved:.1f}公里")
                        proposal.preview.append(f"取舍：{candidate['label']}较公共交通{'、'.join(benefits)}，费用增加约¥{added_cost:.0f}")
        proposal.preview.append("确认后按当前偏好方案生成；可继续调整时间、步行或费用偏好")
        proposal.preview.append("接驳步行不含景点内游览；费用为路线接口估算")
    except Exception:
        proposal.reply = "准备按你的偏好逐段安排交通；当前试算未完成，确认后计算实际路线。"
        proposal.warnings.append("交通方案试算未完成，尚不能确认耗时、步行量和费用")
    return proposal


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
        base = _base_request(ctx)
        ops = agent._ops_from_arguments({**args, "addPlaces": [{"name": n} for n in names]}, index)
        ops["removeNames"] = [d.name for d in base.destinations if d.name not in names]
        req, _, _ = agent.request_from_ops(base, ops)
        return await _preview_request(req, compare=bool(args.get("compareTransport", True)))

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
            # 模型光回了文字没调工具：再请求一次，强制收口成提案。
            # 否则"纯聊天回复"不会进入「确认执行」流程，用户会以为没反应。
            reply = str(resp.get("content") or "").strip()
            messages.append({"role": "assistant", "content": reply or ""})
            messages.append({"role": "user", "content": "请调用 propose_changes 给出最终提案。"})
            forced = await llm.chat_tools(messages, [TURN_TOOL], force="propose_changes", timeout=30.0)
            for call in forced.get("tool_calls") or []:
                proposal = agent.proposal_from_llm_args(
                    call.get("arguments") or {}, index=index, used_names=set(ctx["used_names"])
                )
                if proposal is not None:
                    return proposal, evidence
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
            {"role": "user", "content": "工具结果：" + json.dumps(
                {k: v for k, v in result.items() if k != "requestKey"}, ensure_ascii=False,
            )[:4500]}
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
