"""模块 4 的编排层：自然语言解析 / 一句话重规划 / 路线解释。

统一的降级策略（这是本项目"演示不崩"的关键）：
    LLM 可用 → 走 Function Calling，source="llm"
    LLM 不可用（没 Key / 超时 / 返回结构异常）→ 自动走 nlp_rules 规则解析，source="rules"
两条路径产出**同构的参数 dict**，所以下游处理、端到端测试、前端渲染都只有一份代码。
"""
from __future__ import annotations

import json

from ..models import (
    AiExplainResponse,
    AiParseResponse,
    AiReplanRequest,
    AiReplanResponse,
    PlanRequest,
    PlanResponse,
    ResolvedPlace,
    Weights,
)
from . import amap_client, llm, nlp_rules
from .ai_schemas import (
    ADD_DESTINATIONS_TOOL,
    EXPLAIN_SYSTEM_PROMPT,
    PLACE_PARSE_SYSTEM_PROMPT,
    REPLAN_SYSTEM_PROMPT,
    REPLAN_TOOL,
    build_explain_user_prompt,
    build_place_parse_user_prompt,
    build_replan_user_prompt,
)
from .planner import create_plan
from .poi_store import load_pois

WEIGHT_KEYS = ("time", "convenience", "cost", "walking")
MODE_LABELS = {
    "walk": "步行",
    "transit": "公交",
    "subway": "地铁",
    "taxi": "打车",
    "drive": "驾车",
}
# 权重在求解器里的语义是"惩罚/在意程度"，所以用短句描述而不是裸露 key
WEIGHT_LABELS = {
    "time": "赶时间",
    "convenience": "少换乘",
    "cost": "省钱",
    "walking": "少走路",
}


# --------------------------------------------------------------------------- #
# 1. 自然语言 -> 目的地
# --------------------------------------------------------------------------- #
def _match_preset(name: str) -> str | None:
    """把口语地名映射到预置 POI 的正式名（精确 -> 别名 -> 包含）。"""
    pois = load_pois()
    for poi in pois:
        if poi.name == name:
            return poi.name
    for alias, official in nlp_rules._alias_table():  # noqa: SLF001 - 同包内部复用别名表
        if alias == name or (len(name) >= 2 and name in alias) or (len(alias) >= 3 and alias in name):
            return official
    return None


async def resolve_places(raw_places: list[dict]) -> tuple[list[ResolvedPlace], list[str]]:
    """把 [{name, stayMin?}] 补齐成带坐标的 ResolvedPlace；解析不到的进 unresolved。"""
    by_name = {poi.name: poi for poi in load_pois()}
    resolved: list[ResolvedPlace] = []
    unresolved: list[str] = []
    seen: set[str] = set()

    for item in raw_places:
        raw_name = str(item.get("name") or "").strip()
        if not raw_name:
            continue
        official = _match_preset(raw_name)
        poi = by_name.get(official) if official else None

        if poi is not None:
            if poi.name in seen:
                continue
            seen.add(poi.name)
            resolved.append(
                ResolvedPlace(
                    name=poi.name,
                    lng=poi.lng,
                    lat=poi.lat,
                    stayMin=int(item.get("stayMin") or poi.stayMin),
                    tags=list(poi.tags) or list(item.get("tags") or []),
                    openTime=poi.openTime,
                    closeTime=poi.closeTime,
                    matchedBy="preset",
                    address=poi.district,
                    reason=item.get("reason"),
                )
            )
            continue

        # 预置库里没有 → 让高德地理编码补坐标（无 Key 时返回 None，绝不猜）
        geo = await amap_client.geocode_name(raw_name)
        if geo is None:
            unresolved.append(raw_name)
            continue
        lng, lat, address = geo
        if raw_name in seen:
            continue
        seen.add(raw_name)
        resolved.append(
            ResolvedPlace(
                name=raw_name,
                lng=lng,
                lat=lat,
                stayMin=int(item.get("stayMin") or 60),
                tags=list(item.get("tags") or []),
                matchedBy="geocode",
                address=address,
                reason=item.get("reason"),
            )
        )

    return resolved, unresolved


