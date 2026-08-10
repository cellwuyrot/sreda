#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TrioZ / TZ.Connect — межсетевой экран узла (nftables).
#
# Один скрипт на все роли: главный сервер, узел TURN, узел VPN, файловый узел.
# Роль задаётся первым аргументом — набор открытых портов у каждой свой, и это
# главное: узел, на котором нет ничего кроме реле, не должен принимать ничего
# кроме этого реле.
#
#   ./firewall.sh app          сайт: 80/443 (и только они)
#   ./firewall.sh turn         голос: 3478/5349 + диапазон медиа UDP
#   ./firewall.sh vpn          VPN-узел: 51820/udp
#   ./firewall.sh files        отдача файлов: 80/443
#
# ── Как не запереть себя ─────────────────────────────────────────────────────
#
# Самая частая авария при настройке экрана — потерять собственный доступ. Поэтому
# скрипт ТРЕБУЕТ явно указать, откуда разрешён вход по SSH:
#
#   ADMIN_SSH_CIDR=203.0.113.7/32 ./firewall.sh app
#
# Если адрес динамический и указать его нельзя — ALLOW_ANY_SSH=1, но это
# осознанный выбор, а не значение по умолчанию.
#
# ── Про диапазоны прокси ─────────────────────────────────────────────────────
#
# PROXY_CIDRS задаёт, кому вообще можно на 80/443. Заполненный список — это и
# есть настоящее скрытие адреса: домен спрятан за прокси, а origin не отвечает
# никому, кроме него. Пустой список означает «принимаем всех» — рабочее
# состояние на время переезда, но не итоговое.
#
# ── Что скрипт делает всегда ─────────────────────────────────────────────────
#
#   • политика по умолчанию: входящее — запрет, исходящее — разрешено;
#   • свои соединения и loopback — разрешены;
#   • ICMP не глушится: без него ломается определение MTU, а «невидимость» от
#     запрета ping всё равно нулевая;
#   • защита от потока новых соединений и от SYN-флуда — счётчиками на адрес;
#   • правила сохраняются, чтобы выжить перезагрузку.
#
# Идемпотентен: таблица создаётся заново при каждом запуске.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROLE="${1:-}"
ADMIN_SSH_CIDR="${ADMIN_SSH_CIDR:-}"
ALLOW_ANY_SSH="${ALLOW_ANY_SSH:-0}"
SSH_PORT="${SSH_PORT:-22}"
PROXY_CIDRS="${PROXY_CIDRS:-}"
TURN_MEDIA_RANGE="${TURN_MEDIA_RANGE:-49160-49200}"
WG_PORT="${WG_PORT:-51820}"
# Предел новых соединений с одного адреса в минуту. Обычному человеку хватает с
# избытком; перебору и флуду — нет.
CONN_RATE="${CONN_RATE:-120/minute}"
CONN_BURST="${CONN_BURST:-60}"

die() { echo "ОШИБКА: $*" >&2; exit 1; }

case "$ROLE" in
  app|turn|vpn|files) ;;
  *) die "укажите роль: app | turn | vpn | files" ;;
esac

[[ $EUID -eq 0 ]] || die "запускать от root"
command -v nft >/dev/null || die "нет nft — установите nftables"

if [[ -z "$ADMIN_SSH_CIDR" && "$ALLOW_ANY_SSH" != "1" ]]; then
  die "не задан ADMIN_SSH_CIDR. Это защита от того, чтобы закрыть себе вход.
     Пример: ADMIN_SSH_CIDR=203.0.113.7/32 $0 $ROLE
     Если адрес динамический — ALLOW_ANY_SSH=1 $0 $ROLE (осознанно)."
fi

