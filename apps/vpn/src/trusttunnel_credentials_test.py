import importlib.util
from pathlib import Path
import sys
import unittest
import tomllib

spec = importlib.util.spec_from_file_location('tt_credentials', Path(__file__).with_name('trusttunnel_credentials.py'))
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

class TestCredentialPreparation(unittest.TestCase):
    def setUp(self):
        self.original = '# existing client: keep it\n[[client]]\nusername = "smoke"\npassword = "dummy-only"\n'
        self.a = mod.ManagedCredential('trioz_' + 'a' * 32, 'A' * 43)
        self.b = mod.ManagedCredential('trioz_' + 'b' * 32, 'B' * 43)

    def test_create_keeps_existing_and_is_valid(self):
        out = mod.render_credentials(self.original, [self.a])
        self.assertTrue(out.startswith(self.original))
        self.assertEqual([c['username'] for c in tomllib.loads(out)['client']], ['smoke', self.a.username])
        self.assertEqual(mod.render_credentials(out, [self.a]), out)

    def test_snapshot_removal_and_rotation(self):
        first = mod.render_credentials(self.original, [self.a, self.b])
        rotated = mod.ManagedCredential(self.a.username, 'C' * 43)
        result = mod.render_credentials(first, [rotated])
        clients = tomllib.loads(result)['client']
        self.assertEqual([c['username'] for c in clients], ['smoke', self.a.username])
        self.assertEqual(clients[-1]['password'], 'C' * 43)
        self.assertEqual(mod.render_credentials(result, []), self.original)

    def test_random_generation_has_restricted_format_and_hidden_repr(self):
        a, b = mod.new_managed_credential(), mod.new_managed_credential()
        self.assertNotEqual(a.username, b.username)
        self.assertNotEqual(a.password, b.password)
        self.assertNotIn(a.password, repr(a))
        self.assertIn(a.username, mod.render_credentials('', [a]))

    def test_rejects_invalid_existing_toml_or_markers(self):
        for text in ['bad = [', self.original + '# BEGIN TRIOZ MANAGED CREDENTIALS v1\n',
                     self.original + '# END TRIOZ MANAGED CREDENTIALS v1\n']:
            with self.subTest(case=len(text)), self.assertRaises(mod.CredentialFileError):
                mod.render_credentials(text, [self.a])

    def test_rejects_invalid_or_duplicate_managed(self):
        for entries in [[self.a, self.a], [mod.ManagedCredential('bad', 'A' * 43)],
                        [mod.ManagedCredential(self.a.username, 'bad')]]:
            with self.assertRaises(mod.CredentialFileError): mod.render_credentials(self.original, entries)

    def test_never_overwrites_existing_user(self):
        existing = self.original + '[[client]]\nusername = "' + self.a.username + '"\npassword = "untouched"\n'
        with self.assertRaises(mod.CredentialFileError): mod.render_credentials(existing, [self.a])

    def test_rejects_duplicate_or_broken_existing_users(self):
        for text in [self.original + '[[client]]\nusername = "smoke"\npassword = "dummy"\n',
                     '[[client]]\nusername = "smoke"\n']:
            with self.assertRaises(mod.CredentialFileError): mod.render_credentials(text, [self.a])

    def test_rejects_outside_text_after_managed_section(self):
        out = mod.render_credentials(self.original, [self.a]) + '[unexpected]\na = 1\n'
        with self.assertRaises(mod.CredentialFileError): mod.render_credentials(out, [self.a])

if __name__ == '__main__': unittest.main()
