"""行程口令分享（黑客松版）。

设计取舍（都是有意的）：
  · **不落库**：进程内存字典，重启即清空。比赛演示足够，也省掉迁移；
    要持久化只需把这个 dict 换成 SQLite 表（接口签名不用动）。
  · **口令字母表去掉 O/0/I/1**：现场口述或手抄时最容易看错的就是这四个字符。
  · **24 小时 TTL**：接口文案里的「口令不存在或已过期」才有实际含义；
    改 SHARE_TTL_HOURS 即可，或设成 0 表示永不过期。
  · **不做账号**：谁拿到口令谁能导入，符合"发个码给队友"的使用方式。
"""
from __future__ import annotations

import json
import random
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["share"])

# 去掉 O / 0 / I / 1，避免口头与手抄歧义
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6

SHARE_TTL_HOURS = 24
MAX_PAYLOAD_BYTES = 64 * 1024

# 口令 -> 行程快照；创建时间单独存，便于过期清理
_shared_trips: dict[str, dict[str, Any]] = {}
_shared_created_at: dict[str, float] = {}


class ShareRequest(BaseModel):
    """前端收集的行程快照（原样存取，后端不解释字段含义）。"""

    trip_data: dict[str, Any] = Field(..., description="酒店 / 目的地 / 方式 / 权重 等行程快照")


class ShareResponse(BaseModel):
    code: str
    message: str


def _purge_expired() -> None:
    if SHARE_TTL_HOURS <= 0:
        return
    deadline = time.time() - SHARE_TTL_HOURS * 3600
    for code, created_at in list(_shared_created_at.items()):
        if created_at < deadline:
            _shared_trips.pop(code, None)
            _shared_created_at.pop(code, None)


def _new_code() -> str:
    for _ in range(50):
        code = "".join(random.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if code not in _shared_trips:
            return code
    raise HTTPException(status_code=503, detail="口令生成失败，请稍后重试")


def _validate_trip(trip_data: dict[str, Any]) -> None:
    hotel = trip_data.get("hotel")
    if not isinstance(hotel, dict):
        raise HTTPException(status_code=400, detail="行程缺少酒店信息")
    try:
        lng = float(hotel.get("lng"))
        lat = float(hotel.get("lat"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="酒店坐标不合法") from None
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise HTTPException(status_code=400, detail="酒店坐标超出范围")

    payload = json.dumps(trip_data, ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="行程太大，无法分享")


@router.post("/share", response_model=ShareResponse)
def create_share(payload: ShareRequest) -> ShareResponse:
    """把一份行程存成 6 位口令。"""
    _validate_trip(payload.trip_data)
    _purge_expired()

    code = _new_code()
    _shared_trips[code] = payload.trip_data
    _shared_created_at[code] = time.time()
    return ShareResponse(code=code, message="分享成功")


@router.get("/share/{code}")
def read_share(code: str) -> dict[str, Any]:
    """用口令取回行程；找不到（或已过期）返回 404。"""
    _purge_expired()
    trip = _shared_trips.get((code or "").strip().upper())
    if trip is None:
        raise HTTPException(status_code=404, detail="口令不存在或已过期")
    return trip


@router.get("/share/stats/summary")
def share_stats() -> dict[str, int]:
    """调试/演示用：当前有效口令数与总容量（不暴露任何行程内容）。"""
    _purge_expired()
    return {"active": len(_shared_trips), "ttlHours": SHARE_TTL_HOURS}
