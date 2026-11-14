import hashlib
import json
import sys
try:
    import tomllib
except ModuleNotFoundError:
    import trusttunnel_vendor_tomli as tomllib
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from trusttunnel_credentials import ManagedCredential
from trusttunnel_pilot_plan import PilotAccount, PilotPlanError, prepare_pilot_plan

class PilotPlanTests(unittest.TestCase):
    def setUp(self):
        self.base = '# retained smoke test\n[[client]]\nusername="smoke"\npassword="fixture"\n'
        self.a = ManagedCredential('trioz_'+'a'*32, 'A'*43)
        self.b = ManagedCredential('trioz_'+'b'*32, 'B'*43)
    def plan(self, current, previous, ids, generator=None, **kw):
        args = dict(hostname='turn.example.com', gateway_ipv4='192.0.2.4', port=8443)
        args.update(kw)
        if generator is not None: args['generator'] = generator
        return prepare_pilot_plan(current, previous, ids, **args)
    def test_initial_snapshot_and_sealer_payload_match(self):
        p = self.plan(self.base, [], ['admin_a'], lambda: self.a)
        rows = tomllib.loads(p.endpoint_credentials)['client']
        payload = json.loads(p.sealer_input)['accounts']
        self.assertEqual(rows[0]['username'], 'smoke')
        self.assertEqual(rows[1]['username'], payload[0]['username'])
        self.assertEqual(rows[1]['password'], payload[0]['password'])
        self.assertEqual(p.original_sha256, hashlib.sha256(self.base.encode()).hexdigest())
        self.assertEqual((p.added_count,p.removed_count),(1,0))
        self.assertNotIn('A'*43, repr(p)); self.assertNotIn('A'*43, repr(p.accounts[0]))
    def test_retain_add_remove_and_deprovision(self):
        a = self.plan(self.base, [], ['admin_a'], lambda: self.a)
        ab = self.plan(a.endpoint_credentials, a.accounts, ['admin_b','admin_a'], lambda: self.b)
        self.assertEqual((ab.added_count, ab.removed_count), (1,0))
        self.assertEqual(ab.accounts[0].credential, self.a)
        b = self.plan(ab.endpoint_credentials, ab.accounts, ['admin_b'])
        self.assertEqual((b.added_count, b.removed_count), (0,1))
        self.assertEqual(b.accounts[0].credential, self.b)
        done = self.plan(b.endpoint_credentials, b.accounts, [])
        self.assertEqual(done.endpoint_credentials, self.base)
        self.assertEqual(json.loads(done.sealer_input), {'accounts': []})
    def test_stale_or_incomplete_mapping_fails_closed(self):
        a = self.plan(self.base, [], ['admin_a'], lambda: self.a)
        for previous in [[], [PilotAccount('admin_a', self.b)], [*a.accounts, *a.accounts]]:
            with self.assertRaises(PilotPlanError): self.plan(a.endpoint_credentials, previous, ['admin_a'])
        self.assertNotIn(self.a.password, str(self._capture_error(a)))
    def _capture_error(self, a):
        try: self.plan(a.endpoint_credentials, [], ['admin_a'])
        except PilotPlanError as e: return e
        self.fail('Expected failure')
    def test_invalid_and_duplicate_inputs_fail(self):
        for ids in [['admin_a','admin_a'], ['oops\n'], ['x']*101]:
            with self.assertRaises(PilotPlanError): self.plan(self.base, [], ids)
        for kw in [dict(hostname='turn.example.com\n'), dict(gateway_ipv4='192.0.2.999'), dict(port=True), dict(port=0)]:
            with self.assertRaises(PilotPlanError): self.plan(self.base, [], ['admin'], **kw)
    def test_duplicate_generated_secrets_and_username_refused(self):
        for generated in [self.a, ManagedCredential('trioz_'+'b'*32, 'A'*43)]:
            a = self.plan(self.base, [], ['admin_a'], lambda: self.a)
            with self.assertRaises(PilotPlanError): self.plan(a.endpoint_credentials, a.accounts, ['admin_a', 'admin_b'], lambda: generated)
    def test_mutated_file_refused(self):
        a = self.plan(self.base, [], ['admin_a'], lambda: self.a)
        with self.assertRaises(PilotPlanError): self.plan(a.endpoint_credentials + '# manually changed\n', a.accounts, ['admin_a'])

if __name__ == '__main__': unittest.main()
