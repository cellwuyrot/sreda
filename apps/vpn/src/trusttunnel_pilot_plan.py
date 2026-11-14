"""Prepare a consistent pilot credential snapshot entirely in memory.

This is a library, not a deployment tool. Neither file writes nor service
reloads nor network calls are performed. Protect both returned values as
secrets. Operators must independently authorize every project ADMIN and
reconcile endpoint activation with profile delivery before pilot use.
"""
from dataclasses import dataclass, field
import hashlib
import ipaddress
import json
import re
from typing import Callable, Iterable

from trusttunnel_credentials import ManagedCredential, new_managed_credential, render_credentials, CredentialFileError

_ID = re.compile(r'[A-Za-z0-9_-]{1,128}\Z')
_HOST = re.compile(r'(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z')
_USER = re.compile(r'trioz_[a-f0-9]{32}\Z')
_PASSWORD = re.compile(r'[A-Za-z0-9_-]{43}\Z')

class PilotPlanError(ValueError):
    """Never includes input values or secrets."""

@dataclass(frozen=True)
class PilotAccount:
    account_id: str
    credential: ManagedCredential = field(repr=False)

@dataclass(frozen=True)
class PilotPlan:
    original_sha256: str
    endpoint_credentials: str = field(repr=False)
    # JSON includes plaintext credentials: send directly to a protected sealer,
    # never print, log, commit, or expose it to chat.
    sealer_input: str = field(repr=False)
    accounts: tuple[PilotAccount, ...] = field(repr=False)
    added_count: int
    removed_count: int


def prepare_pilot_plan(current: str, previous: Iterable[PilotAccount], desired_admin_ids: Iterable[str],
                       hostname: str, gateway_ipv4: str, port: int, *,
                       generator: Callable[[], ManagedCredential] = new_managed_credential) -> PilotPlan:
    """Plan a complete snapshot; retained accounts keep their original credentials.

    `previous` is the trusted, complete mapping used for the current endpoint.
    Canonical equality check refuses unrecognized or manually edited managed
    sections: never silently remove accounts not present in this mapping.
    Empty desired set generates a deprovision plan (there is no bundle to seal).
    Use only in a controlled offline flow; role checks and deploy are separate.
    """
    try:
        if not isinstance(current, str) or len(current.encode('utf8')) > 4 * 1024 * 1024:
            raise PilotPlanError('Invalid current credentials')
        if not isinstance(hostname, str) or not _HOST.fullmatch(hostname):
            raise PilotPlanError('Invalid endpoint')
        if not isinstance(gateway_ipv4, str) or str(ipaddress.IPv4Address(gateway_ipv4)) != gateway_ipv4:
            raise PilotPlanError('Invalid endpoint')
        if type(port) is not int or not 1 <= port <= 65535:
            raise PilotPlanError('Invalid endpoint')
        prev, desired = list(previous), list(desired_admin_ids)
        if len(prev) > 100 or len(desired) > 100:
            raise PilotPlanError('Too many accounts')
        if any(not isinstance(x, str) or not _ID.fullmatch(x) for x in desired) or len(set(desired)) != len(desired):
            raise PilotPlanError('Invalid account list')
        old = {}
        names, passwords = set(), set()
        for record in prev:
            if not isinstance(record, PilotAccount) or not isinstance(record.account_id, str) or not _ID.fullmatch(record.account_id) or record.account_id in old:
                raise PilotPlanError('Invalid previous mapping')
            c = record.credential
            if not isinstance(c, ManagedCredential) or not isinstance(c.username, str) or not _USER.fullmatch(c.username) or not isinstance(c.password, str) or not _PASSWORD.fullmatch(c.password) or c.username in names or c.password in passwords:
                raise PilotPlanError('Invalid previous mapping')
            old[record.account_id] = c; names.add(c.username); passwords.add(c.password)
        if render_credentials(current, old.values()) != current:
            raise PilotPlanError('Current file does not match mapping')
        records = []
        # A complete replacement snapshot; preserve existing pairs for retained accounts.
        for account_id in sorted(desired):
            if account_id in old:
                c = old[account_id]
            else:
                c = generator()
                if not isinstance(c, ManagedCredential) or not isinstance(c.username, str) or not _USER.fullmatch(c.username) or not isinstance(c.password, str) or not _PASSWORD.fullmatch(c.password) or c.username in names or c.password in passwords:
                    raise PilotPlanError('Invalid generated credential')
                names.add(c.username); passwords.add(c.password)
            records.append(PilotAccount(account_id, c))
        endpoint = render_credentials(current, (r.credential for r in records))
        payload = {'accounts': [{'accountId': r.account_id, 'hostname': hostname,
                    'gatewayIpv4': gateway_ipv4, 'port': port, 'username': r.credential.username,
                    'password': r.credential.password} for r in records]}
        return PilotPlan(hashlib.sha256(current.encode('utf8')).hexdigest(), endpoint,
                         json.dumps(payload, ensure_ascii=True, separators=(',', ':')),
                         tuple(records), len(set(desired) - old.keys()), len(old.keys() - set(desired)))
    except (CredentialFileError, ValueError, TypeError, UnicodeError):
        raise PilotPlanError('Pilot snapshot is invalid or inconsistent') from None
