"""模块 3 端到端测试：多日聚类分天 + 权重滑杆 + 等时圈。

用法（在 backend/ 目录下）：
    .venv\\Scripts\\python.exe scripts\\test_module3.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "shanghai_pois.json"
HOTEL = {
    "name": "人民广场 · 默认起点",
    "lng": 121.4737,
    "lat": 31.2304,
    "address": "上海市黄浦区人民大道",
}

# 12 个点横跨浦西/浦东，分天效果明显
MULTI_NAMES = [
    "外滩",
    "豫园·城隍庙",
    "南京路步行街",
    "新天地",
    "田子坊",
    "武康路·武康大楼",
    "静安寺",
    "张园",
    "陆家嘴滨江大道",
    "上海科技馆",
    "世纪公园",
    "1933 老场坊",
]


def load_destinations(names: list[str]) -> list[dict]:
    pois = {p["name"]: p for p in json.loads(DATA.read_text(encoding="utf-8"))}
    out = []
    for i, name in enumerate(names):
        poi = pois[name]
        out.append(
            {
                "id": f"m-{i}",
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


def build_request(days: int, weights: dict | None = None, mode: str = "transit") -> dict:
    return {
        "hotel": HOTEL,
        "destinations": load_destinations(MULTI_NAMES),
        "days": days,
        "mode": mode,
        "weights": weights or {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5},
        "options": {"dayStartTime": "09:00", "dayEndTime": "21:00", "lunchBreakMin": 60},
    }


def print_multi_day(client: TestClient, days: int, weights: dict | None = None, label: str = "") -> bool:
    resp = client.post("/api/plan", json=build_request(days, weights))
    if resp.status_code != 200:
        print(f"[FAIL] {label} -> HTTP {resp.status_code}: {resp.text[:300]}")
        return False
    plan = resp.json()
    meta = plan["solver"]
    ok = True

    print(f"\n--- {label or f'{days} 天路书'} ---")
    print(
        f"  分天方式 {meta.get('splitMethod')} | 请求 {meta.get('requestedDays')} 天 / "
        f"实际 {meta.get('dayCount')} 天 | 目标值 {meta.get('objectiveMinutes')} | "
        f"耗时 {meta.get('elapsedMs')}ms"
    )
    for warning in meta.get("warnings") or []:
        print(f"  ⚠ {warning}")

    total_stops = 0
    for day in plan["days"]:
        stops = day["stops"]
        total_stops += len(stops)
        polylines = day.get("polylines") or []
        print(
            f"\n  【{day.get('title')}】{day['date']}  "
            f"{stops[0]['arriveTime'] if stops else '—'}–{day.get('returnTime') or '—'}  "
            f"步行 {day['stats']['totalWalkKm']} km / 交通 {day['stats']['totalTransitMin']} 分 / "
            f"花费 {day['stats']['totalCost']} 元"
        )
        for index, stop in enumerate(stops, start=1):
            leg = stop.get("transportFromPrev") or {}
            print(
                f"    {index}. {stop['arriveTime']}-{stop['leaveTime']} {stop['name']:<16} "
                f"{leg.get('mode')} {leg.get('durationMin')}分/{leg.get('distanceKm')}km"
            )
        if len(polylines) != len(stops) + 1:
            print(f"    [FAIL] 折线段数 {len(polylines)} != 站点数+1 {len(stops) + 1}")
            ok = False

    if total_stops != len(MULTI_NAMES):
        dropped = [d["name"] for d in (meta.get("dropped") or [])]
        print(f"\n  · 排入 {total_stops}/{len(MULTI_NAMES)} 个点，未排入：{dropped}")
    print(f"\n  解释：{plan['explanation']}")
    return ok


def main() -> int:
    client = TestClient(app)
    print("=" * 84)
    print("模块 3 端到端测试：多日聚类分天 + 权重滑杆 + 等时圈")
    print("=" * 84)

    ok = True
    ok &= print_multi_day(client, 1, label="单日（对照：不应分天）")
    ok &= print_multi_day(client, 2, label="2 天（浦西 / 浦东）")
    ok &= print_multi_day(client, 3, label="3 天")

    # 权重变化会影响分天与顺序
    print("\n【权重对分天的影响】3 天、只改权重滑杆：")
    for label, weights in (
        ("默认", {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5}),
        ("极度厌恶步行", {"time": 0.2, "convenience": 0.2, "cost": 0.2, "walking": 1.0}),
        ("极度在意花费", {"time": 0.2, "convenience": 0.2, "cost": 1.0, "walking": 0.2}),
    ):
        body = client.post("/api/plan", json=build_request(3, weights)).json()
        groups = [
            f"{day.get('title')}:{'/'.join(s['name'] for s in day['stops'])}"
            for day in body["days"]
        ]
        print(f"  {label:<8} 目标值 {body['solver']['objectiveMinutes']:>7} | " + "  |  ".join(groups))

    # 等时圈 / 酒店交通便利度
    print("\n【等时圈】酒店 = 人民广场，步行 15/30/45 分钟：")
    resp = client.post(
        "/api/isochrone",
        json={"hotel": HOTEL, "minutes": [15, 30, 45], "mode": "walk"},
    )
    if resp.status_code != 200:
        print(f"  [FAIL] HTTP {resp.status_code}: {resp.text[:300]}")
        ok = False
    else:
        data = resp.json()
        print(f"  方式 {data['modeLabel']} | 数据来源 {data['dataSource']} | POI 总数 {data['poiTotal']}")
        for warning in data.get("warnings") or []:
            print(f"  ⚠ {warning}")
        for band in data["bands"]:
            polygon = band["polygon"]
            print(
                f"  {band['minutes']:>3} 分钟：可达 {band['poiCount']:>2} 个热门 POI | "
                f"多边形 {len(polygon)} 点 | 来源 {band['source']}"
            )
            if len(polygon) < 4 or polygon[0] != polygon[-1]:
                print("    [FAIL] 多边形不闭合或点数不足")
                ok = False
            names = "、".join(p["name"] for p in band["pois"][:6])
            print(f"        例如：{names}")

    # 驾车等时圈（对比不同交通方式下酒店便利度的差异）
    resp = client.post("/api/isochrone", json={"hotel": HOTEL, "minutes": [15, 30], "mode": "taxi"})
    if resp.status_code == 200:
        data = resp.json()
        summary = " / ".join(f"{b['minutes']}分钟 {b['poiCount']} 个" for b in data["bands"])
        print(f"\n  对照（打车）：{summary} | 来源 {data['dataSource']}")

    print("\n" + "=" * 84)
    print("[module3]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
