#!/usr/bin/env bash
# =============================================================================
# TrioZ Connect — установка VPN-узла на AmneziaWG одной командой.
#
# Почему AmneziaWG, а не обычный WireGuard. У обычного WireGuard первые четыре
# байта каждого пакета — константа, своя для каждого из четырёх типов сообщений.
# Это готовая подпись: фильтру достаточно сравнить их с таблицей, и туннель
# распознан. На живом узле это выглядело так: рукопожатие проходило (92 байта
# ответа доходили), а дальше клиент отправлял 102 КиБ и принимал ровно ноль.
# Ни ошибки, ни журнала — просто «интернет пропал».
#
# AmneziaWG подменяет эти заголовки (H1–H4), добавляет случайные префиксы к
# служебным пакетам (S1–S4) и рассылает мусорные пакеты перед рукопожатием
# (Jc/Jmin/Jmax). Криптография не тронута — это тот же Noise_IK, Curve25519 и
# ChaCha20-Poly1305.
#
# Обычного WireGuard на узле после этого скрипта не остаётся. Держать оба нельзя
# и это не вкусовщина: прежняя версия поднимала awg0 рядом с живым wg0, оба с
# адресом 10.8.0.1/24, awg-quick падал на «already exists», а панель показывала
# узел устойчивым и выдавала клиентам профили, которые обычный WireGuard молча
# отбрасывает.
#
# Запуск:
#   sudo ./deploy/awg-node.sh                       установка/обновление
#   sudo ./deploy/awg-node.sh --host=vpn.trioz.ru   явная точка подключения
#   sudo ./deploy/awg-node.sh --port=443            другой UDP-порт
#   sudo ./deploy/awg-node.sh --print-key           показать ключ узла заново
#   sudo ./deploy/awg-node.sh --status              диагностика, ничего не меняет
#   sudo ./deploy/awg-node.sh --reset               снести ВСЁ и поставить заново
#
# Скрипт идемпотентен: приватный ключ узла и набор маскировки переиспользуются,
# поэтому выданные клиентам профили остаются действительными. Единственное, что
# ломает профили, — это --reset (новые ключи) и смена порта (новый Endpoint).
# =============================================================================
set -euo pipefail

HOST="${HOST:-}"
PORT="${PORT:-51820}"
MAIN_URL="${MAIN_URL:-}"
IFACE="${IFACE:-awg0}"
REPO="${REPO:-/var/www/trioz}"
ETH="${ETH:-}"
TOKEN="${TOKEN:-}"
SUBNET="10.8.0"
CONF_DIR="/etc/amneziawg"
STATE_DIR="/etc/trioz-vpn"
KEY_PATH="$CONF_DIR/trioz-private.key"
AWG_PARAMS="$STATE_DIR/obfuscation.env"
TOKEN_PATH="$STATE_DIR/agent.token"
UNIT="/etc/systemd/system/trioz-vpn-agent.service"
SYSCTL="/etc/sysctl.d/99-trioz-vpn.conf"
MODE="install"

for arg in "$@"; do
  case "$arg" in
    --host=*) HOST="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    --main=*) MAIN_URL="${arg#*=}" ;;
    --iface=*) IFACE="${arg#*=}" ;;
    --repo=*) REPO="${arg#*=}" ;;
    --token=*) TOKEN="${arg#*=}" ;;
    --status) MODE="status" ;;
    --print-key) MODE="printkey" ;;
    --reset) MODE="reset" ;;
    -h|--help) MODE="help" ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 1 ;;
  esac
done

CONF="$CONF_DIR/$IFACE.conf"

