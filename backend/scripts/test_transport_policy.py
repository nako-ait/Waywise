r"""交通决策回归：离线注入路线结果，不调用高德或模型、不修改用户数据。

在 backend 下运行 .venv\Scripts\python.exe scripts\test_transport_policy.py。
"""
from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models import PlanRequest
from app.services import planner, transport_policy as policy
from app.services.amap_client import LegRoute, Matrix, select_transit_option
from app.services.tsp_core import SolveResult


def matrix_for(count: int, mode: str = "walk") -> Matrix:
    points = [(121.49 + index * 0.001, 31.23) for index in range(count)]
    return Matrix(
        points=points, mode=mode,
        durations=[[0 if i == j else 5 for j in range(count)] for i in range(count)],
        distances=[[0 if i == j else 0.5 for j in range(count)] for i in range(count)],
        costs=[[0.0] * count for _ in points], walk_km=[[0.1] * count for _ in points],
        transfers=[[0] * count for _ in points], data_source="amap",
    )


def route(minutes: float, walk: float, cost: float = 0, *, real: bool = True) -> LegRoute:
    return LegRoute(
        duration_min=minutes, distance_km=max(walk, 2.0), cost=cost, walk_km=walk,
        polyline=[(121.49214, 31.23352), (121.495924, 31.236697)],
        approx=not real, data_source="amap" if real else "offline",
    )


