"""模块 4 端到端测试：自然语言解析 / 一句话重规划 / 路线解释。

关键点：**默认在"没有 LLM Key"的情况下测试** —— 走的是内置规则解析路径，
也就是演示现场最坏情况（没 Key / 没网）下的真实表现。
如果你配了 DEEPSEEK_API_KEY，同一个脚本会自动走大模型 Function Calling 路径，
并打印 source=llm 以及模型的 token 用量。

用法（在 backend/ 目录下）：
    .venv\\Scripts\\python.exe scripts\\test_module4.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "shanghai_pois.json"
HOTEL = {"name": "人民广场 · 默认起点", "lng": 121.4737, "lat": 31.2304}

DEMO_NAMES = ["外滩", "豫园·城隍庙", "南京路步行街", "新天地", "田子坊", "上海博物馆"]


def load_destinations(names: list[str]) -> list[dict]:
    pois = {p["name"]: p for p in json.loads(DATA.read_text(encoding="utf-8"))}
    out = []
    for i, name in enumerate(names):
        poi = pois[name]
        out.append(
            {
                "id": f"ai-{i}",
                "name": poi["name"],
                "lng": poi["lng"],
                "lat": poi["lat"],
                "selected": True,
                "source": "import",
                "stayMin": poi["stayMin"],
                "openTime": poi["openTime"],
                "closeTime": poi["closeTime"],
                "tags": poi["tags"],
            }
        )
    return out


def build_plan_request(days: int = 1, mode: str = "transit") -> dict:
    return {
        "hotel": HOTEL,
        "destinations": load_destinations(DEMO_NAMES),
        "days": days,
        "mode": mode,
        "weights": {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5},
        "options": {"dayStartTime": "09:00", "dayEndTime": "21:00", "lunchBreakMin": 60},
    }


def test_parse(client: TestClient, text: str, expect_names: list[str]) -> bool:
    resp = client.post("/api/ai/parse", json={"text": text})
    if resp.status_code != 200:
        print(f"  [FAIL] 「{text}」-> HTTP {resp.status_code}: {resp.text[:200]}")
        return False
    data = resp.json()
    names = [p["name"] for p in data["places"]]
    print(f"  「{text}」")
    print(f"    source={data['source']} 命中={names} 未识别={data['unresolved']}")
    print(f"    摘要：{data['summary']}")
    for note in data["notes"]:
        print(f"    · {note}")
    for warning in data["warnings"]:
        print(f"    ⚠ {warning}")
    ok = all(any(expect in name for name in names) for expect in expect_names)
    if not ok:
        print(f"    [FAIL] 期望包含 {expect_names}")
    return ok


def test_replan(client: TestClient, text: str, expect_applied: list[str]) -> bool:
    payload = build_plan_request() | {"text": text}
    resp = client.post("/api/ai/replan", json=payload)
    if resp.status_code != 200:
        print(f"  [FAIL] 「{text}」-> HTTP {resp.status_code}: {resp.text[:300]}")
        return False
    data = resp.json()
    applied = data["applied"]
    print(f"  「{text}」")
    print(f"    source={data['source']} 约束={json.dumps(data['constraints'], ensure_ascii=False)}")
    print(f"    生效变更：{applied or '（无）'}")
    if data["removed"]:
        print(f"    移除地点：{data['removed']}")
    for warning in data["warnings"]:
        print(f"    ⚠ {warning}")
    plan = data["plan"]
    day = plan["days"][0]
    print(
        f"    重算结果：{len(day['stops'])} 站，"
        f"{day['stops'][0]['arriveTime'] if day['stops'] else '—'}–{day['returnTime']}，"
        f"步行 {day['stats']['totalWalkKm']} km、花费 {day['stats']['totalCost']} 元"
    )
    ok = all(any(expect in item for item in applied) for expect in expect_applied)
    if not ok:
        print(f"    [FAIL] 期望 applied 里包含 {expect_applied}")
    return ok


def main() -> int:
    client = TestClient(app)
    print("=" * 84)
    print("模块 4 端到端测试：AI 自然语言能力（默认验证无 Key 的规则降级路径）")
    print("=" * 84)

    health = client.get("/api/ai/health").json()
    print(f"[ai/health] {json.dumps(health, ensure_ascii=False)}")
    if health.get("configured"):
        print("已配置 LLM Key：下面的解析会走大模型 Function Calling（source=llm）")
    else:
        print("未配置 LLM Key：下面的解析走内置规则（source=rules），这正是现场兜底路径")

    ok = True
    print("\n【1. 自然语言 -> 目的地】")
    ok &= test_parse(client, "我想去外滩、豫园、武康路", ["外滩", "豫园", "武康路"])
    ok &= test_parse(client, "带爸妈玩两天，想去朱家角、七宝老街，别安排太累", ["朱家角", "七宝老街"])
    ok &= test_parse(client, "想去看看公园和博物馆，少走路", [])
    ok &= test_parse(client, "今天天气不错", [])

    print("\n【2. 一句话重规划】")
    ok &= test_replan(client, "少走路，多拍照，6 点前回酒店", ["walking", "18:00"])
    ok &= test_replan(client, "改成 3 天，用地铁，省点钱", ["3", "地铁", "cost"])
    ok &= test_replan(client, "我不想去田子坊了", ["移除"])

    print("\n【3. 路线解释】")
    plan = client.post("/api/plan", json=build_plan_request()).json()
    resp = client.post("/api/ai/explain", json={"plan": plan})
    if resp.status_code != 200:
        print(f"  [FAIL] HTTP {resp.status_code}: {resp.text[:200]}")
        ok = False
    else:
        data = resp.json()
        print(f"  source={data['source']}")
        print(f"  {data['text'][:300]}")
        if not data["text"]:
            print("  [FAIL] 解释为空")
            ok = False

    print("\n【4. 解析 + 规划全链路（模拟前端「一句话生成路书」）】")
    parsed = client.post("/api/ai/parse", json={"text": "想去外滩、豫园、新天地，用公交"}).json()
    destinations = [
        {
            "id": f"p-{i}",
            "name": place["name"],
            "lng": place["lng"],
            "lat": place["lat"],
            "selected": True,
            "source": "ai",
            "stayMin": place["stayMin"],
            "openTime": place["openTime"],
            "closeTime": place["closeTime"],
            "tags": place["tags"],
        }
        for i, place in enumerate(parsed["places"])
    ]
    print(f"  解析出 {len(destinations)} 个点：{[d['name'] for d in destinations]}")
    if destinations:
        full = client.post(
            "/api/plan",
            json={
                "hotel": HOTEL,
                "destinations": destinations,
                "days": 1,
                "mode": "transit",
                "weights": {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5},
                "options": {"dayStartTime": "09:00", "dayEndTime": "21:00", "lunchBreakMin": 60},
            },
        )
        if full.status_code != 200:
            print(f"  [FAIL] 规划失败 HTTP {full.status_code}")
            ok = False
        else:
            day = full.json()["days"][0]
            print(f"  规划成功：{' → '.join(s['name'] for s in day['stops'])}")
    else:
        print("  [FAIL] 没有解析出任何地点")
        ok = False

    print("\n" + "=" * 84)
    print("[module4]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
