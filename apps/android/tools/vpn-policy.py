#!/usr/bin/env python3
"""Edit local build-time admission policy. No device inventory or network requests."""
import argparse
import json
from pathlib import Path
import re
import tempfile
import os

POLICY = Path(__file__).resolve().parents[1] / "vpn-admission-policy.json"

def validate(value):
    assert isinstance(value.get("version"), int) and value["version"] > 0, "Invalid version"
    assert type(value.get("enabled")) is bool, "enabled must be boolean"
    rows = value.get("packages")
    assert isinstance(rows, list) and len(rows) <= 200, "packages must be a list (max 200)"
    seen = set()
    for row in rows:
        package = row.get("package", "")
        assert isinstance(package, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+", package), "Invalid exact package ID"
        assert package not in seen, "Duplicate package ID"
        assert isinstance(row.get("label"), str) and row["label"].strip(), "Label required"
        seen.add(package)
    return value

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["list", "validate", "add", "remove", "enable", "disable"])
    parser.add_argument("--package")
    parser.add_argument("--label")
    args = parser.parse_args()
    value = validate(json.loads(POLICY.read_text(encoding="utf-8")))
    if args.command == "list":
        print(json.dumps(value, ensure_ascii=False, indent=2)); return
    if args.command == "validate":
        print("Policy valid"); return
    if args.command in ("add", "remove") and not args.package:
        parser.error("--package required")
    if args.command == "add":
        if not args.label: parser.error("--label required")
        value["packages"] = [p for p in value["packages"] if p["package"] != args.package]
        value["packages"].append({"package": args.package, "label": args.label})
    elif args.command == "remove":
        value["packages"] = [p for p in value["packages"] if p["package"] != args.package]
    else:
        value["enabled"] = args.command == "enable"
    value["version"] += 1
    validate(value)
    fd, name = tempfile.mkstemp(dir=POLICY.parent, prefix=".vpn-policy-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2); f.write("\n")
        os.replace(name, POLICY)
    finally:
        if os.path.exists(name): os.unlink(name)
    print("Policy updated. Rebuild APK/AAB and increment Android versionCode before distribution.")
if __name__ == "__main__":
    main()
