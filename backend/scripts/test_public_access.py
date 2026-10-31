"""Offline public-entry configuration checks; never contacts a certificate authority."""
from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parent))
from configure_public_access import check_ip, check_password, configure

PROJECT = Path(__file__).resolve().parents[2]


class PublicSetupTests(unittest.TestCase):
    def setUp(self):
        scratch = PROJECT / '.tmp'
        scratch.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / '.env.example').write_bytes((PROJECT / '.env.example').read_bytes())
        self.original = b'VITE_AMAP_JS_KEY=keep-js\nAMAP_SECURITY_CODE=keep-code\n'
        (self.root / '.env').write_bytes(self.original)

    def test_only_hash_is_saved_and_existing_map_settings_survive(self):
        hashed = '$2b$12$' + 'A' * 53
        configure(self.root, '8.8.8.8', hashed)
        values = dotenv_values(self.root / '.env')
        self.assertEqual(values['DEMO_PASSWORD_HASH'], hashed)
        self.assertEqual(values['COMPOSE_PROFILES'], 'public')
        self.assertEqual(values['PUBLIC_IP'], '8.8.8.8')
        self.assertEqual(values['AMAP_SECURITY_CODE'], 'keep-code')
        self.assertEqual(values['VITE_AMAP_JS_KEY'], 'keep-js')
        self.assertEqual(list(self.root.glob('.env.backup-*'))[0].read_bytes(), self.original)

    def test_rejects_non_public_addresses_and_config_injection(self):
        for address in ('127.0.0.1', '10.60.31.180', '192.168.1.2', '0.0.0.0', '::1', 'example.com', '8.8.8.8 { malicious }'):
            with self.assertRaises(ValueError):
                check_ip(address)
        self.assertEqual((self.root / '.env').read_bytes(), self.original)

    def test_plaintext_or_invalid_hash_cannot_enable_public_entry(self):
        for value in ('plain-demo-password', '', '$2b$04$' + 'A' * 53, '$2b$12$bad\nvalue'):
            with self.assertRaises(ValueError):
                configure(self.root, '8.8.8.8', value)
            self.assertEqual((self.root / '.env').read_bytes(), self.original)

    def test_password_constraints(self):
        for password in ('short', ' ' + 'A' * 12, 'A' * 12 + '\n', 'A' * 73, 'A' * 12 + '\0'):
            with self.assertRaises(ValueError):
                check_password(password)
        check_password('A-new-demo-password-123')


def main() -> int:
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(PublicSetupTests))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