# ── Сборка правил ────────────────────────────────────────────────────────────
rules=$(cat <<'HEAD'
table inet trioz {
  set proxy4 {
    type ipv4_addr
    flags interval
HEAD
)

if [[ -n "$PROXY_CIDRS" ]]; then
  list=$(echo "$PROXY_CIDRS" | tr ',' ' ' | xargs | tr ' ' ',')
  rules+=$'\n    elements = { '"$list"$' }'
fi

rules+=$(cat <<'MID'

  }

  set flood4 {
    type ipv4_addr
    flags dynamic,timeout
    timeout 1m
  }

  chain input {
    type filter hook input priority filter; policy drop;

    # Своё и уже установленное — сразу.
    iif lo accept
    ct state established,related accept
    ct state invalid drop

    # ICMP не глушим: без него ломается определение MTU, а скрытности от
    # запрета ping ноль — адрес и так виден по открытому порту.
    ip protocol icmp icmp type { echo-request, destination-unreachable, time-exceeded, parameter-problem } limit rate 10/second accept
    ip6 nexthdr icmpv6 accept
MID
)

# SSH
if [[ -n "$ADMIN_SSH_CIDR" ]]; then
  rules+=$'\n\n    # Вход только со своего адреса.'
  rules+=$'\n    ip saddr { '"$(echo "$ADMIN_SSH_CIDR" | tr ',' ' ' | xargs | tr ' ' ',')"$' } tcp dport '"$SSH_PORT"$' ct state new accept'
else
  rules+=$'\n\n    # ALLOW_ANY_SSH=1: вход открыт всем — только с ключами и fail2ban.'
  rules+=$'\n    tcp dport '"$SSH_PORT"$' ct state new limit rate 10/minute accept'
fi

# Роли
case "$ROLE" in
  app|files)
    rules+=$'\n\n    # Сайт. Если список прокси задан — только он; иначе все.'
    if [[ -n "$PROXY_CIDRS" ]]; then
      rules+=$'\n    ip saddr @proxy4 tcp dport { 80, 443 } ct state new accept'
      rules+=$'\n    # Прямой заход по адресу, минуя прокси, — молча в никуда.'
      rules+=$'\n    tcp dport { 80, 443 } ct state new drop'
    else
      rules+=$'\n    tcp dport { 80, 443 } ct state new accept'
    fi
    ;;
  turn)
    rules+=$'\n\n    # Голос: сигнальные порты TURN и диапазон медиа.'
    rules+=$'\n    tcp dport { 3478, 5349 } ct state new accept'
    rules+=$'\n    udp dport { 3478, 5349 } accept'
    rules+=$'\n    udp dport '"$TURN_MEDIA_RANGE"$' accept'
    ;;
  vpn)
    rules+=$'\n\n    # VPN-узел: один порт и ничего больше. Своего API у узла нет —'
    rules+=$'\n    # он сам приходит к главному серверу за списком пиров.'
    rules+=$'\n    udp dport '"$WG_PORT"$' accept'
    ;;
esac

# Поток новых соединений
rules+=$'\n\n    # Поток новых соединений с одного адреса. Дальше — в чёрный список'
rules+=$'\n    # на минуту: дешевле, чем считать каждый пакет.'
rules+=$'\n    ct state new add @flood4 { ip saddr limit rate over '"$CONN_RATE"$' burst '"$CONN_BURST"$' packets } drop'

rules+=$(cat <<'TAIL'

    # Всё остальное — тихо в никуда, без ответа: reject подсказывает сканеру,
    # что здесь кто-то есть.
    counter drop
  }

  chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
  }

  chain output {
    type filter hook output priority filter; policy accept;
  }
}
TAIL
)

# ── Применение ───────────────────────────────────────────────────────────────
tmp=$(mktemp)
{
  echo "#!/usr/sbin/nft -f"
  echo "table inet trioz"        # чтобы delete не падал на первом запуске
  echo "delete table inet trioz"
  echo "$rules"
} >"$tmp"

echo "── Проверка правил (роль: $ROLE)"
nft -c -f "$tmp" || { cat "$tmp" >&2; die "правила не приняты, ничего не изменено"; }

echo "── Применение"
nft -f "$tmp"

install -d /etc/nftables.d
install -m 0600 "$tmp" /etc/nftables.d/trioz.nft
rm -f "$tmp"

# Сохранение на перезагрузку: без этого экран исчезнет при первом же ребуте.
if systemctl list-unit-files | grep -q '^nftables.service'; then
  if ! grep -q 'nftables.d/trioz.nft' /etc/nftables.conf 2>/dev/null; then
    echo 'include "/etc/nftables.d/trioz.nft"' >>/etc/nftables.conf
  fi
  systemctl enable nftables >/dev/null 2>&1 || true
  echo "── Правила сохранены и включены на загрузку"
else
  echo "ВНИМАНИЕ: службы nftables нет — правила действуют до перезагрузки."
  echo "Сохранены в /etc/nftables.d/trioz.nft, подключите их сами."
fi

echo
echo "Готово. Открыто:"
nft list table inet trioz | grep -E 'dport|saddr' | sed 's/^/  /'
echo
echo "Проверить со СТОРОННЕЙ машины (не с этого сервера):"
echo "  nmap -Pn -p 22,80,443,3000,3478,5432,6379,51820 <адрес>"
echo "Ожидается: открыты только порты своей роли. 3000, 5432 и 6379 — закрыты."
