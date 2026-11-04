#!/usr/bin/env bash
# Local checks only. Does not publish, install an APK or contact TrioZ accounts.
# Requires: JDK 17, Android SDK 36/build-tools 35, npm ci and generated Prisma client.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash -n apps/builder/scripts/build-android.sh
bash apps/builder/tests/test-android-build.sh
python3 -m unittest discover -s apps/android/tools -p 'test_*.py'
npm run build:shared
npm run test -w apps/web -- \
  src/app/api/admin/builds/route.test.ts \
  src/app/api/messages/history.test.ts src/app/api/messages/read/route.test.ts \
  src/app/api/dm src/lib/e2ee.security.test.ts src/lib/dmPolicy.test.ts src/lib/push.test.ts
npm run typecheck -w apps/web
bash apps/android/gradlew -p apps/android --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
printf '\nPASS: local checks completed. Device, server, push, calls, VPN and upgrade acceptance remain separate.\n'
