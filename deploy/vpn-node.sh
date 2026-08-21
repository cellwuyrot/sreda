#!/usr/bin/env bash
# =============================================================================
# TrioZ / TZ.Connect - FIX-VPNSCRIPT + FIX-NOAWG: установка VPN-узла одной командой.
#
# Скрипт ставит обычный WireGuard (инструмент wg), поднимает интерфейс, настраивает
# NAT и службу агента. Всё, что можно вычислить, вычисляется само: внешний
# интерфейс, адрес сервера, домен главного сервера. Руками нужно дать только
# токен агента из панели.
#
#   Админ > Серверы > добавить узел (Дочерний, назначение Соединение) > токен
#
# Запуск:
#   sudo ./deploy/vpn-node.sh --token=ТОКЕН
#   sudo ./deploy/vpn-node.sh --token=ТОКЕН --host=vpn.example.ru --port=51820
#   sudo ./deploy/vpn-node.sh --status          диагностика, ничего не меняет
#   sudo ./deploy/vpn-node.sh --purge-awg       только снести остатки маскировки
#
# Скрипт идемпотентен. Приватный ключ узла переиспользуется, поэтому публичный
# ключ и выданные адреса пиров не меняются.
#
# FIX-NOAWG: почему здесь больше нет AmneziaWG (инструмент awg, интерфейс awg0).
# Прежняя версия поднимала маскированный интерфейс И оставляла рядом обычный wg0.
# На живом узле это кончилось так: awg-quick@awg0 падал каждую попытку
# («awg0' already exists», тот же адрес 10.8.0.1/24, что у поднятого wg0),
# служба висела в failed с 19 августа, ничего не слушало объявленный порт 443 —
# а панель при этом показывала узел «устойчивым к блокировкам» и выдавала
# клиентам профили со строками Jc/S1/H1. Обычный WireGuard такие профили
# отбрасывает молча: рукопожатия нет, ошибки нет, объяснить нечем.
# Один работающий интерфейс лучше двух, из которых один мёртв.
# =============================================================================
set -euo pipefail

TOKEN="${TOKEN:-}"
HOST="${HOST:-}"
PORT="${PORT:-51820}"
MAIN_URL="${MAIN_URL:-}"
IFACE="${IFACE:-wg0}"
REPO="${REPO:-/var/www/trioz}"
ETH="${ETH:-}"
SUBNET="10.8.0"
CONF_DIR="/etc/wireguard"
KEY_PATH="/etc/wireguard/trioz-private.key"
UNIT="/etc/systemd/system/trioz-vpn-agent.service"
SYSCTL="/etc/sysctl.d/99-trioz-vpn.conf"
MODE="install"

for arg in "$@"; do
  case "$arg" in
    --token=*) TOKEN="${arg#*=}" ;;
    --host=*) HOST="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    --main=*) MAIN_URL="${arg#*=}" ;;
    --iface=*) IFACE="${arg#*=}" ;;
    --repo=*) REPO="${arg#*=}" ;;
    --status) MODE="status" ;;
    --purge-awg) MODE="purge" ;;
    -h|--help) MODE="help" ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 1 ;;
  esac
done

CONF="$CONF_DIR/$IFACE.conf"

