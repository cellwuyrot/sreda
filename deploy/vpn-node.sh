#!/usr/bin/env bash
# =============================================================================
# TrioZ / TZ.Connect - FIX-VPNSCRIPT: установка VPN-узла (AmneziaWG) одной командой.
#
# Скрипт ставит обфусцированный WireGuard (инструмент awg), поднимает интерфейс,
# настраивает NAT и службу агента. Всё, что можно вычислить, вычисляется само:
# внешний интерфейс, адрес сервера, домен главного сервера, параметры маскировки.
# Руками нужно дать только токен агента из панели.
#
#   Админ > Серверы > добавить узел (Дочерний, назначение Соединение) > токен
#
# Запуск:
#   sudo ./deploy/vpn-node.sh --token=ТОКЕН
#   sudo ./deploy/vpn-node.sh --token=ТОКЕН --host=trioz.ru --port=443
#   sudo ./deploy/vpn-node.sh --status          диагностика, ничего не меняет
#   sudo ./deploy/vpn-node.sh --token=ТОКЕН --renew-params   новые параметры маскировки
#
# Скрипт идемпотентен. Приватный ключ узла переиспользуется, поэтому публичный
# ключ и выданные адреса пиров не меняются. Параметры маскировки тоже сохраняются:
# их смена требует перевыпуска всех профилей, поэтому только по --renew-params.
#
# Порт по умолчанию 443/udp, а не 51820: 51820 узнаваем и часто режется в гостевых
# и мобильных сетях, а UDP 443 проходит почти везде и не конфликтует с nginx,
# который занимает TCP 443.
# =============================================================================
set -euo pipefail

TOKEN="${TOKEN:-}"
HOST="${HOST:-}"
PORT="${PORT:-443}"
MAIN_URL="${MAIN_URL:-}"
IFACE="${IFACE:-awg0}"
REPO="${REPO:-/var/www/trioz}"
ETH="${ETH:-}"
SUBNET="10.8.0"
CONF_DIR="/etc/amnezia/amneziawg"
KEY_PATH="/etc/wireguard/trioz-private.key"
UNIT="/etc/systemd/system/trioz-vpn-agent.service"
SYSCTL="/etc/sysctl.d/99-trioz-vpn.conf"
MODE="install"
RENEW_PARAMS=0

for arg in "$@"; do
  case "$arg" in
    --token=*) TOKEN="${arg#*=}" ;;
    --host=*) HOST="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    --main=*) MAIN_URL="${arg#*=}" ;;
    --iface=*) IFACE="${arg#*=}" ;;
    --repo=*) REPO="${arg#*=}" ;;
    --renew-params) RENEW_PARAMS=1 ;;
    --status) MODE="status" ;;
    -h|--help) MODE="help" ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 1 ;;
  esac
done

CONF="$CONF_DIR/$IFACE.conf"

