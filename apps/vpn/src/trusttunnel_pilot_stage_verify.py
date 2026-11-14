"""Validate staged snapshot coherence, without touching the live endpoint."""
import json
from pathlib import Path
from trusttunnel_pilot_gcm import decrypt_bundle
from trusttunnel_credentials import ManagedCredential
from trusttunnel_pilot_plan import PilotAccount, prepare_pilot_plan
from trusttunnel_pilot_transaction import protected_read, ensure_private_dir, TransactionError

class StageVerificationError(TransactionError): pass

def verify_stage(path: str) -> tuple[str, bytes]:
    """Returns old digest and new secret TOML; does not log or persist either."""
    try:
        folder=Path(path); ensure_private_dir(folder)
        meta=json.loads(protected_read(folder/'stage.json',(0o600,),4096))
        if not isinstance(meta,dict) or set(meta)!={'version','original_sha256','added','removed','accounts','deprovision'} or meta['version'] != 1:
            raise ValueError()
        original=meta['original_sha256']
        if not isinstance(original,str) or len(original)!=64 or any(c not in '0123456789abcdef' for c in original): raise ValueError()
        for key in ('added','removed','accounts'):
            if type(meta[key]) is not int or not 0 <= meta[key] <= 100: raise ValueError()
        if type(meta['deprovision']) is not bool or meta['deprovision'] != (meta['accounts']==0): raise ValueError()
        endpoint=protected_read(folder/'endpoint.credentials.toml',(0o600,))
        mapping=json.loads(protected_read(folder/'pilot-mapping.json',(0o600,),48000))
        if not isinstance(mapping,dict) or set(mapping)!={'accounts'} or not isinstance(mapping['accounts'],list) or len(mapping['accounts'])!=meta['accounts']: raise ValueError()
        records=[]
        for r in mapping['accounts']:
            if not isinstance(r,dict) or set(r)!={'accountId','hostname','gatewayIpv4','port','username','password'}: raise ValueError()
            records.append(PilotAccount(r['accountId'],ManagedCredential(r['username'],r['password'])))
        if records:
            first=mapping['accounts'][0]
            plan=prepare_pilot_plan(endpoint.decode('utf8'),records,[r.account_id for r in records],first['hostname'],first['gatewayIpv4'],first['port'])
            # Reject inconsistent endpoint, different mapping endpoint settings,
            # reordering or any unexpected content. JSON comparison is semantic.
            if plan.endpoint_credentials.encode()!=endpoint or json.loads(plan.sealer_input)!=mapping: raise ValueError()
            secret=json.loads(protected_read(folder/'pilot-server-secret.json',(0o600,),70000))
            if not isinstance(secret,dict) or set(secret)!={'key','bundle'}: raise ValueError()
            plaintext=decrypt_bundle(secret['key'],secret['bundle'])
            if json.loads(plaintext)!=mapping: raise ValueError()
            if protected_read(folder/'pilot-key.txt',(0o600,),128).decode('utf8').strip()!=secret['key']: raise ValueError()
            if protected_read(folder/'pilot-bundle.txt',(0o600,),65536).decode('utf8').strip()!=secret['bundle']: raise ValueError()
        else:
            # Validate that no managed records remain; address is syntactically
            # required by the pure planner but is not used in an empty mapping.
            plan=prepare_pilot_plan(endpoint.decode('utf8'),[],[],'turn.example.com','192.0.2.1',8443)
            if plan.endpoint_credentials.encode()!=endpoint: raise ValueError()
        return original, endpoint
    except Exception:
        raise StageVerificationError('Staged snapshot is invalid or inconsistent') from None
