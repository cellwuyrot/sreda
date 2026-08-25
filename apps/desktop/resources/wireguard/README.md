# Встроенный клиент туннеля

`scripts/vendor-wireguard.mjs` кладёт сюда бинарники клиента. `electron-builder`
переносит их в `resourcesPath/wireguard` готового приложения, вне `asar`.

## Ожидаемые файлы

| Каталог | Файлы |
|---|---|
| `win32/` | `wireguard.exe` из wireguard-windows |
| `darwin/` | `wireguard-go` |
| `linux/` | `wireguard-go` |

## Windows

На Windows больше не используется самописная связка `wireguard-go.exe` +
`wintun.dll` + ручные команды `netsh`. Нужен официальный `wireguard.exe` из
проекта wireguard-windows. Приложение вызывает его так:

```powershell
wireguard.exe /installtunnelservice C:\ProgramData\TrioZ\tunnel\trioz.conf
```

Официальный клиент создаёт службу `WireGuardTunnel$trioz` и использует
WireGuardNT. Адреса, DNS, endpoint-exclude и full-tunnel маршруты применяются
официальным кодом WireGuard for Windows.

Где взять `wireguard.exe`:

1. Установить официальный WireGuard for Windows и взять файл:
   `C:\Program Files\WireGuard\wireguard.exe`.
2. Или собрать репозиторий wireguard-windows по его `docs/buildrun.md`.

## Сборка

```bash
# пример структуры источника
/path/to/vpn-bin/win32/wireguard.exe
/path/to/vpn-bin/linux/wireguard-go
/path/to/vpn-bin/darwin/wireguard-go

# строгая укладка бинарников для релиза
TRIOZ_CLIENT_SRC=/path/to/vpn-bin npm run vendor:client:strict

# только Windows
TRIOZ_CLIENT_SRC=/path/to/vpn-bin node scripts/vendor-wireguard.mjs --platform win32
```

В обычный `npm run build` входит мягкий вариант `--allow-missing`, чтобы dev-сборка
без бинарников не ломалась. Для релиза используйте `vendor:client:strict`.
