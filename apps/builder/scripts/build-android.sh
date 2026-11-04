#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BUILDS: сборка Android-клиента (APK) на сервере.
#
# Запускается агентом (apps/builder). Переменные приходят от него:
#
#   TRIOZ_REF           ветка или коммит
#   TRIOZ_BUILD_REPO    отдельный клон репозитория ТОЛЬКО под сборку
#   TRIOZ_ARTIFACT_DIR  хранилище загрузок, откуда раздаётся /desktop/
#
# Скрипт объявляет результат строками в журнале — их читает агент:
#
#   TRIOZ_VERSION=…     версия
#   TRIOZ_ARTIFACT=…    имя файла, положенного в хранилище
#
# ── Почему отдельный клон ────────────────────────────────────────────────────
#
# Сборка делает `git reset --hard`. В каталоге, откуда работает сайт, это
# означало бы падение сайта посреди сборки. Каталоги обязаны различаться, и
# скрипт это проверяет.
#
# ── Что должно стоять на машине ──────────────────────────────────────────────
#
#   * JDK 17           (apt install openjdk-17-jdk-headless)
#   * Android SDK      cmdline-tools + platforms;android-36 + build-tools;35.0.0
#   * ANDROID_HOME     путь к SDK
#
# Подпись и Firebase: TRIOZ_ANDROID_CONFIG_DIR вне клона сборки.
# Release требует ключ подписи; без него сборка завершается ошибкой.
# Публичный агент собирает только release; debug собирается вручную вне него.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

REF="${TRIOZ_REF:-main}"
REPO="${TRIOZ_BUILD_REPO:?не задан каталог сборки}"
OUT="${TRIOZ_ARTIFACT_DIR:?не задано хранилище загрузок}"
APK_NAME="${TRIOZ_APK_NAME:-connect.apk}"

# This agent publishes to the public download directory. Never allow a debug
# package to overwrite a release (or to appear as a production job).
if [[ "${TRIOZ_ANDROID_DEBUG:-0}" = "1" ]]; then
  echo "ERROR: debug builds are not supported by the public builder. Build them locally with assembleDebug."
  exit 1
fi

