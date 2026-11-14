import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('tt_store', Path(__file__).with_name('trusttunnel_atomic_store.py'))
store = importlib.util.module_from_spec(spec); sys.modules[spec.name] = store; spec.loader.exec_module(store)

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.file = self.dir / 'credentials.toml'
        self.original = b'[[client]]\nusername="smoke"\npassword="fixture"\n'
        self.updated = self.original + b'\n[[client]]\nusername="new"\npassword="dummy"\n'
        self.file.write_bytes(self.original); self.file.chmod(0o640)
        self.hash = hashlib.sha256(self.original).hexdigest()
    def tearDown(self): self.tmp.cleanup()
    def put(self, content=None, digest=None): return store.replace_if_unchanged(str(self.file), digest or self.hash, content if content is not None else self.updated)
    def test_atomic_replacement_preserves_mode_and_owner(self):
        old = self.file.stat(); self.assertTrue(self.put()); new = self.file.stat()
        self.assertEqual(self.file.read_bytes(), self.updated)
        self.assertEqual(stat.S_IMODE(new.st_mode), 0o640)
        self.assertEqual((new.st_uid, new.st_gid), (old.st_uid, old.st_gid))
        self.assertNotEqual(new.st_ino, old.st_ino)
    def test_idempotent(self): self.assertFalse(self.put(self.original))
    def test_rejects_stale_or_bad_input(self):
        with self.assertRaises(store.StoreError): self.put(digest='0'*64)
        with self.assertRaises(store.StoreError): self.put(content=b'invalid [')
        with self.assertRaises(store.StoreError): self.put(content=b'')
        self.assertEqual(self.file.read_bytes(), self.original)
    def test_refuses_unsafe_file_modes(self):
        for mode in [0o644, 0o660, 0o777]:
            self.file.chmod(mode)
            with self.assertRaises(store.StoreError): self.put()
        self.assertEqual(self.file.read_bytes(), self.original)
    def test_refuses_unsafe_directory(self):
        self.dir.chmod(0o777)
        try:
            with self.assertRaises(store.StoreError): self.put()
        finally: self.dir.chmod(0o700)
    def test_rejects_link_and_hardlink(self):
        other = self.dir / 'other'; self.file.rename(other); self.file.symlink_to(other)
        with self.assertRaises(OSError): self.put()
        self.file.unlink(); os.link(other, self.file)
        with self.assertRaises(store.StoreError): self.put()
        self.assertEqual(other.read_bytes(), self.original)
    def test_rejects_symlink_lock(self):
        (self.dir / '.trioz-credentials.lock').symlink_to(self.file)
        with self.assertRaises(OSError): self.put()
        self.assertEqual(self.file.read_bytes(), self.original)
    def test_directory_fsync_failure_reports_uncertain_commit(self):
        real_fsync = os.fsync
        def flaky(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode): raise OSError("fixture")
            return real_fsync(fd)
        with mock.patch.object(store.os, 'fsync', side_effect=flaky):
            with self.assertRaises(store.StoreCommitUncertain): self.put()
        self.assertEqual(self.file.read_bytes(), self.updated)

    def test_rejects_duplicate_users(self):
        data = self.original + b'[[client]]\nusername="smoke"\npassword="x"\n'
        with self.assertRaises(store.StoreError): self.put(data)
        self.assertEqual(self.file.read_bytes(), self.original)

if __name__ == '__main__': unittest.main()
