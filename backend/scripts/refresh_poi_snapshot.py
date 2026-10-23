"""从高德刷新 POI 快照：坐标 / 地址 / 营业时间 / 评分，并按类别批量扩容到 150+。

为什么要有这个脚本（而不是"运行时查高德"）：
    现场演示必须**零网络依赖**，所以把不可靠的实时查询转成"离线抓取一次 + 本地固化快照"，
    和距离矩阵落 SQLite 缓存是同一个思路。

它同时解决三件事：
    1) 坐标准确性 —— 原来 37 个坐标是人工整理的近似值（实测有的偏 600m+），
       改用高德的权威点位；
    2) 营业时间 —— 原来按印象填，现在用高德的 biz_ext.opentime2；
    3) 数量 —— 按类别批量抓取，从 37 个扩到 150+。

保留人工的部分（高德给不了）：
    · tags —— 规划用的**语义标签**（夜景/拍照/citywalk…），高德只有分类学标签；
    · stayMin —— 建议停留时长，高德给的是门票价不是停留时长。

用法（在 backend/ 目录下，需要 .env 里的 AMAP_WEB_KEY）：
    .venv\\Scripts\\python.exe scripts/refresh_poi_snapshot.py                # 刷新 + 扩容
    .venv\\Scripts\\python.exe scripts/refresh_poi_snapshot.py --no-expand    # 只刷新原有 POI
    .venv\\Scripts\\python.exe scripts/refresh_poi_snapshot.py --dry-run      # 只出报告，不写文件
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.services import cache  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
ROOT = BASE_DIR.parent                                      # 项目根
JSON_OUT = BASE_DIR / "data" / "shanghai_pois.json"
TS_OUT = ROOT / "frontend" / "src" / "data" / "shanghaiPois.ts"
REPORT_OUT = ROOT / "docs" / "poi-refresh-report.md"

AMAP_PLACE_URL = "https://restapi.amap.com/v3/place/text"
SHANGHAI_CITYCODE = "021"
TIMEOUT = 15.0
FETCHED_AT = date.today().isoformat()

# 坐标偏差超过这个值就报警（人工整理的近似坐标大多在 300m 内，
# 超过 500m 通常意味着"同名不同地"，需要人工确认）
COORD_WARN_M = 500


# --------------------------------------------------------------------------- #
# 类别定义：扩容的来源（每个类别取前 N 个）
# --------------------------------------------------------------------------- #
@dataclass
class Category:
    keyword: str          # 传给高德的关键词
    tag: str              # 我们自己的语义标签
    limit: int            # 取前几个
    stay_min: int         # 该类的建议停留时长（人工设定，高德不提供）
    exclude: tuple[str, ...] = ()   # 名称里含这些词的直接跳过


CATEGORIES: list[Category] = [
    Category("咖啡", "咖啡", 16, 45),
    Category("博物馆", "博物馆", 12, 120),
    Category("美术馆", "艺术", 10, 90),
    Category("公园", "公园", 14, 60),
    Category("古镇", "古镇", 6, 180),
    Category("小吃", "小吃", 12, 60),
    Category("购物中心", "购物", 12, 90),
    Category("书店", "书店", 10, 45),
    Category("酒吧", "酒吧", 8, 90, exclude=("停车场",)),
    Category("观景台", "观景", 6, 60),
    Category("寺庙", "寺庙", 6, 45),
    Category("创意园", "文创", 8, 60),
    Category("剧院", "演出", 8, 120),
    Category("体育馆", "运动", 6, 90),
]

# 高德分类里明显不适合做"旅行目的地"的顶层类型
TYPE_BLACKLIST = (
    "地名地址信息", "热点地名", "道路附属设施", "公共设施", "公司企业", "商务住宅",
    "汽车服务", "汽车销售", "摩托车服务", "医疗保健服务", "政府机构及社会团体",
    "金融保险服务", "生活服务", "通行设施", "门牌信息", "保险", "学校",
)
# 名称里含这些词的也跳过（停车场/出入口/公厕之类的"设施点"）
NAME_BLACKLIST = ("停车场", "停车库", "公厕", "加油站", "充电站", "出入口", "售票处", "地铁站", "公交站")

# 明显不是"可游览目的地"的**后缀**。这是踩过的坑：
# 查「中共一大会址纪念馆」时高德只返回了「…保管部」（徐汇区的行政办公点，偏 3.5km），
# 如果不拦，自动刷新会把一个正确的点换成 3.5 公里外的一间办公室。
NAME_SUFFIX_BLACKLIST = (
    "保管部", "管理处", "管理部", "办公室", "派出所", "居委会", "委员会", "服务中心",
    "游客中心", "售票处", "售票厅", "售票点", "检票口", "停车场", "停车点", "停车库",
    "仓库", "门市部", "营业厅", "工会", "协会", "学会", "商会", "分部", "筹备处",
    "工地", "项目部",
)

# 时间区间里可能出现的各种连接符（高德文案里都用过：半角、全角、短横、en dash、至）
TIME_RANGE_RE = re.compile(r"(\d{1,2}):(\d{2})\s*[-–—－~～至]\s*(\d{1,2}):(\d{2})")
# 「周X」后面紧跟闭馆词（最多隔 8 个非分句符字符）
ADJACENT_CLOSURE_TAIL_RE = re.compile(r"[^；;。]{0,8}?(?:全天关闭|闭馆|全天不开放|不开放|停业|不营业)")

# 高德搜不到好结果时的备用关键词（人工指定，跑一次就会缓存在 SQLite 里）
SEARCH_ALIASES = {
    "中共一大会址纪念馆": "中共一大纪念馆",
}

# 命中这些词说明该 POI 状态存疑，需要在报告里人工确认
SUSPICIOUS_NAME_WORDS = ("不对外开放", "暂不开放", "已关闭", "停业", "装修中")

# 同名不同地时，优先选这些类型（越靠前越优先）
TYPE_PREFERENCE = ("风景名胜", "科教文化服务", "体育休闲服务", "购物服务", "餐饮服务", "文化场馆")

# 高德分类 → 我们的语义标签（新抓的点用；老的 37 个保留人工标签）
TYPE_TO_TAGS: list[tuple[str, list[str]]] = [
    ("博物馆", ["博物馆"]),
    ("展览馆", ["艺术"]),
    ("美术馆", ["艺术"]),
    ("图书馆", ["书店"]),
    ("公园", ["公园"]),
    ("动物园", ["亲子"]),
    ("植物园", ["公园"]),
    ("风景名胜", ["地标"]),
    ("寺庙", ["寺庙"]),
    ("教堂", ["建筑"]),
    ("商场", ["购物"]),
    ("购物中心", ["购物"]),
    ("超市", ["购物"]),
    ("咖啡", ["咖啡"]),
    ("餐厅", ["餐饮"]),
    ("快餐厅", ["小吃"]),
    ("酒吧", ["酒吧"]),
    ("剧院", ["演出"]),
    ("电影院", ["演出"]),
    ("体育", ["运动"]),
    ("健身", ["运动"]),
    ("古镇", ["古镇"]),
    ("观景", ["观景"]),
]


# --------------------------------------------------------------------------- #
# 解析：照着真实返回结构写（type 分号分级 / location 字符串 / biz_ext 两种字段）
# --------------------------------------------------------------------------- #
def tags_from_type(raw: str) -> list[str]:
    return list(dict.fromkeys([seg.strip() for seg in (raw or "").split(";") if seg.strip()]))[:4]


def top_type(raw: str) -> str:
    parts = [seg.strip() for seg in (raw or "").split(";") if seg.strip()]
    return parts[0] if parts else ""


def semantic_tags(raw_type: str, category_tag: str | None) -> list[str]:
    """高德分类 → 我们的语义标签（新点用）。"""
    joined = raw_type or ""
    tags: list[str] = []
    if category_tag:
        tags.append(category_tag)
    for keyword, mapped in TYPE_TO_TAGS:
        if keyword in joined:
            for tag in mapped:
                if tag not in tags:
                    tags.append(tag)
    return tags[:4] or (["地标"] if not tags else tags)


WEEKDAY_CHARS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
# "某月某日""某月至某月""08-09至08-10"这类是**具体日期**，不是"每周规律"
DATE_SPECIFIC_RE = re.compile(r"(\d{1,2}月\d{1,2}日|\d{1,2}月至\d{1,2}月|\d{2}-\d{2}\s*至)")


def parse_hours(biz_ext: dict) -> tuple[str, str, str]:
    """返回 (openTime, closeTime, 原始文案)。

    **解析顺序很重要，这里踩过坑**：
      1) 先找时间区间 `HH:mm-HH:mm` —— 高德的文案里经常混着「全天关闭」这种句子，
         "全天"两个字的含义完全可能是"**全天不开放**"；
         反过来先匹配"全天"就会把「周一,周日 全天关闭；周二至周六 09:00-16:00」
         错判成"全天营业"（徐家汇天主教堂 / 长风海洋世界都栽在这上面）。
      2) 全文都没有时间区间时，才考虑「24小时营业 / 全天营业」，且必须不带"关闭/闭馆"。
      3) 都判断不出来 → 返回空，**不加时间窗约束**（安全默认）。

    两个字段都看：opentime2 更结构化，open_time 有时反而是干净的短句。
    """
    if not isinstance(biz_ext, dict):
        return "", "", ""

    texts: list[str] = []
    for key in ("opentime2", "open_time"):
        raw = biz_ext.get(key)
        text = (" ".join(raw) if isinstance(raw, list) else str(raw or "")).strip()
        if text and text != "[]":
            texts.append(text)
    if not texts:
        return "", "", ""

    joined = "；".join(texts)
    match = TIME_RANGE_RE.search(joined)
    if match:
        open_time = f"{int(match.group(1)):02d}:{match.group(2)}"
        close_raw = f"{int(match.group(3)):02d}:{match.group(4)}"
        close_time = "23:59" if close_raw == "24:00" else close_raw
        return open_time, close_time, joined[:200]

    if re.search(r"24\s*小时|全天", joined) and not re.search(r"关闭|闭馆|不开放|停业", joined):
        return "00:00", "23:59", joined[:200]

    return "", "", joined[:200]


def parse_closed_weekdays(text: str) -> list[int]:
    """析出「每周固定哪天全天关闭」，**仅用于界面提示，不进求解器**。

    严格准入 —— 宁可漏报也不误报（误报会让界面显示错误的"今天闭馆"）。
    这里有两个踩过的坑，都写成了硬规则：

      坑 1：「周一至周日 09:00-17:00（周一闭馆）」—— 分句里既有**开放范围**又有闭馆词，
            天真的实现会把"周一至周日"当成闭馆范围，得出"全周闭馆"的荒谬结论。
            → 规则：`周一至周日` 这种全周范围直接不算闭馆；
              且**含具体时间区间的分句整个跳过**（那种句子多半在描述开放时间）。
      坑 2：「上午暂停开放」「08-09至08-10 全天关闭」—— 半天 / 具体日期，不是每周规律。
            → 规则：含"上午/下午/暂停/提前"或具体日期的分句跳过。
    """
    if not text:
        return []
    closed: set[int] = set()
    for segment in re.split(r"[；;。]", text):
        if not re.search(r"全天关闭|闭馆|不开放|停业|不营业", segment):
            continue
        if re.search(r"上午|下午|暂停|提前", segment):
            continue
        if DATE_SPECIFIC_RE.search(segment):
            continue

        days: set[int] = set()
        # 规则 A（主）：紧邻的「周X + 闭馆词」。
        # ⚠️ 必须**逐个星期往后看**，不能用消费式正则：
        #    `周([一二三四五六日天])[^；;。]{0,8}?(?:闭馆|…)` 会把「周一,周日 全天关闭」
        #    整段一次吃掉，只命中第一个「周一」，周日就丢了（这个回归真出现过）。
        # 这一条不受"含时间区间"限制，因为「（周一闭馆，法定节假日除外）」就是跟在开放时间后面的。
        for match in re.finditer(r"周([一二三四五六日天])", segment):
            tail = segment[match.end(): match.end() + 12]
            if ADJACENT_CLOSURE_TAIL_RE.match(tail):
                days.add(WEEKDAY_CHARS[match.group(1)])

        # 规则 B：「周X至周Y」范围只在**不含时间区间**的分句里才算闭馆，
        # 否则「周一至周日 09:00-17:00 开放」会被误判成整周闭馆。
        if not TIME_RANGE_RE.search(segment):
            for match in re.finditer(r"周([一二三四五六日天])\s*至\s*周?([一二三四五六日天])", segment):
                start = WEEKDAY_CHARS[match.group(1)]
                end = WEEKDAY_CHARS[match.group(2)]
                if start == 1 and end == 7:    # 全周范围 = 不是闭馆
                    continue
                if start <= end:
                    days.update(range(start, end + 1))

        if len(days) == 7:                     # 兜底：全周闭馆不可能是"每周规律"
            continue
        closed |= days
    return sorted(closed)


def coords_from(location) -> tuple[float, float] | None:
    if not location:
        return None
    if isinstance(location, str):
        lng_text, _, lat_text = location.partition(",")
        try:
            return float(lng_text), float(lat_text)
        except ValueError:
            return None
    try:
        return float(location.get("lng")), float(location.get("lat"))
    except (AttributeError, TypeError, ValueError):
        return None


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math

    r = 6371008.8
    dlat = math.radians(b[1] - a[1])
    dlng = math.radians(b[0] - a[0])
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.sin(dlng / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def is_usable(poi: dict) -> tuple[bool, str]:
    """过滤掉不适合做目的地的 POI。"""
    name = str(poi.get("name") or "").strip()
    if not name:
        return False, "无名称"
    if any(bad in name for bad in NAME_BLACKLIST):
        return False, f"名称含设施词（{name}）"
    raw_type = str(poi.get("type") or "")
    if not raw_type:
        return False, "无分类"
    if any(bad in raw_type for bad in TYPE_BLACKLIST):
        return False, f"分类不适合（{top_type(raw_type)}）"
    if not coords_from(poi.get("location")):
        return False, "无坐标"
    return True, ""


# --------------------------------------------------------------------------- #
# 高德查询（带 SQLite 缓存，重复跑不再消耗配额）
# --------------------------------------------------------------------------- #
async def amap_place_search(client: httpx.AsyncClient, keyword: str, offset: int = 25) -> list[dict]:
    payload = {"keywords": keyword, "city": SHANGHAI_CITYCODE, "citylimit": "true",
               "offset": offset, "page": 1, "extensions": "all"}
    key = cache.make_key("poi-refresh-v1", {**payload, "city": SHANGHAI_CITYCODE})
    cached = cache.get(key)
    if cached is not None:
        return cached

    params = {**payload, "key": settings.amap_web_key}
    resp = await client.get(AMAP_PLACE_URL, params=params)
    resp.raise_for_status()
    data = resp.json()
    if str(data.get("status")) != "1":
        raise RuntimeError(f"高德返回错误：{data.get('info')}（keywords={keyword}）")
    pois = list(data.get("pois") or [])
    cache.set(key, pois)
    return pois


def name_score(query: str, name: str) -> int:
    """名称相似度打分（越小越好）：完全一致 > 前缀 > 包含。

    这一项必须排在"类型偏好"前面 —— 否则同一次搜索里的同名异地会挑错。
    """
    if name == query:
        return 0
    if name.startswith(query):
        return 1
    if query in name:
        return 2
    if name in query:
        return 3
    return 9


def pick_best(query: str, candidates: list[dict]) -> dict | None:
    """同名多条时挑最像"这个点本身"的那条。

    排序权重：名称相似度 > 类型偏好 > 有没有营业时间。
    带行政/设施后缀（保管部、管理处、售票处…）的候选直接剔除。
    """
    scored: list[tuple[int, int, int, dict]] = []
    for poi in candidates:
        ok, _reason = is_usable(poi)
        if not ok:
            continue
        name = str(poi.get("name") or "").strip()
        if any(name.endswith(suffix) for suffix in NAME_SUFFIX_BLACKLIST):
            continue

        raw_type = str(poi.get("type") or "")
        type_rank = len(TYPE_PREFERENCE)
        for index, preferred in enumerate(TYPE_PREFERENCE):
            if preferred in raw_type:
                type_rank = index
                break
        has_hours = 1 if parse_hours(poi.get("biz_ext") or {})[2] else 0
        scored.append((name_score(query, name), type_rank, -has_hours, poi))

    if not scored:
        return None
    scored.sort(key=lambda item: item[:3])
    return scored[0][3]


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
@dataclass
class Stats:
    refreshed: int = 0
    unmatched: list[tuple[str, str]] = field(default_factory=list)
    coord_changes: list[tuple[str, float, float, float]] = field(default_factory=list)
    hours_changes: list[tuple[str, str, str, str]] = field(default_factory=list)
    added_by_category: list[tuple[str, int]] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    # 名称不一致（疑似同名异地）／状态存疑／用了备用关键词
    name_changes: list[tuple[str, str]] = field(default_factory=list)
    suspicious: list[tuple[str, str]] = field(default_factory=list)
    alias_used: list[tuple[str, str]] = field(default_factory=list)
    # 高德说「24小时营业」但人工写了明确时段 —— 保留人工时段，列为待确认
    all_day_conflicts: list[tuple[str, str, str]] = field(default_factory=list)


async def main() -> int:
    parser = argparse.ArgumentParser(description="从高德刷新 POI 快照")
    parser.add_argument("--no-expand", action="store_true", help="只刷新原有 POI，不按类别扩容")
    parser.add_argument("--dry-run", action="store_true", help="只生成报告，不覆盖数据文件")
    args = parser.parse_args()

    if not settings.amap_web_key.strip():
        print("[x] 未配置 AMAP_WEB_KEY：请在 backend/.env 里填好再跑", file=sys.stderr)
        return 1

    baseline: list[dict] = json.loads(JSON_OUT.read_text(encoding="utf-8"))
    print(f"== 基线：{len(baseline)} 个 POI（{JSON_OUT.relative_to(ROOT)}）==")

    stats = Stats()
    result: list[dict] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # ---------- 1. 逐个刷新原有 POI（保住人工语义标签与停留时长） ----------
        for old in baseline:
            name = old["name"]
            best: dict | None = None
            reason = ""
            # 主打原名；原名匹配不到好结果时再试人工指定的备用关键词
            keywords = [name] + ([SEARCH_ALIASES[name]] if name in SEARCH_ALIASES else [])
            for keyword in keywords:
                try:
                    candidates = await amap_place_search(client, keyword, offset=10)
                except Exception as exc:  # noqa: BLE001
                    reason = f"查询失败：{exc}"
                    continue
                best = pick_best(name, candidates)
                if best is not None:
                    if keyword != name:
                        stats.alias_used.append((name, keyword))
                    break
                reason = (
                    "没有可用匹配（已排除行政/设施类同名点）" if candidates else "高德没有结果"
                )

            if best is None:
                stats.unmatched.append((name, reason or "未知原因"))
                result.append(old)          # 保留原数据，绝不因为抓不到就删掉
                continue

            coords = coords_from(best.get("location"))
            assert coords is not None
            moved = distance_m((old["lng"], old["lat"]), coords)
            if moved > COORD_WARN_M:
                stats.coord_changes.append((name, moved, old["lng"], old["lat"]))

            open_time, close_time, hours_raw = parse_hours(best.get("biz_ext") or {})
            old_open, old_close = old.get("openTime", ""), old.get("closeTime", "")
            old_hours = f"{old_open}-{old_close}"

            # ⚠️ 高德标「24小时营业」很多时候等于「没有营业时间数据」，而不是真的全天开放。
            #    世纪公园就是典型：高德给 24 小时，人工写的是 07:00-18:00。
            #    直接采信会让规划器把公园排到晚上 8 点 —— 那是**数据质量倒退**。
            #    所以：高德说全天、而人工有明确时段时，**保留人工时段**并在报告里列为冲突。
            amap_all_day = (open_time, close_time) == ("00:00", "23:59")
            manual_has_window = bool(old_open and old_close) and (old_open, old_close) != ("00:00", "23:59")
            if amap_all_day and manual_has_window:
                stats.all_day_conflicts.append((name, old_hours, hours_raw))
                open_time, close_time = old_open, old_close
            elif hours_raw and (open_time, close_time) != (old_open, old_close):
                stats.hours_changes.append((name, old_hours, f"{open_time}-{close_time}", hours_raw))

            amap_name = str(best.get("name") or name)
            if amap_name != name:
                stats.name_changes.append((name, amap_name))
            if any(word in amap_name for word in SUSPICIOUS_NAME_WORDS):
                stats.suspicious.append((name, amap_name))

            amap_id = str(best.get("id") or "")
            if amap_id:
                seen_ids.add(amap_id)
            seen_names.add(name)
            stats.refreshed += 1

            result.append({
                # ★ 保留人工整理的名字：3 条主题演示线路是**按名字**去预置库查的，
                #   用高德的名字覆盖（"上海博物馆" → "上海博物馆(人民广场馆)"）会让线路直接失配。
                "name": name,
                "lng": round(coords[0], 6),
                "lat": round(coords[1], 6),
                "openTime": open_time,
                "closeTime": close_time,
                "stayMin": int(old.get("stayMin") or 60),
                # ★ 人工语义标签原样保留（高德给不了"适合拍照"这种标签）
                "tags": list(old.get("tags") or []),
                "district": str(best.get("adname") or old.get("district") or ""),
                "address": str(best.get("address") or ""),
                "amapId": amap_id,
                "rating": str((best.get("biz_ext") or {}).get("rating") or ""),
                "category": (old.get("tags") or ["地标"])[0],
                "hoursRaw": hours_raw,
                "closedWeekdays": parse_closed_weekdays(hours_raw),
                "fetchedAt": FETCHED_AT,
            })

        print(f"  刷新成功 {stats.refreshed} 个，未匹配 {len(stats.unmatched)} 个")

        # ---------- 2. 按类别扩容 ----------
        # ⚠️ 幂等性：这里按「**每个类别总量上限**」补，而不是"每跑一次就再加一批"。
        #    高德的搜索结果排序会在两次调用之间漂移，如果只做"已存在则跳过"，
        #    每跑一次就会多出一批新点，库会无限膨胀（真踩到过：165 → 276）。
        if not args.no_expand:
            print("\n== 按类别扩容 ==")
            existing_by_category = Counter(poi.get("category") for poi in result)
            for category in CATEGORIES:
                already = existing_by_category.get(category.tag, 0)
                quota = max(0, category.limit - already)
                if quota == 0:
                    stats.added_by_category.append((category.tag, 0))
                    print(f"  {category.keyword:<6} → 已有 {already} 个，不再新增（幂等）")
                    continue

                try:
                    pois = await amap_place_search(client, f"上海 {category.keyword}", offset=25)
                except Exception as exc:  # noqa: BLE001
                    print(f"  [x] {category.keyword}: 查询失败 {exc}")
                    continue

                added = 0
                for poi in pois:
                    if added >= quota:
                        break
                    ok, reason = is_usable(poi)
                    if not ok:
                        continue
                    amap_id = str(poi.get("id") or "")
                    name = str(poi.get("name") or "").strip()
                    if amap_id and amap_id in seen_ids:
                        continue
                    if name in seen_names:
                        continue
                    coords = coords_from(poi.get("location"))
                    if coords is None:
                        continue
                    open_time, close_time, hours_raw = parse_hours(poi.get("biz_ext") or {})
                    raw_type = str(poi.get("type") or "")

                    result.append({
                        "name": name,
                        "lng": round(coords[0], 6),
                        "lat": round(coords[1], 6),
                        "openTime": open_time,
                        "closeTime": close_time,
                        "stayMin": category.stay_min,
                        "tags": semantic_tags(raw_type, category.tag),
                        "district": str(poi.get("adname") or ""),
                        "address": str(poi.get("address") or ""),
                        "amapId": amap_id,
                        "rating": str((poi.get("biz_ext") or {}).get("rating") or ""),
                        "category": category.tag,
                        "hoursRaw": hours_raw,
                        "closedWeekdays": parse_closed_weekdays(hours_raw),
                        "fetchedAt": FETCHED_AT,
                    })
                    if amap_id:
                        seen_ids.add(amap_id)
                    seen_names.add(name)
                    added += 1
                    stats.refreshed += 1

                stats.added_by_category.append((category.tag, added))
                print(f"  {category.keyword:<6} → 新增 {added} 个（累计 {len(result)}）")

    # ---------- 3. 报告 ----------
    report = render_report(result, stats, baseline, dry_run=args.dry_run)
    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(report, encoding="utf-8")
    print(f"\n[ok] 差异报告 → {REPORT_OUT.relative_to(ROOT)}")

    if args.dry_run:
        print("[dry-run] 未写入数据文件")
        return 0

    # ---------- 4. 写数据（JSON + TS 单一数据源）----------
    JSON_OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    TS_OUT.write_text(render_ts(result), encoding="utf-8")
    print(f"[ok] 数据 → {JSON_OUT.relative_to(ROOT)}（{len(result)} 个）")
    print(f"[ok] 数据 → {TS_OUT.relative_to(ROOT)}（前端预置库同步更新）")

    # 缓存里有新数据，提示一下
    print(f"\n提示：本次查询结果已进 SQLite 缓存（{cache.stats()['entries']} 条），重复跑不再消耗配额。")
    return 0


def ts_str(value: object) -> str:
    """TS 单引号字符串字面量：反斜杠和单引号都要转义。

    踩过的坑：高德有家店叫「Peet's皮爷咖啡」，名字里的撇号直接把生成的 TS 文件
    搞成语法错误（前端整个编译不过）。所以**所有**字符串字段都必须走这个函数，
    不能只转义"看起来会出问题"的那几个。
    """
    text = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{text}'"


def render_ts(pois: list[dict]) -> str:
    """生成前端 TS 数据文件（保持人类可读，且字段与 PoiPreset 类型一致）。"""
    lines = [
        "/**",
        " * 上海 POI 演示数据（模块 1 快速加点 + 模块 5 演示兜底）",
        " *",
        " * ⚠️ 本文件由 backend/scripts/refresh_poi_snapshot.py 生成，请勿手工编辑。",
        " *    坐标 / 营业时间 / 评分来自高德 Web 服务（权威），",
        " *    tags 是人工维护的**规划语义标签**（夜景/拍照/citywalk…），高德给不了。",
        f" *    数据抓取时间：{FETCHED_AT}",
        " *",
        " * ⚠️ 坐标为 GCJ-02（高德坐标系）。",
        " */",
        "import type { PoiPreset } from '@/types'",
        "",
        "export const SHANGHAI_POIS: PoiPreset[] = [",
    ]
    for poi in pois:
        tags = ", ".join(ts_str(tag) for tag in poi.get("tags") or [])
        parts = [
            f"name: {ts_str(poi['name'])}",
            f"lng: {poi['lng']}",
            f"lat: {poi['lat']}",
            f"openTime: {ts_str(poi.get('openTime', ''))}",
            f"closeTime: {ts_str(poi.get('closeTime', ''))}",
            f"stayMin: {poi.get('stayMin', 60)}",
            f"tags: [{tags}]",
            f"district: {ts_str(poi.get('district', ''))}",
        ]
        for key in ("address", "amapId", "rating", "category", "hoursRaw"):
            value = poi.get(key)
            if value:
                parts.append(f"{key}: {ts_str(value)}")
        closed = poi.get("closedWeekdays") or []
        if closed:
            parts.append(f"closedWeekdays: [{', '.join(str(day) for day in closed)}]")
        parts.append(f"fetchedAt: {ts_str(poi.get('fetchedAt', FETCHED_AT))}")
        lines.append("  { " + ", ".join(parts) + " },")
    lines += [
        "]",
        "",
        "/** 本地模糊匹配：按名称/标签/区名打分，零网络、零限流 */",
        "export function searchLocalPois(keyword: string, limit = 8): PoiPreset[] {",
        "  const kw = keyword.trim().toLowerCase()",
        "  if (!kw) return []",
        "  return SHANGHAI_POIS.map((poi) => {",
        "    const name = poi.name.toLowerCase()",
        "    let score = -1",
        "    if (name === kw) score = 100",
        "    else if (name.startsWith(kw)) score = 80",
        "    else if (name.includes(kw)) score = 60",
        "    else if ((poi.tags ?? []).some((tag) => tag.toLowerCase().includes(kw))) score = 40",
        "    else if ((poi.district ?? '').toLowerCase().includes(kw)) score = 20",
        "    return { poi, score }",
        "  })",
        "    .filter((item) => item.score > 0)",
        "    .sort((a, b) => b.score - a.score)",
        "    .slice(0, limit)",
        "    .map((item) => item.poi)",
        "}",
        "",
    ]
    validate_ts_object_lines(lines)
    return "\n".join(lines)


def validate_ts_object_lines(lines: list[str]) -> None:
    """自检：生成的数据行里单引号必须成对，否则说明有字符串没转义。

    「Peet's皮爷咖啡」那次就是被这个检查拦下的（拦住之前前端直接编译不过）。
    """
    for index, line in enumerate(lines, 1):
        if not line.startswith("  { "):
            continue
        without_escaped = line.replace("\\'", "")
        if without_escaped.count("'") % 2 != 0:
            raise SystemExit(
                f"[x] 生成的 TS 第 {index} 行单引号不成对（多半是名称里有撇号没转义）：\n    {line[:120]}"
            )


def render_report(result: list[dict], stats: Stats, baseline: list[dict], *, dry_run: bool) -> str:
    lines = [
        "# POI 快照刷新报告",
        "",
        f"- 抓取时间：**{FETCHED_AT}**",
        f"- 数据来源：高德 Web 服务 `v3/place/text`（GCJ-02）",
        f"- 基线：{len(baseline)} 个手工整理的 POI → 刷新后 **{len(result)}** 个",
        f"- 刷新成功：{stats.refreshed} 个｜未匹配：{len(stats.unmatched)} 个"
        + ("（**dry-run，未写入数据文件**）" if dry_run else ""),
        "",
        "## 一、坐标被修正的点（人工近似值 vs 高德权威点位）",
        "",
    ]
    if stats.coord_changes:
        lines += ["| 名称 | 偏差 | 原坐标 |", "| --- | --- | --- |"]
        for name, moved, lng, lat in sorted(stats.coord_changes, key=lambda x: -x[1]):
            lines.append(f"| {name} | **{moved:.0f} m** | {lng:.6f}, {lat:.6f} |")
        lines += [
            "",
            f"> 偏差超过 {COORD_WARN_M}m 的点需要人工确认是不是「同名不同地」。"
            "这类偏差会直接影响距离矩阵与步行可达性。",
        ]
    else:
        lines.append("无（所有点偏差都在阈值内）")

    lines += ["", "## 二、营业时间与手工填写不一致的点", ""]
    if stats.hours_changes:
        lines += ["| 名称 | 手工填写 | 高德 | 高德原始文案 |", "| --- | --- | --- | --- |"]
        for name, old, new, raw in stats.hours_changes:
            lines.append(f"| {name} | `{old}` | `{new}` | {raw[:60]} |")
    else:
        lines.append("无")

    lines += ["", "## 三、营业时间冲突：高德标「24小时营业」，人工写了明确时段", ""]
    if stats.all_day_conflicts:
        lines += ["| 名称 | 保留的人工时段 | 高德原始文案 |", "| --- | --- | --- |"]
        for name, manual, raw in stats.all_day_conflicts:
            lines.append(f"| {name} | `{manual}` | {raw[:60] or '（空）'} |")
        lines += [
            "",
            "> 高德的「24小时营业」很多时候等于「没有数据」而不是真的全天开放。",
            "> 这里**保留人工时段**（规划器宁可保守，也不要把公园排到晚上 8 点），",
            "> 但每一条都列出来供人工确认：如果确实是 24 小时开放的开放区域，可以直接把时段清空。",
        ]
    else:
        lines.append("无")

    lines += ["", "## 四、名称不一致的点（疑似同名异地，需人工扫一眼）", ""]
    if stats.name_changes:
        lines += ["| 我们的名字（保留） | 高德返回的名字 |", "| --- | --- |"]
        for ours, theirs in stats.name_changes:
            lines.append(f"| {ours} | {theirs} |")
        lines += [
            "",
            "> 名字统一保留我们人工整理的那份：3 条主题演示线路是**按名字**查预置库的，",
            "> 用高德的名字覆盖会让线路直接失配。",
        ]
    else:
        lines.append("无")

    lines += ["", "## 五、状态存疑的点（高德名称里就写了不对外开放之类）", ""]
    if stats.suspicious:
        lines += ["| 我们的名字 | 高德返回的名字 |", "| --- | --- |"]
        for ours, theirs in stats.suspicious:
            lines.append(f"| {ours} | {theirs} |")
    else:
        lines.append("无")

    if stats.alias_used:
        lines += ["", "## 六、使用了备用关键词的点", ""]
        lines += ["| 原名 | 实际查询词 |", "| --- | --- |"]
        for ours, keyword in stats.alias_used:
            lines.append(f"| {ours} | {keyword} |")

    lines += ["", "## 七、未匹配到高德的点（保留原数据，未被删除）", ""]
    if stats.unmatched:
        lines += ["| 名称 | 原因 |", "| --- | --- |"]
        for name, reason in stats.unmatched:
            lines.append(f"| {name} | {reason} |")
    else:
        lines.append("无")

    lines += ["", "## 八、按类别扩容结果", ""]
    if stats.added_by_category:
        lines += ["| 类别 | 新增 |", "| --- | --- |"]
        for tag, added in stats.added_by_category:
            lines.append(f"| {tag} | {added} |")
        lines.append(f"| **合计** | **{sum(a for _, a in stats.added_by_category)}** |")
    else:
        lines.append("未执行扩容（--no-expand）")

    no_hours = [poi["name"] for poi in result if not poi.get("hoursRaw")]
    weekday_closed = [(poi["name"], poi.get("closedWeekdays") or []) for poi in result if poi.get("closedWeekdays")]
    lines += [
        "",
        "## 九、数据质量说明",
        "",
        f"- 有明确营业时间文案的：{len(result) - len(no_hours)} / {len(result)}",
        f"- 高德未提供营业时间的：{len(no_hours)} 个 → **不加时间窗约束**（不是当成 24 小时）",
        f"- 析出「每周固定某天全天关闭」的：{len(weekday_closed)} 个 → **只在界面提示，不进求解器**",
        "- `tags` 为人工维护的规划语义标签，未随高德数据覆盖",
        "- 名称保留人工整理版本（演示线路按名字查预置库）",
        "",
    ]
    if weekday_closed:
        weekday_names = "、".join(f"{name}(周{'/'.join('一二三四五六日'[d - 1] for d in days)})" for name, days in weekday_closed[:40])
        lines += ["<details><summary>每周固定关闭日</summary>", "", weekday_names, "", "</details>", ""]
    if no_hours:
        lines.append("<details><summary>未提供营业时间的点</summary>")
        lines.append("")
        lines.append("、".join(no_hours[:80]))
        lines.append("")
        lines.append("</details>")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
