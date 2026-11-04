#!/usr/bin/env bash
# Isolated fault-injection tests: fake Git/Gradle, no real signing key/SDK.
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/build-android.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/repo/.git" "$tmp/repo/apps/android/app" "$tmp/config" "$tmp/out"
printf 'fake-keystore-properties' > "$tmp/config/keystore.properties"
printf 'fake-firebase-config' > "$tmp/config/google-services.json"
printf 'versionName = "1.2.3"\n' > "$tmp/repo/apps/android/app/build.gradle.kts"
cat > "$tmp/bin/git" <<'GIT'
#!/usr/bin/env bash
if [[ "${1:-}" == rev-parse ]]; then echo abc123; fi
GIT
cat > "$tmp/bin/mv" <<'MOVE'
#!/usr/bin/env bash
if [[ "${SIMULATE_MOVE_FAILURE:-0}" == 1 && "$*" == *new.apk* ]]; then exit 43; fi
if [[ "${SIMULATE_ROLLBACK_FAILURE:-0}" == 1 && "$*" == *previous.aab* ]]; then exit 44; fi
exec /usr/bin/mv "$@"
MOVE
cat > "$tmp/repo/apps/android/gradlew" <<'GRADLE'
#!/usr/bin/env bash
set -eu
test -f app/keystore.properties
test -f app/google-services.json
[[ "$(stat -c %a app/keystore.properties)" == 600 ]]
[[ "$(stat -c %a app/google-services.json)" == 600 ]]
rm -rf app/build
if [[ "${SIMULATE_FAILURE:-0}" == 1 ]]; then exit 42; fi
mkdir -p app/build/outputs/apk/release app/build/outputs/bundle/release
printf 'release-apk' > app/build/outputs/apk/release/app-release.apk
if [[ "${SIMULATE_MISSING_AAB:-0}" != 1 ]]; then printf 'release-aab' > app/build/outputs/bundle/release/app-release.aab; fi
if [[ "${SIMULATE_EMPTY_APK:-0}" == 1 ]]; then : > app/build/outputs/apk/release/app-release.apk; fi
GRADLE
chmod +x "$tmp/bin/git" "$tmp/bin/mv" "$tmp/repo/apps/android/gradlew"
export PATH="$tmp/bin:$PATH" TRIOZ_BUILD_REPO="$tmp/repo" TRIOZ_ARTIFACT_DIR="$tmp/out" TRIOZ_ANDROID_CONFIG_DIR="$tmp/config"
count=0
original() { printf original-release > "$tmp/out/connect.apk"; printf original-bundle > "$tmp/out/connect.aab"; chmod 0644 "$tmp/out/connect.apk" "$tmp/out/connect.aab"; }
unchanged() { [[ "$(stat -c %a "$tmp/out/connect.apk")" == 644 && "$(stat -c %a "$tmp/out/connect.aab")" == 644 ]]; [[ "$(cat "$tmp/out/connect.apk")" == original-release && "$(cat "$tmp/out/connect.aab")" == original-bundle ]]; }
cleaned() {
  [[ ! -e "$tmp/repo/apps/android/app/keystore.properties" && ! -e "$tmp/repo/apps/android/app/google-services.json" ]]
  [[ -z "$(find "$tmp/out" -maxdepth 1 -name '.android-release.*' -print -quit)" ]]
}
reject() {
  local label="$1"; shift
  original
  if env "$@" bash "$SCRIPT" > "$tmp/$label.log" 2>&1; then echo "FAIL: $label accepted"; exit 1; fi
  unchanged; cleaned
  count=$((count+1)); echo "PASS: $label"
}
reject debug TRIOZ_ANDROID_DEBUG=1
reject traversal TRIOZ_APK_NAME=../unsafe.apk
reject failed-gradle SIMULATE_FAILURE=1
reject missing-aab SIMULATE_MISSING_AAB=1
reject empty-apk SIMULATE_EMPTY_APK=1
reject unprovisioned-output TRIOZ_ARTIFACT_DIR="$tmp/unprovisioned"
reject failed-publication SIMULATE_MOVE_FAILURE=1
reject config-inside-checkout TRIOZ_ANDROID_CONFIG_DIR="$tmp/repo/apps/android"
# Deterministic lock tests; no timing sleeps required.
exec 7>"$tmp/repo/.git/trioz-android.lock"
flock 7
reject busy-checkout
flock -u 7
exec 6>"$tmp/out/.android-publish.lock"
flock 6
reject busy-output
flock -u 6
# If the destination cannot be restored, keep the backup for an operator.
original
if SIMULATE_MOVE_FAILURE=1 SIMULATE_ROLLBACK_FAILURE=1 bash "$SCRIPT" > "$tmp/rollback-failure.log" 2>&1; then echo 'FAIL: rollback fault accepted'; exit 1; fi
backup="$(find "$tmp/out" -name previous.aab -print -quit)"
[[ -n "$backup" && "$(cat "$backup")" == original-bundle ]]
[[ ! -e "$tmp/repo/apps/android/app/keystore.properties" && ! -e "$tmp/repo/apps/android/app/google-services.json" ]]
rm -rf -- "$(dirname "$backup")"
count=$((count+1)); echo 'PASS: failed rollback retains backup but removes credential copies'
original
bash "$SCRIPT" > "$tmp/success.log" 2>&1
[[ "$(cat "$tmp/out/connect.apk")" == release-apk && "$(cat "$tmp/out/connect.aab")" == release-aab ]]
cleaned
[[ -e "$tmp/config/keystore.properties" && -e "$tmp/config/google-services.json" ]]
count=$((count+1)); echo 'PASS: release published; external configs preserved; copies and staging removed'
echo "PASS: $count isolated builder scenarios (not a real Android release)"
