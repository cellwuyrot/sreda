#!/usr/bin/env bash
# Isolated tests: fake git and Gradle; no real SDK, key or network involved.
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/build-android.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/repo/.git" "$tmp/repo/apps/android/app" "$tmp/config" "$tmp/out"
printf 'original-release' > "$tmp/out/connect.apk"
printf 'fake-keystore-properties' > "$tmp/config/keystore.properties"
printf 'fake-firebase-config' > "$tmp/config/google-services.json"
printf 'versionName = "1.2.3"\n' > "$tmp/repo/apps/android/app/build.gradle.kts"
cat > "$tmp/bin/git" <<'GIT'
#!/usr/bin/env bash
if [[ "${1:-}" == rev-parse ]]; then echo abc123; fi
GIT
cat > "$tmp/repo/apps/android/gradlew" <<'GRADLE'
#!/usr/bin/env bash
set -eu
test -f app/keystore.properties
test -f app/google-services.json
if [[ "${SIMULATE_FAILURE:-0}" == 1 ]]; then exit 42; fi
mkdir -p app/build/outputs/apk/release app/build/outputs/bundle/release
printf 'release-apk' > app/build/outputs/apk/release/app-release.apk
printf 'release-aab' > app/build/outputs/bundle/release/app-release.aab
GRADLE
chmod +x "$tmp/bin/git" "$tmp/repo/apps/android/gradlew"
export PATH="$tmp/bin:$PATH" TRIOZ_BUILD_REPO="$tmp/repo" TRIOZ_ARTIFACT_DIR="$tmp/out" TRIOZ_ANDROID_CONFIG_DIR="$tmp/config"
if TRIOZ_ANDROID_DEBUG=1 bash "$SCRIPT" > "$tmp/debug.log" 2>&1; then echo 'FAIL: debug accepted'; exit 1; fi
[[ "$(cat "$tmp/out/connect.apk")" == original-release ]]
if SIMULATE_FAILURE=1 bash "$SCRIPT" > "$tmp/fail.log" 2>&1; then echo 'FAIL: fake Gradle failure accepted'; exit 1; fi
[[ ! -e "$tmp/repo/apps/android/app/keystore.properties" && ! -e "$tmp/repo/apps/android/app/google-services.json" ]]
[[ "$(cat "$tmp/out/connect.apk")" == original-release ]]
bash "$SCRIPT" > "$tmp/success.log" 2>&1
[[ "$(cat "$tmp/out/connect.apk")" == release-apk && "$(cat "$tmp/out/connect.aab")" == release-aab ]]
[[ ! -e "$tmp/repo/apps/android/app/keystore.properties" && ! -e "$tmp/repo/apps/android/app/google-services.json" ]]
[[ -e "$tmp/config/keystore.properties" && -e "$tmp/config/google-services.json" ]]
echo 'PASS: debug rejected; failed build keeps release; copied configs removed; release artifacts published'
