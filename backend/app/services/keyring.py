"""请求级密钥：让前端填的 Key 真正生效。

背景：个人页让用户填"我的高德 Key / 大模型 Key"，但这些 Key 只存在浏览器里，
后端读的是 .env —— 两边不通，于是 AI 永远走规则降级。
这里用 contextvars 把「本次请求携带的 Key」传给 amap_client / llm，
没有传就回落到 .env，行为完全兼容旧配置。
"""
from __future__ import annotations

from contextvars import ContextVar

llm_key: ContextVar[str] = ContextVar("llm_key", default="")
llm_provider: ContextVar[str] = ContextVar("llm_provider", default="")
llm_model: ContextVar[str] = ContextVar("llm_model", default="")
llm_base_url: ContextVar[str] = ContextVar("llm_base_url", default="")
amap_key: ContextVar[str] = ContextVar("amap_key", default="")


def reset_all() -> None:
    llm_key.set("")
    llm_provider.set("")
    llm_model.set("")
    llm_base_url.set("")
    amap_key.set("")
