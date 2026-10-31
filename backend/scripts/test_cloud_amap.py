"""Offline checks: hidden map setup preserves AI credentials and rejects bad input."""
from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parent))
import configure_cloud_amap

PROJECT = Path(__file__).resolve().parents[2]
WEB = 'unitWebKeyValue123'
JS = 'unitJsKeyValue1234'
CODE = 'unitSecurityCode123'


class MapSetupTests(unittest.TestCase):
    def setUp(self):
        scratch = PROJECT / '.tmp'
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'backend').mkdir()
        for name in ('backend/.env.example', '.env.example'):
            (self.root / name).write_bytes((PROJECT / name).read_bytes())
        self.original = b"DEEPSEEK_API_KEY='keep$literal#value'\nDEEPSEEK_MODEL=keep-model\nSOLVER_TIME_LIMIT_S=2\nAMAP_WEB_KEY=old\n"
        (self.root / 'backend/.env').write_bytes(self.original)
        (self.root / '.env').write_text('VITE_AMAP_SECURITY_CODE=old-client-code\nCUSTOM_SETTING=keep\n', encoding='utf-8')

    def test_preserves_ai_and_keeps_security_code_server_side(self):
        configure_cloud_amap.configure(self.root, WEB, JS, CODE)
        backend = dotenv_values(self.root / 'backend/.env')
        frontend = dotenv_values(self.root / '.env')
        self.assertEqual(backend['DEEPSEEK_API_KEY'], 'keep$literal#value')
        self.assertEqual(backend['DEEPSEEK_MODEL'], 'keep-model')
        self.assertEqual(backend['SOLVER_TIME_LIMIT_S'], '2')
        self.assertEqual(backend['AMAP_WEB_KEY'], WEB)
        self.assertEqual(frontend['VITE_AMAP_JS_KEY'], JS)
        self.assertEqual(frontend['AMAP_SECURITY_CODE'], CODE)
        self.assertNotIn('VITE_AMAP_SECURITY_CODE', frontend)
        self.assertEqual(frontend['CUSTOM_SETTING'], 'keep')
        self.assertNotIn(CODE, (self.root / 'backend/.env').read_text(encoding='utf-8'))
        backup = list((self.root / 'backend').glob('.env.backup-*'))
        self.assertEqual(backup[0].read_bytes(), self.original)

    def test_bad_value_does_not_modify_either_file(self):
        before_root = (self.root / '.env').read_bytes()
        for bad in ('', 'masked***value', 'a' * 12 + '\n', 'a' * 12 + '";}', 'has space inside'):
            with self.assertRaises(ValueError):
                configure_cloud_amap.configure(self.root, WEB, JS, bad)
            self.assertEqual((self.root / 'backend/.env').read_bytes(), self.original)
            self.assertEqual((self.root / '.env').read_bytes(), before_root)

    def test_different_key_types_cannot_use_same_value(self):
        with self.assertRaises(ValueError):
            configure_cloud_amap.configure(self.root, WEB, WEB, CODE)
        self.assertEqual((self.root / 'backend/.env').read_bytes(), self.original)


def main() -> int:
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(MapSetupTests))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
