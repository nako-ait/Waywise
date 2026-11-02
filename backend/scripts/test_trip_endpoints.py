"""Multi-city routing and open-trip regression tests; no credentials or live APIs."""
from __future__ import annotations

import asyncio
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.models import PlanRequest
from app.services import amap_client as amap, planner, transport_policy, agent, agent_loop, solver
from app.services.modes import get_mode
from app.services.tsp_core import NodeSpec, SolveRequest
from app.services.tsp_fallback import solve_fallback
from app.services.timeutil import hhmm_to_min
from app.services.vrp import DaySplit

ORIGIN = (120.155, 30.274)
END = (120.18, 30.25)


def request(**updates):
    data = dict(hotel=dict(name="杭州起点", lng=ORIGIN[0], lat=ORIGIN[1]), cityName="杭州",
                destinations=[dict(id=str(i), name=f"景点{i}", lng=120.16 + i * .001, lat=30.27,
                                   stayMin=20, selected=True) for i in range(1, 3)],
                mode="transit", legModes={"1": "transit", "2": "transit", "__return__": "taxi"},
                options=dict(dayStartTime="09:00", dayEndTime="18:00", lunchBreakMin=0))
    data.update(updates)
    return PlanRequest(**data)


def endpoint():
    return dict(name="杭州东站", lng=END[0], lat=END[1])


def matrix(points, mode="transit"):
    n = len(points)
    durations = [[0 if i == j else 25 if points[j] == END else 5 for j in range(n)] for i in range(n)]
    return amap.Matrix(points=list(points), mode=mode, durations=durations,
                       distances=[[d / 10 for d in row] for row in durations],
                       costs=[[0 if i == j else 7 for j in range(n)] for i in range(n)],
                       walk_km=[[0 if i == j else .1 for j in range(n)] for i in range(n)],
                       transfers=[[0] * n for _ in points], data_source="offline")


class EndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.calls = []
        self.stack.enter_context(patch.object(planner.settings, "solver_time_limit_s", .08))
        async def build(points, mode):
            return matrix(points, mode)
        self.stack.enter_context(patch.object(planner, "build_matrix", side_effect=build))

        async def route(a, b, mode, *_):
            self.calls.append((a, b, mode))
            return amap.LegRoute(duration_min=25 if b == END else 5, distance_km=2, cost=7,
                                 walk_km=.1, polyline=[a, b], approx=True, data_source="offline")
        self.stack.enter_context(patch.object(transport_policy, "leg_route", side_effect=route))

    def tearDown(self):
        self.stack.close()

    async def test_legacy_is_round_trip(self):
        req = request(cityName=None)
        plan = await planner.create_plan(req)
        day = plan.days[0]
        self.assertEqual(day.endMode, "return")
        self.assertEqual(day.endPoint.name, req.hotel.name)
        self.assertEqual(day.polylines[-1][-1], ORIGIN)
        self.assertEqual(day.stats.totalCost, 21)

    async def test_free_end_omits_return_and_totals(self):
        plan = await planner.create_plan(request(endMode="last_stop"))
        day = plan.days[0]
        self.assertIsNone(day.returnLeg)
        self.assertEqual(len(day.polylines), len(day.stops))
        self.assertEqual(day.returnTime, day.stops[-1].leaveTime)
        self.assertEqual(day.stats.totalCost, 14)
        self.assertFalse(any(b == ORIGIN for _, b, _ in self.calls))
        self.assertFalse(agent_loop._summary(plan, "test")["includesReturn"])

    async def test_custom_endpoint_counts_final_time_cost_walk_and_manual_mode(self):
        plan = await planner.create_plan(request(endMode="custom", endPoint=endpoint()))
        day = plan.days[0]
        self.assertEqual(day.endPoint.name, "杭州东站")
        self.assertEqual(day.polylines[-1][-1], END)
        self.assertEqual(day.returnLeg.mode, "taxi")
        self.assertEqual(day.stats.totalCost, 21)
        self.assertEqual(day.stats.totalWalkKm, .3)
        self.assertEqual(day.stats.totalTransitMin, 35)
        self.assertEqual(hhmm_to_min(day.returnTime), hhmm_to_min(day.stops[-1].leaveTime) + 25)
        self.assertEqual(plan.solver["requestedCount"], 2)
        self.assertEqual(plan.solver["visitedCount"], 2)
        self.assertIn("杭州东站", plan.explanation)
        self.assertFalse(any(b == ORIGIN for _, b, _ in self.calls))
        summary = agent_loop._summary(plan, "test")
        self.assertFalse(summary["includesReturn"])
        self.assertEqual(summary["cost"], 21)
        self.assertEqual(summary["days"][0]["endPoint"]["name"], "杭州东站")

    async def test_only_final_day_uses_finish_setting(self):
        for mode in ("last_stop", "custom"):
            with patch.object(planner, "split_into_days", return_value=DaySplit(groups=[[1], [2]])):
                plan = await planner.create_plan(request(days=2, endMode=mode, endPoint=endpoint() if mode == "custom" else None))
            self.assertEqual([d.endMode for d in plan.days], ["return", mode])
            self.assertEqual(plan.days[0].polylines[-1][-1], ORIGIN)
            self.assertEqual(plan.days[1].polylines[-1][-1], END if mode == "custom" else (120.162, 30.27))

    async def test_deadline_reserves_terminal_transport(self):
        options = dict(dayStartTime="09:00", dayEndTime="09:45", lunchBreakMin=0)
        free = await planner.create_plan(request(endMode="last_stop", destinations=request().destinations[:1], options=options))
        custom = await planner.create_plan(request(endMode="custom", endPoint=endpoint(), destinations=request().destinations[:1], options=options))
        self.assertEqual(len(free.days[0].stops), 1)
        self.assertEqual(len(custom.days[0].stops), 0)
        self.assertIsNone(custom.days[0].returnTime, "No invented endpoint arrival when the journey is infeasible")
        self.assertTrue(custom.solver["dropped"])

    async def test_all_closed_keeps_endpoint_and_drop_reasons(self):
        closed = [d.model_copy(update={"openTime": "23:00", "closeTime": "23:30"}) for d in request().destinations]
        plan = await planner.create_plan(request(destinations=closed, endMode="custom", endPoint=endpoint()))
        self.assertEqual(plan.days[0].endMode, "custom")
        self.assertEqual(len(plan.solver["dropped"]), 2)
        self.assertIsNone(plan.days[0].returnLeg)

    async def test_request_city_is_isolated_and_reset_on_failure(self):
        seen = []
        async def build(points, mode):
            before = amap.routing_city.get()
            await asyncio.sleep(.005)
            seen.append((before, amap.routing_city.get()))
            return matrix(points, mode)
        with patch.object(planner, "build_matrix", side_effect=build):
            await asyncio.gather(planner.create_plan(request(cityName="北京")), planner.create_plan(request(cityName="杭州")))
        self.assertCountEqual(seen, [("北京", "北京"), ("杭州", "杭州")])
        self.assertEqual(amap.routing_city.get(), "")
        with patch.object(planner, "build_matrix", side_effect=RuntimeError("test")):
            with self.assertRaises(RuntimeError):
                await planner.create_plan(request())
        self.assertEqual(amap.routing_city.get(), "")

    async def test_ai_changes_preserve_city_and_finish(self):
        req = request(endMode="custom", endPoint=endpoint())
        ctx = dict(hotel=req.hotel.model_dump(), destinations=[d.model_dump() for d in req.destinations],
                   city_name=req.cityName, endMode=req.endMode, endPoint=req.endPoint.model_dump(),
                   days=req.days, mode=req.mode, weights=req.weights.model_dump(), options=req.options.model_dump())
        restored = agent_loop._base_request(ctx)
        changed, _, _ = agent.request_from_ops(restored, {"days": 2})
        self.assertEqual(changed.cityName, "杭州")
        self.assertEqual(changed.endMode, "custom")
        self.assertEqual(changed.endPoint, req.endPoint)