async def parse_places(text: str) -> AiParseResponse:
    """POST /api/ai/parse 的实现。"""
    warnings: list[str] = []
    debug: dict | None = None

    if llm.is_configured():
        result = await llm.call_tool(
            ADD_DESTINATIONS_TOOL,
            PLACE_PARSE_SYSTEM_PROMPT,
            build_place_parse_user_prompt(text),
        )
        if result.ok:
            arguments = result.arguments
            source = "llm"
            debug = result.debug
        else:
            warnings.append(f"大模型解析失败，已降级为规则解析：{result.error}")
            parsed = nlp_rules.parse_text(text)
            arguments = parsed.as_tool_arguments()
            source = "rules"
            debug = {"fallbackFrom": result.error}
    else:
        warnings.append("未配置 LLM API Key：使用内置规则解析（地点识别 + 偏好关键词）")
        parsed = nlp_rules.parse_text(text)
        arguments = parsed.as_tool_arguments()
        source = "rules"
        debug = {"notes": parsed.notes}

    raw_places = list(arguments.get("places") or [])
    resolved, unresolved = await resolve_places(raw_places)
    if unresolved and not amap_client.has_web_key():
        warnings.append(
            "以下地名不在预置库里，且未配置 AMAP_WEB_KEY，无法地理编码：" + "、".join(unresolved)
        )

    if source == "rules":
        notes = list(debug.get("notes") or []) if debug else []
    else:
        notes = []

    return AiParseResponse(
        source=source,
        places=resolved,
        exclude=list(arguments.get("exclude") or []),
        unresolved=unresolved,
        summary=str(arguments.get("summary") or ""),
        notes=notes,
        warnings=warnings,
        debug=debug,
    )


# --------------------------------------------------------------------------- #
# 2. 一句话重规划
# --------------------------------------------------------------------------- #
def _plan_digest(req: PlanRequest, plan: PlanResponse | None = None) -> str:
    """给模型看的极简路书摘要（控制 token，且只喂事实）。"""
    if plan is None:
        lines = [f"酒店：{req.hotel.name}", f"天数：{req.days}", f"方式：{MODE_LABELS.get(req.mode, req.mode)}"]
    else:
        lines = [f"酒店：{req.hotel.name}"]
        for day in plan.days:
            stops = "、".join(f"{s.name}({s.arriveTime}-{s.leaveTime})" for s in day.stops)
            lines.append(
                f"{day.title or day.date}：{stops or '（空）'}；"
                f"步行{day.stats.totalWalkKm}km 交通{day.stats.totalTransitMin}分 花费{day.stats.totalCost}元"
            )
    lines.append(
        f"当前权重：时间{req.weights.time} 换乘{req.weights.convenience} "
        f"花费{req.weights.cost} 步行{req.weights.walking}"
    )
    return "\n".join(lines)


