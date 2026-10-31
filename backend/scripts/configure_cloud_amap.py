"""Set AMap credentials with hidden prompts; JS security code stays server-side."""
from __future__ import annotations

import getpass
from pathlib import Path
import re
import sys
import warnings

from configure_cloud_ai import write_private_env

ROOT = Path(__file__).resolve().parents[2]


def configure(root: Path, web_key: str, js_key: str, security_code: str) -> None:
    for value in (web_key, js_key, security_code):
        if len(value) < 12 or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
            raise ValueError('Enter complete AMap values using letters/digits, without spaces or masking stars.')
    if web_key == js_key:
        raise ValueError('The Web service Key and Web JS API Key must be different.')
    for path in (root / 'backend/.env', root / '.env'):
        if path.is_symlink():
            raise ValueError('Refusing to replace a symlink.')
    write_private_env(root / 'backend/.env', root / 'backend/.env.example', {'AMAP_WEB_KEY': web_key})
    write_private_env(root / '.env', root / '.env.example', {
        'VITE_AMAP_JS_KEY': js_key,
        'AMAP_SECURITY_CODE': security_code,
    }, remove=('VITE_AMAP_SECURITY_CODE',))


def main() -> int:
    print('Enter the three AMap values in order. Input is hidden; press Enter after each.')
    print('The JS security code stays on the server and is not included in the website build.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            web = getpass.getpass('1/3 Web service API Key (hidden): ').strip()
            js = getpass.getpass('2/3 Web JS API Key (hidden): ').strip()
            code = getpass.getpass('3/3 JS security code (hidden): ').strip()
        configure(ROOT, web, js, code)
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled. Configuration was not changed.')
        return 1
    except getpass.GetPassWarning:
        print('Hidden input is unavailable. Run this in the server terminal.')
        return 1
    except ValueError as error:
        print(str(error))
        return 1
    except OSError:
        print('Could not save both configuration files. Check permissions/disk space, then rerun.')
        return 1
    print('Saved backend/.env and .env. Keys were not printed. Existing AI settings were preserved.')
    print('Run: sudo docker compose up -d --build --force-recreate')
    return 0


if __name__ == '__main__':
    sys.exit(main())
