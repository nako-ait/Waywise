"""对话层（v1.9）：**先确认，再动手**。

用户说一句话，这里只产出「提案」（要改什么），不执行；用户点确认后
`/api/ai/apply` 才真正改参数、跑求解器，并返回一句变更回执。

为什么这么拆：
  · 之前是一句话直接改路书，用户没有反悔机会，也看不清 AI 到底动了什么；
  · 拆成两步后，每轮都会先告诉用户"我准备做 X"，确认后才落库 —— 这就是
    LangGraph 里 human-in-the-loop 的 interrupt 语义，只是我们放在了 HTTP 边界上。

另外两条硬规则：
  · 回复必须短（≤3 句 / ≤80 字），细节放进 preview；
  · 模型/规则"没有的数据"（酒店星级、房价、天气、人流）必须承认，不许编。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..models import Destination, PlanResponse, TripLimits
from . import nlp_rules
from .planner import create_plan
from .poi_store import load_pois, search_pois

# 权重在求解器里是"在意程度"，这里映射成人话
WEIGHT_LABELS = {"time": "赶时间", "convenience": "少换乘", "cost": "省钱", "walking": "少走路"}
MODE_LABELS = {"walk": "步行", "transit": "公交", "subway": "地铁", "taxi": "打车", "drive": "驾车"}

# 我们没有的数据源：命中就老实说，并给替代方案
BOUNDARIES: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(r"酒店|住宿|民宿|宾馆"),
        "酒店",
        "我这边没有酒店的星级和实时房价，只有地点本身。把酒店名或地址告诉我，我设成起点；或者你在右侧「出发酒店 → 更换」里搜一下。",
    ),
    (
        re.compile(r"天气|下雨|下雨天|气温|冷不冷"),
        "天气",
        "我没有实时天气。能帮你的是：把室外点挪到上午、或者安排成室内为主。",
    ),
    (
        re.compile(r"人多|排队|客流|拥挤"),
        "实时人流",
        "我没有实时人流数据。能帮你的是：把热门点排到刚开门的时段，或者换一个同类地点。",
    ),
    (
        re.compile(r"门票|票价|人均|多少钱一个人|消费"),
        "实时价格",
        "门票和人均消费我没有可靠来源，只能按距离和停留时长帮你排。",
    ),
]

MAX_REPLY = 90


def _short(text: str, limit: int = MAX_REPLY) -> str:
    """把回复压到 2~3 句、limit 字以内（模型偶尔会啰嗦）。"""
    cleaned = re.sub(r"\s+", " ", text.strip())
    if len(cleaned) <= limit:
        return cleaned
    cut = cleaned[:limit]
    # 优先在句号/问号处断开
    for mark in ("。", "？", "！", "；"):
        idx = cut.rfind(mark)
        if idx >= limit // 2:
            return cut[: idx + 1]
    return cut + "…"


@dataclass
class Proposal:
    kind: str = "act"  # act | clarify | answer
    reply: str = ""
    preview: list[str] = field(default_factory=list)
    question: str | None = None
    options: list[str] = field(default_factory=list)
    ops: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _poi_index(city_pois: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for poi in load_pois():
        index[poi.name] = {"name": poi.name, "lng": poi.lng, "lat": poi.lat, "stayMin": poi.stayMin}
    for poi in city_pois or []:
        name = str(poi.get("name") or "").strip()
        if not name:
            continue
        index.setdefault(
            name,
            {"name": name, "lng": poi.get("lng"), "lat": poi.get("lat"), "stayMin": poi.get("stayMin") or 60},
        )
    return index


def _match_place(text: str, index: dict[str, dict], used: set[str]) -> list[dict]:
    """从一句话里找出想加的地点（按已知 POI 名匹配，宁缺毋滥）。"""
    hits: list[dict] = []
    for name, info in index.items():
        if name in used or len(name) < 2:
            continue
        if name in text:
            hits.append(info)
    # 同一前缀的短名优先（"外滩" 命中就不要 "外滩·陈毅广场"）
    hits.sort(key=lambda item: len(item["name"]))
    picked: list[dict] = []
    for hit in hits:
        if any(hit["name"] in other["name"] for other in picked):
            continue
        picked.append(hit)
    return picked


def build_proposal(
    text: str,
    *,
    used_names: set[str],
    city_pois: list[dict],
    days: int,
    mode: str,
    weights: dict[str, float],
    has_places: bool,
) -> Proposal:
    """把一句话变成「提案」。纯规则 + 本地检索，零网络、零等待。"""
    clean = text.strip()
    index = _poi_index(city_pois)

    # 1) 能力边界：先承认，再给替代
    for pattern, label, message in BOUNDARIES:
        if pattern.search(clean):
            ops = {}
            others = _extract_ops(clean, index, used_names, days, mode, weights, has_places)
            if others:
                ops = others.get("ops", {})
            return Proposal(
                kind="answer",
                reply=message,
                preview=[],
                warnings=[label],
                ops=ops,
            )

    # 2) 推荐：没有任何地点时说"推荐/随便/帮我安排"
    if not has_places and re.search(r"推荐|随便|帮我|安排|规划|不知道|看着办|都行", clean):
        pool = city_pois or [
            {"name": p.name, "lng": p.lng, "lat": p.lat, "stayMin": p.stayMin, "tags": p.tags}
            for p in load_pois()
        ]
        picks = pool[: max(4, min(6, days * 4))]
        return Proposal(
            kind="act",
            reply=_short(f"我按{days}天给你挑了{len(picks)}个顺路的点，先看看合不合口味。"),
            preview=["新增 " + "、".join(p["name"] for p in picks[:4]) + ("…" if len(picks) > 4 else "")],
            ops={"addPlaces": picks},
        )

    # 3) 常规：解析改动
    result = _extract_ops(clean, index, used_names, days, mode, weights, has_places)
    if result is None:
        return Proposal(
            kind="clarify",
            reply="没太听懂要改什么。",
            question="是想加点、去掉点，还是改天数 / 交通方式？",
            options=["加地点", "去掉某个点", "改天数", "换交通方式"],
        )
    return result


def _parse_limits(text: str) -> dict[str, float]:
    """从一句话里抠出「预算上限」和「路上时间上限」。

    这是用户最常给、而我们以前完全不认的两类硬约束：
      · 「全程费用预算 150」「150 元以内」 → budgetCap
      · 「交通时间压缩到 5 小时以内」「路上不超过 90 分钟」 → transitCapMin
    """
    limits: dict[str, float] = {}
    budget = re.search(r"(?:预算|费用|花费|人均)[^\d]{0,8}(\d{2,5})", text) or re.search(
        r"(\d{2,5})\s*元?\s*(?:以内|以下|之内|封顶)", text
    )
    if budget:
        value = float(budget.group(1))
        if 20 <= value <= 20000:
            limits["budgetCap"] = value

    transit = re.search(
        r"(?:交通|路上|路程|通勤|车程|坐车)[^\d]{0,8}(\d{1,2}(?:\.\d)?)\s*(个?小时|h|小时|分钟|min)",
        text,
    )
    if transit:
        amount = float(transit.group(1))
        unit = transit.group(2)
        minutes = amount * 60 if ("小时" in unit or unit == "h") else amount
        if 10 <= minutes <= 600:
            limits["transitCapMin"] = round(minutes)
    return limits


def _extract_ops(
    text: str,
    index: dict[str, dict],
    used_names: set[str],
    days: int,
    mode: str,
    weights: dict[str, float],
    has_places: bool,
) -> Proposal | None:
    raw = nlp_rules.parse_replan(text) or {}
    ops: dict[str, Any] = {}
    preview: list[str] = []
    reply_parts: list[str] = []

    # 天数
    if isinstance(raw.get("days"), int) and raw["days"] != days:
        ops["days"] = raw["days"]
        preview.append(f"天数改成 {raw['days']} 天")
        reply_parts.append(f"{raw['days']} 天")

    def negated(keyword: str) -> bool:
        """判断某个词是不是被否定了：不要全部都打车 / 不是省钱。"""
        return re.search(r"(?:不(?:是|要|想|用|会)|别|避免)[^，。；]{0,10}" + re.escape(keyword), text) is not None

    # 交通方式（被否定的不提：不要全部都打车 → 不改交通方式）
    if raw.get("mode") in MODE_LABELS and raw["mode"] != mode and not negated(MODE_LABELS[raw["mode"]]):
        ops["mode"] = raw["mode"]
        preview.append(f"全程改为{MODE_LABELS[raw['mode']]}")
        reply_parts.append(f"改{MODE_LABELS[raw['mode']]}")

    # 硬上限：预算 / 路上时间（这两条以前完全没有概念，用户说了也白说）
    limits = _parse_limits(text)
    if limits:
        ops["limits"] = limits
        if "budgetCap" in limits:
            preview.append(f"预算上限 ¥{limits['budgetCap']:.0f}")
            reply_parts.append(f"预算 ¥{limits['budgetCap']:.0f}")
        if "transitCapMin" in limits:
            hours = limits["transitCapMin"] / 60
            label = f"{hours:g} 小时" if hours >= 1 else f"{limits['transitCapMin']:.0f} 分钟"
            preview.append(f"路上时间上限 {label}")
            reply_parts.append(f"路上 {label}")

    # 权重
    changed_weights = {
        k: v
        for k, v in (raw.get("weights") or {}).items()
        if k in WEIGHT_LABELS and not negated(WEIGHT_LABELS[k])
    }
    # 给了预算上限就不必再叠一层"省钱"权重；反过来，"节省交通时间"要显式抬时间权重
    if "budgetCap" in limits:
        changed_weights.pop("cost", None)
    if re.search(r"节省?(?:交通)?时间|压缩.{0,4}时间|赶时间|快点|别太久", text):
        changed_weights.setdefault("time", 0.9)
    if changed_weights:
        ops["weights"] = changed_weights
        preview.append("更看重" + "、".join(WEIGHT_LABELS[k] for k in changed_weights))
        reply_parts.append("、".join(WEIGHT_LABELS[k] for k in changed_weights))

    # 时间
    times: dict[str, Any] = {}
    if raw.get("dayStartTime"):
        times["dayStartTime"] = raw["dayStartTime"]
    if raw.get("dayEndTime"):
        times["dayEndTime"] = raw["dayEndTime"]
    if times:
        ops["times"] = times
        preview.append("出发/收工时间调整")
        reply_parts.append("时间调整")

    # 去掉地点
    removes: list[str] = []
    for name in list(raw.get("removeNames") or []):
        hit = next((n for n in used_names if name and (name in n or n in name)), None)
        if hit:
            removes.append(hit)
    if removes:
        ops["removeNames"] = removes
        preview.append("去掉 " + "、".join(removes))
        reply_parts.append("去掉" + "、".join(removes))

    # 加地点（明确提到的地名）
    adds = _match_place(text, index, used_names)
    adds = [item for item in adds if item["name"] not in removes]
    if adds:
        ops["addPlaces"] = adds
        preview.append("加入 " + "、".join(item["name"] for item in adds))
        reply_parts.append("加入" + "、".join(item["name"] for item in adds))

    if not ops:
        return None

    reply = "收到，" + "；".join(reply_parts) + "。确认后我再改动。"
    return Proposal(kind="act", reply=_short(reply), preview=preview, ops=ops)


# --------------------------------------------------------------------------- #
# 执行：确认之后才走到这里
# --------------------------------------------------------------------------- #
async def apply_ops(base_req: Any, ops: dict[str, Any]) -> tuple[PlanResponse, list[str], str]:
    """把 ops 合并进请求 → 编译 → 返回 (路书, 变更清单, 一行回执)。"""
    destinations = list(base_req.destinations)
    removed = [str(n) for n in (ops.get("removeNames") or [])]
    kept = [d for d in destinations if not any(n and (n in d.name or d.name in n) for n in removed)]
    removed_real = [d.name for d in destinations if d not in kept]

    added_names: list[str] = []
    for item in ops.get("addPlaces") or []:
        name = str(item.get("name") or "").strip()
        if not name or any(d.name == name for d in kept):
            continue
        kept.append(
            Destination(
                id=f"op_{len(kept)}_{abs(hash(name)) % 9999}",
                name=name,
                lng=float(item.get("lng") or 0),
                lat=float(item.get("lat") or 0),
                selected=True,
                stayMin=int(item.get("stayMin") or 60),
            )
        )
        added_names.append(name)

    days = int(ops.get("days") or base_req.days)
    mode = str(ops.get("mode") or base_req.mode)
    weights = base_req.weights.model_copy(update=(ops.get("weights") or {}))
    options = base_req.options.model_copy(update=(ops.get("times") or {}))

    new_req = base_req.model_copy(
        update={
            "destinations": kept,
            "days": days,
            "mode": mode,
            "weights": weights,
            "options": options,
            "legModes": {} if ops.get("mode") else getattr(base_req, "legModes", None),
            "limits": TripLimits(**ops["limits"])
            if ops.get("limits")
            else getattr(base_req, "limits", None),
        }
    )
    plan = await create_plan(new_req)

    changes: list[str] = []
    if added_names:
        changes.append(f"＋{len(added_names)} 地点")
    if removed_real:
        changes.append(f"－{len(removed_real)} 地点")
    if ops.get("mode"):
        changes.append(f"交通改为{MODE_LABELS.get(str(ops['mode']), ops['mode'])}")
    if ops.get("weights"):
        changes.append("偏好已更新")
    if ops.get("days"):
        changes.append(f"{days} 天")
    if ops.get("times"):
        changes.append("时间已更新")
    limit_info = (plan.solver or {}).get("limits") or {}
    violations = list(limit_info.get("violations") or [])
    if violations:
        changes.append("⚠ " + "；".join(violations))
    elif limit_info:
        changes.append(
            f"预算 ¥{limit_info.get('actualCost', 0):.0f}/"
            f"{limit_info.get('budgetCap') or '-'} · 路上 {limit_info.get('actualTransitMin', 0):.0f} 分钟"
        )
    changes.append("已重新编译")
    return plan, changes, " · ".join(changes)