class ModelAndSolverTests(unittest.TestCase):
    def test_invalid_endpoint_is_rejected(self):
        for data in ({"endMode": "custom"}, {"endMode": "custom", "endPoint": {**endpoint(), "lng": float("nan")}},
                     {"endMode": "custom", "endPoint": {**endpoint(), "lat": 100}}):
            with self.assertRaises(ValidationError):
                request(**data)

    def test_endpoint_changes_order_for_both_solvers(self):
        full = matrix([ORIGIN, (120.161, 30.27), (120.162, 30.27), END])
        full.durations[1][0], full.durations[2][0] = 100, 1
        full.durations[1][3], full.durations[2][3] = 1, 100
        base = amap.sub_matrix(full, [0, 1, 2])
        for solve in (solver.solve, solve_fallback):
            for mode, order in (("return", [1, 2]), ("custom", [2, 1])):
                terminal = planner._finish_matrix(base, full, 3, mode)
                self.assertEqual(terminal.durations[0], base.durations[0])
                req = SolveRequest(matrix=terminal, nodes=[NodeSpec(1, "A", 0), NodeSpec(2, "B", 0)],
                                   weights={"time": 1, "cost": 0, "walking": 0, "convenience": 0}, time_limit_s=.1)
                self.assertEqual(solve(req).order, order, f"{solve.__name__}/{mode}")
        free = planner._finish_matrix(base, full, None, "last_stop")
        for field in ("durations", "costs", "distances", "walk_km", "transfers"):
            self.assertEqual([row[0] for row in getattr(free, field)], [0, 0, 0])
        self.assertEqual(base.durations[1][0], 100, "Do not mutate the closed-trip base matrix")


class CityApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_selected_city_reaches_transit_api(self):
        seen = []
        def handler(req):
            seen.append(dict(req.url.params))
            self.assertIn("/direction/transit/", req.url.path)
            return httpx.Response(200, json={"status": "1", "route": {"transits": []}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for city in ("上海", "杭州", "北京"):
                token = amap.routing_city.set(city)
                try:
                    await amap._fetch_direction(client, ORIGIN, END, get_mode("transit"))
                finally:
                    amap.routing_city.reset(token)
        self.assertEqual([(x["city"], x["cityd"]) for x in seen], [(c, c) for c in ("上海", "杭州", "北京")])

    async def test_legacy_coordinates_resolve_both_city_codes(self):
        seen = []
        def handler(req):
            if "/geocode/regeo" in req.url.path:
                return httpx.Response(200, json={"status": "1", "regeocode": {"addressComponent": {"citycode": "0571"}}})
            seen.append(dict(req.url.params))
            return httpx.Response(200, json={"status": "1", "route": {"transits": []}})
        with patch.object(amap.cache, "get", return_value=None), patch.object(amap.cache, "set"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                await amap._fetch_direction(client, ORIGIN, END, get_mode("transit"))
        self.assertEqual((seen[0]["city"], seen[0]["cityd"]), ("0571", "0571"))

    async def test_failed_reverse_lookup_never_assumes_shanghai(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"status": "0"}))
        with patch.object(amap.cache, "get", return_value=None):
            async with httpx.AsyncClient(transport=transport) as client:
                self.assertIsNone(await amap._fetch_direction(client, ORIGIN, END, get_mode("transit")))


def main():
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]) if __name__ in sys.modules else unittest.TestSuite(
        unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in (EndpointTests, ModelAndSolverTests, CityApiTests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
