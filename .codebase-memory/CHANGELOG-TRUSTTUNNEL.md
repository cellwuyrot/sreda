# Изменения вне индекса codebase-memory

Рабочий этап TrustTunnel pilot. Исходный граф `graph.db.zst` сохранён без изменения; `artifact.json` ссылается на более ранний commit, поэтому граф не включает изменения данного архива и не подтверждает их актуальность. После внесения и коммита в настоящий Git-репозиторий обновить граф штатной системой codebase-memory.

- `apps/web/src/lib/trustTunnelPilotPolicy.ts` — чистая политика допуска аккаунта проектного ADMIN, allowlist, fail-closed.
- `apps/web/src/app/api/vpn/trusttunnel/pilot/route.ts` — только read-only статус допуска; реального подключения нет.
- `apps/web/src/lib/vpnProvider.ts` — актуализированы тексты двух блокировок без снятия блокировок.
- `build-desktop.bat` — версия для electron-builder через существующий resolver; Windows-сборка не проверена.
- Подробности и ограничения: `docs/TRUSTTUNNEL-PILOT-WORK-IN-PROGRESS.md`.