say()  { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

if [ "$MODE" = "help" ]; then
  sed -n '3,27p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

[ "$(id -u)" = "0" ] || die "запускать надо от root (sudo)"

# -- Автоопределение сети ----------------------------------------------------
ROUTE="$(ip route get 1.1.1.1 2>/dev/null || true)"
[ -n "$ETH" ] || ETH="$(printf '%s' "$ROUTE" | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)"
PUBIP="$(printf '%s' "$ROUTE" | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -1)"
[ -n "$ETH" ] || die "не удалось определить внешний интерфейс, укажите ETH=..."

# Домен главного сервера берётся из .env проекта, если узел стоит рядом с сайтом.
if [ -z "$MAIN_URL" ] && [ -f "$REPO/apps/web/.env" ]; then
  MAIN_URL="$(sed -n 's/^NEXTAUTH_URL=//p' "$REPO/apps/web/.env" | tr -d '\"' | tr -d "'" | head -1)"
fi
if [ -z "$HOST" ] && [ -n "$MAIN_URL" ]; then
  HOST="$(printf '%s' "$MAIN_URL" | sed -e 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##' -e 's#/.*##' -e 's/:.*//')"
fi
[ -n "$HOST" ] || HOST="$PUBIP"
[ -n "$MAIN_URL" ] || MAIN_URL="https://$HOST"
[ -n "$HOST" ] || die "не удалось определить точку подключения, укажите --host=..."

# -- Диагностика -------------------------------------------------------------
if [ "$MODE" = "status" ]; then
  say "Служба агента"
  systemctl is-active trioz-vpn-agent || true
  systemctl show trioz-vpn-agent -p Environment | tr ' ' '\n' | sed 's/^Environment=//' | grep -v '^$' || true
  say "Интерфейс $IFACE"
  awg show "$IFACE" 2>/dev/null || echo "интерфейс не поднят"
  say "Переадресация и NAT"
  info "ip_forward = $(sysctl -n net.ipv4.ip_forward)"
  info "MASQUERADE = $(iptables -t nat -S POSTROUTING | grep -c "$SUBNET.0/24" || true)"
  info "MSS clamp  = $(iptables -t mangle -S FORWARD | grep -c "$IFACE" || true)"
  info "вход UDP $PORT = $(iptables -S INPUT | grep -c "dport $PORT" || true)"
  say "Журнал агента"
  journalctl -u trioz-vpn-agent -n 12 --no-pager || true
  exit 0
fi

# -- 1. Пакеты ---------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive

if ! command -v awg >/dev/null 2>&1; then
  say "Установка AmneziaWG"
  apt-get update -qq
  apt-get install -y -qq software-properties-common ca-certificates >/dev/null
  if ! grep -Rqs amnezia /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
    add-apt-repository -y ppa:amnezia/ppa >/dev/null
  fi
  apt-get update -qq
  apt-get install -y -qq "linux-headers-$(uname -r)" >/dev/null || info "заголовки ядра не встали - проверьте вручную"
  apt-get install -y -qq amneziawg amneziawg-tools >/dev/null
else
  info "AmneziaWG уже установлен"
fi
apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true

modprobe amneziawg 2>/dev/null || true
lsmod | grep -q amneziawg || info "модуль ядра не загружен - возможно, нужна перезагрузка после сборки DKMS"
command -v awg >/dev/null 2>&1 || die "инструмент awg не найден после установки"

# -- 2. Ключ узла ------------------------------------------------------------
mkdir -p /etc/wireguard "$CONF_DIR"
chmod 700 /etc/wireguard "$CONF_DIR"
if [ ! -s "$KEY_PATH" ]; then
  say "Создание ключа узла"
  ( umask 077; awg genkey > "$KEY_PATH" )
else
  info "ключ узла уже есть - переиспользуем, выданные профили остаются действительными"
fi
chmod 600 "$KEY_PATH"

# -- 3. Параметры маскировки -------------------------------------------------
# Границы те же, что проверяет сервер (NUMERIC_BOUNDS в apps/web/src/lib/vpn.ts).
read_param() { sed -n "s/^$1 *= *//p" "$CONF" 2>/dev/null | head -1; }

if [ -f "$CONF" ] && [ "$RENEW_PARAMS" = "0" ] && [ -n "$(read_param Jc)" ]; then
  JC="$(read_param Jc)"; JMIN="$(read_param Jmin)"; JMAX="$(read_param Jmax)"
  S1="$(read_param S1)"; S2="$(read_param S2)"
  H1="$(read_param H1)"; H2="$(read_param H2)"; H3="$(read_param H3)"; H4="$(read_param H4)"
  info "параметры маскировки сохранены из текущего конфига"
else
  say "Генерация параметров маскировки"
  JC=$(( RANDOM % 4 + 3 ))
  JMIN=$(( RANDOM % 20 + 30 ))
  JMAX=$(( JMIN + 20 + RANDOM % 20 ))
  S1=$(( RANDOM % 16 + 12 ))
  S2=$(( RANDOM % 16 + 20 ))
  H1=$(( 1000000 + RANDOM * 30 ))
  H2=$(( H1 + 1000000 + RANDOM * 20 ))
  H3=$(( H2 + 1000000 + RANDOM * 20 ))
  H4=$(( H3 + 1000000 + RANDOM * 20 ))
  [ "$RENEW_PARAMS" = "1" ] && info "ПАРАМЕТРЫ ОБНОВЛЕНЫ: всем пользователям нужен новый файл подключения"
fi

# -- 4. Конфиг интерфейса ----------------------------------------------------
say "Конфиг $CONF"
cat > "$CONF" <<EOF
# Создан deploy/vpn-node.sh - правки вручную переживут только до следующего запуска.
[Interface]
Address = $SUBNET.1/24
ListenPort = $PORT
Jc = $JC
Jmin = $JMIN
Jmax = $JMAX
S1 = $S1
S2 = $S2
H1 = $H1
H2 = $H2
H3 = $H3
H4 = $H4
# Приватный ключ хранится отдельным файлом с правами 600, а не внутри конфига.
PostUp = awg set %i private-key $KEY_PATH
PostUp = iptables -t nat -A POSTROUTING -s $SUBNET.0/24 -o $ETH -j MASQUERADE
PostUp = iptables -t mangle -A FORWARD -i %i -o $ETH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostDown = iptables -t nat -D POSTROUTING -s $SUBNET.0/24 -o $ETH -j MASQUERADE
PostDown = iptables -t mangle -D FORWARD -i %i -o $ETH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
EOF
chmod 600 "$CONF"

# -- 5. Переадресация и старый интерфейс -------------------------------------
# FIX-NETTUNE: настройки ядра шлюза.
#
# ip_forward обязателен — без него узел вообще не пересылает пакеты.
# rp_filter в свободном режиме (2), а не строгом: при закреплённом внешнем
# адресе ответ приходит на общий адрес, и строгая проверка обратного пути молча
# его отбрасывает — снаружи это выглядит как «часть клиентов не работает».
# tcp_mtu_probing спасает там, где фаервол по пути вырезает ICMP: ядро само
# ищет рабочий размер пакета вместо бесконечных повторов.
# fq + bbr заметно держат скорость при потерях: обычный контроль перегрузок
# принимает любую потерю за перегрузку и режет полосу на мобильных сетях в разы.
# Запас таблицы соединений: при её переполнении узел начинает терять пакеты
# выборочно и молча.
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
net.ipv4.conf.all.accept_source_route = 0
SYSCTL_EOF
# Часть значений есть не на всех ядрах (bbr, conntrack). Ошибка по одной строке
# не должна валить установку целиком — поэтому вывод глушится, а итог виден в
# отчёте ниже.
sysctl -q --system >/dev/null 2>&1 || sysctl -q -p "$SYSCTL" >/dev/null 2>&1 || true

if [ "$IFACE" != "wg0" ]; then
  systemctl disable --now wg-quick@wg0 >/dev/null 2>&1 || true
  if ip link show wg0 >/dev/null 2>&1; then ip link del wg0 || true; fi
  iptables -t mangle -D FORWARD -i wg0 -o "$ETH" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
fi

say "Поднятие интерфейса $IFACE"
awg-quick down "$IFACE" >/dev/null 2>&1 || true
awg-quick up "$IFACE"
systemctl enable "awg-quick@$IFACE" >/dev/null 2>&1 || true

# -- 6. Входящий порт и сохранение правил ------------------------------------
iptables -C INPUT -p udp --dport "$PORT" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport "$PORT" -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
  info "правила сохранены и выживут перезагрузку"
fi

# -- 7. Служба агента --------------------------------------------------------
# Юнит всегда перезаписывается ЦЕЛИКОМ и без drop-in переопределений: файл с двумя
# строками Environment= даёт молчаливый 401, потому что systemd применяет последнюю.
if [ -n "$TOKEN" ]; then
  say "Служба trioz-vpn-agent"
  AGENT="$REPO/apps/vpn/src/index.mjs"
  [ -f "$AGENT" ] || die "не найден агент $AGENT, укажите --repo=/путь/к/проекту"
  NODE_BIN="$(command -v node || true)"
  [ -n "$NODE_BIN" ] || die "node не найден в PATH"
  systemctl stop trioz-vpn-agent >/dev/null 2>&1 || true
  rm -rf /etc/systemd/system/trioz-vpn-agent.service.d
  cat > "$UNIT" <<EOF
[Unit]
Description=TrioZ VPN agent
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
Restart=always
RestartSec=5

# FIX-HARDEN: агенту нужны ровно две вещи — менять сетевые настройки и читать
# свой конфиг. Всё остальное у процесса, работающего от root, отбирается.
# Зачем это нужно: агент выполняет внешние программы (wg/awg/iptables) и
# разбирает ответ главного сервера. Если когда-нибудь в этой цепочке найдётся
# дыра, ограничения ниже определят разницу между «испорчена сеть» и «машина
# полностью чужая».
NoNewPrivileges=yes
# Права на сеть оставлены, всё прочее из набора root вычеркнуто.
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
# Файловая система только для чтения, кроме явно перечисленного ниже.
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/etc/wireguard /etc/amnezia /run
PrivateTmp=yes
# Ключ узла и токен агента лежат в файлах: доступ к устройствам не нужен.
PrivateDevices=yes
ProtectKernelTunables=no
ProtectKernelModules=no
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
  sleep 8
  if journalctl -u trioz-vpn-agent --since '-40s' --no-pager | grep -q '401'; then
    info "АГЕНТ ПОЛУЧИЛ 401: токен не подошёл. Создайте узел в панели заново и"
    info "перезапустите скрипт с новым токеном."
  else
    info "агент запущен"
  fi
else
  info "токен не передан - служба агента не настраивалась (--token=...)"
fi

# -- 8. Итог -----------------------------------------------------------------
PUBKEY="$(awg show "$IFACE" public-key 2>/dev/null || echo '-')"
say "Готово"
info "Точка подключения:   $HOST:$PORT"
info "Главный сервер:      $MAIN_URL"
info "Интерфейс:           $IFACE  (подсеть $SUBNET.0/24, выход через $ETH)"
info "Публичный ключ узла: $PUBKEY"
info "Маскировка:          Jc=$JC Jmin=$JMIN Jmax=$JMAX S1=$S1 S2=$S2 H1=$H1 H2=$H2 H3=$H3 H4=$H4"
echo
info "Осталось в панели:"
info "1. Админ > Серверы: у узла точка подключения $HOST:$PORT и тип «Устойчивое к блокировкам»."
info "2. Админ > Надёжное соединение: сервис включён, режим «Весь трафик», лимит 0."
info "3. Пользователю: /connect > включить соединение и сразу скачать файл подключения."
info "Диагностика в любой момент: $0 --status"
