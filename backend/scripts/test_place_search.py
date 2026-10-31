"""Offline origin-search regression: real API, mocked AMap transport."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app
from app.services import place_search

CLIENT = httpx.AsyncClient
KEY = 'test-web-key-only'


class PlaceSearchTests(unittest.TestCase):
    def invoke(self, payload=None, http_status=200, key=KEY, headers=None, query=None, failure=None):
        self.requests = []
        def handle(request):
            self.requests.append(request)
            if failure:
                raise failure
            return httpx.Response(http_status, json=payload)
        def client(*args, **kwargs):
            return CLIENT(*args, **kwargs, transport=httpx.MockTransport(handle))
        with patch.object(place_search.settings, 'amap_web_key', key), \
             patch.object(place_search.httpx, 'AsyncClient', side_effect=client), TestClient(app) as api:
            return api.get('/api/poi/online', params=query or {'q': '和平饭店', 'city': '上海'}, headers=headers or {})

    def test_success_and_city_boundary(self):
        response = self.invoke({'status': '1', 'pois': [
            {'name': '和平饭店', 'location': '121.490,31.240', 'adname': '黄浦区', 'address': '南京东路', 'type': '住宿;酒店', 'id': 'poi1'},
            {'name': 'bad', 'location': 'nan,31'},
        ]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p['name'] for p in response.json()], ['和平饭店'])
        self.assertEqual(response.json()[0]['lng'], 121.49)
        params = self.requests[0].url.params
        self.assertEqual(params['city'], '上海')
        self.assertEqual(params['citylimit'], 'true')
        self.assertEqual(params['key'], KEY)
        self.assertNotIn(KEY, response.text)

    def test_genuine_empty_is_success(self):
        response = self.invoke({'status': '1', 'pois': []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_permission_error_is_not_empty(self):
        response = self.invoke({'status': '0', 'info': 'INSUFFICIENT_PRIVILEGES', 'infocode': '10012'})
        self.assertEqual(response.status_code, 502)
        self.assertIn('INSUFFICIENT_PRIVILEGES', response.text)

    def test_no_secret_or_url_in_errors(self):
        for payload in [{'status': '0', 'info': 'https://example.invalid/?key=' + KEY}, {'status': '0', 'info': KEY}]:
            response = self.invoke(payload)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn(KEY, response.text)
            self.assertNotIn('example.invalid', response.text)

    def test_bad_coordinates_are_not_empty(self):
        response = self.invoke({'status': '1', 'pois': [{'name': 'bad', 'location': '200,31'}]})
        self.assertEqual(response.status_code, 502)

    def test_missing_key_does_not_call_upstream(self):
        response = self.invoke(key='')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.requests, [])

    def test_request_key_override(self):
        response = self.invoke({'status': '1', 'pois': []}, headers={'x-amap-key': 'request-specific-key'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.requests[0].url.params['key'], 'request-specific-key')

    def test_timeout_is_not_empty(self):
        response = self.invoke(failure=httpx.ReadTimeout('private upstream URL with ' + KEY))
        self.assertEqual(response.status_code, 504)
        self.assertNotIn(KEY, response.text)

    def test_validation_and_malformed_payload(self):
        self.assertEqual(self.invoke(query={'q': '   ', 'city': '上海'}).status_code, 422)
        self.assertEqual(self.requests, [])
        for payload in [[], {'status': '1', 'pois': {}}]:
            self.assertEqual(self.invoke(payload).status_code, 502)


def main() -> int:
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(PlaceSearchTests))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
