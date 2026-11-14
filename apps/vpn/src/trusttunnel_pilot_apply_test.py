import importlib.util
from pathlib import Path
import unittest
from unittest import mock
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('pilot_apply',ROOT/'scripts/trusttunnel-pilot-apply.py')
app=importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
class UnitSafetyTests(unittest.TestCase):
 def good(self):
  return 'User=trusttunnel\nGroup=trusttunnel\nWorkingDirectory=/etc/trusttunnel\nExecStart={ path=/opt/trusttunnel/trusttunnel_endpoint ; argv[]=/opt/trusttunnel/trusttunnel_endpoint /etc/trusttunnel/vpn.toml /etc/trusttunnel/hosts.toml ; ignore_errors=no ; }\n'
 def test_accepts_expected_unit(self): app.check_unit_output(self.good())
 def test_rejects_overrides_and_wrappers(self):
  for bad in [self.good().replace('User=trusttunnel','User=root'),self.good().replace('hosts.toml ;','hosts.toml --extra ;'),self.good()+'User=root\n',self.good().replace('path=/opt','path=/bin/sh ; path=/opt')]:
   with self.assertRaises(app.ApplyError): app.check_unit_output(bad)
 def test_restart_never_calls_network_and_checks_twice(self):
  with mock.patch.object(app,'run_systemctl',return_value=mock.Mock(returncode=0)) as ctl, mock.patch.object(app.time,'sleep'):
   self.assertTrue(app.restart_checked()); self.assertEqual(ctl.call_count,3)
   self.assertEqual(ctl.call_args_list[0].args,('restart','trusttunnel.service'))
 def test_restart_failure_short_circuits(self):
  with mock.patch.object(app,'run_systemctl',return_value=mock.Mock(returncode=1)) as ctl:
   self.assertFalse(app.restart_checked()); self.assertEqual(ctl.call_count,1)

# The entire operator command is exercised only in a temp directory; systemd is mocked.
class CommandFlowTests(unittest.TestCase):
 def setUp(self):
  import tempfile, subprocess, sys
  self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
  self.creds=self.root/'credentials.toml'; self.old=b'[[client]]\nusername="smoke"\npassword="fixture"\n'; self.creds.write_bytes(self.old); self.creds.chmod(0o640)
  self.state=self.root/'state'; self.state.mkdir(mode=0o700)
  proc=subprocess.run([sys.executable,str(ROOT/'scripts/trusttunnel-pilot-stage.py'),'--credentials',str(self.creds),'--stage-parent',str(self.root),'--hostname','turn.example.com','--gateway-ipv4','192.0.2.4','--port','8443'],input='["admin_1"]',text=True,capture_output=True)
  if proc.returncode: raise RuntimeError('fixture staging failed')
  self.stage=next(self.root.glob('trioz-pilot-*'))
 def tearDown(self): self.tmp.cleanup()
 def call(self, confirmations, restart):
  import contextlib, io, sys
  argv=['pilot-apply','apply','--state-dir',str(self.state),'--stage-dir',str(self.stage)] + confirmations
  out=io.StringIO(); err=io.StringIO()
  with mock.patch.object(sys,'argv',argv), mock.patch.object(app,'is_root',return_value=True), mock.patch.object(app,'CREDS',self.creds), mock.patch.object(app,'trusted_ancestors'), mock.patch.object(app,'check_endpoint'), mock.patch.object(app,'active',return_value=True), mock.patch.object(app,'restart_checked',restart), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
   result=app.main()
  return result,out.getvalue()+err.getvalue()
 def test_apply_requires_both_explicit_confirmations(self):
  restart=mock.Mock(return_value=True)
  result,out=self.call(['--confirm-restart'],restart)
  self.assertEqual(result,1); self.assertEqual(self.creds.read_bytes(),self.old); restart.assert_not_called(); self.assertNotIn('fixture',out)
 def test_apply_success_and_atomic_backup(self):
  restart=mock.Mock(return_value=True)
  result,out=self.call(['--confirm-restart','--confirm-issuance-closed'],restart)
  self.assertEqual(result,0); self.assertIn('Applied.',out); self.assertNotIn('fixture',out); self.assertIn(b'trioz_',self.creds.read_bytes())
  restart.assert_called_once(); self.assertEqual(next(self.state.glob('txn-*')).joinpath('before.toml').read_bytes(),self.old)
 def test_restart_failure_rolls_back(self):
  restart=mock.Mock(side_effect=[False,True])
  result,out=self.call(['--confirm-restart','--confirm-issuance-closed'],restart)
  self.assertEqual(result,2); self.assertEqual(self.creds.read_bytes(),self.old); self.assertEqual(restart.call_count,2); self.assertNotIn('fixture',out)
 def test_tampered_bundle_blocks_before_service_change(self):
  f=self.stage/'pilot-server-secret.json'; f.write_text('{}'); restart=mock.Mock(return_value=True)
  result,out=self.call(['--confirm-restart','--confirm-issuance-closed'],restart)
  self.assertEqual(result,1); self.assertEqual(self.creds.read_bytes(),self.old); restart.assert_not_called(); self.assertNotIn('fixture',out)

if __name__=='__main__': unittest.main()
