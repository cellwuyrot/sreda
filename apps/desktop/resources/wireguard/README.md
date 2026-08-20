# Встроенный клиент туннеля (VPN-EMBEDDED)

Сюда `scripts/vendor-wireguard.mjs` кладёт бинарники клиента, которые
`electron-builder` через `extraResources` переносит в `resourcesPath/wireguard`
готового приложения. Именно этот клиент поднимает туннель — пользователю
не нужно ставить WireGuard или AmneziaWG самостоятельно.

Ожидаемые файлы:

| Каталог | Файлы |
|---|---|
| `win32/` | `wireguard-go.exe`, `wintun.dll` |
| `darwin/` | `wireguard-go` |
| `linux/` | `wireguard-go` |

Важно про Windows: нужен именно `wireguard-go.exe`, а НЕ официальный
`wireguard.exe`. Официальный не умеет поднимать туннель сам: он просит службу-
менеджер WireGuard (без неё — «The specified service does not exist as an
installed service») и на любой непонятный аргумент открывает своё окно.

Где взять:

- `wireguard-go.exe` — собрать из исходников (готовых бинарников под Windows
  проект не выкладывает): `go build -o wireguard-go.exe golang.zx2c4.com/wireguard/...`
  — точная команда есть в `build-desktop.bat`.
- `wintun.dll` — `https://www.wintun.net/builds/wintun-0.14.1.zip`, файл `bin\amd64\wintun.dll`
  (подписанный распространяемый драйвер тех же авторов).

Сами файлы в git не хранятся: три платформы — это десятки мегабайт в истории
навсегда, а заменить их потом нельзя без такого же роста.

Сборка:

```bash
# строго: без клиента сборка остановится (так надо для релиза)
TRIOZ_CLIENT_SRC=/путь/к/бинарникам npm run vendor:client:strict

# сразу под все платформы
TRIOZ_CLIENT_SRC=/путь/к/бинарникам node scripts/vendor-wireguard.mjs --platform all
```

В `npm run build` входит мягкий вариант (`--allow-missing`), чтобы разработка без
бинарников не ломалась. В такой сборке включение скажет: «Встроенный клиент
отсутствует в этой сборке. Пересоберите приложение с шагом vendor:client.»
