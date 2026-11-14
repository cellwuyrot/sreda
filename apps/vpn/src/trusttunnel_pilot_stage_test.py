import json, os, stat, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SCRIPT=ROOT/'scripts/trusttunnel-pilot-stage.py'
class StageTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.dir=Path(self.tmp.name)
  self.creds=self.dir/'credentials.toml'; self.creds.write_text('[[client]]\nusername="smoke"\npassword="fixture"\n'); self.creds.chmod(0o640)
 def tearDown(self): self.tmp.cleanup()
 def run_stage(self, ids, current=None, previous=None, parent=None):
  args=[sys.executable,str(SCRIPT),'--credentials',str(current or self.creds),'--stage-parent',str(parent or self.dir),'--hostname','turn.example.com','--gateway-ipv4','192.0.2.4','--port','8443']
  if previous: args += ['--previous-mapping',str(previous)]
  return subprocess.run(args,input=json.dumps(ids),text=True,capture_output=True)
 def test_initial_and_followup_preserve_and_remove(self):
  r=self.run_stage(['admin_a']); self.assertEqual(r.returncode,0)
  stage=next(self.dir.glob('trioz-pilot-*')); self.assertNotIn('fixture',r.stdout+r.stderr)
  self.assertEqual(stat.S_IMODE(stage.stat().st_mode),0o700)
  for name in ['endpoint.credentials.toml','pilot-mapping.json','pilot-key.txt','pilot-bundle.txt','pilot-server-secret.json','stage.json']:
   self.assertEqual(stat.S_IMODE((stage/name).stat().st_mode),0o600)
  combined=json.loads((stage/'pilot-server-secret.json').read_text()); self.assertEqual(combined['key'], (stage/'pilot-key.txt').read_text().strip()); self.assertEqual(combined['bundle'], (stage/'pilot-bundle.txt').read_text().strip())
  old=json.loads((stage/'pilot-mapping.json').read_text())['accounts'][0]
  r=self.run_stage(['admin_a','admin_b'],stage/'endpoint.credentials.toml',stage/'pilot-mapping.json'); self.assertEqual(r.returncode,0)
  dirs=sorted(self.dir.glob('trioz-pilot-*'), key=lambda p:p.stat().st_mtime_ns); new=dirs[-1]
  self.assertEqual(json.loads((new/'pilot-mapping.json').read_text())['accounts'][0]['password'],old['password'])
  r=self.run_stage([],new/'endpoint.credentials.toml',new/'pilot-mapping.json'); self.assertEqual(r.returncode,0)
  deprov=sorted(self.dir.glob('trioz-pilot-*'), key=lambda p:p.stat().st_mtime_ns)[-1]
  self.assertNotIn('trioz_', (deprov/'endpoint.credentials.toml').read_text()); self.assertFalse((deprov/'pilot-bundle.txt').exists())
  self.assertEqual(self.creds.read_text(),'[[client]]\nusername="smoke"\npassword="fixture"\n')
 def test_refuses_unsafe_and_inconsistent(self):
  self.creds.chmod(0o644); self.assertNotEqual(self.run_stage(['a']).returncode,0); self.creds.chmod(0o640)
  self.assertNotEqual(self.run_stage(['a','a']).returncode,0)
  r=self.run_stage(['a']); self.assertEqual(r.returncode,0); stage=next(self.dir.glob('trioz-pilot-*'))
  self.assertNotEqual(self.run_stage(['a'],stage/'endpoint.credentials.toml').returncode,0)
  self.assertEqual(len(list(self.dir.glob('trioz-pilot-*'))),1)
  bad=self.dir/'unsafe'; bad.mkdir(mode=0o755); self.assertNotEqual(self.run_stage(['a'],parent=bad).returncode,0)
 def test_refuses_symlink_and_never_prints_secrets(self):
  link=self.dir/'link'; link.symlink_to(self.creds)
  r=self.run_stage(['a'],current=link); self.assertNotEqual(r.returncode,0); self.assertNotIn('fixture',r.stdout+r.stderr)
if __name__=='__main__': unittest.main()