say()  { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

if [ "$MODE" = "help" ]; then
  sed -n '3,34p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

[ "$(id -u)" = "0" ] || die "запускать надо от root (sudo)"

# ---------------------------------------------------------------------------
# Снос обычного WireGuard.
#
# Юниты именно маскируются, а не отключаются: отключённый юнит возвращается при
# следующем обновлении пакета, и через месяц на узле снова два интерфейса.
# Конфиги не удаляются, а отставляются в сторону — если что-то пойдёт не так,
# по ним можно восстановить прежнее состояние руками.
# ---------------------------------------------------------------------------
purge_wireguard() {
  say "Удаление обычного WireGuard"
  for unit in $(systemctl list-units --all --plain --no-legend 'wg-quick@*' 2>/dev/null | awk '{print $1}'); do
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    systemctl mask "$unit" >/dev/null 2>&1 || true
    info "юнит $unit остановлен и замаскирован"
  done
  systemctl mask 'wg-quick@wg0.service' >/dev/null 2>&1 || true

  for dev in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^wg' || true); do
    ip link del "$dev" 2>/dev/null || true
    info "интерфейс $dev удалён"
  done

  if [ -d /etc/wireguard ]; then
    mv /etc/wireguard "/etc/wireguard.disabled.$(date +%s)" 2>/dev/null || true
    info "конфиги /etc/wireguard отложены в сторону"
  fi

  # Правила, оставленные PostUp прежнего интерфейса. Без этого NAT ссылается на
  # исчезнувшую подсеть и мешает читать вывод iptables при разборе проблем.
  if [ -n "${ETH:-}" ]; then
    while iptables -t nat -C POSTROUTING -s "$SUBNET.0/24" -o "$ETH" -j MASQUERADE 2>/dev/null; do
      iptables -t nat -D POSTROUTING -s "$SUBNET.0/24" -o "$ETH" -j MASQUERADE
    done
  fi
  info "готово"
}

# ---------------------------------------------------------------------------
# Полный сброс: --reset
#
# Отдельный режим, потому что он необратим: новые ключи означают, что все
# выданные профили мертвы и клиентам нужен новый. Именно это и нужно, когда
# узел переезжает или когда после серии ручных экспериментов непонятно, какое
# состояние на машине настоящее.
# ---------------------------------------------------------------------------
reset_all() {
  say "Полный сброс узла"
  systemctl disable --now trioz-vpn-agent >/dev/null 2>&1 || true
  systemctl disable --now "awg-quick@$IFACE" >/dev/null 2>&1 || true
  systemctl reset-failed trioz-vpn-agent "awg-quick@$IFACE" >/dev/null 2>&1 || true
  rm -f "$UNIT"
  rm -rf /etc/systemd/system/trioz-vpn-agent.service.d
  systemctl daemon-reload

  for dev in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^(awg|wg)' || true); do
    ip link del "$dev" 2>/dev/null || true
    info "интерфейс $dev удалён"
  done

  rm -rf "$CONF_DIR" "$STATE_DIR"
  info "ключи, конфиги и набор маскировки удалены"

  # Кэш маршрутов и таблица соединений: после смены интерфейса в ней остаются
  # записи со ссылками на исчезнувшее устройство, и часть пакетов уходит в
  # никуда до истечения их срока.
  ip route flush cache 2>/dev/null || true
  command -v conntrack >/dev/null 2>&1 && conntrack -F >/dev/null 2>&1 || true
  info "кэш маршрутов и таблица соединений очищены"
  info "ВНИМАНИЕ: все ранее выданные профили теперь недействительны"
}

if [ "$MODE" = "reset" ]; then
  reset_all
  info "теперь запустите скрипт без --reset для установки с нуля"
  exit 0
fi

# ---------------------------------------------------------------------------
# Автоопределение сети
# ---------------------------------------------------------------------------
ROUTE="$(ip route get 1.1.1.1 2>/dev/null || true)"
[ -n "$ETH" ] || ETH="$(printf '%s' "$ROUTE" | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)"
PUBIP="$(printf '%s' "$ROUTE" | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -1)"
[ -n "$ETH" ] || die "не удалось определить внешний интерфейс, укажите ETH=..."

if [ -z "$MAIN_URL" ] && [ -f "$REPO/apps/web/.env" ]; then
  MAIN_URL="$(sed -n 's/^NEXTAUTH_URL=//p' "$REPO/apps/web/.env" | tr -d '\"' | tr -d "'" | head -1)"
fi
[ -n "$HOST" ] || HOST="$PUBIP"
[ -n "$MAIN_URL" ] || MAIN_URL="https://$HOST"
[ -n "$HOST" ] || die "не удалось определить точку подключения, укажите --host=..."

# Точка подключения обязана разрешаться в адрес: непроверенное имя уезжает в
# профили всех клиентов, и подключение молча не работает ни у кого.
if ! getent hosts "$HOST" >/dev/null 2>&1; then
  if [ -n "$PUBIP" ]; then
    info "имя $HOST не разрешается в адрес — беру внешний адрес узла $PUBIP"
    HOST="$PUBIP"
  else
    die "точка подключения $HOST не разрешается в адрес"
  fi
fi

# ---------------------------------------------------------------------------
# Диагностика
# ---------------------------------------------------------------------------
if [ "$MODE" = "status" ]; then
  say "Инструмент"
  command -v awg >/dev/null 2>&1 && awg --version || echo "awg не установлен"
  say "Интерфейс $IFACE"
  awg show "$IFACE" 2>/dev/null || echo "интерфейс не поднят"
  say "Маскировка в конфиге"
  grep -E '^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4) *=' "$CONF" 2>/dev/null || echo "параметров нет — узел работает как обычный WireGuard"
  say "Остатки обычного WireGuard (должно быть пусто)"
  ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^wg' || echo "интерфейсов wg нет"
  say "Переадресация и NAT"
  info "ip_forward   = $(sysctl -n net.ipv4.ip_forward)"
  info "rp_filter    = $(sysctl -n net.ipv4.conf.all.rp_filter)"
  info "MASQUERADE   = $(iptables -t nat -S POSTROUTING | grep -c "$SUBNET.0/24" || true)"
  info "MSS clamp    = $(iptables -t mangle -S FORWARD | grep -c "$IFACE" || true)"
  info "вход UDP $PORT = $(iptables -S INPUT | grep -c "dport $PORT" || true)"
  say "Служба агента"
  systemctl is-active trioz-vpn-agent || true
  journalctl -u trioz-vpn-agent -n 12 --no-pager || true
  exit 0
fi

# ---------------------------------------------------------------------------
# Ключ узла для админки
#
# Одна строка вместо шести полей в форме. Причина не в удобстве: набор
# маскировки — это одиннадцать чисел, которые обязаны совпасть на узле и у
# клиента побайтово. Перенос их руками означает, что рано или поздно одно число
# разойдётся, и туннель перестанет вставать без единого сообщения об ошибке.
#
# Ключ содержит токен агента, то есть это СЕКРЕТ: он даёт право отчитываться от
# имени узла. Передавать его в открытых чатах нельзя.
# ---------------------------------------------------------------------------
print_node_key() {
  local pub params json
  pub="$(awg show "$IFACE" public-key 2>/dev/null || true)"
  [ -n "$pub" ] || die "интерфейс $IFACE не поднят — публичный ключ неизвестен"
  [ -s "$TOKEN_PATH" ] || die "нет токена агента ($TOKEN_PATH), запустите установку"
  [ -s "$AWG_PARAMS" ] || die "нет набора маскировки ($AWG_PARAMS), запустите установку"
  # shellcheck disable=SC1090
  . "$AWG_PARAMS"
  params="{\"Jc\":$Jc,\"Jmin\":$Jmin,\"Jmax\":$Jmax,\"S1\":$S1,\"S2\":$S2,\"S3\":$S3,\"S4\":$S4,\"H1\":$H1,\"H2\":$H2,\"H3\":$H3,\"H4\":$H4}"
  json="{\"v\":1,\"host\":\"$HOST\",\"port\":$PORT,\"pub\":\"$pub\",\"token\":\"$(cat "$TOKEN_PATH")\",\"subnet\":\"$SUBNET.0/24\",\"awg\":$params}"
  printf 'TRIOZ-NODE-%s\n' "$(printf '%s' "$json" | base64 -w0)"
}

if [ "$MODE" = "printkey" ]; then
  say "Ключ узла для админки"
  print_node_key
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Обычный WireGuard — вон
# ---------------------------------------------------------------------------
purge_wireguard

# ---------------------------------------------------------------------------
# 2. Установка AmneziaWG
#
# Сначала пробуем модуль ядра: он работает на скорости обычного WireGuard,
# потому что пакеты обрабатываются в ядре. Если ядро нестандартное и DKMS не
# собирается (частый случай на VPS с ядром хостера), падаем на amneziawg-go —
# он медленнее, но работает всегда. Оба управляются одной и той же командой awg,
# поэтому всему остальному коду безразлично, что под ним.
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive

install_awg() {
  if command -v awg >/dev/null 2>&1 && command -v awg-quick >/dev/null 2>&1; then
    info "awg уже установлен: $(awg --version 2>/dev/null | head -1)"
    return 0
  fi

  say "Установка AmneziaWG"
  apt-get update -qq
  apt-get install -y -qq software-properties-common curl ca-certificates >/dev/null 2>&1 || true

  # Официальный репозиторий Amnezia.
  add-apt-repository -y ppa:amnezia/ppa >/dev/null 2>&1 || info "PPA недоступен, пробуем дальше"
  apt-get update -qq || true
  if apt-get install -y -qq amneziawg amneziawg-tools >/dev/null 2>&1; then
    info "установлен модуль ядра amneziawg + инструменты"
  elif apt-get install -y -qq amneziawg-dkms amneziawg-tools >/dev/null 2>&1; then
    info "установлен amneziawg-dkms + инструменты"
  else
    info "пакеты недоступны — собираем amneziawg-go из исходников"
    apt-get install -y -qq git make golang-go >/dev/null
    local build=/opt/amneziawg-go
    rm -rf "$build"
    git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-go "$build" >/dev/null 2>&1 \
      || die "не удалось скачать amneziawg-go (нет доступа к github?)"
    ( cd "$build" && make >/dev/null 2>&1 ) || die "не удалось собрать amneziawg-go"
    install -m 755 "$build/amneziawg-go" /usr/bin/amneziawg-go

    # Инструменты awg/awg-quick нужны в любом случае: именно ими управляет агент.
    local tools=/opt/amneziawg-tools
    rm -rf "$tools"
    git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools "$tools" >/dev/null 2>&1 \
      || die "не удалось скачать amneziawg-tools"
    ( cd "$tools/src" && make >/dev/null 2>&1 && make install >/dev/null 2>&1 ) \
      || die "не удалось собрать amneziawg-tools"
    info "собраны amneziawg-go и amneziawg-tools"
  fi

  apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  command -v awg >/dev/null 2>&1 || die "инструмент awg не найден после установки"
}

install_awg

# ---------------------------------------------------------------------------
# 3. Ключ узла
# ---------------------------------------------------------------------------
mkdir -p "$CONF_DIR" "$STATE_DIR"
chmod 700 "$CONF_DIR" "$STATE_DIR"

if [ ! -s "$KEY_PATH" ]; then
  say "Создание ключа узла"
  ( umask 077; awg genkey > "$KEY_PATH" )
else
  info "ключ узла уже есть — переиспользуем, выданные профили остаются действительными"
fi
chmod 600 "$KEY_PATH"

# ---------------------------------------------------------------------------
# 4. Набор маскировки
#
# Генерируется ОДИН раз на узел и после этого не меняется: он входит в профили
# клиентов, и его смена без перевыпуска профилей означает, что перестают
# подключаться все сразу.
#
# Три ограничения, нарушение которых не даёт внятной ошибки, а просто ломает
# туннель: Jmin < Jmax; S1 + 56 != S2 (иначе размеры пакетов инициации и ответа
# сходятся и реализация перестаёт их различать); H1..H4 попарно различны.
#
# Одинаковый набор на всех узлах свёл бы затею к нулю: он сам стал бы подписью
# сервиса. Поэтому у каждого узла свои числа.
# ---------------------------------------------------------------------------
if [ ! -s "$AWG_PARAMS" ]; then
  say "Генерация набора маскировки"
  rnd() { shuf -i "$1-$2" -n 1; }
  Jmin=$(rnd 24 96)
  Jmax=$((Jmin + $(rnd 48 400)))
  S1=$(rnd 20 80)
  S2=$(rnd 20 80)
  [ "$((S1 + 56))" -eq "$S2" ] && S2=$((S2 + 1))
  H1=$(rnd 10 1000000)
  H2=$((H1 + $(rnd 1000 900000)))
  H3=$((H2 + $(rnd 1000 900000)))
  H4=$((H3 + $(rnd 1000 900000)))
  cat > "$AWG_PARAMS" <<EOF
Jc=$(rnd 3 6)
Jmin=$Jmin
Jmax=$Jmax
S1=$S1
S2=$S2
S3=$(rnd 20 80)
S4=$(rnd 8 32)
H1=$H1
H2=$H2
H3=$H3
H4=$H4
EOF
  chmod 600 "$AWG_PARAMS"
  info "набор создан"
else
  info "набор маскировки уже есть — переиспользуем"
fi
# shellcheck disable=SC1090
. "$AWG_PARAMS"

# ---------------------------------------------------------------------------
# 5. Конфиг интерфейса
#
# Блоков [Peer] здесь нет намеренно: пиров ведёт агент по списку из панели.
# Параметры маскировки стоят до PrivateKey — так их ожидает awg-quick.
# ---------------------------------------------------------------------------
say "Конфиг $CONF"
cat > "$CONF" <<EOF
# Создан deploy/awg-node.sh — правки вручную живут до следующего запуска.
[Interface]
Address = $SUBNET.1/24
ListenPort = $PORT
Jc = $Jc
Jmin = $Jmin
Jmax = $Jmax
S1 = $S1
S2 = $S2
S3 = $S3
S4 = $S4
H1 = $H1
H2 = $H2
H3 = $H3
H4 = $H4
# Приватный ключ хранится отдельным файлом с правами 600, а не внутри конфига.
PostUp = awg set %i private-key $KEY_PATH
PostUp = iptables -t nat -A POSTROUTING -s $SUBNET.0/24 -o $ETH -j MASQUERADE
PostUp = iptables -A FORWARD -i %i -o $ETH -j ACCEPT
PostUp = iptables -A FORWARD -i $ETH -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostUp = iptables -t mangle -A FORWARD -i %i -o $ETH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostUp = iptables -t mangle -A FORWARD -i $ETH -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostDown = iptables -t nat -D POSTROUTING -s $SUBNET.0/24 -o $ETH -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -o $ETH -j ACCEPT
PostDown = iptables -D FORWARD -i $ETH -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostDown = iptables -t mangle -D FORWARD -i %i -o $ETH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostDown = iptables -t mangle -D FORWARD -i $ETH -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
EOF
chmod 600 "$CONF"

# ---------------------------------------------------------------------------
# 6. Настройки ядра
#
# rp_filter в свободном режиме (2), а не строгом: при закреплённом внешнем
# адресе ответ приходит на общий адрес узла, и строгая проверка обратного пути
# молча его отбрасывает.
# tcp_mtu_probing спасает там, где по пути вырезают ICMP: ядро само ищет рабочий
# размер пакета вместо бесконечных повторов одного и того же сегмента — ровно
# та картина, которую мы видели в tcpdump.
# ---------------------------------------------------------------------------
cat > "$SYSCTL" <<'SYSCTL_EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.ipv4.conf.all.rp_filter = 2
net.ipv4.tcp_mtu_probing = 1
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.netfilter.nf_conntrack_max = 262144
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
SYSCTL_EOF
sysctl -q --system >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 7. Поднятие интерфейса
#
# Перезапуск рвёт живые соединения всех клиентов, поэтому делается только когда
# интерфейс не поднят или разошёлся порт.
# ---------------------------------------------------------------------------
say "Интерфейс $IFACE"
systemctl unmask "awg-quick@$IFACE" >/dev/null 2>&1 || true
RUNNING_PORT="$(awg show "$IFACE" listen-port 2>/dev/null || true)"
if [ -z "$RUNNING_PORT" ]; then
  awg-quick up "$IFACE"
  info "интерфейс поднят"
elif [ "$RUNNING_PORT" != "$PORT" ]; then
  info "порт сменился ($RUNNING_PORT -> $PORT): перезапуск, клиентам нужен новый профиль"
  awg-quick down "$IFACE" >/dev/null 2>&1 || true
  awg-quick up "$IFACE"
else
  info "интерфейс уже поднят на порту $PORT — не трогаем, соединения клиентов целы"
fi
systemctl enable "awg-quick@$IFACE" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 8. Входящий порт
# ---------------------------------------------------------------------------
iptables -C INPUT -p udp --dport "$PORT" -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -p udp --dport "$PORT" -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# 9. Токен агента
#
# Токен создаётся ЗДЕСЬ, а не в панели, потому что весь смысл ключа узла — один
# перенос вместо двух. Панель хранит только SHA-256 от него и физически не
# может предъявить сам токен.
# ---------------------------------------------------------------------------
if [ -n "$TOKEN" ]; then
  printf '%s' "$TOKEN" > "$TOKEN_PATH"
elif [ ! -s "$TOKEN_PATH" ]; then
  ( umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_PATH" )
fi
chmod 600 "$TOKEN_PATH"
TOKEN="$(cat "$TOKEN_PATH")"

# ---------------------------------------------------------------------------
# 10. Служба агента
#
# Юнит перезаписывается целиком и без drop-in переопределений: файл с двумя
# строками Environment= даёт молчаливый 401, потому что systemd применяет
# последнюю.
# ---------------------------------------------------------------------------
say "Служба trioz-vpn-agent"
AGENT="$REPO/apps/vpn/src/index.mjs"
[ -f "$AGENT" ] || die "не найден агент $AGENT, укажите --repo=/путь/к/проекту"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || die "node не найден в PATH"

systemctl stop trioz-vpn-agent >/dev/null 2>&1 || true
rm -rf /etc/systemd/system/trioz-vpn-agent.service.d
cat > "$UNIT" <<EOF
[Unit]
Description=TrioZ VPN agent (AmneziaWG)
After=network-online.target awg-quick@$IFACE.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO/apps/vpn
ExecStart=$NODE_BIN $AGENT
Environment=TRIOZ_MAIN_URL=$MAIN_URL
Environment=TRIOZ_AGENT_TOKEN=$TOKEN
Environment=WG_ENDPOINT_HOST=$HOST
Environment=WG_INTERFACE=$IFACE
Environment=WG_TOOL=awg
Environment=WG_CONF_PATH=$CONF
Environment=WG_PRIVATE_KEY_PATH=$KEY_PATH
Environment=WG_PORT=$PORT
Environment=WG_MTU=1280
Restart=always
RestartSec=5

NoNewPrivileges=yes
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$CONF_DIR $STATE_DIR /run
PrivateTmp=yes
PrivateDevices=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallArchitectures=native
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
chmod 600 "$UNIT"
systemctl daemon-reload
systemctl reset-failed trioz-vpn-agent >/dev/null 2>&1 || true
systemctl enable --now trioz-vpn-agent >/dev/null 2>&1
sleep 6
if journalctl -u trioz-vpn-agent --since '-30s' --no-pager | grep -q '401'; then
  info "агент получил 401: узел в панели ещё не создан — это нормально до вставки ключа"
else
  info "агент запущен"
fi

# ---------------------------------------------------------------------------
# 11. Итог
# ---------------------------------------------------------------------------
PUBKEY="$(awg show "$IFACE" public-key 2>/dev/null || echo '-')"
say "Готово"
info "Точка подключения:   $HOST:$PORT (UDP)"
info "Главный сервер:      $MAIN_URL"
info "Интерфейс:           $IFACE (подсеть $SUBNET.0/24, выход через $ETH)"
info "Публичный ключ узла: $PUBKEY"
info "Транспорт:           AmneziaWG с маскировкой (обычного WireGuard на узле нет)"
echo
say "Ключ узла — вставьте его в админке: Админ > Серверы > Добавить по ключу"
print_node_key
echo
info "Ключ содержит токен агента. Это секрет, не публикуйте его."
info "Показать снова:  $0 --print-key"
info "Диагностика:     $0 --status"
info "Сброс начисто:   $0 --reset"
