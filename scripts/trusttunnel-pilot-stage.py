#!/usr/bin/env python3
"""Experimental offline staging only; never changes the live endpoint.

Run only as a trusted operator in a controlled, owner-only directory. Both the
staged TOML and mapping contain plaintext passwords. Bundle and key are secrets.
This program does NOT authenticate account IDs or deploy, restart or revoke.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/vpn/src'))
from trusttunnel_credentials import ManagedCredential
from trusttunnel_pilot_plan import PilotAccount, prepare_pilot_plan

class StageError(Exception): pass

def read_protected(path, modes, maxsize=4*1024*1024):
    if not os.path.isabs(path): raise StageError()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.geteuid() or s.st_nlink != 1 or stat.S_IMODE(s.st_mode) not in modes or s.st_size > maxsize:
            raise StageError()
        with os.fdopen(fd, 'rb', closefd=False) as f: data = f.read(maxsize + 1)
        if len(data) > maxsize: raise StageError()
        return data.decode('utf8')
    finally: os.close(fd)

def previous_mapping(text):
    doc = json.loads(text)
    if not isinstance(doc, dict) or set(doc) != {'accounts'} or not isinstance(doc['accounts'], list): raise StageError()
    result = []
    for row in doc['accounts']:
        if not isinstance(row, dict) or set(row) != {'accountId','hostname','gatewayIpv4','port','username','password'}: raise StageError()
        result.append(PilotAccount(row['accountId'], ManagedCredential(row['username'], row['password'])))
    return result

def secure_write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as f:
            f.write(data); f.flush(); os.fsync(fd)
    finally: os.close(fd)

def stage(args, admin_ids):
    parent = Path(args.stage_parent)
    if not parent.is_absolute(): raise StageError()
    st = os.lstat(parent)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) & 0o077: raise StageError()
    current = read_protected(args.credentials, {0o400,0o440,0o600,0o640})
    prev = previous_mapping(read_protected(args.previous_mapping, {0o400,0o600}, 48000)) if args.previous_mapping else []
    plan = prepare_pilot_plan(current, prev, admin_ids, args.hostname, args.gateway_ipv4, args.port)
    folder = Path(tempfile.mkdtemp(prefix='trioz-pilot-', dir=str(parent)))
    try:
        secure_write(folder/'endpoint.credentials.toml', plan.endpoint_credentials.encode('utf8'))
        secure_write(folder/'pilot-mapping.json', plan.sealer_input.encode('utf8'))
        # A zero-account deprovisioning plan cannot be sealed; it must close
        # issuance and remove the existing deployed bundle by a separate process.
        if plan.accounts:
            child = subprocess.run(['node', str(ROOT/'scripts/trusttunnel-pilot-seal.mjs'), str(folder)], input=plan.sealer_input.encode('utf8'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            if child.returncode != 0: raise StageError()
            key = read_protected(str(folder/'pilot-key.txt'), {0o600}, 128).strip()
            bundle = read_protected(str(folder/'pilot-bundle.txt'), {0o600}, 65536).strip()
            # This combined file is as sensitive as plaintext credentials.
            secure_write(folder/'pilot-server-secret.json', (json.dumps({'key':key,'bundle':bundle}, separators=(',',':'))+'\n').encode())
        meta = {'version': 1, 'original_sha256': plan.original_sha256, 'added': plan.added_count, 'removed': plan.removed_count, 'accounts': len(plan.accounts), 'deprovision': not bool(plan.accounts)}
        secure_write(folder/'stage.json', (json.dumps(meta, separators=(',',':'))+'\n').encode())
        fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
        return folder
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise

def main():
    parser = argparse.ArgumentParser(description='Offline pilot staging only; no live changes')
    parser.add_argument('--credentials', required=True); parser.add_argument('--stage-parent', required=True)
    parser.add_argument('--previous-mapping'); parser.add_argument('--hostname', required=True)
    parser.add_argument('--gateway-ipv4', required=True); parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    try:
        if sys.stdin.isatty(): raise StageError()
        data = sys.stdin.buffer.read(16385)
        if len(data) > 16384: raise StageError()
        ids = json.loads(data)
        if not isinstance(ids, list): raise StageError()
        folder = stage(args, ids)
        print('Prepared protected staging directory:', folder)
        print('Not deployed. No service or network changes were made.')
    except Exception:
        print('Staging failed: invalid, inconsistent or unsafe input.', file=sys.stderr)
        return 1
    return 0
if __name__ == '__main__': raise SystemExit(main())
