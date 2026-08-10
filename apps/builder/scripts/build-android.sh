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
#   * Android SDK      cmdline-tools + platforms;android-34 + build-tools;34.0.0
#   * ANDROID_HOME     путь к SDK
#
# Подпись: если в apps/android/app/ лежит keystore.properties, собирается
# подписанный release. Файла нет — собирается debug: неподписанный release всё
# равно не установится, и отдавать его людям бессмысленно.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REF="${TRIOZ_REF:-main}"
REPO="${TRIOZ_BUILD_REPO:?не задан каталог сборки}"
OUT="${TRIOZ_ARTIFACT_DIR:?не задано хранилище загрузок}"
APK_NAME="${TRIOZ_APK_NAME:-connect.apk}"

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

cd "$REPO"
git fetch --prune origin
git checkout --detach "origin/$REF" 2>/dev/null || git checkout --detach "$REF"
git reset --hard
git clean -fdx apps/android
echo "── Код: $(git rev-parse --short HEAD)"

cd apps/android

VERSION=$(grep -oP 'versionName\s*=\s*"\K[^"]+' app/build.gradle.kts | head -1 || true)
[[ -n "$VERSION" ]] && echo "TRIOZ_VERSION=$VERSION"

chmod +x ./gradlew 2>/dev/null || true

if [[ -f app/keystore.properties ]]; then
  echo "── Подпись: ключ найден, собираем release"
  TASK="assembleRelease"
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
  echo "── Подпись: ключа нет (app/keystore.properties), собираем debug"
  echo "   Неподписанный release не устанавливается — отдавать его людям нечего."
  TASK="assembleDebug"
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

# nice/ionice: сборка идёт на машине, которая обслуживает людей, и не должна
# отбирать у них процессор и диск.
nice -n 15 ionice -c3 ./gradlew --no-daemon "$TASK"

[[ -f "$APK_PATH" ]] || { echo "ОШИБКА: не найден $APK_PATH"; exit 1; }

mkdir -p "$OUT"
# Сначала во временный файл, потом переименование: подмена готового файла
# должна быть мгновенной, иначе кто-то скачает половину.
install -m 0644 "$APK_PATH" "$OUT/.$APK_NAME.tmp"
mv -f "$OUT/.$APK_NAME.tmp" "$OUT/$APK_NAME"

echo "TRIOZ_ARTIFACT=$APK_NAME"
echo "── Готово: $OUT/$APK_NAME ($(du -h "$OUT/$APK_NAME" | cut -f1))"
