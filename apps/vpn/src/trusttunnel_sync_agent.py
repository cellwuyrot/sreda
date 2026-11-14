#!/usr/bin/env python3
"""TrioZ TrustTunnel endpoint sync agent (runs as root on the endpoint host).

Pull model, same as the AmneziaWG node agent: the agent periodically POSTs to
`<mainUrl>/api/internal/trusttunnel/sync` with its bearer token, receives the
COMPLETE desired credential snapshot sealed with AES-256-GCM (sync key), and
converges the managed block of credentials.toml to it:

  * new/rotated/removed logins are written atomically (CAS + fsync);
  * the endpoint is restarted (v1.1.0 does not reload credentials on SIGHUP),
    at most once per `minRestartIntervalSeconds`; restart drops current
    sessions, clients reconnect automatically, revoked users cannot;
  * if the service is not active after restart the previous file is restored
    and the endpoint restarted again; the failure is acknowledged to the web;
  * on any network/auth/decrypt/validation error the last applied state is
    KEPT (never "revoke everybody because the web was down").

Unmanaged clients (e.g. the operator's smoke account) outside the managed block
are preserved and must never collide with managed usernames.
Secrets are never logged, never put on command lines and never written outside
credentials.toml and the protected state directory.

Usage: trusttunnel_sync_agent.py --config /etc/trioz/trusttunnel-sync.json [--once]
Python 3.10+ (bundled Tomli on 3.10), OpenSSL 3 libcrypto. No pip packages.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trusttunnel_credentials import CredentialFileError, ManagedCredential, render_credentials  # noqa: E402
from trusttunnel_atomic_store import StoreError, replace_if_unchanged  # noqa: E402
from trusttunnel_pilot_gcm import VerificationError, decrypt_bundle  # noqa: E402

AAD = b'trioz-trusttunnel-sync-v1'
MAX_USERS = 300
MAX_RESPONSE = 256 * 1024
CLOCK_SKEW_MS = 5 * 60 * 1000
_USER = re.compile(r'trioz_[a-f0-9]{32}\Z')
_PASSWORD = re.compile(r'[A-Za-z0-9_-]{43}\Z')
_SERVICE = re.compile(r'[A-Za-z0-9@_.-]{1,64}\Z')


class AgentError(RuntimeError):
    """Messages never contain secrets."""


def log(message):
    sys.stdout.write(time.strftime('%Y-%m-%dT%H:%M:%S ') + message + '\n')
    sys.stdout.flush()


def _read_protected(path, modes, limit=64 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) not in modes or st.st_size > limit:
            raise AgentError('unsafe file: ' + os.path.basename(path))
        with os.fdopen(fd, 'rb', closefd=False) as f:
            return f.read(limit + 1)
    finally:
        os.close(fd)


def load_config(path):
    try:
        cfg = json.loads(_read_protected(path, (0o400, 0o600)).decode('utf-8'))
    except (OSError, ValueError) as e:
        raise AgentError('cannot read config') from None
    if not isinstance(cfg, dict):
        raise AgentError('invalid config')
    url = cfg.get('mainUrl')
    if not isinstance(url, str) or not re.fullmatch(r'https://[A-Za-z0-9.-]+(:\d{1,5})?', url.rstrip('/')):
        raise AgentError('mainUrl must be https://host')
    token, key = cfg.get('token'), cfg.get('syncKey')
    if not isinstance(token, str) or not 32 <= len(token) <= 200 or not re.fullmatch(r'[\x21-\x7e]+', token):
        raise AgentError('invalid token')
    if not isinstance(key, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', key):
        raise AgentError('invalid syncKey')
    creds = cfg.get('credentialsPath', '/etc/trusttunnel/credentials.toml')
    state_dir = cfg.get('stateDir', '/var/lib/trioz-tt-sync')
    service = cfg.get('serviceName', 'trusttunnel')
    for p in (creds, state_dir):
        if not isinstance(p, str) or not os.path.isabs(p) or os.path.normpath(p) != p:
            raise AgentError('paths must be absolute')
    if not isinstance(service, str) or not _SERVICE.fullmatch(service):
        raise AgentError('invalid serviceName')
    interval = cfg.get('intervalSeconds', 60)
    min_restart = cfg.get('minRestartIntervalSeconds', 30)
    if not isinstance(interval, int) or not 15 <= interval <= 3600 or not isinstance(min_restart, int) or not 0 <= min_restart <= 3600:
        raise AgentError('invalid intervals')
    return {'mainUrl': url.rstrip('/'), 'token': token, 'syncKey': key.lower(), 'credentialsPath': creds,
            'stateDir': state_dir, 'serviceName': service, 'intervalSeconds': interval,
            'minRestartIntervalSeconds': min_restart}


def usernames_digest(usernames):
    return hashlib.sha256('\n'.join(sorted(usernames)).encode('utf-8')).hexdigest()


def open_state(sealed, key_hex, now_ms, last_serial):
    """Decrypt + validate a desired state. Raises AgentError (no secrets in text)."""
    try:
        raw = decrypt_bundle(key_hex, sealed, aad=AAD, max_ciphertext=200000)
    except VerificationError:
        raise AgentError('desired state failed authentication') from None
    try:
        doc = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        raise AgentError('desired state is not JSON') from None
    if not isinstance(doc, dict) or doc.get('v') != 1:
        raise AgentError('unsupported desired state version')
    serial, issued, expires, users = doc.get('serial'), doc.get('issuedAt'), doc.get('expiresAt'), doc.get('users')
    if not all(isinstance(x, int) and not isinstance(x, bool) and x > 0 for x in (serial, issued, expires)) or expires <= issued:
        raise AgentError('invalid desired state timestamps')
    if issued - CLOCK_SKEW_MS > now_ms or now_ms > expires + CLOCK_SKEW_MS:
        raise AgentError('desired state is stale or from the future (check clocks)')
    if serial < last_serial:
        raise AgentError('desired state older than applied one (replay?)')
    if not isinstance(users, list) or len(users) > MAX_USERS:
        raise AgentError('invalid user list')
    out, names = [], set()
    for u in users:
        if not isinstance(u, dict) or set(u) != {'username', 'password'}:
            raise AgentError('invalid user entry')
        name, password = u['username'], u['password']
        if not isinstance(name, str) or not isinstance(password, str) or not _USER.fullmatch(name) or not _PASSWORD.fullmatch(password) or name in names:
            raise AgentError('invalid user entry')
        names.add(name)
        out.append(ManagedCredential(name, password))
    return serial, out


class Agent:
    def __init__(self, cfg, http=None, systemctl=None, clock=None, sleep=None):
        self.cfg = cfg
        self.http = http or self._http
        self.systemctl = systemctl or self._systemctl
        self.clock = clock or time.time
        self.sleep = sleep or time.sleep
        self.state_path = os.path.join(cfg['stateDir'], 'state.json')
        self.state = {'lastSerial': 0, 'pendingAck': None, 'lastRestart': 0}

    # ---- I/O adapters (replaced in tests) ----
    def _http(self, body):
        req = urllib.request.Request(self.cfg['mainUrl'] + '/api/internal/trusttunnel/sync', data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + self.cfg['token'], 'Content-Type': 'application/json',
                                              'User-Agent': 'trioz-tt-sync/1'})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read(MAX_RESPONSE + 1)
                if len(data) > MAX_RESPONSE:
                    raise AgentError('response too large')
                return resp.status, data
        except urllib.error.HTTPError as e:
            return e.code, b''
        except (urllib.error.URLError, OSError, TimeoutError):
            raise AgentError('main server unreachable') from None

    def _systemctl(self, *args):
        r = subprocess.run(['systemctl', *args], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=60, check=False)
        return r.returncode

    # ---- state ----
    def ensure_state_dir(self):
        d = self.cfg['stateDir']
        os.makedirs(d, mode=0o700, exist_ok=True)
        st = os.lstat(d)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) & 0o077:
            raise AgentError('unsafe state directory')

    def load_state(self):
        try:
            data = json.loads(_read_protected(self.state_path, (0o600,)).decode('utf-8'))
            if isinstance(data, dict) and isinstance(data.get('lastSerial'), int):
                self.state.update({k: data.get(k, self.state[k]) for k in self.state})
        except FileNotFoundError:
            pass
        except (OSError, ValueError, AgentError):
            log('state file unreadable; starting from serial 0')

    def save_state(self):
        tmp = self.state_path + '.tmp'
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, json.dumps(self.state).encode('utf-8'))
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, self.state_path)

    # ---- one cycle ----
    def cycle(self):
        body = json.dumps({'ack': self.state['pendingAck']}).encode('utf-8')
        status, data = self.http(body)
        if status == 401:
            raise AgentError('main server rejected agent token')
        if status != 200:
            raise AgentError('main server returned HTTP %d; keeping current credentials' % status)
        self.state['pendingAck'] = None
        try:
            sealed = json.loads(data.decode('utf-8'))['sealed']
        except (UnicodeDecodeError, ValueError, KeyError, TypeError):
            raise AgentError('invalid response from main server') from None
        serial, desired = open_state(sealed, self.cfg['syncKey'], int(self.clock() * 1000), self.state['lastSerial'])
        digest = usernames_digest([c.username for c in desired])
        try:
            changed = self.apply(desired)
        except AgentError as e:
            self.state['pendingAck'] = {'serial': serial, 'ok': False, 'digest': digest, 'error': str(e)[:120]}
            raise
        self.state['lastSerial'] = serial
        self.state['pendingAck'] = {'serial': serial, 'ok': True, 'digest': digest, 'error': None}
        if changed:
            log('applied %d managed credential(s), endpoint restarted' % len(desired))
        return changed

    def apply(self, desired):
        path = self.cfg['credentialsPath']
        try:
            current = _read_protected(path, (0o400, 0o440, 0o600, 0o640), 4 * 1024 * 1024)
            new = render_credentials(current.decode('utf-8'), desired).encode('utf-8')
        except (OSError, UnicodeDecodeError):
            raise AgentError('cannot read credentials file') from None
        except CredentialFileError as e:
            raise AgentError('credentials file rejected: %s' % e) from None
        if new == current:
            return False
        wait = self.state['lastRestart'] + self.cfg['minRestartIntervalSeconds'] - self.clock()
        if wait > 0:
            self.sleep(wait)
        old_digest = hashlib.sha256(current).hexdigest()
        try:
            replace_if_unchanged(path, old_digest, new)
        except StoreError as e:
            raise AgentError('credentials write failed: %s' % e) from None
        self.state['lastRestart'] = self.clock()
        if self.restart_ok():
            return True
        # Roll back to the previous credentials and bring the endpoint back.
        try:
            replace_if_unchanged(path, hashlib.sha256(new).hexdigest(), current)
        except StoreError:
            raise AgentError('endpoint failed after apply AND rollback failed; manual check required') from None
        if not self.restart_ok():
            raise AgentError('endpoint failed after apply and after rollback; manual check required')
        raise AgentError('endpoint failed after apply; previous credentials restored')

    def restart_ok(self):
        svc = self.cfg['serviceName']
        if self.systemctl('restart', svc) != 0:
            return False
        for _ in range(10):
            self.sleep(1)
            if self.systemctl('is-active', '--quiet', svc) == 0:
                # still active a moment later = did not crash on the new file
                self.sleep(2)
                return self.systemctl('is-active', '--quiet', svc) == 0
        return False

    def run(self, once=False):
        self.ensure_state_dir()
        lock = os.open(os.path.join(self.cfg['stateDir'], 'agent.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AgentError('another agent instance is running') from None
        self.load_state()
        while True:
            ok = True
            try:
                self.cycle()
            except AgentError as e:
                ok = False
                log('sync error: %s' % e)
            finally:
                try:
                    self.save_state()
                except OSError:
                    log('cannot save agent state')
            if once:
                return ok
            self.sleep(self.cfg['intervalSeconds'])


def main(argv=None):
    p = argparse.ArgumentParser(description='TrioZ TrustTunnel credentials sync agent')
    p.add_argument('--config', default='/etc/trioz/trusttunnel-sync.json')
    p.add_argument('--once', action='store_true', help='one cycle, exit code 0 on success')
    a = p.parse_args(argv)
    if os.geteuid() != 0:
        log('must run as root (owner of credentials.toml)')
        return 2
    try:
        return 0 if Agent(load_config(a.config)).run(once=a.once) else 1
    except AgentError as e:
        log('fatal: %s' % e)
        return 1


if __name__ == '__main__':
    sys.exit(main())
