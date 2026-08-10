#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BUILDS: сборка установщика Windows на сервере с Linux.
#
# Запускается агентом (apps/builder), переменные те же, что у Android-сборки.
#
# ── Честно о главном ─────────────────────────────────────────────────────────
#
# Windows-установщик на Linux собирается через Wine — другого способа нет.
# Что это значит на практике:
#
#   • ДЛЯ ЭТОГО ПРИЛОЖЕНИЯ это работает: у десктоп-клиента нет ни одной
#     зависимости с нативным кодом (electron-store, electron-updater,
#     socket.io-client — чистый JS), а именно на них Wine-сборки и спотыкаются;
#   • подписи Authenticode не будет. Windows покажет «издатель неизвестен»
#     при установке. Подпись требует сертификата и отдельного шага; поставить
#     её на Linux можно (osslsigncode), но сертификат должен быть куплен;
#   • если однажды появится зависимость с нативным кодом — эта сборка сломается,
#     и чинить её надо будет не тут, а переносом агента на машину с Windows.
#     Переносится он без правок кода: связь односторонняя, нужен только токен.
#
# ── Что должно стоять на машине ──────────────────────────────────────────────
#
#   * Node 20+
#   * wine64 (apt install wine64) — только для цели Windows
#
# Кэш electron-builder (~/.cache/electron, ~/.cache/electron-builder) при первой
# сборке скачивает около 300 МБ. Это разово, дальше берётся из кэша.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REF="${TRIOZ_REF:-main}"
REPO="${TRIOZ_BUILD_REPO:?не задан каталог сборки}"
OUT="${TRIOZ_ARTIFACT_DIR:?не задано хранилище загрузок}"

echo "── Сборка Windows: ветка $REF"

if [[ ! -d "$REPO/.git" ]]; then
  echo "ОШИБКА: $REPO не является клоном репозитория."
  exit 1
fi
if [[ -f "$REPO/apps/web/.env" ]]; then
  echo "ОШИБКА: похоже, это рабочий каталог приложения — сборка должна идти в отдельном клоне."
  exit 1
fi

command -v wine64 >/dev/null || command -v wine >/dev/null || {
  echo "ОШИБКА: не найден wine. Установите: apt install -y wine64"
  exit 1
}

cd "$REPO"
git fetch --prune origin
git checkout --detach "origin/$REF" 2>/dev/null || git checkout --detach "$REF"
git reset --hard
git clean -fdx apps/desktop
echo "── Код: $(git rev-parse --short HEAD)"

VERSION=$(node -p "require('./apps/desktop/package.json').version")
echo "TRIOZ_VERSION=$VERSION"

# Зависимости всего монорепозитория: десктоп берёт @trioz/shared из workspace.
nice -n 15 ionice -c3 npm ci

cd apps/desktop
# --publish never: файлы кладём мы сами, никуда их выкладывать не надо.
nice -n 15 ionice -c3 npx electron-builder --win --publish never

REL="release"
[[ -d "$REL" ]] || { echo "ОШИБКА: нет каталога $REL"; exit 1; }

mkdir -p "$OUT"

# Кладём всё, что нужно установщику и самообновлению: сам .exe, онлайн-стаб с
# его пакетом .7z, карту блоков и фид latest.yml. Без latest.yml установленное
# приложение не увидит обновление, а без .7z онлайн-установщик не докачает
# пакет — и то и другое проявится не сразу, а у людей.
shopt -s nullglob
COPIED=0
for f in "$REL"/*.exe "$REL"/*.7z "$REL"/*.blockmap "$REL"/latest*.yml; do
  name=$(basename "$f")
  install -m 0644 "$f" "$OUT/.$name.tmp"
  mv -f "$OUT/.$name.tmp" "$OUT/$name"
  echo "TRIOZ_ARTIFACT=$name"
  COPIED=$((COPIED + 1))
done

[[ $COPIED -gt 0 ]] || { echo "ОШИБКА: electron-builder не оставил файлов в $REL"; exit 1; }
echo "── Готово: $COPIED файлов в $OUT"
