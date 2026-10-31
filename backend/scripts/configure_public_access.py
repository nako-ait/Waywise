"""Configure the demo HTTPS gateway without echoing/storing a plaintext password."""
from __future__ import annotations

import getpass
import ipaddress
from pathlib import Path
import re
import sys
import warnings

from configure_cloud_ai import write_private_env

ROOT = Path(__file__).resolve().parents[2]


def check_ip(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        raise ValueError('Enter the public IPv4 shown on your cloud instance page.') from None
    if address.version != 4 or not address.is_global:
        raise ValueError('A public IPv4 is required; do not enter localhost or a private address.')
    return str(address)


def check_password(password: str) -> None:
    if len(password) < 12 or len(password.encode('utf-8')) > 72:
        raise ValueError('Use a demo password of at least 12 characters and at most 72 UTF-8 bytes.')
    if password != password.strip() or any(c in password for c in ('\r', '\n', '\0')):
        raise ValueError('The demo password cannot contain line breaks or leading/trailing spaces.')


def hash_password(password: str) -> str:
    check_password(password)
    # Ubuntu 22.04's Python 3.10 and libcrypt support bcrypt without extra packages.
    # Import only here so non-Ubuntu tests can validate the rest of the setup.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', DeprecationWarning)
            import crypt
        method = crypt.METHOD_BLOWFISH
        encoded = crypt.crypt(password, crypt.mksalt(method, rounds=2 ** 12))
    except (ImportError, AttributeError, OSError, ValueError):
        raise ValueError('Run this setup with the Ubuntu server system python3 (3.10 or 3.12, with bcrypt crypt support).') from None
    if not encoded or not re.fullmatch(r'\$2[aby]\$12\$[./A-Za-z0-9]{53}', encoded):
        raise ValueError('The system could not produce a bcrypt password hash; no configuration was saved.')
    return encoded


def configure(root: Path, public_ip: str, password_hash: str) -> None:
    public_ip = check_ip(public_ip)
    if not re.fullmatch(r'\$2[aby]\$12\$[./A-Za-z0-9]{53}', password_hash):
        raise ValueError('A valid bcrypt hash is required; no configuration was saved.')
    # Quote the hash to keep Compose from interpreting its dollar signs.
    write_private_env(root / '.env', root / '.env.example', {
        'PUBLIC_IP': public_ip,
        'DEMO_PASSWORD_HASH': "'" + password_hash + "'",
        'COMPOSE_PROFILES': 'public',
    })


def main() -> int:
    print('Configure the public HTTPS entrance. Existing AI/map settings are preserved.')
    print('Use the IPv4 from the cloud instance page. Choose a NEW demo password, not an API key or SSH password.')
    try:
        address = check_ip(input('Public server IPv4: ').strip())
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('Demo access password (hidden, 12+ characters): ')
            check_password(password)
            confirmation = getpass.getpass('Repeat demo password (hidden): ')
        if password != confirmation:
            raise ValueError('The two passwords do not match; no configuration was saved.')
        configure(ROOT, address, hash_password(password))
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
        print('Could not save configuration. Check permissions and disk space.')
        return 1
    print('Saved .env. Only the password hash was stored; plaintext was not printed.')
    print('Demo username: judge')
    print('Target URL: https://' + address)
    print('Open TCP 80/443 in the cloud firewall, then run: sudo docker compose up -d gateway')
    print('The URL is ready only after a trusted certificate has been issued and external access has been tested.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