say()  { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

if [ "$MODE" = "help" ]; then
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

[ "$(id -u)" = "0" ] || die "запускать надо от root (sudo)"

# -- FIX-NOAWG: снос маскированного интерфейса -------------------------------
# Выполняется ВСЕГДА, а не только по флагу: пока на машине жив мёртвый awg0,
# каждый диагностический вывод показывает две правды одновременно, и разобраться
# в них нельзя. Юнит именно маскируется (mask), а не просто отключается: иначе
# он вернётся при следующем обновлении пакета.
purge_awg() {
  say "Удаление остатков маскировки (awg)"
  for unit in $(systemctl list-units --all --plain --no-legend 'awg-quick@*' 2>/dev/null | awk '{print $1}'); do
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    systemctl mask "$unit" >/dev/null 2>&1 || true
    info "юнит $unit остановлен и замаскирован"
  done
  systemctl mask 'awg-quick@awg0.service' >/dev/null 2>&1 || true
  for dev in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^awg' || true); do
    ip link del "$dev" 2>/dev/null || true
    info "интерфейс $dev удалён"
  done
  if [ -d /etc/amnezia ]; then
    mv /etc/amnezia "/etc/amnezia.disabled.$(date +%s)" 2>/dev/null || true
    info "конфиги /etc/amnezia отложены в сторону (не удалены)"
  fi
  # Правила NAT/MSS, оставленные PostUp прежнего интерфейса, иначе висят вечно.
  if [ -n "${ETH:-}" ]; then
    iptables -t nat -D POSTROUTING -s "$SUBNET.0/24" -o "$ETH" -j MASQUERADE 2>/dev/null || true
  fi
  info "готово: на узле остаётся один интерфейс — $IFACE"
}

if [ "$MODE" = "purge" ]; then
  purge_awg
  exit 0
fi

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

# FIX-ENDPOINTDNS: точка подключения обязана РАЗРЕШАТЬСЯ в адрес.
#
# На живом узле в переменной стояло vpn1.trioz.ru, у которого нет ни одной
# записи в DNS. Агент честно сообщал этот адрес главному серверу, тот подставлял
# его в профили, и подключение зависело от того, задан ли адрес руками в карточке
# узла. Стоило его очистить — переставало работать у всех, причём молча.
# Непроверяемое имя лучше заменить на адрес, который точно работает.
if ! getent hosts "$HOST" >/dev/null 2>&1; then
  if [ -n "$PUBIP" ]; then
    info "ВНИМАНИЕ: имя $HOST не разрешается в адрес - беру внешний адрес узла $PUBIP"
    info "Если имя нужно, создайте A-запись $HOST -> $PUBIP и запустите скрипт снова."
    HOST="$PUBIP"
  else
    die "точка подключения $HOST не разрешается в адрес, а внешний адрес не определён"
  fi
fi

# -- Диагностика -------------------------------------------------------------
if [ "$MODE" = "status" ]; then
  say "Служба агента"
  systemctl is-active trioz-vpn-agent || true
  systemctl show trioz-vpn-agent -p Environment | tr ' ' '\n' | sed 's/^Environment=//' | grep -v '^$' || true
  say "Интерфейс $IFACE"
  wg show "$IFACE" 2>/dev/null || echo "интерфейс не поднят"
  say "Остатки маскировки (должно быть пусто)"
  ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^awg' || echo "интерфейсов awg нет"
  systemctl is-enabled 'awg-quick@awg0' 2>/dev/null || echo "юнит awg-quick@awg0 не активен"
  say "Точка подключения"
  info "объявляется: $HOST:$PORT"
  info "разрешается в: $(getent hosts "$HOST" | awk '{print $1}' | head -1)"
  say "Переадресация и NAT"
  info "ip_forward = $(sysctl -n net.ipv4.ip_forward)"
  info "MASQUERADE = $(iptables -t nat -S POSTROUTING | grep -c "$SUBNET.0/24" || true)"
  info "MSS clamp  = $(iptables -t mangle -S FORWARD | grep -c "$IFACE" || true)"
  info "вход UDP $PORT = $(iptables -S INPUT | grep -c "dport $PORT" || true)"
  say "Журнал агента"
  journalctl -u trioz-vpn-agent -n 12 --no-pager || true
  exit 0
fi

purge_awg

# -- 1. Пакеты ---------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive

if ! command -v wg >/dev/null 2>&1; then
  say "Установка WireGuard"
  apt-get update -qq
  apt-get install -y -qq wireguard wireguard-tools >/dev/null
else
  info "WireGuard уже установлен"
fi
apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
command -v wg >/dev/null 2>&1 || die "инструмент wg не найден после установки"

# -- 2. Ключ узла ------------------------------------------------------------
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
if [ ! -s "$KEY_PATH" ]; then
  say "Создание ключа узла"
  ( umask 077; wg genkey > "$KEY_PATH" )
else
  info "ключ узла уже есть - переиспользуем, выданные профили остаются действительными"
fi
chmod 600 "$KEY_PATH"

# -- 3. Конфиг интерфейса ----------------------------------------------------
# Блоков [Peer] здесь нет намеренно: пиров ведёт агент через `wg set`, по списку
# из панели. Файл описывает только сам интерфейс.
say "Конфиг $CONF"
cat > "$CONF" <<EOF
# Создан deploy/vpn-node.sh - правки вручную переживут только до следующего запуска.
[Interface]
Address = $SUBNET.1/24
ListenPort = $PORT
# Приватный ключ хранится отдельным файлом с правами 600, а не внутри конфига.
PostUp = wg set %i private-key $KEY_PATH
PostUp = iptables -t nat -A POSTROUTING -s $SUBNET.0/24 -o $ETH -j MASQUERADE
PostUp = iptables -t mangle -A FORWARD -i %i -o $ETH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostDown = iptables -t nat -D POSTROUTING -s $SUBNET.0/24 -o $ETH -j MASQUERADE
PostDown = iptables -t mangle -D FORWARD -i %i -o $ETH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
EOF
chmod 600 "$CONF"

# -- 4. Настройки ядра -------------------------------------------------------
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

# -- 5. Поднятие интерфейса --------------------------------------------------
# Интерфейс перезапускается только если он ещё не поднят ИЛИ порт разошёлся с
# требуемым: перезапуск рвёт живые соединения всех клиентов, и делать его "на
# всякий случай" при каждом запуске скрипта нельзя.
say "Интерфейс $IFACE"
RUNNING_PORT="$(wg show "$IFACE" listen-port 2>/dev/null || true)"
if [ -z "$RUNNING_PORT" ]; then
  wg-quick up "$IFACE"
  info "интерфейс поднят"
elif [ "$RUNNING_PORT" != "$PORT" ]; then
  info "порт сменился ($RUNNING_PORT -> $PORT): перезапуск интерфейса, клиентам нужен новый профиль"
  wg-quick down "$IFACE" >/dev/null 2>&1 || true
  wg-quick up "$IFACE"
else
  info "интерфейс уже поднят на порту $PORT - не трогаем, соединения клиентов целы"
fi
systemctl enable "wg-quick@$IFACE" >/dev/null 2>&1 || true

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
After=network-online.target wg-quick@$IFACE.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO/apps/vpn
ExecStart=$NODE_BIN $AGENT
Environment=TRIOZ_MAIN_URL=$MAIN_URL
Environment=TRIOZ_AGENT_TOKEN=$TOKEN
Environment=WG_ENDPOINT_HOST=$HOST
Environment=WG_INTERFACE=$IFACE
Environment=WG_TOOL=wg
Environment=WG_CONF_PATH=$CONF
Environment=WG_PRIVATE_KEY_PATH=$KEY_PATH
Environment=WG_PORT=$PORT
Restart=always
RestartSec=5

# FIX-HARDEN: агенту нужны ровно две вещи — менять сетевые настройки и читать
# свой конфиг. Всё остальное у процесса, работающего от root, отбирается.
# Зачем это нужно: агент выполняет внешние программы (wg/iptables) и разбирает
# ответ главного сервера. Если когда-нибудь в этой цепочке найдётся дыра,
# ограничения ниже определят разницу между «испорчена сеть» и «машина
# полностью чужая».
NoNewPrivileges=yes
# Права на сеть оставлены, всё прочее из набора root вычеркнуто.
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
# Файловая система только для чтения, кроме явно перечисленного ниже.
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/etc/wireguard /run
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
PUBKEY="$(wg show "$IFACE" public-key 2>/dev/null || echo '-')"
say "Готово"
info "Точка подключения:   $HOST:$PORT"
info "Главный сервер:      $MAIN_URL"
info "Интерфейс:           $IFACE  (подсеть $SUBNET.0/24, выход через $ETH)"
info "Публичный ключ узла: $PUBKEY"
info "Тип подключения:     обычный WireGuard (другого больше нет)"
echo
info "Осталось в панели:"
info "1. Админ > Серверы: у узла точка подключения $HOST:$PORT."
info "2. Админ > Надёжное соединение: сервис включён, режим «Весь трафик», лимит 0."
info "3. Пользователю: /connect > включить соединение."
info "Диагностика в любой момент: $0 --status"
