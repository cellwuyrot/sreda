"""Pure, fail-closed TrustTunnel 1.1.0 credential-file preparation.

NO file/network/service operations. The caller must independently protect,
validate and deploy the output. This module is not connected to TrioZ yet.
Passwords must never be logged, placed on command lines, or committed.
"""
from dataclasses import dataclass, field
import json
import re
import secrets
try:
    import tomllib
except ModuleNotFoundError:
    import trusttunnel_vendor_tomli as tomllib
from typing import Iterable

_BEGIN = '# BEGIN TRIOZ MANAGED CREDENTIALS v1'
_END = '# END TRIOZ MANAGED CREDENTIALS v1'
_USER = re.compile(r'trioz_[a-f0-9]{32}\Z')
_PASSWORD = re.compile(r'[A-Za-z0-9_-]{43}\Z')

class CredentialFileError(ValueError):
    """Messages deliberately contain no credentials."""

@dataclass(frozen=True)
class ManagedCredential:
    username: str
    password: str = field(repr=False)


def new_managed_credential() -> ManagedCredential:
    """Generate a random opaque username and a 256-bit URL-safe password."""
    return ManagedCredential('trioz_' + secrets.token_hex(16), secrets.token_urlsafe(32))


def _parse(text: str) -> dict:
    try:
        return tomllib.loads(text)
    except (tomllib.TOMLDecodeError, TypeError):
        raise CredentialFileError('Invalid credential TOML') from None


def _clients(document: dict) -> list:
    clients = document.get('client', [])
    if not isinstance(clients, list) or any(not isinstance(c, dict) for c in clients):
        raise CredentialFileError('Invalid client list')
    return clients


def _validate_managed(c: ManagedCredential) -> None:
    if not isinstance(c, ManagedCredential) or not isinstance(c.username, str) or not isinstance(c.password, str):
        raise CredentialFileError('Invalid managed credential type')
    if not _USER.fullmatch(c.username) or not _PASSWORD.fullmatch(c.password):
        raise CredentialFileError('Invalid managed credential format')


def _check_unmanaged(clients: list) -> set[str]:
    seen = set()
    for c in clients:
        u, p = c.get('username'), c.get('password')
        if not isinstance(u, str) or not u or not isinstance(p, str) or not p:
            raise CredentialFileError('Invalid existing client')
        if u in seen:
            raise CredentialFileError('Duplicate existing username')
        seen.add(u)
    return seen


def render_credentials(current: str, desired: Iterable[ManagedCredential]) -> str:
    """Return TOML for a COMPLETE managed snapshot; no real file is touched.

    Missing managed clients are removed from returned text. Invalid inputs,
    malformed markers, and conflicts with existing users are rejected.
    """
    if not isinstance(current, str):
        raise CredentialFileError('Credential input must be text')
    _clients(_parse(current))
    lines = current.splitlines(keepends=True)
    begins = [i for i, line in enumerate(lines) if line.rstrip('\r\n') == _BEGIN]
    ends = [i for i, line in enumerate(lines) if line.rstrip('\r\n') == _END]
    if len(begins) != len(ends) or len(begins) > 1:
        raise CredentialFileError('Invalid managed markers')
    if begins:
        start, stop = begins[0], ends[0]
        if start >= stop or ''.join(lines[stop + 1:]).strip():
            raise CredentialFileError('Invalid managed section placement')
        managed_doc = _parse(''.join(lines[start + 1:stop]))
        if set(managed_doc) - {'client'}:
            raise CredentialFileError('Unexpected managed section content')
        managed_names = set()
        for c in _clients(managed_doc):
            if set(c) != {'username', 'password'}:
                raise CredentialFileError('Invalid managed section client')
            entry = ManagedCredential(c['username'], c['password'])
            _validate_managed(entry)
            if entry.username in managed_names:
                raise CredentialFileError('Duplicate managed username')
            managed_names.add(entry.username)
        base = ''.join(lines[:start] + lines[stop + 1:])
    else:
        base = current
    unmanaged_names = _check_unmanaged(_clients(_parse(base)))
    entries = list(desired)
    names = set()
    for entry in entries:
        _validate_managed(entry)
        if entry.username in names or entry.username in unmanaged_names:
            raise CredentialFileError('Conflicting username')
        names.add(entry.username)
    if not entries:
        return base
    prefix = base if not base or base.endswith('\n') else base + '\n'
    block = [_BEGIN + '\n']
    for entry in sorted(entries, key=lambda item: item.username):
        block.extend(['[[client]]\n', 'username = ' + json.dumps(entry.username) + '\n',
                      'password = ' + json.dumps(entry.password) + '\n'])
    block.append(_END + '\n')
    result = prefix + ''.join(block)
    _parse(result)
    return result
