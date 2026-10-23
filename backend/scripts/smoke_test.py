"""后端冒烟测试：不启动服务器，直接用 TestClient 打一遍模块 1 的接口。

用法（在 backend/ 目录下）：
    .venv\\Scripts\\python.exe scripts\\smoke_test.py

也会顺带校验 POI 演示数据的坐标是否落在上海范围内（防止坐标系统混用）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# 让脚本能直接 import app（不需要先 pip install -e .）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main() -> int:
    client = TestClient(app)
    ok = True

    r = client.get("/")
    print("GET /                       ->", r.status_code, r.json().get("name"))
    ok &= r.status_code == 200

    r = client.get("/api/health")
    print("GET /api/health             ->", r.status_code, json.dumps(r.json(), ensure_ascii=False))
    ok &= r.status_code == 200 and r.json().get("status") == "ok"

    r = client.get("/api/poi/presets")
    presets = r.json()
    print("GET /api/poi/presets        ->", r.status_code, f"{len(presets)} 个 POI")
    ok &= r.status_code == 200 and len(presets) >= 30

    r = client.get("/api/poi/search", params={"q": "外滩"})
    names = [p["name"] for p in r.json()]
    print("GET /api/poi/search?q=外滩  ->", r.status_code, names)
    ok &= r.status_code == 200 and any("外滩" in n for n in names)

    r = client.get("/api/poi/search", params={"q": "咖啡"})
    print("GET /api/poi/search?q=咖啡  ->", r.status_code, [p["name"] for p in r.json()])

    # 上海 + GCJ-02 的粗略包围盒，越界说明坐标系统可能被混用
    out_of_range = [
        p["name"] for p in presets if not (120.8 < p["lng"] < 122.2 and 30.6 < p["lat"] < 31.9)
    ]
    print("坐标越界的 POI              ->", out_of_range or "无")
    ok &= not out_of_range

    print("\n[smoke]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
