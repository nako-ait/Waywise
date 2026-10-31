"""Offline regression checks for reasoning models and health-probe output."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import llm


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    async def invoke(self, response=None, status=200, configured=True):
        config = llm.LlmConfig('deepseek', 'https://example.invalid/v1', 'unit-value', 'deepseek-v4.1-flash')
        self.payloads = []
        client_class = httpx.AsyncClient

        def handle(request):
            self.payloads.append(json.loads(request.content))
            if response is not None:
                return httpx.Response(status, json=response)
            budget = self.payloads[-1]['max_tokens']
            return httpx.Response(200, json={
                'choices': [{'finish_reason': 'stop' if budget >= 128 else 'length',
                    'message': {'content': '可用' if budget >= 128 else '',
                                'reasoning_content': 'private-test-reasoning'}}],
                'usage': {'completion_tokens': 128},
            })

        def client(*args, **kwargs):
            return client_class(*args, **kwargs, transport=httpx.MockTransport(handle))

        with patch.object(llm, 'current_config', return_value=config if configured else None), \
             patch.object(llm.httpx, 'AsyncClient', side_effect=client):
            return await llm.probe()

    async def test_thinking_budget_allows_final_answer(self):
        result = await self.invoke()
        self.assertTrue(result['ok'])
        self.assertEqual(result['reply'], '可用')
        self.assertEqual(result['debug']['finishReason'], 'stop')
        self.assertEqual(self.payloads[0]['max_tokens'], 1024)
        self.assertNotIn('private-test-reasoning', json.dumps(result))
        self.assertNotIn('unit-value', json.dumps(result))

    async def test_reasoning_only_truncation_is_not_success(self):
        result = await self.invoke({'choices': [{'finish_reason': 'length',
            'message': {'content': None, 'reasoning_content': 'private-test-reasoning'}}],
            'usage': {'completion_tokens': 1024}})
        self.assertFalse(result['ok'])
        self.assertEqual(result['reply'], '')
        self.assertEqual(result['debug']['finishReason'], 'length')
        self.assertTrue(result['debug']['hasReasoning'])
        self.assertNotIn('private-test-reasoning', json.dumps(result))

    async def test_empty_final_content_still_fails(self):
        result = await self.invoke({'choices': [{'finish_reason': 'stop', 'message': {'content': ''}}]})
        self.assertFalse(result['ok'])
        self.assertEqual(result['debug']['finishReason'], 'stop')

    async def test_unconfigured_does_not_send_request(self):
        result = await self.invoke(configured=False)
        self.assertFalse(result['configured'])
        self.assertFalse(self.payloads)

    async def test_http_failure_does_not_pass_probe(self):
        result = await self.invoke({'error': {'message': 'unauthorized'}}, status=401)
        self.assertFalse(result['ok'])


def main() -> int:
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(ProbeTests))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
