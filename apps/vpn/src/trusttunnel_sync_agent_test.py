"""Offline tests for the sync agent. Sealing uses Node's crypto (same format as
apps/web/src/lib/trustTunnelAccess.ts); skipped when node is not installed."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import trusttunnel_sync_agent as agent

KEY = '22' * 32
U1, U2 = 'trioz_' + 'a' * 32, 'trioz_' + 'b' * 32
P1, P2 = 'A' * 43, 'B' * 43
SEAL_JS = r"""
const c=require('crypto');const [key,doc]=[process.argv[1],process.argv[2]];
const iv=c.randomBytes(12);const k=c.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
k.setAAD(Buffer.from('trioz-trusttunnel-sync-v1'));
const e=Buffer.concat([k.update(Buffer.from(doc)),k.final()]);
process.stdout.write(['v1',iv.toString('base64url'),e.toString('base64url'),k.getAuthTag().toString('base64url')].join('.'));
"""


def seal(doc, key=KEY):
    return subprocess.run(['node', '-e', SEAL_JS, key, json.dumps(doc)], check=True, capture_output=True, text=True).stdout


def state(serial, users, now_ms=None):
    now_ms = now_ms or serial
    return {'v': 1, 'serial': serial, 'issuedAt': now_ms, 'expiresAt': now_ms + 600000, 'users': users}


@unittest.skipIf(shutil.which('node') is None, 'node required for sealing fixtures')
class SyncAgentTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.chmod(self.dir, 0o700)
        self.creds = os.path.join(self.dir, 'credentials.toml')
        with open(self.creds, 'w') as f:
            f.write('[[client]]\nusername = "smoke"\npassword = "operator-secret"\n')
        os.chmod(self.creds, 0o640)
        self.now = 1_800_000_000.0
        self.responses = []
        self.sent = []
        self.calls = []
        self.active = True
        self.fail_restarts = 0
        cfg = {'mainUrl': 'https://trioz.example', 'token': 't' * 40, 'syncKey': KEY, 'credentialsPath': self.creds,
               'stateDir': os.path.join(self.dir, 'state'), 'serviceName': 'trusttunnel',
               'intervalSeconds': 60, 'minRestartIntervalSeconds': 30}
        self.agent = agent.Agent(cfg, http=self.http, systemctl=self.systemctl, clock=lambda: self.now, sleep=lambda s: None)
        self.agent.ensure_state_dir()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def http(self, body):
        self.sent.append(json.loads(body))
        return self.responses.pop(0)

    def systemctl(self, *args):
        self.calls.append(args)
        if args[0] == 'restart':
            self.active = self.fail_restarts <= 0
            self.fail_restarts -= 1
            return 0
        return 0 if self.active else 3

    def respond(self, users, serial=None):
        serial = serial or int(self.now * 1000)
        self.responses.append((200, json.dumps({'sealed': seal(state(serial, users))}).encode()))
        return serial

    def text(self):
        with open(self.creds) as f:
            return f.read()

    def test_adds_rotates_and_revokes_preserving_unmanaged(self):
        s1 = self.respond([{'username': U1, 'password': P1}, {'username': U2, 'password': P2}])
        self.assertTrue(self.agent.cycle())
        t = self.text()
        self.assertIn('smoke', t); self.assertIn(U1, t); self.assertIn(P2, t)
        self.assertEqual(self.agent.state['pendingAck']['serial'], s1)
        self.assertTrue(self.agent.state['pendingAck']['ok'])
        self.assertEqual(self.agent.state['pendingAck']['digest'], agent.usernames_digest([U1, U2]))
        self.assertEqual(oct(os.stat(self.creds).st_mode & 0o777), '0o640')
        # rotation of U1, revocation of U2
        self.now += 60
        self.respond([{'username': U1, 'password': 'C' * 43}])
        self.assertTrue(self.agent.cycle())
        t = self.text()
        self.assertNotIn(P1, t); self.assertNotIn(U2, t); self.assertIn('C' * 43, t); self.assertIn('operator-secret', t)
        self.assertEqual(self.sent[1]['ack']['serial'], s1)
        # no change -> no restart
        restarts = sum(1 for c in self.calls if c[0] == 'restart')
        self.now += 60
        self.respond([{'username': U1, 'password': 'C' * 43}])
        self.assertFalse(self.agent.cycle())
        self.assertEqual(restarts, sum(1 for c in self.calls if c[0] == 'restart'))

    def test_keeps_credentials_when_server_down_or_token_rejected(self):
        self.respond([{'username': U1, 'password': P1}])
        self.agent.cycle()
        before = self.text()
        for code in (503, 401, 500):
            self.responses.append((code, b''))
            with self.assertRaises(agent.AgentError):
                self.agent.cycle()
            self.assertEqual(before, self.text())

    def test_rejects_tampered_wrong_key_stale_and_replayed_states(self):
        self.respond([{'username': U1, 'password': P1}])
        self.agent.cycle()
        before = self.text()
        bad = [
            (200, json.dumps({'sealed': seal(state(int(self.now * 1000) + 1, []), key='33' * 32)}).encode()),
            (200, json.dumps({'sealed': seal(state(int(self.now * 1000) - 3_600_000, []))}).encode()),
            (200, json.dumps({'sealed': seal(state(1000, [], now_ms=int(self.now * 1000)))}).encode()),
            (200, json.dumps({'sealed': seal(state(int(self.now * 1000) + 5, [{'username': 'root', 'password': P1}]))}).encode()),
            (200, json.dumps({'sealed': seal(state(int(self.now * 1000) + 6, [{'username': U1, 'password': 'x"\n[[client]]'}]))}).encode()),
            (200, b'not json'),
        ]
        for response in bad:
            self.responses.append(response)
            with self.assertRaises(agent.AgentError):
                self.agent.cycle()
            self.assertEqual(before, self.text())

    def test_rolls_back_when_endpoint_fails_after_apply(self):
        self.respond([{'username': U1, 'password': P1}])
        self.agent.cycle()
        before = self.text()
        self.fail_restarts = 1  # new file crashes the endpoint, rollback recovers it
        self.now += 60
        self.respond([{'username': U2, 'password': P2}])
        with self.assertRaises(agent.AgentError) as ctx:
            self.agent.cycle()
        self.assertIn('restored', str(ctx.exception))
        self.assertEqual(before, self.text())
        self.assertFalse(self.agent.state['pendingAck']['ok'])
        # endpoint broken even with the old file -> explicit manual-check error
        self.fail_restarts = 2
        self.now += 60
        self.respond([{'username': U2, 'password': P2}])
        with self.assertRaises(agent.AgentError) as ctx:
            self.agent.cycle()
        self.assertIn('manual check', str(ctx.exception))
        self.assertEqual(before, self.text())

    def test_refuses_collision_with_unmanaged_user(self):
        with open(self.creds, 'w') as f:
            f.write('[[client]]\nusername = "%s"\npassword = "operator"\n' % U1)
        self.respond([{'username': U1, 'password': P1}])
        with self.assertRaises(agent.AgentError):
            self.agent.cycle()
        self.assertFalse(self.agent.state['pendingAck']['ok'])

    def test_state_persists_with_private_mode(self):
        self.respond([{'username': U1, 'password': P1}])
        self.agent.cycle()
        self.agent.save_state()
        self.assertEqual(os.stat(self.agent.state_path).st_mode & 0o777, 0o600)
        with open(self.agent.state_path) as f:
            self.assertNotIn(P1, f.read())

    def test_config_validation(self):
        path = os.path.join(self.dir, 'cfg.json')
        good = {'mainUrl': 'https://trioz.ru', 'token': 't' * 40, 'syncKey': KEY}
        with open(path, 'w') as f:
            json.dump(good, f)
        os.chmod(path, 0o600)
        self.assertEqual(agent.load_config(path)['credentialsPath'], '/etc/trusttunnel/credentials.toml')
        os.chmod(path, 0o644)
        with self.assertRaises(agent.AgentError):
            agent.load_config(path)
        for bad in ({**good, 'mainUrl': 'http://trioz.ru'}, {**good, 'syncKey': 'zz'}, {**good, 'serviceName': 'x; rm -rf /'}):
            with open(path, 'w') as f:
                json.dump(bad, f)
            os.chmod(path, 0o600)
            with self.assertRaises(agent.AgentError):
                agent.load_config(path)


if __name__ == '__main__':
    unittest.main()
