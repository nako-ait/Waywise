"""健康检查与配置自检：前端启动时调用，用来判断后端/Key/求解器是否就绪。"""
from __future__ import annotations

from fastapi import APIRouter

from .. import __version__
from ..config import settings
from ..services import cache
from ..services.poi_store import load_pois

router = APIRouter(tags=["system"])


def solver_available() -> bool:
    """OR-Tools 是否可用（不可用时 planner 会自动降级到纯 Python 求解器）。

    不同版本的 OR-Tools 路由模块名不同，这里两个都试一下。
    """
    for module in ("pywrapcp", "pywraprouting"):
        try:
            __import__(f"ortools.constraint_solver.{module}")
            return True
        except Exception:  # noqa: BLE001 - 缺 wheel / DLL 加载失败都算不可用
            continue
    return False


@router.get("/health")
def health() -> dict:
    """返回服务状态 + 关键配置是否就绪（不泄露 Key 明文）。"""
    return {
        "status": "ok",
        "version": __version__,
        # 高德 Web 服务 Key：决定距离矩阵是实时还是离线估算
        "amapConfigured": bool(settings.amap_web_key.strip()),
        "distanceSource": "amap" if settings.amap_web_key.strip() else "offline-estimate",
        "solver": "ortools" if solver_available() else "python-greedy-2opt",
        "llmProvider": settings.llm_provider,
        "llmConfigured": _llm_configured(),
        "poiCount": len(load_pois()),
        "cacheEntries": cache.stats()["entries"],
    }


def _llm_configured() -> bool:
    provider = settings.llm_provider.lower()
    if provider == "deepseek":
        return bool(settings.deepseek_api_key)
    if provider in {"qwen", "dashscope", "tongyi"}:
        return bool(settings.dashscope_api_key)
    if provider in {"zhipu", "glm"}:
        return bool(settings.zhipu_api_key)
    return False
