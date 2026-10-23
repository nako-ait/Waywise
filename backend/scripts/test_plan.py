"""模块 2 端到端测试：直接打 /api/plan，把五种交通方式的时间轴与统计全部打印出来。

用法（在 backend/ 目录下，需要先装好依赖）：
    .venv\\Scripts\\python.exe scripts\\test_plan.py

它同时是一份「演示脚本」：答辩现场可以照着这个输出讲。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "shanghai_pois.json"

# 起始酒店：人民广场（与前端默认值一致）
HOTEL = {"name": "人民广场 · 默认起点", "lng": 121.4737, "lat": 31.2304, "address": "上海市黄浦区人民大道"}

# 演示线路：经典上海一日游（含营业时间约束的两个点）
DEMO_NAMES = ["外滩", "豫园·城隍庙", "南京路步行街", "上海博物馆", "新天地", "田子坊"]

MODE_LABEL = {"walk": "步行", "transit": "公交", "subway": "地铁", "taxi": "打车", "drive": "驾车"}


# 演示线路 B：远郊混合（点之间差异大，权重的影响看得更清楚）
SPREAD_NAMES = ["朱家角古镇", "上海动物园", "陆家嘴滨江大道", "外滩", "五角场", "七宝老街"]


def load_destinations(names: list[str] | None = None) -> list[dict]:
    pois = {p["name"]: p for p in json.loads(DATA.read_text(encoding="utf-8"))}
    out = []
    for i, name in enumerate(names or DEMO_NAMES):
        poi = pois[name]
        out.append(
            {
                "id": f"demo-{i}",
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


def build_request(
    mode: str,
    weights: dict | None = None,
    days: int = 1,
    names: list[str] | None = None,
) -> dict:
    return {
        "hotel": HOTEL,
        "destinations": load_destinations(names),
        "days": days,
        "mode": mode,
        "weights": weights or {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5},
        "options": {
            "dayStartTime": "09:00",
            "dayEndTime": "21:00",
            "lunchBreakMin": 60,
        },
    }


def print_plan(client: TestClient, title: str, payload: dict) -> bool:
    resp = client.post("/api/plan", json=payload)
    if resp.status_code != 200:
        print(f"[FAIL] {title} -> HTTP {resp.status_code}: {resp.text[:300]}")
        return False
    plan = resp.json()
    meta = plan.get("solver") or {}
    day = plan["days"][0]
    stops = day["stops"]

    print(f"\n--- {title} ---")
    print(f"  求解器 {meta.get('name')} | 数据源 {meta.get('dataSource')} | "
          f"目标值 {meta.get('objectiveMinutes')} | 耗时 {meta.get('elapsedMs')}ms | "
          f"折线近似段 {meta.get('legsApprox')}")
    for warning in meta.get("warnings") or []:
        print(f"  ⚠ {warning}")

    prev_leave = payload["options"]["dayStartTime"]
    print(f"  {day['date']}  从酒店 {prev_leave} 出发")
    print(f"  {'':>2} {'到达-离开':<13} {'站点':<16} {'上一段交通'}")
    for index, stop in enumerate(stops, start=1):
        leg = stop.get("transportFromPrev") or {}
        leg_txt = (
            f"{leg.get('mode')} {leg.get('durationMin')}分 / {leg.get('distanceKm')}km"
            f" / {leg.get('cost')}元" + ("（估算）" if leg.get("approx") else "")
        )
        print(
            f"  {index:>2} {stop['arriveTime']}-{stop['leaveTime']}  {stop['name']:<16} {leg_txt}"
        )
    stats = day["stats"]
    overnight = f"（超时 {day['overtimeMin']} 分钟）" if day.get("overtimeMin") else ""
    print(f"  返回酒店：{day.get('returnTime') or '—'}{overnight}（最后一段也已计入统计）")
    print(f"  统计：步行 {stats['totalWalkKm']} km | 交通 {stats['totalTransitMin']} 分钟 | "
          f"花费 {stats['totalCost']} 元 | 站点 {len(stops)} 个")
    print(f"  解释：{plan['explanation']}")

    # 一致性自检
    ok = True
    if not stops:
        print("  [FAIL] 没有任何站点")
        ok = False
    for index in range(1, len(stops)):
        if stops[index]["arriveTime"] < stops[index - 1]["leaveTime"]:
            print(f"  [FAIL] 时间轴倒退：{stops[index]['name']}")
            ok = False
    if len(plan.get("polylines") or []) != len(stops) + 1:
        print(f"  [FAIL] 折线段数 {len(plan.get('polylines') or [])} != 站点数+1 {len(stops) + 1}")
        ok = False
    if meta.get("dropped"):
        print(f"  · 未排入：{[d['name'] for d in meta['dropped']]}")
    return ok


def main() -> int:
    client = TestClient(app)
    print("=" * 78)
    print("模块 2 端到端测试：单日路线规划（距离矩阵 + OR-Tools TSP + 时间轴）")
    print("=" * 78)

    health = client.get("/api/health").json()
    print(f"[health] {json.dumps(health, ensure_ascii=False)}")
    if not health["amapConfigured"]:
        print("提示：未配置 AMAP_WEB_KEY，本次全部使用离线估算（前端会显示「离线估算」徽标）")

    ok = True
    for mode in ("transit", "subway", "walk", "taxi", "drive"):
        ok &= print_plan(client, f"交通方式 = {MODE_LABEL[mode]}（{mode}）", build_request(mode))

    # 权重敏感性：极端偏好应当改变访问顺序 / 目标值
    weight_sets = {
        "默认": {"time": 0.6, "convenience": 0.5, "cost": 0.4, "walking": 0.5},
        "极度厌恶步行": {"time": 0.2, "convenience": 0.2, "cost": 0.2, "walking": 1.0},
        "极度在意换乘": {"time": 0.2, "convenience": 1.0, "cost": 0.2, "walking": 0.2},
        "极度在意花费": {"time": 0.2, "convenience": 0.2, "cost": 1.0, "walking": 0.2},
    }
    print("\n【权重敏感性】同一组点、同一交通方式，只改权重滑杆：")
    for label, weights in weight_sets.items():
        resp = client.post("/api/plan", json=build_request("transit", weights, names=SPREAD_NAMES))
        if resp.status_code != 200:
            print(f"  [FAIL] {label} -> HTTP {resp.status_code}")
            ok = False
            continue
        body = resp.json()
        meta = body["solver"]
        day = body["days"][0]
        order = " → ".join(s["name"] for s in day["stops"])
        print(
            f"  {label:<8} 目标值 {meta['objectiveMinutes']:>7} | "
            f"步行 {day['stats']['totalWalkKm']:>5} km | 花费 {day['stats']['totalCost']:>6} 元 | {order}"
        )

    # 多日请求：模块 3 已支持真正的分天（这里顺带验证单日脚本不会被 days>1 弄崩）
    ok &= print_plan(client, "多日请求（days=3，已由模块 3 实现分天）", build_request("transit", days=3))

    # 预热缓存
    pre = client.post("/api/plan/prewarm", json=build_request("transit"))
    print(f"\n[prewarm] {json.dumps(pre.json(), ensure_ascii=False)}")

    print("\n" + "=" * 78)
    print("[module2]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
