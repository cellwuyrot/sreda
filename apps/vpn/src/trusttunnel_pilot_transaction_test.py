import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from trusttunnel_pilot_transaction import PilotTransaction, TransactionError, RecoveryRequired, RolledBack, digest

class TransactionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
  self.state=self.root/'state'; self.state.mkdir(mode=0o700)
  self.file=self.root/'credentials.toml'; self.old=b'[[client]]\nusername="smoke"\npassword="oldfixture"\n'; self.new=b'[[client]]\nusername="pilot"\npassword="newfixture"\n'
  self.file.write_bytes(self.old); self.file.chmod(0o640)
 def tearDown(self): self.tmp.cleanup()
 def tx(self): return PilotTransaction(str(self.file),str(self.state))
 def test_success_creates_private_backup_and_commits(self):
  service=mock.Mock(return_value=True)
  with self.tx() as tx: path=tx.apply(digest(self.old),self.new,service); self.assertEqual(tx.unresolved(),[])
  self.assertEqual(self.file.read_bytes(),self.new); self.assertEqual((path/'before.toml').read_bytes(),self.old)
  self.assertEqual((path/'before.toml').stat().st_mode & 0o777,0o600); self.assertEqual(self.file.stat().st_mode & 0o777,0o640)
  service.assert_called_once()
 def test_failed_restart_restores_and_restarts(self):
  restart=mock.Mock(side_effect=[False,True])
  with self.tx() as tx:
   with self.assertRaises(RolledBack): tx.apply(digest(self.old),self.new,restart)
   self.assertEqual(tx.unresolved(),[])
  self.assertEqual(restart.call_count,2); self.assertEqual(self.file.read_bytes(),self.old)
 def test_failed_rollback_restart_is_unresolved_and_recoverable(self):
  with self.tx() as tx:
   with self.assertRaises(RecoveryRequired): tx.apply(digest(self.old),self.new,mock.Mock(side_effect=[False,False]))
   pending=tx.unresolved(); self.assertEqual(len(pending),1); self.assertEqual(self.file.read_bytes(),self.old)
   tx.recover(pending[0],lambda: True); self.assertEqual(tx.unresolved(),[])
 def test_interrupted_restart_recovers_from_new_snapshot(self):
  with self.tx() as tx:
   with self.assertRaises(RecoveryRequired): tx.apply(digest(self.old),self.new,mock.Mock(side_effect=TimeoutError()))
   pending=tx.unresolved(); self.assertEqual(self.file.read_bytes(),self.new)
   with self.assertRaises(RecoveryRequired): tx.apply(digest(self.new),self.old,lambda: True)
   tx.recover(pending[0],lambda: True); self.assertEqual(self.file.read_bytes(),self.old)
 def test_external_edit_is_never_overwritten(self):
  with self.tx() as tx:
   with self.assertRaises(RecoveryRequired): tx.apply(digest(self.old),self.new,mock.Mock(side_effect=TimeoutError()))
   path=tx.unresolved()[0]; self.file.write_bytes(b'changed')
   with self.assertRaises(RecoveryRequired): tx.recover(path,lambda: True)
   self.assertEqual(self.file.read_bytes(),b'changed')
 def test_stale_digest_never_creates_transaction(self):
  with self.tx() as tx:
   with self.assertRaises(TransactionError): tx.apply('0'*64,self.new,lambda: True)
   self.assertEqual(tx.unresolved(),[])
  self.assertEqual(self.file.read_bytes(),self.old)
 def test_no_change_does_not_restart(self):
  restart=mock.Mock(return_value=True)
  with self.tx() as tx: tx.apply(digest(self.old),self.old,restart)
  restart.assert_not_called()
 def test_incomplete_journal_blocks_new_transaction(self):
  (self.state/'txn-incomplete').mkdir(mode=0o700)
  with self.tx() as tx:
   with self.assertRaises(RecoveryRequired): tx.apply(digest(self.old),self.new,lambda: True)
 def test_lock_refuses_concurrent_transaction(self):
  with self.tx():
   with self.assertRaises(BlockingIOError): self.tx()
 def test_bad_backup_refuses_recovery(self):
  with self.tx() as tx:
   with self.assertRaises(RecoveryRequired): tx.apply(digest(self.old),self.new,mock.Mock(side_effect=TimeoutError()))
   path=tx.unresolved()[0]; (path/'before.toml').write_bytes(b'bad')
   with self.assertRaises(RecoveryRequired): tx.recover(path,lambda: True)
   self.assertEqual(self.file.read_bytes(),self.new)
if __name__=='__main__': unittest.main()
