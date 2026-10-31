"""LLM 客户端：DeepSeek / 通义千问 / 智谱 三家的统一封装。

三家都提供 **OpenAI 兼容**的 /chat/completions 接口，所以这里只写一套实现，
靠 config 里的 provider 切换 base_url 与 model。

设计要点：
  · 所有调用都有超时与异常包装，抛 LlmError；上层的 ai_service 捕获后**自动降级到规则解析**，
    所以现场没网 / 没 Key / 模型抽风，演示都不会崩。
  · 返回 (参数, 调试信息) 二元组，调试信息会带在接口响应里，方便答辩时展示「模型到底返回了什么」。
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

import httpx

from ..config import settings
from . import keyring


class LlmError(RuntimeError):
    """LLM 调用失败（超时、HTTP 错误、返回结构不符合预期、未配置 Key）。"""


@dataclass
class LlmConfig:
    provider: str
    base_url: str
    api_key: str
    model: str


@dataclass
class LlmResult:
    ok: bool
    arguments: dict = field(default_factory=dict)
    text: str = ""
    debug: dict = field(default_factory=dict)
    error: str | None = None


def current_config() -> LlmConfig | None:
    """优先用「本次请求携带的 Key」（前端个人页填的），没有就回落到 .env。"""
    override_key = keyring.llm_key.get()
    if override_key:
        provider = (keyring.llm_provider.get() or settings.llm_provider or "deepseek").lower()
        if provider in {"qwen", "dashscope", "tongyi"}:
            base = keyring.llm_base_url.get() or settings.dashscope_base_url
            model = keyring.llm_model.get() or settings.dashscope_model
            provider = "qwen"
        elif provider in {"zhipu", "glm"}:
            base = keyring.llm_base_url.get() or settings.zhipu_base_url
            model = keyring.llm_model.get() or settings.zhipu_model
            provider = "zhipu"
        else:
            base = keyring.llm_base_url.get() or settings.deepseek_base_url
            model = keyring.llm_model.get() or settings.deepseek_model
            provider = "deepseek"
        return LlmConfig(provider, base.rstrip("/"), override_key, model)

    provider = (settings.llm_provider or "deepseek").lower()
    if provider == "deepseek" and settings.deepseek_api_key:
        return LlmConfig("deepseek", settings.deepseek_base_url.rstrip("/"),
                         settings.deepseek_api_key, settings.deepseek_model)
    if provider in {"qwen", "dashscope", "tongyi"} and settings.dashscope_api_key:
        return LlmConfig("qwen", settings.dashscope_base_url.rstrip("/"),
                         settings.dashscope_api_key, settings.dashscope_model)
    if provider in {"zhipu", "glm"} and settings.zhipu_api_key:
        return LlmConfig("zhipu", settings.zhipu_base_url.rstrip("/"),
                         settings.zhipu_api_key, settings.zhipu_model)
    return None


def is_configured() -> bool:
    return current_config() is not None


def _extract_json(raw: str) -> dict:
    """从模型输出里抠出 JSON（有的模型会把 JSON 包在 ```json 里或前后加解释）。"""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    raise LlmError("模型没有返回可解析的 JSON")


async def _chat(payload: dict, timeout: float) -> tuple[dict, int]:
    cfg = current_config()
    if cfg is None:
        raise LlmError("未配置 LLM API Key")
    headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}
    started = time.perf_counter()
    try:
        client = httpx.AsyncClient(timeout=timeout)
    except Exception as exc:  # 代理配置异常（如 NO_PROXY 里有 [::1]）：降级而不是 500
        raise LlmError(f"HTTP 客户端初始化失败：{type(exc).__name__}: {exc}") from exc
    async with client:
        resp = await client.post(f"{cfg.base_url}/chat/completions", json=payload, headers=headers)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    if resp.status_code >= 400:
        raise LlmError(f"{cfg.provider} 返回 HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json(), elapsed_ms


async def call_tool(
    tool: dict,
    system_prompt: str,
    user_prompt: str,
    *,
    timeout: float = 25.0,
    temperature: float = 0.2,
) -> LlmResult:
    """调用某个工具（Function Calling），返回工具参数。

    兼容两种返回形态：
      1) 标准 tool_calls（DeepSeek / 通义 / 智谱 都支持）
      2) 模型把 JSON 直接写在 content 里（某些模型的兜底行为）
    """
    cfg = current_config()
    if cfg is None:
        return LlmResult(ok=False, error="未配置 LLM API Key")

    payload = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "tools": [{"type": "function", "function": tool}],
        "tool_choice": {"type": "function", "function": {"name": tool["name"]}},
        "temperature": temperature,
        "stream": False,
    }
    try:
        data, elapsed_ms = await _chat(payload, timeout)
    except (httpx.HTTPError, LlmError, ValueError) as exc:
        return LlmResult(ok=False, error=f"{type(exc).__name__}: {exc}")

    try:
        message = data["choices"][0]["message"]
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            arguments = json.loads(tool_calls[0]["function"]["arguments"])
        else:
            arguments = _extract_json(message.get("content") or "")
    except (KeyError, IndexError, TypeError, json.JSONDecodeError, LlmError) as exc:
        return LlmResult(
            ok=False,
            error=f"模型返回结构异常：{exc}",
            debug={"elapsedMs": elapsed_ms, "raw": json.dumps(data, ensure_ascii=False)[:600]},
        )

    return LlmResult(
        ok=True,
        arguments=arguments,
        debug={
            "provider": cfg.provider,
            "model": cfg.model,
            "elapsedMs": elapsed_ms,
            "tool": tool["name"],
            "usage": data.get("usage"),
        },
    )


async def call_text(
    system_prompt: str,
    user_prompt: str,
    *,
    timeout: float = 30.0,
    temperature: float = 0.5,
    max_tokens: int = 600,
) -> LlmResult:
    """普通文本生成（路线解释用）。"""
    cfg = current_config()
    if cfg is None:
        return LlmResult(ok=False, error="未配置 LLM API Key")

    payload = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    try:
        data, elapsed_ms = await _chat(payload, timeout)
        choice = data["choices"][0]
        message = choice["message"]
        text = (message.get("content") or "").strip()
    except (httpx.HTTPError, LlmError, ValueError, KeyError, IndexError, TypeError) as exc:
        return LlmResult(ok=False, error=f"{type(exc).__name__}: {exc}")

    debug = {
        "provider": cfg.provider,
        "model": cfg.model,
        "elapsedMs": elapsed_ms,
        "usage": data.get("usage"),
        "finishReason": choice.get("finish_reason"),
        "hasReasoning": bool(message.get("reasoning_content")),
    }
    if not text:
        error = ("模型输出额度已耗尽，尚未生成最终回答"
                 if choice.get("finish_reason") == "length" else "模型返回了空内容")
        return LlmResult(ok=False, error=error, debug=debug)
    return LlmResult(
        ok=True,
        text=text,
        debug=debug,
    )


async def probe() -> dict:
    """轻量自检：给 /api/ai/health 用，确认 Key 与网络是否真的可用。"""
    cfg = current_config()
    if cfg is None:
        return {"configured": False, "provider": settings.llm_provider, "ok": False}
    # Thinking tokens may share the completion budget. Ten tokens can be exhausted
    # before any final content is emitted, so do not use a two-word answer's size
    # as the entire generation budget. Reasoning-only output is still a failure.
    result = await call_text("你是一个测试助手。", "只回复两个字：可用", timeout=15, max_tokens=1024)
    return {
        "configured": True,
        "provider": cfg.provider,
        "model": cfg.model,
        "ok": result.ok,
        "reply": result.text,
        "error": result.error,
        "debug": result.debug,
    }



async def chat_tools(
    messages: list[dict],
    tools: list[dict],
    *,
    force: str | None = None,
    timeout: float = 30.0,
    temperature: float = 0.2,
) -> dict:
    """通用 function calling：可以一次暴露多个工具，由模型自己挑。

    返回 {"content": str, "tool_calls": [{"name", "arguments"}], "elapsedMs": int}
    """
    cfg = current_config()
    if cfg is None:
        raise LlmError("未配置 LLM API Key")
    payload: dict = {
        "model": cfg.model,
        "messages": messages,
        "tools": [{"type": "function", "function": tool} for tool in tools],
        "tool_choice": (
            {"type": "function", "function": {"name": force}} if force else "auto"
        ),
        "temperature": temperature,
        "stream": False,
    }
    data, elapsed_ms = await _chat(payload, timeout)
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmError(f"模型返回结构异常：{exc}") from exc

    calls: list[dict] = []
    for call in message.get("tool_calls") or []:
        fn = call.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append({"name": fn.get("name", ""), "arguments": args})
    return {"content": message.get("content") or "", "tool_calls": calls, "elapsedMs": elapsed_ms}