[[ "$APK_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$ ]] || {
  echo "ERROR: TRIOZ_APK_NAME must be a plain .apk filename"; exit 1;
}

echo "── Сборка Android: ветка $REF"

if [[ ! -d "$REPO/.git" ]]; then
  echo "ОШИБКА: $REPO не является клоном репозитория."
  echo "Один раз: git clone <репозиторий> $REPO"
  exit 1
fi

# Защита от сборки в рабочем каталоге сайта: git reset --hard там означает
# уронить прод. Проверяем по наличию рядом работающего приложения.
if [[ -f "$REPO/apps/web/.env" ]]; then
  echo "ОШИБКА: похоже, это рабочий каталог приложения (есть apps/web/.env)."
  echo "Сборка должна идти в ОТДЕЛЬНОМ клоне — задайте TRIOZ_BUILD_REPO."
  exit 1
fi

if [[ -n "${TRIOZ_ANDROID_CONFIG_DIR:-}" ]]; then
  CONFIG_REAL="$(realpath "$TRIOZ_ANDROID_CONFIG_DIR")"
  REPO_REAL="$(realpath "$REPO")"
  [[ "$CONFIG_REAL" != "$REPO_REAL" && "$CONFIG_REAL" != "$REPO_REAL/"* ]] || {
    echo "ERROR: Android credentials must be OUTSIDE the disposable checkout"; exit 1;
  }
fi
# Hold both locks through checkout, build and publication. Different clones can
# share the output directory; a checkout lock alone does not protect publication.
command -v flock >/dev/null || { echo "ERROR: flock is required"; exit 1; }
exec 9>"$REPO/.git/trioz-android.lock"
flock -n 9 || { echo "ERROR: Android checkout is busy"; exit 1; }
# Do not guess public directory permissions under the restrictive umask.
# Provision it separately with access for the actual download-serving process.
[[ -d "$OUT" ]] || { echo "ERROR: provision TRIOZ_ARTIFACT_DIR with web-server read access first"; exit 1; }
OUT="$(realpath "$OUT")"
exec 8>"$OUT/.android-publish.lock"
flock -n 8 || { echo "ERROR: Android publication is busy"; exit 1; }
cd "$REPO"
git fetch --prune origin
git checkout --detach "origin/$REF" 2>/dev/null || git checkout --detach "$REF"
git reset --hard
git clean -fdx apps/android
echo "── Код: $(git rev-parse --short HEAD)"

cd apps/android
ANDROID_ROOT="$(pwd -P)"
# The disposable checkout must not retain copies of credentials after this run.
COPIED_KEYSTORE=0
COPIED_FIREBASE=0
STAGE=""
PUBLISHING=0
HAD_APK=0
HAD_AAB=0
ROLLBACK_FAILED=0
cleanup_android_config() {
  # Best-effort rollback for ordinary failures/signals. SIGKILL/power loss is
  # NOT a transaction; production promotion needs versioned releases later.
  if [[ "$PUBLISHING" = 1 && -n "$STAGE" ]]; then
    if [[ "$HAD_APK" = 1 ]]; then mv -f -- "$STAGE/previous.apk" "$OUT/$APK_NAME" || { echo "ERROR: APK rollback failed; previous artifacts retained in staging" >&2; ROLLBACK_FAILED=1; }
    else rm -f -- "$OUT/$APK_NAME"; fi
    if [[ "$HAD_AAB" = 1 ]]; then mv -f -- "$STAGE/previous.aab" "$OUT/connect.aab" || { echo "ERROR: AAB rollback failed; previous artifacts retained in staging" >&2; ROLLBACK_FAILED=1; }
    else rm -f -- "$OUT/connect.aab"; fi
  fi
  if [[ -n "$STAGE" && "$ROLLBACK_FAILED" = 0 ]]; then rm -rf -- "$STAGE"; fi
  [[ "$COPIED_KEYSTORE" != 1 ]] || rm -f -- "$ANDROID_ROOT/app/keystore.properties"
  [[ "$COPIED_FIREBASE" != 1 ]] || rm -f -- "$ANDROID_ROOT/app/google-services.json"
}
trap cleanup_android_config EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

VERSION=$(grep -oP 'versionName\s*=\s*"\K[^"]+' app/build.gradle.kts | head -1 || true)
[[ -n "$VERSION" ]] && echo "TRIOZ_VERSION=$VERSION"

chmod +x ./gradlew 2>/dev/null || true

CONFIG_DIR="${TRIOZ_ANDROID_CONFIG_DIR:-}"
if [[ -n "$CONFIG_DIR" ]]; then
  [[ "$CONFIG_DIR" = /* && -d "$CONFIG_DIR" ]] || { echo "ERROR: TRIOZ_ANDROID_CONFIG_DIR must be an absolute directory"; exit 1; }
  if [[ -f "$CONFIG_DIR/keystore.properties" ]]; then
    COPIED_KEYSTORE=1
    install -m 0600 "$CONFIG_DIR/keystore.properties" app/keystore.properties
  fi
  if [[ -f "$CONFIG_DIR/google-services.json" ]]; then
    COPIED_FIREBASE=1
    install -m 0600 "$CONFIG_DIR/google-services.json" app/google-services.json
  fi
fi
[[ -f app/keystore.properties ]] || { echo "ERROR: production upload key is required; set TRIOZ_ANDROID_CONFIG_DIR"; exit 1; }
TASK="assembleRelease bundleRelease"
APK_PATH="app/build/outputs/apk/release/app-release.apk"

# nice/ionice: сборка идёт на машине, которая обслуживает людей, и не должна
# отбирать у них процессор и диск.
nice -n 15 ionice -c3 ./gradlew --no-daemon $TASK

AAB_PATH="app/build/outputs/bundle/release/app-release.aab"
# Validate the complete set BEFORE touching either public artifact.
[[ -s "$APK_PATH" && -s "$AAB_PATH" ]] || {
  echo "ERROR: release APK and AAB must both exist and be non-empty"; exit 1;
}
STAGE="$(mktemp -d "$OUT/.android-release.XXXXXX")"
install -m 0644 "$APK_PATH" "$STAGE/new.apk"
install -m 0644 "$AAB_PATH" "$STAGE/new.aab"
if [[ -e "$OUT/$APK_NAME" ]]; then cp -p -- "$OUT/$APK_NAME" "$STAGE/previous.apk"; HAD_APK=1; fi
if [[ -e "$OUT/connect.aab" ]]; then cp -p -- "$OUT/connect.aab" "$STAGE/previous.aab"; HAD_AAB=1; fi
PUBLISHING=1
mv -f -- "$STAGE/new.aab" "$OUT/connect.aab"
mv -f -- "$STAGE/new.apk" "$OUT/$APK_NAME"
PUBLISHING=0
# Each rename is atomic, but the pair is not crash-atomic. See release plan.
echo "TRIOZ_ARTIFACT=$APK_NAME"
echo "── Готово: $OUT/$APK_NAME ($(du -h "$OUT/$APK_NAME" | cut -f1))"
