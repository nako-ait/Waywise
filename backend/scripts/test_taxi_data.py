"""打车数据回归：景点导航匹配、接口费用、短缓存和排序矩阵。"""
from __future__ import annotations

import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from app.services import amap_client as amap, cache
from app.services.modes import get_mode

RIVER = (121.495962, 31.2367)
BUND = (121.492127, 31.233516)
ENTRANCE = (121.492306, 31.232973)


class TaxiDataTests(unittest.IsolatedAsyncioTestCase):
    async def direction(self, *, mode='taxi', fare='21', duration='1200', tolls='0'):
        self.requests = []

        def respond(request):
            self.requests.append(request)
            return httpx.Response(200, json={
                'status': '1', 'route': {'taxi_cost': fare, 'paths': [{
                    'distance': '5994', 'duration': duration, 'tolls': tolls,
                    'steps': [{'polyline': f'{RIVER[0]},{RIVER[1]};{ENTRANCE[0]},{ENTRANCE[1]}'}],
                }]},
            })

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch.object(amap, '_amap_key', return_value='test-key'):
                return await amap._fetch_direction(client, RIVER, BUND, get_mode(mode))

    async def test_bund_uses_poi_navigation_and_recommended_driving_strategy(self):
        leg = await self.direction()
        params = self.requests[0].url.params
        self.assertEqual(params['originid'], 'B001533722')
        self.assertEqual(params['destinationid'], 'B00155FXB3')
        self.assertEqual(params['strategy'], '10')
        self.assertEqual(params['extensions'], 'all')
        self.assertAlmostEqual(leg.distance_km, 5.994)

    async def test_taxi_cost_comes_from_api_instead_of_old_formula(self):
        leg = await self.direction()
        self.assertEqual(leg.cost, 21)
        self.assertEqual(leg.cost_source, 'amap_taxi_estimate')
        self.assertTrue(leg.cost_approx)
        self.assertFalse(leg.approx)
        self.assertIsNotNone(leg.queried_at)

    async def test_missing_taxi_fee_is_explicitly_a_local_estimate(self):
        leg = await self.direction(fare=[])
        self.assertEqual(leg.cost_source, 'local_estimate')
        self.assertTrue(leg.cost_approx)
        self.assertGreater(leg.cost, 0)

    async def test_missing_duration_cannot_become_a_zero_minute_real_route(self):
        self.assertIsNone(await self.direction(duration=[]))

    async def test_access_walk_uses_vehicle_endpoint_and_is_in_total_time(self):
        leg = await self.direction()
        expected = amap.haversine_km(ENTRANCE, BUND) * 1.25
        self.assertAlmostEqual(leg.walk_km, expected, places=3)
        self.assertAlmostEqual(leg.driving_min, 20)
        self.assertAlmostEqual(leg.duration_min, 20 + expected / 4.5 * 60)
        self.assertLess(leg.walk_km, 0.1)

    async def test_self_driving_estimate_includes_tolls(self):
        leg = await self.direction(mode='drive', tolls='12')
        self.assertAlmostEqual(leg.cost, round(5.994 * .8, 2) + 12)

    def test_driving_cache_expires_after_five_minutes(self):
        conn = MagicMock()
        conn.__enter__.return_value.execute.return_value.fetchone.return_value = (json.dumps({'old': True}), time.time() - 600)
        with patch.object(cache, '_connect', return_value=conn):
            self.assertIsNone(cache.get('driving', max_age_seconds=300))
            self.assertEqual(cache.get('poi'), {'old': True})

    async def test_vehicle_cache_is_versioned_and_preserves_fare_source(self):
        leg = await self.direction()
        with patch.object(amap, 'has_web_key', return_value=True), \
             patch.object(cache, 'get', return_value=None) as read, \
             patch.object(cache, 'set') as write, \
             patch.object(amap, '_fetch_direction', new=AsyncMock(return_value=leg)):
            await amap.leg_route(RIVER, BUND, 'taxi')
        self.assertEqual(read.call_args.kwargs['max_age_seconds'], 300)
        saved = write.call_args.args[1]
        self.assertEqual(saved['costSource'], 'amap_taxi_estimate')
        self.assertTrue(saved['costApprox'])
        self.assertEqual(saved['queriedAt'], leg.queried_at)
        with patch.object(amap, 'has_web_key', return_value=True), patch.object(cache, 'get', return_value=saved):
            cached = await amap.leg_route(RIVER, BUND, 'taxi')
        self.assertTrue(cached.cache_hit)
        self.assertEqual(cached.queried_at, leg.queried_at)
        self.assertEqual(cached.cost_source, 'amap_taxi_estimate')

    async def test_matrix_resolves_driving_arrival_and_departure_points(self):
        entrances = [(121.496513, 31.236361), ENTRANCE]
        matrix = [[(0, 0), (6, 20)], [(6, 20), (0, 0)]]
        async def access(client, point):
            entrance = entrances[[RIVER, BUND].index(point)]
            return entrance, entrance
        async def raw(client, points, dtype, destinations=None):
            return matrix if dtype == 1 else None
        with patch.object(amap, 'has_web_key', return_value=True), \
             patch.object(amap, '_driving_access', side_effect=access), \
             patch.object(amap, '_raw_matrix', side_effect=raw) as query:
            result = await amap.build_matrix([RIVER, BUND], 'taxi')
        self.assertEqual(query.call_args_list[0].args[1], entrances)
        self.assertEqual(query.call_args_list[0].args[3], entrances)
        self.assertEqual(result.distances[0][1], 6)
        self.assertGreater(result.durations[0][1], 20)
        self.assertLess(result.walk_km[0][1], .2)

    async def test_access_lookup_falls_back_to_entrance_if_no_exit_exists(self):
        def respond(request):
            return httpx.Response(200, json={'status': '1', 'pois': [{
                'id': 'B00155FXB3', 'entr_location': f'{ENTRANCE[0]},{ENTRANCE[1]}', 'exit_location': [],
            }]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch.object(cache, 'get', return_value=None), patch.object(cache, 'set'):
                departure, arrival = await amap._driving_access(client, BUND)
        self.assertEqual(departure, ENTRANCE)
        self.assertEqual(arrival, ENTRANCE)


def main():
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(TaxiDataTests),
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
