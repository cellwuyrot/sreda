# Встроенный клиент туннеля (VPN-EMBEDDED)

Сюда `scripts/vendor-wireguard.mjs` кладёт бинарники клиента, которые
`electron-builder` через `extraResources` переносит в `resourcesPath/wireguard`
готового приложения. Именно этот клиент поднимает туннель — пользователю
не нужно ставить WireGuard или AmneziaWG самостоятельно.

Ожидаемые файлы:

| Каталог | Файлы |
|---|---|
| `win32/` | `wireguard.exe`, `wg.exe` |
| `darwin/` | `wireguard-go`, `wg` |
| `linux/` | `wireguard-go`, `wg` |

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
