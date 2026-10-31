"""Configure the cloud model without placing its API key in shell history."""
from __future__ import annotations

import getpass
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid
import warnings

BACKEND = Path(__file__).resolve().parents[1]
ASSIGNMENT = re.compile(r'^([A-Z_][A-Z0-9_]*)=(.*)$')


def write_private_env(path: Path, template: Path, updates: dict[str, str], remove=()) -> None:
    if path.is_symlink():
        raise ValueError('Refusing to replace a symlink.')
    original = path.read_bytes() if path.exists() else None
    values = {}
    if original is not None:
        for line in original.decode('utf-8-sig').splitlines():
            match = ASSIGNMENT.fullmatch(line.strip())
            if match:
                values[match[1]] = match[2]
    values.update(updates)
    for name in remove:
        values.pop(name, None)
    lines = []
    for line in template.read_text(encoding='utf-8-sig').splitlines():
        match = ASSIGNMENT.fullmatch(line.strip())
        if match and match[1] in remove:
            continue
        if match and match[1] in values:
            lines.append(match[1] + '=' + values.pop(match[1]))
        else:
            lines.append(line)
    lines.extend(name + '=' + value for name, value in values.items())
    if original is not None:
        backup = path.with_name('.env.backup-' + uuid.uuid4().hex)
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(original)
    descriptor, temporary_name = tempfile.mkstemp(prefix='.env.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write('\n'.join(lines) + '\n')
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def configure(path: Path, template: Path, key: str) -> None:
    if not key or any(character.isspace() for character in key) or '*' in key:
        raise ValueError('Please enter the complete API key, without spaces or masking stars.')
    # Single quotes keep $ and # literal for Compose env_file and python-dotenv.
    quoted_key = "'" + key.replace('\\', '\\\\').replace("'", "\\'") + "'"
    write_private_env(path, template, {
        'LLM_PROVIDER': 'deepseek',
        'DEEPSEEK_API_KEY': quoted_key,
        'DEEPSEEK_BASE_URL': 'https://api.modelverse.cn/v1',
        'DEEPSEEK_MODEL': 'deepseek-v4.1-flash',
    })


def main() -> int:
    print('Model: deepseek-v4.1-flash')
    print('Endpoint: https://api.modelverse.cn/v1')
    print('Paste your complete CompShare API key below, then press Enter.')
    print('Your input will NOT be displayed. Ctrl+C cancels without saving.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('API Key (hidden): ').strip()
        configure(BACKEND / '.env', BACKEND / '.env.example', key)
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled. Configuration was not changed.')
        return 1
    except getpass.GetPassWarning:
        print('Hidden input is unavailable. Please run from the server terminal.')
        return 1
    except ValueError as error:
        print(str(error))
        return 1
    except OSError:
        print('Could not save configuration. Check file permissions and disk space.')
        return 1
    print('Saved backend/.env. The key was not printed.')
    print('Run: sudo docker compose up -d --force-recreate')
    return 0


if __name__ == '__main__':
    sys.exit(main())
