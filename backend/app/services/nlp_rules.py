"""无 LLM Key 时的规则解析器（关键词 + 正则 + 预置 POI 匹配）。

定位：**不是要逼近大模型，而是保证没有 Key / 没有网也能把整个演示走完**。
所以它只做两件确定性很强的事：
  1) 地点识别 —— 用 37 个预置 POI 的全名与别名做「最长优先」扫描，
     再按 、，和 等分隔符切词兜底；识别不到的词原样报给用户（不猜）。
  2) 约束识别 —— 「少走路」「6 点前回酒店」「省钱」「多拍照」「两天」这类说法
     映射成权重与时间设置，映射表写在下面的常量里，一眼可查、可现场改。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .poi_store import load_pois

# --------------------------------------------------------------------------- #
# 别名表：让「豫园」「武康路」「1933」这种口语说法也能命中预置 POI
# --------------------------------------------------------------------------- #
EXTRA_ALIASES: dict[str, list[str]] = {
    "豫园·城隍庙": ["豫园", "城隍庙", "老城隍庙"],
    "武康路·武康大楼": ["武康路", "武康大楼", "武康"],
    "东方明珠广播电视塔": ["东方明珠"],
    "上海中心大厦·上海之巅观光厅": ["上海中心", "上海之巅"],
    "陆家嘴滨江大道": ["陆家嘴", "滨江大道"],
    "1933 老场坊": ["1933", "老场坊"],
    "复旦大学（邯郸校区）": ["复旦", "复旦大学"],
    "上海当代艺术博物馆 PSA": ["PSA", "当代艺术博物馆"],
    "西岸·油罐艺术中心": ["油罐", "西岸"],
    "北外滩·白玉兰广场": ["白玉兰", "北外滩"],
    "南京路步行街": ["南京路"],
    "朱家角古镇": ["朱家角"],
    "七宝老街": ["七宝"],
    "上海科技馆": ["科技馆"],
    "上海博物馆": ["上博"],
    "上海自然博物馆": ["自然博物馆"],
    "田子坊": ["田子坊"],
}

# 标签词 -> 用标签补位时最多补几个点
TAG_KEYWORDS: list[tuple[str, str, int]] = [
    ("咖啡", "咖啡", 3),
    ("拍照", "拍照", 4),
    ("夜景", "夜景", 3),
    ("博物馆", "博物馆", 3),
    ("公园", "公园", 3),
    ("古镇", "古镇", 2),
    ("小吃", "小吃", 3),
    ("购物", "购物", 3),
    ("美术馆", "美术馆", 3),
    ("citywalk", "citywalk", 4),
]

WEIGHT_RULES: list[tuple[str, str, float]] = [
    (r"少走|不想走|走不动|腿脚|别走太多|少点步|走太多|少走路", "walking", 0.95),
    (r"赶时间|时间紧|快一点|快些|别太晚|早点回|早点结束|少花时间|尽量快", "time", 0.9),
    (r"省.{0,2}钱|便宜|穷游|预算|不花钱|经济|实惠", "cost", 0.9),
    (r"少换乘|直达|别倒车|方便|不想折腾", "convenience", 0.9),
    (r"多拍照|拍照|出片|慢慢逛|别太累|休闲|轻松", "walking", 0.7),
]

# 「要去」与「不要去」的触发词
REMOVE_PATTERN = r"(?:不想去|不要去|不去了|不去|别去|别安排|去掉|删除|移除|剔除|除了|排除)"
MUST_PATTERN = r"(?:一定要去|必须去|非得去|不能错过|别忘(?:了)?|重点去|优先去)"

# 判定「这句话是在说收工时间」的上下文词
DAY_END_HINTS = r"回|返|结束|收工|到酒店|之前|点前|前回"

# unknown 里的噪声词：纯约束表达，不该被当成"没识别的地名"
NOISE_RE = re.compile(
    r"^(\d+|[一两二三四五六七八九十]+)?"
    r"(天|日|点|小时|分钟|分|个|人|次|元|块|路|步|车)?"
    r"(左右|前后|之前|以后|以内)?$"
)

# 扫描别名前先抹掉的 filler 词组，避免"我想去"这类词被当成没识别的地名报出来
STRIP_PHRASES = [
    "我想去", "我想", "我要去", "我要", "帮我", "帮忙", "请", "麻烦",
    "想去", "要去", "去一下", "去", "看看", "看一下", "逛逛", "逛", "玩玩", "玩",
    "安排", "一起", "顺便", "然后", "还有", "再加", "加上", "以及", "另外",
    "今天", "明天", "这次", "计划", "打算", "想去看看",
]

CHINESE_DIGITS = {"一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7}

MODE_KEYWORDS: list[tuple[str, str]] = [
    (r"地铁|轨交", "subway"),
    (r"公交|巴士", "transit"),
    (r"打车|出租车|滴滴|网约车", "taxi"),
    (r"自驾|开车|驾车", "drive"),
    (r"步行|走路|徒步", "walk"),
]


@dataclass
class ParseResult:
    """与 LLM 工具调用返回的结构保持一致，下游处理逻辑因此只有一份。"""

    places: list[dict] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    must_visit: list[str] = field(default_factory=list)
    summary: str = ""
    weights: dict[str, float] = field(default_factory=dict)
    day_start: str | None = None
    day_end: str | None = None
    lunch_min: int | None = None
    days: int | None = None
    mode: str | None = None
    intent_summary: str | None = None
    notes: list[str] = field(default_factory=list)

    def as_tool_arguments(self) -> dict:
        """转成与 replan_constraints / add_destinations 工具参数同构的 dict。"""
        payload: dict = {
            "places": self.places,
            "exclude": self.exclude,
            "summary": self.summary,
        }
        weights = dict(self.weights)
        if weights:
            payload["weights"] = weights
        if self.day_start:
            payload["dayStartTime"] = self.day_start
        if self.day_end:
            payload["dayEndTime"] = self.day_end
        if self.lunch_min is not None:
            payload["lunchBreakMin"] = self.lunch_min
        if self.days:
            payload["days"] = self.days
        if self.mode:
            payload["mode"] = self.mode
        if self.must_visit:
            payload["mustVisitNames"] = self.must_visit
        if self.exclude:
            payload["removeNames"] = self.exclude
        if self.intent_summary or self.summary:
            payload["intentSummary"] = self.intent_summary or self.summary
        return payload


def _alias_table() -> list[tuple[str, str]]:
    """(别名, 正式名) 列表，按别名长度倒序 —— 保证「武康大楼」优先于「武康」命中。"""
    table: dict[str, str] = {}
    for poi in load_pois():
        table[poi.name] = poi.name
        for part in re.split(r"[·（(）)\s]+", poi.name):
            if len(part) >= 2:
                table.setdefault(part, poi.name)
        for alias in EXTRA_ALIASES.get(poi.name, []):
            table[alias] = poi.name
    return sorted(table.items(), key=lambda item: len(item[0]), reverse=True)


def _scan_names(chunk: str) -> list[str]:
    """在一个文本片段里按别名最长优先扫描出正式地名。"""
    remaining = chunk
    for phrase in STRIP_PHRASES:
        remaining = remaining.replace(phrase, " ")
    hits: list[str] = []
    for alias, official in _alias_table():
        if alias and alias in remaining:
            if official not in hits:
                hits.append(official)
            remaining = remaining.replace(alias, " ")
    return hits


def extract_names(text: str) -> tuple[list[str], list[str], list[str]]:
    """按「肯定 / 否定 / 必须去」的上下文切分，抽出地名。

    返回 (要去的地点, 要去掉的地点, 必须去的地点)。
    先按否定词/必须词切段再识别，才能正确处理「我想去外滩，不去田子坊」这种一句话里两种态度。
    """
    pattern = f"({REMOVE_PATTERN}|{MUST_PATTERN})"
    chunks = re.split(pattern, text)
    want: list[str] = []
    exclude: list[str] = []
    must: list[str] = []
    polarity = "pos"
    for index, chunk in enumerate(chunks):
        if index % 2 == 1:  # 奇数位是分隔符本身
            polarity = "neg" if re.fullmatch(REMOVE_PATTERN, chunk) else "must"
            continue
        for official in _scan_names(chunk):
            if polarity == "neg":
                if official not in exclude:
                    exclude.append(official)
            elif polarity == "must":
                if official not in must:
                    must.append(official)
                if official not in want:
                    want.append(official)
            elif official not in want:
                want.append(official)
    # 否定优先：同一地点既说要去又说不去时，以「不去」为准
    want = [name for name in want if name not in exclude]
    must = [name for name in must if name not in exclude]
    return want, exclude, must


def _tag_fill(tags: list[str], limit: int = 4) -> list[str]:
    """按标签补位：每个标签取前 N 个预置 POI。"""
    if not tags:
        return []
    out: list[str] = []
    for poi in load_pois():
        if any(tag in poi.tags for tag in tags):
            out.append(poi.name)
        if len(out) >= limit:
            break
    return out


def _parse_clock(text: str, *, prefer_pm: bool = False) -> str | None:
    """从「6 点前回酒店」「下午 5 点」「18:30」里解析出 HH:mm。

    prefer_pm=True 用于「收工时间」这种语境：中文里说「6 点前回酒店」几乎一定指 18:00，
    不做这个推断就会得到 06:00（这是实测踩到的坑）。
    """
    explicit = re.search(r"(\d{1,2})[:：](\d{2})", text)
    if explicit:
        hour, minute = int(explicit.group(1)), int(explicit.group(2))
        if 0 <= hour <= 23:
            return f"{hour:02d}:{minute:02d}"

    match = re.search(r"(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*点(半)?", text)
    if not match:
        return None
    period, hour_text, half = match.group(1), match.group(2), match.group(3)
    hour = int(hour_text)
    if period in {"下午", "晚上"} and hour < 12:
        hour += 12
    if period in {"上午", "早上"} and hour == 12:
        hour = 0
    if period == "中午" and hour < 12:
        hour += 12
    # 没说上下午时按语境推断：收工时间里的 1~11 点算作下午
    if prefer_pm and period is None and hour <= 11:
        hour += 12
    minute = 30 if half else 0
    if 0 <= hour <= 23:
        return f"{hour:02d}:{minute:02d}"
    return None


def _is_noise(token: str) -> bool:
    """「两天」「6点」「走路」这类约束表达不该被当成没识别的地名报出来。"""
    if NOISE_RE.fullmatch(token):
        return True
    return bool(re.search(r"走路|拍照|便宜|省钱|换乘|时间|累|钱|预算|方便", token))


def _parse_stay_minutes(text: str) -> int | None:
    """「待一小时」「30 分钟」「多待一会儿」-> 分钟数。"""
    match = re.search(r"(\d+)\s*(小时|个小时|h)", text)
    if match:
        return int(match.group(1)) * 60
    match = re.search(r"(\d+)\s*(分钟|分)", text)
    if match:
        return int(match.group(1))
    if re.search(r"多待|待久|久一点|慢慢逛|深度", text):
        return 120
    if re.search(r"随便看看|打卡就走|拍个照就走|路过", text):
        return 30
    return None


def _extract_constraints(text: str, result: ParseResult) -> None:
    """抽取权重、时间、天数、交通方式、午餐（地点识别之外的部分）。"""
    for pattern, key, value in WEIGHT_RULES:
        if re.search(pattern, text):
            result.weights[key] = max(result.weights.get(key, 0.0), value)
            result.notes.append(f"命中偏好：{pattern.split('|')[0]} → {key}={value}")

    if re.search(DAY_END_HINTS, text):
        clock = _parse_clock(text, prefer_pm=True)
        if clock:
            result.day_end = clock
            result.notes.append(f"收工时间 → {clock}")
    if re.search(r"早点出发|早出发|早点出门|上午出发", text):
        result.day_start = "08:30"
        result.notes.append("出发时间 → 08:30")

    days_match = re.search(r"(\d+|[一两二三四五六七])\s*天", text)
    if days_match:
        token = days_match.group(1)
        result.days = int(token) if token.isdigit() else CHINESE_DIGITS.get(token, 1)
        result.notes.append(f"天数 → {result.days}")

    # 交通方式：「少走路」是偏好而不是想步行，先把这类说法摘掉再匹配
    mode_text = re.sub(r"(少|不想|别|不要|懒得)\s*走(路)?", " ", text)
    for pattern, mode in MODE_KEYWORDS:
        if re.search(pattern, mode_text):
            result.mode = mode
            result.notes.append(f"交通方式 → {mode}")
            break

    if re.search(r"午饭|午餐|吃饭|美食", text):
        result.lunch_min = _parse_stay_minutes(text) or 60
        result.notes.append(f"午餐 → {result.lunch_min} 分钟")


def parse_text(text: str) -> ParseResult:
    """一句话 -> 地点 + 约束（/api/ai/parse 的规则降级路径）。"""
    result = ParseResult()
    raw = (text or "").strip()
    if not raw:
        result.summary = "没有输入内容"
        result.notes.append("输入为空")
        return result

    want, exclude, must = extract_names(raw)
    result.exclude = exclude
    result.must_visit = must

    # 一个地点都没提到，但说了「想看公园/博物馆」这类类别词 → 按标签补位
    if not want:
        tags = [tag for keyword, tag, _ in TAG_KEYWORDS if keyword in raw]
        filled = _tag_fill(tags)
        if filled:
            want = filled
            result.notes.append(f"按标签「{'/'.join(tags)}」补位：{len(filled)} 个地点")

    stay = _parse_stay_minutes(raw)
    result.places = [
        {"name": name, **({"stayMin": stay} if stay else {}), "reason": "来自自然语言解析"}
        for name in want
    ]

    _extract_constraints(raw, result)

    # 摘要与提示
    if result.places:
        result.summary = f"识别到 {len(result.places)} 个地点：" + "、".join(
            p["name"] for p in result.places
        )
    else:
        leftover = [
            token.strip()
            for token in re.split(r"[、，,。；;\s]+", raw)
            if token.strip() and not _is_noise(token.strip()) and len(token.strip()) >= 2
        ]
        result.summary = (
            "没有匹配到可规划的地点：" + "、".join(leftover[:5]) if leftover else "没有识别到地点或偏好"
        )
    if result.places and stay:
        result.notes.append(f"统一停留时间 → {stay} 分钟")
    return result


def parse_replan(text: str) -> dict:
    """一句话重规划 -> replan_constraints 同构的参数。

    注意：重规划**不产出 places**（用户是在改已有路书，不是在加点），
    「多拍照」这类偏好只应影响权重，绝不能变成"新增 3 个拍照地点"。
    """
    result = ParseResult()
    raw = (text or "").strip()
    _extract_constraints(raw, result)
    _want, exclude, must = extract_names(raw)

    payload: dict = {}
    if result.weights:
        payload["weights"] = result.weights
    if result.day_start:
        payload["dayStartTime"] = result.day_start
    if result.day_end:
        payload["dayEndTime"] = result.day_end
    if result.lunch_min is not None:
        payload["lunchBreakMin"] = result.lunch_min
    if result.days:
        payload["days"] = result.days
    if result.mode:
        payload["mode"] = result.mode
    if must:
        payload["mustVisitNames"] = must
        result.notes.append("必去：" + "、".join(must))
    if exclude:
        payload["removeNames"] = exclude
        result.notes.append("移除：" + "、".join(exclude))

    summary_bits = list(result.notes) or ["没有解析出可执行的调整"]
    payload["intentSummary"] = "；".join(summary_bits)
    return payload