class TransportPolicyTests(unittest.IsolatedAsyncioTestCase):
    async def select(self, routes, *, preferred="walk", locked=False, weights=None, count=1, windows=None):
        matrix = matrix_for(count + 1, preferred)
        self.calls = []

        async def query(a, b, mode, *args):
            self.calls.append(mode)
            result = routes.get(mode)
            if isinstance(result, Exception):
                raise result
            return result

        with patch.object(policy, "leg_route", side_effect=query):
            return await policy.select_leg_routes(
                points=matrix.points, pairs=[(i, i + 1) for i in range(count)],
                preferred_modes=[preferred] * count, locked=[locked] * count,
                matrix=matrix, weights=weights or {},
                windows=windows or [(540, 1260, 0)] * count, start_min=540,
            )

    async def test_bund_riverside_two_hour_walk_uses_public_transport(self):
        walking = replace(route(120.13, 9.01), distance_km=9.01)
        legs, modes, notes = await self.select({
            "walk": walking, "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        })
        self.assertEqual(modes, ["transit"])
        self.assertEqual(legs[0].duration_min, 35)
        self.assertTrue(legs[0].is_auto_optimized)
        self.assertEqual(set(self.calls), {"walk", "transit", "taxi"})
        self.assertFalse(walking.is_auto_optimized, "不能污染缓存中的原始路线")

    async def test_short_matrix_does_not_force_a_long_actual_walk(self):
        _, modes, _ = await self.select({
            "walk": route(120, 9.01), "subway": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        }, preferred="subway")
        self.assertEqual(modes, ["subway"])

    async def test_short_actual_walk_remains_reasonable(self):
        _, modes, _ = await self.select({"walk": route(10, 0.7), "transit": route(25, 0.5, 4)}, preferred="transit")
        self.assertEqual(modes, ["walk"])
        self.assertIn("taxi", self.calls, "即使没有触发步行超限，自动乘车段也应比较打车")

    async def test_public_preference_compares_taxi_before_walking_limit(self):
        legs, modes, _ = await self.select({
            "transit": route(50, 0.4, 5), "taxi": route(10, 0.1, 25),
        }, preferred="transit", weights={"time": 1, "cost": 0, "walking": 0, "convenience": 0})
        self.assertEqual(modes, ["taxi"])
        self.assertEqual(legs[0].duration_min, 10)

    async def test_manual_public_transport_is_not_replaced_by_taxi(self):
        _, modes, _ = await self.select({
            "transit": route(50, 0.4, 5), "taxi": route(10, 0.1, 25),
        }, preferred="transit", locked=True)
        self.assertEqual(modes, ["transit"])
        self.assertEqual(self.calls, ["transit"])

    async def test_manual_walking_stays_with_visible_alternatives(self):
        legs, modes, _ = await self.select({
            "walk": route(120, 9.01), "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        }, locked=True)
        self.assertEqual(modes, ["walk"])
        self.assertFalse(legs[0].is_auto_optimized)
        self.assertIn("已保留你指定", legs[0].optimization_hint)
        self.assertIn("35 分钟", legs[0].optimization_hint)

    async def test_manual_drive_is_never_replaced_by_taxi_or_walking(self):
        _, modes, _ = await self.select({"drive": route(20, 0.1, 3)}, preferred="drive", locked=True)
        self.assertEqual(modes, ["drive"])
        self.assertEqual(self.calls, ["drive"])

    async def test_automatic_drive_does_not_abandon_car_for_taxi(self):
        _, modes, _ = await self.select({"drive": route(8, 0.1, 3), "walk": route(35, 2)}, preferred="drive")
        self.assertEqual(modes, ["drive"])
        self.assertNotIn("taxi", self.calls)

    async def test_real_walking_is_not_replaced_by_optimistic_estimates(self):
        legs, modes, notes = await self.select({
            "walk": route(120, 9.01), "transit": route(1, 0.1, 1, real=False),
            "taxi": route(2, 0.1, 2, real=False),
        })
        self.assertEqual(modes, ["walk"])
        self.assertIn("未取得可替代的已核验", legs[0].optimization_hint)

    async def test_alternative_failure_is_explicit(self):
        legs, modes, notes = await self.select({"walk": route(120, 9.01), "transit": RuntimeError("unavailable")})
        self.assertEqual(modes, ["walk"])
        self.assertTrue(any("查询失败" in text for text in notes))
        self.assertIn("请确认", legs[0].optimization_hint)

    async def test_offline_results_remain_marked_as_estimates(self):
        legs, modes, _ = await self.select({
            "walk": route(120, 9, real=False), "transit": route(35, 0.3, 4, real=False),
            "taxi": route(18, 0.1, 35, real=False),
        })
        self.assertNotEqual(modes, ["walk"])
        self.assertTrue(legs[0].approx)
        self.assertIn("离线估算", legs[0].optimization_reason)

    async def test_cost_and_time_preferences_change_comparison(self):
        routes = {"walk": route(120, 9), "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35)}
        _, economical, _ = await self.select(routes, weights={"time": 0, "cost": 1, "walking": 0, "convenience": 0})
        _, fastest, _ = await self.select(routes, weights={"time": 1, "cost": 0, "walking": 0, "convenience": 0})
        self.assertEqual(economical, ["transit"])
        self.assertEqual(fastest, ["taxi"])

    async def test_short_walk_also_changes_mode_with_new_preferences(self):
        routes = {"walk": route(12, .8), "transit": route(10, .1, 3), "taxi": route(3, .05, 16)}
        _, cheap, _ = await self.select(routes, weights={"time": 0, "cost": 1, "walking": 0, "convenience": 0})
        _, fast, _ = await self.select(routes, weights={"time": 1, "cost": 0, "walking": 0, "convenience": 0})
        self.assertEqual(cheap, ["walk"])
        self.assertEqual(fast, ["taxi"])

    async def test_releasing_manual_mode_allows_new_weights_to_change_it(self):
        routes = {"walk": route(12, .8), "transit": route(10, .1, 3), "taxi": route(3, .05, 16)}
        weights = {"time": 1, "cost": 0, "walking": 0, "convenience": 0}
        _, manual, _ = await self.select(routes, locked=True, weights=weights)
        _, automatic, _ = await self.select(routes, locked=False, weights=weights)
        self.assertEqual(manual, ["walk"])
        self.assertEqual(automatic, ["taxi"])

    async def test_walking_suggestion_cannot_override_pure_cost_preference(self):
        legs, modes, notes = await self.select({
            "walk": route(12, 1), "transit": route(10, .1, 3), "taxi": route(3, .05, 16),
        }, count=7, weights={"time": 0, "cost": 1, "walking": 0, "convenience": 0})
        self.assertEqual(modes, ["walk"] * 7)
        self.assertEqual(sum(leg.cost for leg in legs), 0)
        self.assertTrue(any("超过建议" in text for text in notes))

    async def test_business_hours_take_priority_over_weighted_score(self):
        _, modes, _ = await self.select({
            "walk": route(120, 9), "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        }, windows=[(540, 565, 5)])
        self.assertEqual(modes, ["taxi"])

    async def test_many_short_walks_are_balanced_across_the_day(self):
        legs, modes, _ = await self.select({
            "walk": route(18, 0.95), "transit": route(12, 0.1, 3), "taxi": route(5, 0.05, 16),
        }, count=7)
        self.assertLessEqual(sum(leg.walk_km for leg in legs), 6)
        self.assertIn("transit", modes)

    async def test_less_walking_preference_reduces_daily_limit(self):
        legs, _, _ = await self.select({
            "walk": route(12, 0.8), "transit": route(12, 0.1, 3), "taxi": route(5, 0.05, 16),
        }, count=5, weights={"walking": 1})
        self.assertLessEqual(sum(leg.walk_km for leg in legs), 3)

    async def test_manual_daily_walk_is_preserved_with_warning(self):
        _, modes, notes = await self.select({"walk": route(18, 1)}, count=7, locked=True)
        self.assertEqual(modes, ["walk"] * 7)
        self.assertTrue(any("全天交通步行" in text for text in notes))

    async def test_twenty_minutes_is_the_comparison_boundary(self):
        await self.select({"walk": route(20, 1)}, locked=True)
        self.assertEqual(self.calls, ["walk"])
        await self.select({"walk": route(20.01, 1), "transit": route(15, 0.2, 3), "taxi": route(5, 0, 16)})
        self.assertIn("transit", self.calls)

    def test_walking_only_response_is_not_a_public_transport_route(self):
        chosen, options = select_transit_option([{"rides": [], "walkKm": 9.01}])
        self.assertIsNone(chosen)
        self.assertEqual(options, [])


class PlanScheduleTests(unittest.IsolatedAsyncioTestCase):
    def request(self, *, closes="09:25", manual=False, end="12:00", lunch=0) -> PlanRequest:
        return PlanRequest.model_validate({
            "hotel": {"name": "外滩", "lng": 121.492127, "lat": 31.233516},
            "destinations": [{
                "id": "riverside", "name": "陆家嘴滨江大道", "lng": 121.495962, "lat": 31.2367,
                "source": "map-click", "selected": True, "stayMin": 5,
                "openTime": "09:00", "closeTime": closes,
            }], "mode": "walk", "legModes": {"riverside": "walk"} if manual else {},
            "options": {"dayStartTime": "09:00", "dayEndTime": end, "lunchBreakMin": lunch},
        })

    async def plan(self, req, routes):
        matrix = matrix_for(len(req.destinations) + 1)
        result = SolveResult(order=list(range(1, len(req.destinations) + 1)), arrivals={1: 545}, return_min=560, solver="test")

        async def query(a, b, mode, *args):
            return routes.get(mode)

        with patch.object(planner, "build_matrix", new=AsyncMock(return_value=matrix)), \
             patch.object(planner, "solve", return_value=result), \
             patch.object(policy, "leg_route", side_effect=query), \
             patch.object(planner.cache, "stats", return_value={"entries": 0}):
            return await planner.create_plan(req)

    async def test_selected_transport_recomputes_arrival_return_and_totals(self):
        plan = await self.plan(self.request(closes="12:00"), {
            "walk": route(120.13, 9.01), "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        })
        day = plan.days[0]
        self.assertEqual(day.stops[0].arriveTime, "09:35")
        self.assertEqual(day.returnTime, "10:15")
        self.assertEqual(day.stats.totalTransitMin, 70)
        self.assertEqual(day.stats.totalWalkKm, 0.8)
        self.assertEqual(day.returnLeg.mode, "transit")
        self.assertEqual(len(day.polylines), len(day.stops) + 1)

    async def test_closed_stop_is_not_returned_as_a_valid_visit(self):
        plan = await self.plan(self.request(manual=True), {
            "walk": route(29, 2.1), "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        })
        self.assertEqual(plan.days[0].stops, [])
        self.assertEqual(plan.solver["dropped"][0]["id"], "riverside")
        self.assertIn("09:25", plan.solver["dropped"][0]["reason"])

    async def test_faster_candidate_can_save_a_business_hours_visit(self):
        plan = await self.plan(self.request(), {
            "walk": route(120, 9.01), "transit": route(35, 0.4, 4), "taxi": route(18, 0.05, 35),
        })
        self.assertEqual(plan.days[0].stops[0].transportFromPrev.mode, "taxi")
        self.assertEqual(plan.days[0].stops[0].leaveTime, "09:23")
        self.assertEqual(plan.solver["dropped"], [])

    async def test_return_deadline_is_rechecked(self):
        plan = await self.plan(self.request(closes="12:00", end="09:30", manual=True), {
            "walk": route(18, 1.2), "transit": route(25, 0.3, 4), "taxi": route(18, 0.05, 35),
        })
        self.assertEqual(plan.days[0].stops, [])
        self.assertIn("回酒店", plan.solver["dropped"][0]["reason"])


def main() -> int:
    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(TransportPolicyTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(PlanScheduleTests),
    ])
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
