# Отчёт по Windows AmneziaWG handoff

## Изменённые исходники
- `apps/desktop/src/main/networkHandoff.ts` — baseline физического интерфейса, debounce, ожидание шлюза 30 секунд, три попытки с задержками 2/4 секунды, отмена по VPN OFF.
- `apps/desktop/src/main/winNetwork.ts` — текущий default route на физическом hardware-интерфейсе, InterfaceIndex/Alias, IPv4, NextHop, DNS, проверка gateway, DNS A через физический сервер, принадлежность endpoint /32, точная проверка маршрута, свежий handshake AWG (`/dumplog` или `awg show`).
- `apps/desktop/src/main/vpn.ts` — сохранение маршрута при старте, stop/wait PID/adapter → удаление старого route → новый uplink → новый route → запуск AWG → service/adapter/route/handshake/RX, состояние connecting/error до подтверждения, cleanup при off/crash/quit и диагностические логи.
- `apps/desktop/src/main/index.ts` — запуск фонового наблюдения после startup cleanup.
- `apps/desktop/src/main/winTunnel.ts` и `apps/desktop/src/shared/vpnClient.ts` — TrioZ AmneziaWG-only service lookup; существующий stop/wait/fallback без затрагивания других адаптеров.
- `apps/web/src/components/connect/overlays/PremiumInfoModal.tsx` — «Переподключение…» при handoff, без зелёного connected до проверок.
- `scripts/test-vpn-handoff.mjs`, `scripts/test-vpn-win-network.mjs`, `scripts/test-vpn-tunnel-lifecycle.mjs` — 27 новых моделируемых тестов, плюс 15 существующих desktop-recovery тестов.

## Что ещё требуется на Windows
См. `WINDOWS-VPN-HANDOFF-TEST.md` для A–D. Без реального ноутбука нельзя подтвердить доступ к интернету через VPN или единственный Tunnel PID после смены сети. Запрос UAC при каждой привилегированной операции остаётся унаследованным свойством приложения: **автоматический unattended reconnect не доказан и может требовать подтверждения UAC**. Для полного acceptance потребуется заранее установленный доверенный привилегированный компонент с ограниченным интерфейсом команд; отключать UAC не следует. IPv6 endpoint и отдельная прикладная проба узла не реализованы; обработка IPv6 fail-closed.

## Выполненные проверки
`npm run build:shared`; `npm run typecheck -w apps/desktop` — OK. `node --test scripts/test-vpn-handoff.mjs scripts/test-vpn-win-network.mjs scripts/test-vpn-tunnel-lifecycle.mjs scripts/test-desktop-recovery.mjs` — 42/42 OK. Веб typecheck в полном объёме заблокирован отсутствующим сгенерированным Prisma Client (`npm ci --ignore-scripts`), ошибок в отредактированном UI-файле проверка не показала. Windows ручной тест — **не выполнен**.
