"""全局配置：从 .env 读取，全项目统一用 settings.xxx 访问。

注意：高德「Web 服务」Key 与前端「Web端(JS API)」Key 是两把不同的钥匙，
不要混用 —— JS Key 暴露在浏览器里，Web 服务 Key 必须留在后端。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- 高德 ----
    amap_web_key: str = ""

    # ---- LLM ----
    llm_provider: str = "deepseek"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model: str = "deepseek-chat"
    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    dashscope_model: str = "qwen-plus"
    zhipu_api_key: str = ""
    zhipu_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    zhipu_model: str = "glm-4-flash"

    # ---- 服务 ----
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    # ---- 存储 ----
    data_dir: str = "./data"
    amap_cache_ttl_hours: int = 168

    # ---- 求解器 ----
    # OR-Tools 邻域搜索的时限：6~12 个点基本秒收敛，1.2s 足够且演示更跟手
    solver_time_limit_s: float = 1.2
    # 午餐落点探测（第一遍求解）用的更短时限
    solver_probe_time_limit_s: float = 0.4

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = BASE_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def db_path(self) -> Path:
        return self.data_path / "tripcompiler.db"

    @property
    def poi_file(self) -> Path:
        return self.data_path / "shanghai_pois.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
