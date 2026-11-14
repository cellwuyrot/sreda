#!/usr/bin/env python3
"""Experimental VDS endpoint apply/recovery; no remote issuance orchestration.

Never run until connect issuance is stopped, reviewed and independently confirmed.
Creates secret backups, atomically replaces credentials and restarts the one
TrustTunnel systemd service. Restart may interrupt active connections.
"""
import argparse
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import tomllib

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/vpn/src'))
from trusttunnel_pilot_transaction import PilotTransaction, RecoveryRequired, RolledBack, protected_read, ensure_private_dir
from trusttunnel_pilot_stage_verify import verify_stage

UNIT='trusttunnel.service'
CONFIG=Path('/etc/trusttunnel/vpn.toml')
CREDS=Path('/etc/trusttunnel/credentials.toml')
class ApplyError(Exception): pass

def trusted_ancestors(path):
    """Reject symlink or untrusted writable ancestors, including '/' itself."""
    path=Path(path)
    if not path.is_absolute() or os.path.normpath(str(path)) != str(path): raise ApplyError()
    current=path
    while True:
        st=os.lstat(current)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or (stat.S_IMODE(st.st_mode) & 0o022): raise ApplyError()
        if current == current.parent: break
        current=current.parent

def run_systemctl(*args, timeout=45):
    return subprocess.run(['/usr/bin/systemctl',*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
        env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','SYSTEMD_PAGER':'cat','LC_ALL':'C'},timeout=timeout,check=False)

def check_unit_output(text):
    fields={}
    for line in text.splitlines():
        if '=' not in line: raise ApplyError()
        k,v=line.split('=',1)
        if k in fields: raise ApplyError()
        fields[k]=v
    if fields.get('User')!='trusttunnel' or fields.get('Group')!='trusttunnel' or fields.get('WorkingDirectory')!='/etc/trusttunnel': raise ApplyError()
    cmd=fields.get('ExecStart','')
    # Refuse unknown overrides, shell wrappers, extra args, or multiple commands.
    if not re.search(r'\bpath=/opt/trusttunnel/trusttunnel_endpoint\s*;',cmd): raise ApplyError()
    if not re.search(r'\bargv\[\]=/opt/trusttunnel/trusttunnel_endpoint /etc/trusttunnel/vpn\.toml /etc/trusttunnel/hosts\.toml\s*;',cmd): raise ApplyError()
    if cmd.count('argv[]=')!=1 or cmd.count('path=')!=1: raise ApplyError()

def check_endpoint():
    trusted_ancestors(CONFIG.parent)
    data=tomllib.loads(protected_read(CONFIG,(0o400,0o440,0o600,0o640)).decode('utf8'))
    raw=data.get('credentials_file')
    if not isinstance(raw,str) or not raw: raise ApplyError()
    target=Path(raw) if raw.startswith('/') else CONFIG.parent / raw
    if os.path.normpath(str(target)) != str(CREDS): raise ApplyError()
    result=run_systemctl('show', UNIT, '-p','User','-p','Group','-p','WorkingDirectory','-p','ExecStart')
    if result.returncode: raise ApplyError()
    check_unit_output(result.stdout.decode('utf8'))

def active():
    return run_systemctl('is-active','--quiet',UNIT,timeout=15).returncode == 0

def restart_checked():
    result=run_systemctl('restart',UNIT,timeout=60)
    if result.returncode != 0: return False
    if not active(): return False
    time.sleep(2)
    return active()  # Only systemd state, not a VPN connectivity test.

def is_root(): return os.geteuid() == 0

def main():
    parser=argparse.ArgumentParser(description='Experimental controlled TrustTunnel credentials transaction')
    parser.add_argument('action',choices=['inspect','apply','recover'])
    parser.add_argument('--state-dir',required=True)
    parser.add_argument('--stage-dir')
    parser.add_argument('--transaction-dir')
    parser.add_argument('--confirm-issuance-closed',action='store_true')
    parser.add_argument('--confirm-restart',action='store_true')
    args=parser.parse_args()
    try:
        if not is_root(): raise ApplyError()
        state=Path(args.state_dir); trusted_ancestors(state); ensure_private_dir(state)
        check_endpoint()
        with PilotTransaction(str(CREDS),str(state)) as transaction:
            if args.action == 'inspect':
                pending=transaction.unresolved()
                print('Unresolved transactions:',len(pending))
                for p in pending: print('Pending:',p)
                print('Endpoint active:',active())
                return 0
            if not args.confirm_issuance_closed or not args.confirm_restart: raise ApplyError()
            if args.action=='apply':
                if not args.stage_dir or args.transaction_dir or not active(): raise ApplyError()
                folder=Path(args.stage_dir); trusted_ancestors(folder); ensure_private_dir(folder)
                digest,replacement=verify_stage(str(folder))
                tx=transaction.apply(digest,replacement,restart_checked)
                print('Applied. Transaction backup:',tx)
                print('Local systemd state was checked; connectivity was not tested.')
            else:
                if args.stage_dir or not args.transaction_dir: raise ApplyError()
                tx=Path(args.transaction_dir)
                if not tx.is_absolute() or tx.parent != state: raise ApplyError()
                transaction.recover(tx,restart_checked)
                print('Recovered. Check remote issuance remains disabled.')
        return 0
    except RolledBack:
        print('Apply failed. Backup restored and service restarted; issuance must remain closed.',file=sys.stderr); return 2
    except RecoveryRequired:
        print('Recovery required. Do not retry or enable issuance; inspect transaction and service locally.',file=sys.stderr); return 3
    except Exception:
        print('Operation refused. Verify paths, permissions, unit and staging locally; no secrets were printed.',file=sys.stderr); return 1
if __name__=='__main__': raise SystemExit(main())
