"""交通提案回归：不调用地图或模型，验证往返口径与预览/执行参数一致。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models import PlanResponse
from app.services import agent, agent_loop, turn_graph


def context():
    return {
        "text": "上海玩一天，想去外滩和陆家嘴滨江大道，合理安排交通，不要长距离步行",
        "hotel": {"name": "上海大学宝山校区", "lng": 121.387792, "lat": 31.315664},
        "destinations": [{"id": "bund", "name": "外滩", "lng": 121.492127,
                          "lat": 31.233516, "selected": True, "stayMin": 90}],
        "days": 1, "mode": "transit", "weights": {"walking": 0.5},
        "options": {"dayEndTime": "20:00", "lunchBreakMin": 0},
        "legModes": {"bund": "subway"},
        "limits": {"budgetCap": 150}, "used_names": {"外滩"},
        "city_pois": [], "has_places": True,
    }


def proposal():
    return agent.Proposal(kind="act", reply="已排好，全程公交，路上约2小时。", ops={
        "mode": "transit", "weights": {"walking": 0.95},
        "addPlaces": [{"name": "陆家嘴滨江大道", "lng": 121.495962, "lat": 31.2367,
                       "stayMin": 60, "openTime": "10:00", "closeTime": "19:00"}],
    })


def plan_for(req):
    selected = [d for d in req.destinations if d.selected]
    public = req.legModes and req.legModes.get("__return__") == "transit"
    minutes = [80, 40, 76] if public else [70, 20, 60]
    walking = [2.1, 1.8, 1.2] if public else [1.2, 0.3, 1.0]
    costs = [5, 3, 6] if public else [5, 25, 64]
    legs = [{"mode": "transit" if public or i == 0 else "taxi", "durationMin": m,
             "walkKm": walking[i], "cost": costs[i], "distanceKm": 5,
             "dataSource": "amap", "approx": False}
            for i, m in enumerate(minutes)]
    return PlanResponse.model_validate({"days": [{
        "date": "2026-10-28", "returnTime": "16:00",
        "stops": [{"id": d.id, "name": d.name, "lng": d.lng, "lat": d.lat,
                   "arriveTime": "12:00", "leaveTime": "13:00", "stayMin": d.stayMin,
                   "transportFromPrev": legs[i]} for i, d in enumerate(selected)],
        "returnLeg": legs[-1],
    }], "solver": {"totalStats": {"totalTransitMin": 120}}})


class AgentTransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []

        async def planner(req):
            self.requests.append(req)
            return plan_for(req)

        self.stub = patch.object(agent_loop, "create_plan", side_effect=planner)
        self.stub.start()
        self.addCleanup(self.stub.stop)

    def test_reducing_walking_is_not_selecting_walk(self):
        self.assertEqual(agent_loop._requested_modes("合理安排，不要长距离步行，少走路"), set())
        self.assertEqual(agent_loop._requested_modes("只坐公共交通，不要打车"), {"transit"})
        self.assertEqual(agent_loop._requested_modes("地铁或者打车"), {"subway", "taxi"})

    async def test_generic_request_does_not_invent_bus_and_compares_cost(self):
        p = await agent_loop.prepare_transport_proposal(proposal(), context(), [])
        self.assertNotIn("mode", p.ops)
        self.assertNotIn("已排好", p.reply)
        self.assertNotIn("2小时", p.reply)
        preview = "\n".join(p.preview)
        self.assertIn("含返程", preview)
        self.assertIn("196分钟", preview)
        self.assertIn("150分钟", preview)
        self.assertIn("费用增加约¥80", preview)
        self.assertEqual(len(self.requests), 2)

    async def test_preview_uses_same_new_weights_hours_and_locks_as_apply(self):
        ctx = context()
        p = proposal()
        await agent_loop.prepare_transport_proposal(p, ctx, [])
        expected, _, _ = agent.request_from_ops(agent_loop._base_request(ctx), p.ops)
        self.assertEqual(self.requests[0], expected)
        self.assertEqual(expected.weights.walking, 0.95)
        self.assertEqual(expected.destinations[0].stayMin, 90)
        self.assertEqual(expected.destinations[1].closeTime, "19:00")
        self.assertEqual(expected.legModes, {"bund": "subway"})
        self.assertEqual(self.requests[1].legModes["bund"], "subway")
        self.assertEqual(expected.limits.budgetCap, 150)

    async def test_explicit_mode_is_kept(self):
        ctx = context()
        ctx["text"] = "改成优先坐地铁"
        p = agent.Proposal(kind="act", ops={"mode": "subway"})
        await agent_loop.prepare_transport_proposal(p, ctx, [])
        self.assertEqual(p.ops["mode"], "subway")
        self.assertEqual(len(self.requests), 1)
        self.assertNotIn("全程", "\n".join(p.preview))

    async def test_old_weight_preview_is_not_reused(self):
        ctx = context()
        req, _, _ = agent.request_from_ops(agent_loop._base_request(ctx), {**proposal().ops, "mode": None})
        req.weights.walking = 0.5
        old = await agent_loop._preview_request(req, compare=True)
        await agent_loop.prepare_transport_proposal(proposal(), ctx, [{"tool": "preview_plan", "result": old}])
        self.assertEqual(len(self.requests), 4)
        self.assertEqual(self.requests[-2].weights.walking, 0.95)

    async def test_preview_tool_accepts_proposed_weights_and_preserves_existing_stays(self):
        ctx = context()
        index = {"外滩": ctx["destinations"][0]}
        result = await agent_loop._run_tool("preview_plan", {
            "destinations": ["外滩"], "weights": {"walking": 0.95}, "dayEndTime": "18:00",
        }, ctx, index)
        self.assertTrue(result["includesReturn"])
        self.assertEqual(result["transitMin"], 130)
        self.assertEqual(self.requests[0].weights.walking, 0.95)
        self.assertEqual(self.requests[0].destinations[0].stayMin, 90)
        self.assertEqual(self.requests[0].options.dayEndTime, "18:00")

    async def test_graph_checks_model_proposal_before_returning_it(self):
        with patch.object(agent_loop, "run", return_value=(proposal(), [])):
            p, source = await turn_graph.run_turn(context()["text"], context())
        self.assertEqual(source, "llm")
        self.assertIn("含返程", "\n".join(p.preview))
        self.assertNotIn("mode", p.ops)

    async def test_failure_does_not_show_invented_numbers(self):
        with patch.object(agent_loop, "create_plan", side_effect=RuntimeError("unavailable")):
            p = await agent_loop.prepare_transport_proposal(proposal(), context(), [])
        self.assertTrue(p.warnings)
        self.assertNotIn("2小时", p.reply)
        self.assertNotIn("费用约", "\n".join(p.preview))

    async def test_apply_keeps_preview_parameters_even_when_limit_is_missed(self):
        ctx = context()
        req = agent_loop._base_request(ctx)
        result = plan_for(req)
        result.solver = {"limits": {"violations": ["路上约130分钟，超出上限"]}}
        with patch.object(agent, "create_plan", return_value=result) as create:
            _, _, caption = await agent.apply_ops(req, {"weights": {"walking": 0.95}})
        self.assertEqual(create.call_count, 1)
        self.assertEqual(create.call_args.args[0].legModes, req.legModes)
        self.assertEqual(create.call_args.args[0].weights.walking, 0.95)
        self.assertIn("超出上限", caption)

    async def test_all_public_recommendation_still_shows_partial_taxi_comparison(self):
        async def all_public(req):
            self.requests.append(req)
            plan = plan_for(req)
            if "taxi" not in (req.legModes or {}).values():
                for day in plan.days:
                    for leg in [*(s.transportFromPrev for s in day.stops), day.returnLeg]:
                        leg.mode = "transit"
            return plan

        with patch.object(agent_loop, "create_plan", side_effect=all_public):
            result = await agent_loop._preview_request(agent_loop._base_request(context()), compare=True)
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(len(result["alternatives"]), 2)
        self.assertEqual(self.requests[-1].legModes["bund"], "subway")
        self.assertEqual(self.requests[-1].legModes["__return__"], "taxi")


def main():
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(AgentTransportTests),
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
