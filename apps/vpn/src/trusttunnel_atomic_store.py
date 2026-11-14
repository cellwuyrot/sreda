"""Local Linux-only CAS writer for a credentials file, not wired to the service.

Caller owns authentication, directory trust, backups, service restart/recovery and
secret distribution. Uses cooperative locking and rejects symlinks and unsafe
permissions. Never logs contents. Uses stdlib tomllib on Python 3.11+ or bundled Tomli on 3.10.
"""
import fcntl
import hashlib
import os
import secrets
import stat
try:
    import tomllib
except ModuleNotFoundError:
    import trusttunnel_vendor_tomli as tomllib
from pathlib import Path

class StoreError(RuntimeError):
    pass

class StoreCommitUncertain(StoreError):
    """Rename succeeded but persistence could not be verified; inspect before retry."""
    pass

def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def replace_if_unchanged(path: str, expected_digest: str, replacement: bytes) -> bool:
    """Atomically replace a file owned by this process after a SHA-256 CAS.

    Returns False on no change. Does not create backups or reload Endpoint.
    On failure raises a non-sensitive StoreError or OSError. Call only with a
    trusted absolute local path and a protected directory. All cooperating
    writers MUST take this same lock; external editors can violate this contract.
    """
    if not isinstance(path, str) or not os.path.isabs(path):
        raise StoreError('Absolute path required')
    if not isinstance(expected_digest, str) or len(expected_digest) != 64 or any(c not in '0123456789abcdef' for c in expected_digest):
        raise StoreError('Invalid expected digest')
    if not isinstance(replacement, bytes) or len(replacement) > 4 * 1024 * 1024:
        raise StoreError('Invalid replacement')
    try:
        document = tomllib.loads(replacement.decode('utf-8'))
        clients = document.get('client')
        if not isinstance(clients, list) or not clients:
            raise ValueError()
        names = set()
        for client in clients:
            if not isinstance(client, dict) or not isinstance(client.get('username'), str) or not client['username'] or not isinstance(client.get('password'), str) or not client['password'] or client['username'] in names:
                raise ValueError()
            names.add(client['username'])
    except (UnicodeDecodeError, tomllib.TOMLDecodeError, ValueError):
        raise StoreError('Invalid replacement TOML') from None
    p = Path(path)
    name = p.name
    if name in ('', '.', '..'):
        raise StoreError('Invalid file name')
    directory = os.open(str(p.parent), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock = None
    tmp = None
    try:
        folder = os.fstat(directory)
        if folder.st_uid != os.geteuid() or (stat.S_IMODE(folder.st_mode) & 0o022):
            raise StoreError('Unsafe credential directory')
        lock = os.open('.trioz-credentials.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                       0o600, dir_fd=directory)
        lock_stat = os.fstat(lock)
        if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_nlink != 1 or lock_stat.st_uid != os.geteuid() or stat.S_IMODE(lock_stat.st_mode) != 0o600:
            raise StoreError('Unsafe lock file')
        fcntl.flock(lock, fcntl.LOCK_EX)
        source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        try:
            before = os.fstat(source)
            mode = stat.S_IMODE(before.st_mode)
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.geteuid()
                    or mode not in (0o400, 0o440, 0o600, 0o640) or before.st_size > 4 * 1024 * 1024):
                raise StoreError('Unsafe credentials file')
            with os.fdopen(source, 'rb', closefd=False) as stream:
                current = stream.read(4 * 1024 * 1024 + 1)
            if len(current) > 4 * 1024 * 1024 or _digest(current) != expected_digest:
                raise StoreError('Credentials changed; retry with fresh snapshot')
            if replacement == current:
                return False
            tmp = '.trioz-credentials-' + secrets.token_hex(16)
            out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                os.fchown(out, before.st_uid, before.st_gid)
                os.fchmod(out, mode)
                with os.fdopen(out, 'wb', closefd=False) as stream:
                    stream.write(replacement)
                    stream.flush()
                os.fsync(out)
            finally:
                os.close(out)
            now = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if (now.st_dev, now.st_ino, now.st_size, now.st_mtime_ns) != (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
                raise StoreError('Credentials changed while preparing update')
            os.rename(tmp, name, src_dir_fd=directory, dst_dir_fd=directory)
            tmp = None
            try:
                os.fsync(directory)
            except OSError:
                raise StoreCommitUncertain("Replacement occurred; durability uncertain") from None
            return True
        finally:
            os.close(source)
    finally:
        if tmp is not None:
            try: os.unlink(tmp, dir_fd=directory)
            except FileNotFoundError: pass
        if lock is not None: os.close(lock)
        os.close(directory)
