"""FastAPI 应用入口。

启动：
    cd backend
    python -m venv .venv && .venv\\Scripts\\activate
    pip install -r requirements.txt
    cp .env.example .env   # 填 AMAP_WEB_KEY 等
    uvicorn app.main:app --reload --port 8000
或直接：
    python run.py

文档：http://127.0.0.1:8000/docs
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import settings
from .routers import ai, health, isochrone, plan, poi, share
from .services import keyring

app = FastAPI(
    title="路书编译师 TripCompiler API",
    version=__version__,
    description="以酒店为固定起点的多日出行路线编译服务（上海）",
)

# 前端 Vite 开发服务器跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_keys(request: Request, call_next):
    """把前端个人页填的 Key 通过请求头带进来（x-llm-key / x-amap-key ...）。

    没有这些头就完全走 .env，跟旧版行为一致。
    """
    keyring.llm_key.set(request.headers.get("x-llm-key", "").strip())
    keyring.llm_provider.set(request.headers.get("x-llm-provider", "").strip())
    keyring.llm_model.set(request.headers.get("x-llm-model", "").strip())
    keyring.llm_base_url.set(request.headers.get("x-llm-base-url", "").strip())
    keyring.amap_key.set(request.headers.get("x-amap-key", "").strip())
    try:
        return await call_next(request)
    finally:
        keyring.reset_all()

# 模块 1：健康检查 + POI 数据
app.include_router(health.router, prefix="/api")
app.include_router(poi.router, prefix="/api")
# 模块 2：单日路线规划（距离矩阵 + OR-Tools TSP + 时间轴）
app.include_router(plan.router, prefix="/api")
# 模块 3：等时圈 / 酒店交通便利度（多日分天已在 /api/plan 内生效）
app.include_router(isochrone.router, prefix="/api")
# 模块 4：AI 能力（自然语言解析 / 一句话重规划 / 路线解释）
app.include_router(ai.router, prefix="/api")
# 模块 6：行程口令分享（内存口令，6 位大写字母 + 数字）
app.include_router(share.router, prefix="/api")


@app.get("/")
def root() -> dict:
    return {
        "name": "TripCompiler API",
        "version": __version__,
        "docs": "/docs",
        "modules": {
            "1": "地图基础 + POI 数据（已完成）",
            "2": "单日路线规划：距离矩阵 + OR-Tools TSP + 时间轴（已完成）",
            "3": "多日聚类分天 + 权重滑杆 + 等时圈（已完成）",
            "4": "AI 能力：自然语言解析 / 一句话重规划 / 路线解释（已完成，无 Key 自动降级）",
            "6": "行程口令分享：POST /api/share 生成 6 位口令，GET /api/share/{code} 取回",
        },
    }