def _clamp_weights(raw: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for key in WEIGHT_KEYS:
        if key in raw and raw[key] is not None:
            try:
                out[key] = min(1.0, max(0.0, float(raw[key])))
            except (TypeError, ValueError):
                continue
    return out


async def _compose_reply(
    *,
    text: str,
    applied: list[str],
    removed: list[str],
    plan: PlanResponse,
    mode: str,
    days: int,
    hotel_name: str,
    model_ok: bool,
) -> str:
    """把"改了哪些参数"翻译成一句像人说的话。

    为什么要有这一步：`applied` 是给程序看的变更清单，直接甩给用户就是
    「权重 convenience → 0.9」这种没人味的句子。这里先出一条规则版的口语解释
    （离线也成立），有大模型时再让它润色一遍（带取舍理由）。
    """
    day = plan.days[0] if plan.days else None
    stops = sum(len(item.stops) for item in plan.days)
    stats = (plan.solver or {}).get("totalStats") or {}
    walk_km = stats.get("totalWalkKm")
    return_time = getattr(day, "returnTime", None)

    mentions: list[str] = []
    if "地铁" in text:
        mentions.append("地铁")
    if any(word in text for word in ("打车", "出租", "的士")):
        mentions.append("打车")
    if any(word in text for word in ("公交", "大巴")):
        mentions.append("公交")
    if any(word in text for word in ("走路", "步行")):
        mentions.append("走路")

    mode_reason = ""
    if len(mentions) >= 2 and mode in {"subway", "transit", "taxi", "drive"}:
        if mode in {"subway", "transit"}:
            mode_reason = (
                f"你给了「{' / '.join(mentions)}」几个选项，我按更省钱、也不堵车的思路先排了"
                f"{MODE_LABELS[mode]}；打车能少走路，但会贵一些。"
            )
        else:
            mode_reason = (
                f"你给了「{' / '.join(mentions)}」几个选项，我按少走路的思路先排了打车；"
                f"想省钱的话说一句「改地铁」就行。"
            )
    elif mode in MODE_LABELS and any(
        word in text for word in ("打车", "地铁", "公交", "开车", "步行", "走路")
    ):
        mode_reason = f"交通方式我按你说的定成了{MODE_LABELS[mode]}。"

    change_text = "、".join(applied) if applied else "这句里没有能改的参数，路书先保持原样"
    if removed:
        change_text += f"，并去掉了{('、'.join(removed))}"

    # 把「交通方式 → 地铁」这类清单句翻成人话（交通方式交给下面单独解释）
    human_changes: list[str] = []
    for item in applied:
        if item.startswith("交通方式"):
            continue
        if item.startswith("天数 → "):
            human_changes.append(f"天数改成 {item.split('→ ')[-1]} 天")
        elif item.startswith("出发时间 → "):
            human_changes.append(f"出发改到 {item.split('→ ')[-1]}")
        elif item.startswith("收工时间 → "):
            human_changes.append(f"收工改到 {item.split('→ ')[-1]}")
        elif item.startswith("午餐 → "):
            human_changes.append(f"午饭留 {item.split('→ ')[-1]}")
        elif item.startswith("必需") or item.startswith("必去："):
            human_changes.append(item.replace("必去：", "把 ").replace(" 排进去", ""))
        elif " → " in item and item.split(" → ")[0] in WEIGHT_LABELS.values():
            human_changes.append(f"更看重{item.split(' → ')[0]}")
        elif item.startswith("移除："):
            human_changes.append(f"去掉{item.split('：', 1)[-1]}")
        else:
            human_changes.append(item)

    if human_changes:
        change_text = "、".join(human_changes)
    elif not any(item.startswith("交通方式") for item in applied):
        change_text = "这句里没有能改的参数，路书先保持原样"

    tail = "如果还想更松一点，可以说「每天少排一个点」或「午饭后回酒店休息」。"
    if human_changes:
        composed = f"收到，这次调整是：{change_text}。{mode_reason}"
    else:
        composed = f"收到，{mode_reason or '这句里没有能改的参数，路书先保持原样。'}"
    composed += f"现在这版是 {days} 天 {stops} 站"
    if walk_km:
        composed += f"，步行约 {walk_km} km"
    if return_time:
        composed += f"，{return_time} 回到{hotel_name}。"
    else:
        composed += "。"
    composed += tail

    if not model_ok:
        return composed

    system = (
        "你是「Waywise」的行程助理。用中文口语回复 2~4 句：先说这次改了什么，"
        "再说为什么这么选——尤其是用户同时提了多个交通方式时，要讲清你怎么取舍、"
        "另一种选项会带来什么代价；最后给一条可选的下一步建议。"
        "不要罗列参数名、不要 markdown、不要编号，像朋友在聊天。"
    )
    user = (
        f"用户原话：{text}\n"
        f"系统实际改动：{'；'.join(applied) or '无'}\n"
        f"去掉的地点：{'、'.join(removed) or '无'}\n"
        f"用户提到的交通方式：{'、'.join(mentions) or '未提到'}\n"
        f"编译结果：{days} 天 {stops} 站，步行 {walk_km or 0} km，"
        f"预计 {return_time or '—'} 回到{hotel_name}"
    )
    polished = await llm.call_text(system, user, timeout=20, temperature=0.6, max_tokens=220)
    if polished.ok and polished.text:
        return polished.text.strip()
    return composed


async def replan(req: AiReplanRequest) -> AiReplanResponse:
    """POST /api/ai/replan 的实现：解析修改意见 -> 合并参数 -> 重新求解。"""
    warnings: list[str] = []
    debug: dict | None = None

    if llm.is_configured():
        result = await llm.call_tool(
            REPLAN_TOOL,
            REPLAN_SYSTEM_PROMPT,
            build_replan_user_prompt(req.text, _plan_digest(req)),
        )
        if result.ok:
            constraints = result.arguments
            source = "llm"
            debug = result.debug
        else:
            warnings.append(f"大模型解析失败，已降级为规则解析：{result.error}")
            constraints = nlp_rules.parse_replan(req.text)
            source = "rules"
            debug = {"fallbackFrom": result.error}
    else:
        warnings.append("未配置 LLM API Key：使用内置规则解析重规划意图")
        constraints = nlp_rules.parse_replan(req.text)
        source = "rules"
        debug = {"text": req.text}

    applied: list[str] = []

    # ---- 权重 ----
    weights = req.weights.model_dump()
    changed_weights = _clamp_weights(constraints.get("weights") or {})
    for key, value in changed_weights.items():
        weights[key] = value
        applied.append(f"{WEIGHT_LABELS.get(key, key)} → {value:.1f}")

    # ---- 时间与天数 ----
    options = req.options.model_copy()
    if constraints.get("dayStartTime"):
        options.dayStartTime = str(constraints["dayStartTime"])
        applied.append(f"出发时间 → {options.dayStartTime}")
    if constraints.get("dayEndTime"):
        options.dayEndTime = str(constraints["dayEndTime"])
        applied.append(f"收工时间 → {options.dayEndTime}")
    if constraints.get("lunchBreakMin") is not None:
        try:
            options.lunchBreakMin = max(0, int(constraints["lunchBreakMin"]))
            applied.append(f"午餐 → {options.lunchBreakMin} 分钟")
        except (TypeError, ValueError):
            pass

    days = req.days
    if constraints.get("days"):
        try:
            days = min(7, max(1, int(constraints["days"])))
            applied.append(f"天数 → {days}")
        except (TypeError, ValueError):
            pass

    mode = req.mode
    if constraints.get("mode") in MODE_LABELS:
        mode = str(constraints["mode"])
        applied.append(f"交通方式 → {MODE_LABELS[mode]}")

    # ---- 去掉某些点 ----
    remove_names = [str(n) for n in (constraints.get("removeNames") or [])]
    remove_names += [str(n) for n in (constraints.get("exclude") or [])]
    destinations = list(req.destinations)
    removed: list[str] = []
    if remove_names:
        kept = []
        for dest in destinations:
            hit = any(
                name and (name == dest.name or name in dest.name or dest.name in name)
                for name in remove_names
            )
            if hit:
                removed.append(dest.name)
            else:
                kept.append(dest)
        destinations = kept
        if removed:
            applied.append("移除：" + "、".join(removed))

    # ---- 必须去的地点 -> mustVisitIds ----
    must_names = [str(n) for n in (constraints.get("mustVisitNames") or [])]
    if must_names:
        must_ids = [
            dest.id
            for dest in destinations
            if any(name and (name == dest.name or name in dest.name or dest.name in name) for name in must_names)
        ]
        if must_ids:
            options.mustVisitIds = must_ids
            applied.append("必去：" + "、".join(must_names))

    if not applied:
        warnings.append("没有从这句话里解析出可执行的调整，路书保持不变")

    new_req = PlanRequest(
        hotel=req.hotel,
        destinations=destinations,
        days=days,
        mode=mode,
        weights=Weights(**weights),
        naturalLanguage=req.text,
        options=options,
    )
    plan = await create_plan(new_req)

    reply = await _compose_reply(
        text=req.text,
        applied=applied,
        removed=removed,
        plan=plan,
        mode=mode,
        days=days,
        hotel_name=req.hotel.name,
        model_ok=(source == "llm"),
    )

    return AiReplanResponse(
        source=source,
        reply=reply,
        constraints=constraints,
        applied=applied,
        removed=removed,
        plan=plan,
        warnings=warnings,
        debug=debug,
    )


# --------------------------------------------------------------------------- #
# 3. 路线解释
# --------------------------------------------------------------------------- #
def _explain_digest(plan: PlanResponse) -> str:
    """喂给模型的紧凑路书 JSON（只保留解释需要的事实，省 token 也防幻觉）。"""
    days = []
    for day in plan.days:
        days.append(
            {
                "标题": day.title or day.date,
                "回酒店": day.returnTime,
                "超时分钟": day.overtimeMin,
                "统计": day.stats.model_dump(),
                "站点": [
                    {
                        "名称": stop.name,
                        "到达": stop.arriveTime,
                        "离开": stop.leaveTime,
                        "停留": stop.stayMin,
                        "含午餐": stop.lunchMin,
                        "上一段": (
                            {
                                "方式": stop.transportFromPrev.mode,
                                "分钟": stop.transportFromPrev.durationMin,
                                "公里": stop.transportFromPrev.distanceKm,
                                "元": stop.transportFromPrev.cost,
                            }
                            if stop.transportFromPrev
                            else None
                        ),
                    }
                    for stop in day.stops
                ],
            }
        )
    solver = plan.solver or {}
    return json.dumps(
        {
            "酒店": None,  # 酒店名在 explanation 里已有，避免重复
            "天数": len(plan.days),
            "分天方式": solver.get("splitMethod"),
            "交通方式": solver.get("modeLabel"),
            "数据来源": solver.get("dataSource"),
            "权重": solver.get("weights"),
            "未排入": [item.get("name") for item in (solver.get("dropped") or [])],
            "天": days,
        },
        ensure_ascii=False,
    )


async def explain(plan: PlanResponse, question: str | None = None) -> AiExplainResponse:
    """POST /api/ai/explain 的实现：LLM 润色，失败则直接回规则化解释。"""
    if llm.is_configured():
        result = await llm.call_text(
            EXPLAIN_SYSTEM_PROMPT,
            build_explain_user_prompt(_explain_digest(plan), question),
        )
        if result.ok:
            return AiExplainResponse(source="llm", text=result.text, debug=result.debug)
        return AiExplainResponse(
            source="rules",
            text=plan.explanation,
            debug={"fallbackFrom": result.error},
        )

    return AiExplainResponse(
        source="rules",
        text=plan.explanation,
        debug={"reason": "未配置 LLM API Key，返回求解器给出的规则化解释"},
    )

