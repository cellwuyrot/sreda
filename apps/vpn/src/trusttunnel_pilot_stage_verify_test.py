import json, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from trusttunnel_pilot_stage_verify import verify_stage, StageVerificationError
ROOT=Path(__file__).resolve().parents[3]
class VerifyStageTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.dir=Path(self.tmp.name); self.creds=self.dir/'creds'; self.creds.write_text('[[client]]\nusername="smoke"\npassword="fixture"\n'); self.creds.chmod(0o600)
  r=subprocess.run([sys.executable,str(ROOT/'scripts/trusttunnel-pilot-stage.py'),'--credentials',str(self.creds),'--stage-parent',str(self.dir),'--hostname','turn.example.com','--gateway-ipv4','192.0.2.4','--port','8443'],input='["admin_1"]',text=True,capture_output=True)
  if r.returncode: raise RuntimeError('stage setup failed')
  self.stage=next(self.dir.glob('trioz-pilot-*'))
 def tearDown(self): self.tmp.cleanup()
 def test_valid(self):
  digest, endpoint=verify_stage(str(self.stage))
  self.assertEqual(len(digest),64); self.assertIn(b'fixture',endpoint)
 def test_rejects_inconsistent_toml_and_mapping(self):
  file=self.stage/'endpoint.credentials.toml'; file.write_bytes(file.read_bytes().replace(b'trioz_',b'triex_',1))
  with self.assertRaises(StageVerificationError): verify_stage(str(self.stage))
 def test_rejects_tampered_bundle_without_disclosing(self):
  file=self.stage/'pilot-server-secret.json'; doc=json.loads(file.read_text()); doc['key']='00'*32; file.write_text(json.dumps(doc))
  with self.assertRaises(StageVerificationError) as err: verify_stage(str(self.stage))
  self.assertNotIn('fixture',str(err.exception)); self.assertNotIn('00'*32,str(err.exception))
 def test_verification_does_not_spawn_node(self):
  with patch('subprocess.run', side_effect=AssertionError('must not spawn')):
   self.assertEqual(len(verify_stage(str(self.stage))[0]),64)
 def test_rejects_modified_tag_even_if_legacy_bundle_matches(self):
  file=self.stage/'pilot-server-secret.json'; doc=json.loads(file.read_text())
  parts=doc['bundle'].split('.'); parts[-1] = ('A' if parts[-1][0] != 'A' else 'B') + parts[-1][1:]
  doc['bundle']='.'.join(parts); file.write_text(json.dumps(doc))
  (self.stage/'pilot-bundle.txt').write_text(doc['bundle']+'\n')
  with self.assertRaises(StageVerificationError): verify_stage(str(self.stage))
 def test_missing_crypto_fails_closed(self):
  with patch('trusttunnel_pilot_gcm.ctypes.CDLL', side_effect=OSError('absent')):
   with self.assertRaises(StageVerificationError): verify_stage(str(self.stage))
 def test_refuses_symlinked_or_world_readable_files(self):
  file=self.stage/'pilot-mapping.json'; file.chmod(0o644)
  with self.assertRaises(StageVerificationError): verify_stage(str(self.stage))
  file.chmod(0o600); file.unlink(); file.symlink_to(self.creds)
  with self.assertRaises(StageVerificationError): verify_stage(str(self.stage))
if __name__=='__main__': unittest.main()
