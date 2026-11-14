"""Crash-recoverable local credential transaction; no network or systemd dependency.

The caller must close remote issuance before apply/recovery, provide a trusted,
owner-only state directory, serialize all other credential writers and implement
service restart/checking. This module cannot provide a transaction across hosts.
The state directory contains plaintext credential backups: keep it protected.
"""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat

from trusttunnel_atomic_store import replace_if_unchanged, StoreCommitUncertain

MAX_SIZE = 4 * 1024 * 1024
class TransactionError(RuntimeError): pass
class RecoveryRequired(TransactionError): pass
class RolledBack(TransactionError): pass

def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def protected_read(path: Path, modes: tuple[int, ...], limit: int = MAX_SIZE) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.geteuid() or s.st_nlink != 1 or stat.S_IMODE(s.st_mode) not in modes or s.st_size > limit:
            raise TransactionError('Unsafe file')
        data = b''
        while len(data) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(data)))
            if not chunk: break
            data += chunk
        if len(data) > limit: raise TransactionError('File too large')
        return data
    finally: os.close(fd)

def ensure_private_dir(path: Path) -> None:
    if not path.is_absolute(): raise TransactionError('Absolute directory required')
    st = os.lstat(path)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise TransactionError('Unsafe transaction directory')

def write_new(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as out:
            out.write(data); out.flush(); os.fsync(fd)
    finally: os.close(fd)

def fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try: os.fsync(fd)
    finally: os.close(fd)

def save_metadata(tx: Path, metadata: dict, *, first: bool = False) -> None:
    data = (json.dumps(metadata, sort_keys=True, separators=(',', ':')) + '\n').encode()
    if first:
        write_new(tx / 'transaction.json', data)
    else:
        name = tx / ('.meta-' + secrets.token_hex(12))
        try:
            write_new(name, data)
            os.replace(name, tx / 'transaction.json')
        finally:
            try: name.unlink()
            except FileNotFoundError: pass
    fsync_dir(tx)

def read_metadata(tx: Path) -> dict:
    ensure_private_dir(tx)
    try:
        meta = json.loads(protected_read(tx / 'transaction.json', (0o600,), 4096))
        if not isinstance(meta, dict) or set(meta) != {'version','old_sha256','new_sha256','state'} or meta['version'] != 1 or meta['state'] not in ('prepared','committed','rolled_back'):
            raise ValueError()
        for key in ('old_sha256','new_sha256'):
            value = meta[key]
            if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value): raise ValueError()
        return meta
    except (ValueError, UnicodeError, OSError): raise RecoveryRequired('Invalid transaction metadata') from None

class PilotTransaction:
    """One cooperative lock guards scans, apply and recovery in state_dir.

    `restart` is a callable returning True only when the previously active
    service was restarted and locally observed active. It must not log secrets.
    The caller is responsible for checking that the service was already active.
    """
    def __init__(self, credentials_path: str, state_dir: str):
        self.path = Path(credentials_path); self.state = Path(state_dir)
        if not self.path.is_absolute(): raise TransactionError('Absolute credentials path required')
        ensure_private_dir(self.state)
        lock_path = self.state / '.pilot-transaction.lock'
        self.fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            s = os.fstat(self.fd)
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) != 0o600:
                raise TransactionError('Unsafe lock')
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(self.fd); raise

    def close(self):
        if self.fd is not None: os.close(self.fd); self.fd = None
    def __enter__(self): return self
    def __exit__(self, *_): self.close()

    def unresolved(self) -> list[Path]:
        result = []
        for entry in self.state.iterdir():
            if not entry.name.startswith('txn-'): continue
            # A transaction directory without metadata may be an interrupted
            # preparation; never delete it or guess automatically.
            try: meta = read_metadata(entry)
            except (OSError, TransactionError): result.append(entry); continue
            if meta['state'] == 'prepared': result.append(entry)
        return sorted(result)

    def apply(self, expected_digest: str, replacement: bytes, restart) -> Path:
        if self.unresolved(): raise RecoveryRequired('Unresolved transaction exists')
        old = protected_read(self.path, (0o400,0o440,0o600,0o640))
        if digest(old) != expected_digest: raise TransactionError('Credentials changed since staging')
        # Creating and fsyncing the backup and journal before replacement makes
        # both pre- and post-rename interruption recoverable by checksum.
        tx = self.state / ('txn-' + secrets.token_hex(16))
        tx.mkdir(mode=0o700); fsync_dir(self.state)
        write_new(tx / 'before.toml', old)
        meta = {'version':1, 'old_sha256':digest(old), 'new_sha256':digest(replacement), 'state':'prepared'}
        save_metadata(tx, meta, first=True)
        try:
            changed = replace_if_unchanged(str(self.path), expected_digest, replacement)
        except StoreCommitUncertain: raise RecoveryRequired('Commit outcome uncertain; recover before retry') from None
        except Exception:
            # File may not have changed, but preserve the journal until recovery.
            raise RecoveryRequired('Apply interrupted or rejected; recover before retry') from None
        if not changed:
            meta['state'] = 'committed'; save_metadata(tx, meta)
            return tx
        try: ok = restart()
        except Exception: raise RecoveryRequired('Service outcome uncertain; recover before retry') from None
        if not ok:
            self._recover(tx, meta, restart)
            raise RolledBack('Service failed; old credentials restored and service restarted')
        try:
            meta['state'] = 'committed'; save_metadata(tx, meta)
        except Exception: raise RecoveryRequired('Commit journal uncertain; inspect and recover') from None
        return tx

    def recover(self, tx: Path, restart) -> None:
        if tx.parent != self.state or not tx.name.startswith('txn-'): raise TransactionError('Invalid transaction')
        meta = read_metadata(tx)
        if meta['state'] != 'prepared': raise TransactionError('Transaction does not need recovery')
        self._recover(tx, meta, restart)

    def _recover(self, tx: Path, meta: dict, restart) -> None:
        old = protected_read(tx / 'before.toml', (0o600,))
        if digest(old) != meta['old_sha256']: raise RecoveryRequired('Backup mismatch')
        current = protected_read(self.path, (0o400,0o440,0o600,0o640))
        current_hash = digest(current)
        if current_hash not in (meta['old_sha256'], meta['new_sha256']):
            raise RecoveryRequired('Credentials changed externally; manual investigation required')
        if current_hash == meta['new_sha256'] and current_hash != meta['old_sha256']:
            try: replace_if_unchanged(str(self.path), meta['new_sha256'], old)
            except Exception: raise RecoveryRequired('Rollback outcome uncertain') from None
        # Restart even when file was already old: crash may have occurred after
        # restoring the file but before the previous process restarted.
        try: ok = restart()
        except Exception: raise RecoveryRequired('Service outcome uncertain') from None
        if not ok: raise RecoveryRequired('Backup restored but service recovery failed')
        try:
            meta['state'] = 'rolled_back'; save_metadata(tx, meta)
        except Exception: raise RecoveryRequired('Recovery journal uncertain') from None
