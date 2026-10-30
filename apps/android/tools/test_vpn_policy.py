"""Run: python3 -m unittest discover -s apps/android/tools -p 'test_*.py'."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('vpn_policy', Path(__file__).with_name('vpn-policy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PolicyToolTest(unittest.TestCase):
    def policy(self, **changes):
        return {**dict(version=1, enabled=True, packages=[]), **changes}
    def test_valid(self):
        module.validate(self.policy(packages=[{'package':'com.example.app', 'label':'App'}]))
    def test_empty(self):
        module.validate(self.policy())
    def test_disabled(self):
        module.validate(self.policy(enabled=False))
    def test_wildcard(self):
        with self.assertRaises(AssertionError): module.validate(self.policy(packages=[{'package':'com.example.*','label':'App'}]))
    def test_duplicate(self):
        row={'package':'com.example.app','label':'App'}
        with self.assertRaises(AssertionError): module.validate(self.policy(packages=[row,row]))
    def test_label(self):
        with self.assertRaises(AssertionError): module.validate(self.policy(packages=[{'package':'com.example.app','label':' '}]))
    def test_version(self):
        with self.assertRaises(AssertionError): module.validate(self.policy(version=0))
    def test_limit(self):
        with self.assertRaises(AssertionError): module.validate(self.policy(packages=[{'package':f'com.example.a{i}','label':'App'} for i in range(201)]))
    def test_enabled_type(self):
        with self.assertRaises(AssertionError): module.validate(self.policy(enabled='false'))

if __name__ == '__main__': unittest.main()
