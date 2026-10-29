"""SQLite 键值缓存。

存在的唯一理由：高德 Web 服务 API 有 QPS 与日调用量限制，
演示现场被限流会非常尴尬。所有距离矩阵 / 路径规划结果一律落盘，
默认 TTL 7 天（AMAP_CACHE_TTL_HOURS 可配），演示前可先跑预热接口把缓存捂热。
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from typing import Any

from ..config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv_cache (
    key        TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_created ON kv_cache(created_at);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def make_key(namespace: str, payload: Any) -> str:
    """把任意可 JSON 化的入参压成稳定 key。"""
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]
    return f"{namespace}:{digest}"


def get(key: str, *, max_age_seconds: float | None = None) -> Any | None:
    """取缓存；过期或损坏都当作未命中（不抛异常，保证主流程不被打断）。"""
    ttl_seconds = settings.amap_cache_ttl_hours * 3600
    if max_age_seconds is not None:
        ttl_seconds = min(ttl_seconds, max_age_seconds) if ttl_seconds > 0 else max_age_seconds
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT payload, created_at FROM kv_cache WHERE key = ?", (key,)
            ).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    payload, created_at = row
    if ttl_seconds > 0 and time.time() - created_at > ttl_seconds:
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def set(key: str, value: Any) -> None:  # noqa: A001 - 与 get 对称的命名
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO kv_cache(key, payload, created_at) VALUES (?, ?, ?)",
                (key, json.dumps(value, ensure_ascii=False), time.time()),
            )
    except sqlite3.Error:
        # 缓存写失败绝不能影响主流程
        pass


def stats() -> dict:
    """给 /api/health 与预热接口用。"""
    try:
        with _connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM kv_cache").fetchone()[0]
            rows = conn.execute(
                "SELECT key, created_at FROM kv_cache ORDER BY created_at DESC LIMIT 5"
            ).fetchall()
    except sqlite3.Error:
        return {"entries": 0, "recent": []}
    return {
        "entries": total,
        "recent": [{"key": k.split(":")[0], "ageMin": round((time.time() - t) / 60, 1)} for k, t in rows],
    }


def clear() -> int:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM kv_cache")
        return cur.rowcount
