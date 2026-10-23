"""时间工具：HH:mm <-> 分钟、营业时间解析。

约定：一天内的时刻统一用「当日分钟数」（0~1440）参与运算，输出时再转回 HH:mm。
"""
from __future__ import annotations


def hhmm_to_min(value: str | None, default: int = 0) -> int:
    """'09:30' -> 570；非法输入返回 default。"""
    if not value:
        return default
    try:
        hh, mm = value.strip().split(":")
        return max(0, min(1440, int(hh) * 60 + int(mm)))
    except (ValueError, AttributeError):
        return default


def min_to_hhmm(minutes: float) -> str:
    """570 -> '09:30'（自动对 1440 取模，跨零点不会出现 25:10）。"""
    total = int(round(minutes)) % 1440
    return f"{total // 60:02d}:{total % 60:02d}"


def parse_business_hours(open_time: str | None, close_time: str | None) -> tuple[int, int] | None:
    """营业时间 -> (开门分钟, 关门分钟)。

    '00:00'~'23:59' 视为全天营业，返回 None（不加时间窗约束）。
    关门早于开门（跨零点）时按 24h 补正。
    """
    if not open_time or not close_time:
        return None
    o = hhmm_to_min(open_time, 0)
    c = hhmm_to_min(close_time, 1440)
    if o <= 0 and c >= 1439:
        return None
    if c <= o:
        c += 1440
    return o, min(c, 1440)
