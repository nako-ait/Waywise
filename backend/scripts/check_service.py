"""Launcher probe: reuse this app, start a free port, and report foreign listeners."""
from __future__ import annotations

import json
import socket
import sys
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

RUNNING = 0
FREE = 10
OCCUPIED = 20


def inspect_service(kind: str, port: int | None = None) -> int:
    port = port or (8000 if kind == 'backend' else 5173)
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            pass
    except ConnectionRefusedError:
        return FREE
    except OSError:
        return OCCUPIED
    path = '/api/health' if kind == 'backend' else '/'
    try:
        opener = build_opener(ProxyHandler({}))
        request = Request(f'http://127.0.0.1:{port}{path}')
        with opener.open(request, timeout=4) as response:
            body = response.read(65536).decode('utf-8')
        if kind == 'backend':
            health = json.loads(body)
            matches = health.get('status') == 'ok' and 'poiCount' in health and 'solver' in health
        else:
            matches = 'TripCompiler' in body and '/src/main.tsx' in body
        return RUNNING if matches else OCCUPIED
    except (OSError, URLError, ValueError, AttributeError):
        return OCCUPIED


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {'backend', 'frontend'}:
        print('Usage: check_service.py backend|frontend')
        return OCCUPIED
    kind = sys.argv[1]
    status = inspect_service(kind)
    if status == RUNNING:
        print(f'{kind.capitalize()} is already running. Reusing the existing service.')
    elif status == OCCUPIED:
        port = 8000 if kind == 'backend' else 5173
        print(f'[ERROR] Port {port} is occupied by another service or is not responding.')
        print('Check the existing service before starting this project again.')
    return status


if __name__ == '__main__':
    raise SystemExit(main())
