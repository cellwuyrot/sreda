# Интеграция WireGuard for Windows в TrioZ Connect

## Что изменилось

Windows-ветка VPN переведена с самописного бэкенда `wireguard-go + Wintun + netsh`
на официальный `wireguard.exe` из проекта wireguard-windows.

Теперь TrioZ Connect на Windows не создаёт Wintun-интерфейс и маршруты вручную.
Он пишет профиль `trioz.conf` и вызывает официальный механизм:

```powershell
wireguard.exe /installtunnelservice <path-to-trioz.conf>
```

Дальше работает официальный WireGuard for Windows:

- служба `WireGuardTunnel$trioz`;
- WireGuardNT-драйвер;
- штатное назначение адреса клиента из `Address`;
- штатные DNS-настройки;
- штатный full-tunnel и endpoint-exclude;
- удаление через `/uninstalltunnelservice trioz`.

## Какие файлы проекта затронуты

- `apps/desktop/src/main/vpn.ts` — Windows теперь запускает `wireguard.exe
  /installtunnelservice`, а не `vpnHelper.ts`.
- `apps/desktop/src/shared/vpnEmbedded.ts` — для Windows ожидаемый бинарник теперь
  `wireguard.exe` / `amneziawg.exe`.
- `apps/desktop/scripts/vendor-wireguard.mjs` — для `win32` копируется
  `wireguard.exe`, `wintun.dll` больше не требуется.
- `apps/desktop/build/installer.nsh` — старый TrioZ Tunnel Agent больше не
  устанавливается; при удалении чистится `WireGuardTunnel$trioz`.
- `apps/desktop/resources/wireguard/README.md` — обновлена инструкция по бинарникам.

`vpnHelper.ts` оставлен для Linux/macOS. Для Windows он больше не участвует в
подъёме туннеля.

## Как подготовить бинарники

### Вариант А: взять из установленного WireGuard for Windows

1. Установите официальный WireGuard for Windows.
2. Скопируйте:

```powershell
C:\Program Files\WireGuard\wireguard.exe
```

в каталог источников бинарников:

```text
vpn-bin/
  win32/
    wireguard.exe
```

### Вариант Б: собрать wireguard-windows

1. Откройте репозиторий wireguard-windows.
2. Следуйте его `docs/buildrun.md`.
3. После сборки положите полученный `wireguard.exe` в:

```text
vpn-bin/win32/wireguard.exe
```

## Как собрать TrioZ Connect

Из корня проекта:

```bash
# разложить Windows-клиент в ресурсы desktop-приложения
cd apps/desktop
TRIOZ_CLIENT_SRC=/absolute/path/to/vpn-bin node scripts/vendor-wireguard.mjs --platform win32

# или строгий релизный вариант
TRIOZ_CLIENT_SRC=/absolute/path/to/vpn-bin npm run vendor:client:strict

# затем сборка приложения
npm run build
npm run dist
```

После сборки в установленном приложении должен быть файл:

```text
<папка установки>
esources\wireguard\wireguard.exe
```

## Как включается VPN

1. Веб-часть получает профиль WireGuard от сервера TrioZ.
2. Desktop пишет его в `C:\ProgramData\TrioZ\tunnel\trioz.conf`.
3. Desktop с повышением прав запускает:

```powershell
wireguard.exe /installtunnelservice C:\ProgramData\TrioZ\tunnel\trioz.conf
```

4. WireGuard создаёт службу `WireGuardTunnel$trioz`.
5. Отключение выполняется командой:

```powershell
wireguard.exe /uninstalltunnelservice trioz
```

## Проверка после установки

В PowerShell от администратора:

```powershell
Get-Service WireGuardTunnel$trioz
Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'WireGuard|Wintun' }
Get-NetRoute -AddressFamily IPv4 | Where-Object {
  $_.DestinationPrefix -in @('0.0.0.0/1','128.0.0.0/1')
} | Format-Table DestinationPrefix,NextHop,InterfaceIndex,RouteMetric,InterfaceAlias -Auto
```

Для full-tunnel должны появиться маршруты `0.0.0.0/1` и `128.0.0.0/1`, созданные
официальной службой WireGuard.

## Как очистить старый самописный туннель

Если на машине уже запускались старые сборки TrioZ с `wireguard-go`, перед тестом
лучше очистить хвосты:

```powershell
schtasks /End /TN "TriozTunnelAgent"
schtasks /Delete /TN "TriozTunnelAgent" /F
sc.exe delete WireGuardTunnel$trioz
taskkill /F /IM wireguard-go.exe
taskkill /F /IM amneziawg-go.exe
taskkill /F /IM wireguard.exe

netsh interface ipv4 delete route 0.0.0.0/1 interface=trioz store=active
netsh interface ipv4 delete route 128.0.0.0/1 interface=trioz store=active
netsh interface ipv4 set dnsservers name=trioz dhcp validate=no
ipconfig /flushdns
```

Если старый Wintun-адаптер остался в системе, удалите его в диспетчере устройств
или через PowerShell/PnPUtil.

## В чём была трудность

WireGuard handshake сам по себе не доказывает, что Windows full-tunnel работает.
У TrioZ была самописная реализация того, что в WireGuard for Windows уже давно
решено: выбор реального интерфейса, endpoint-exclude, порядок маршрутов, DNS,
rollback, особенности Wintun/ifIndex. Поэтому баги проявлялись как «handshake
есть, сервер видит трафик, но интернет не идёт». Перенос Windows-ветки на
wireguard-windows убирает этот класс ошибок: маршрутизацией занимается официальный
клиент, а проект TrioZ отвечает только за получение и передачу профиля.
