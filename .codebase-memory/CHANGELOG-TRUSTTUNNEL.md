# Изменения вне индекса codebase-memory

Рабочий этап TrustTunnel pilot. Исходный граф `graph.db.zst` сохранён без изменения; `artifact.json` ссылается на более ранний commit, поэтому граф не включает изменения данного архива и не подтверждает их актуальность. После внесения и коммита в настоящий Git-репозиторий обновить граф штатной системой codebase-memory.

- `apps/web/src/lib/trustTunnelPilotPolicy.ts` — чистая политика допуска аккаунта проектного ADMIN, allowlist, fail-closed.
- `apps/web/src/app/api/vpn/trusttunnel/pilot/route.ts` — только read-only статус допуска; реального подключения нет.
- `apps/web/src/lib/vpnProvider.ts` — актуализированы тексты двух блокировок без снятия блокировок.
- `build-desktop.bat` — версия для electron-builder через существующий resolver; Windows-сборка не проверена.
- Подробности и ограничения: `docs/TRUSTTUNNEL-PILOT-WORK-IN-PROGRESS.md`.

## Этап 2

- `apps/vpn/src/trusttunnel_credentials.py`: чистая изолированная подготовка snapshots учётных данных Endpoint 1.1.0, без записи файлов и связи с приложением.
- `apps/vpn/src/trusttunnel_credentials_test.py`: локальные тесты, фиктивные данные.
- `docs/TRUSTTUNNEL-PILOT-STAGE2.md`: наблюдения владельца, проверенные границы и невыполненная работа. Граф не перестроен и не содержит новый код.

## Локальная атомарная запись
- `apps/vpn/src/trusttunnel_atomic_store.py` и тест: экспериментальная CAS-запись в файлы; в проект не подключена и на VDS не применялась.
- `docs/TRUSTTUNNEL-PILOT-ATOMIC-STORE.md` описывает ограничения и следующие шаги. Индекс codebase-memory не обновлён.

## Подготовка выдачи пилотного профиля
- `apps/web/src/lib/trustTunnelClientConfig.ts` и `trustTunnelPilotBundle.ts`: проверка и расшифровка AES-GCM; не интегрированы с клиентами и не готовы к развёртыванию.
- `apps/web/src/app/api/vpn/trusttunnel/pilot/config/route.ts` и тест: отдельный POST с авторизацией проектного ADMIN, allowlist, rate limit, audit и закрытым флагом; выдача профиля не является работающим VPN-соединением.
- `docs/TRUSTTUNNEL-PILOT-PROFILE-ISSUANCE-WIP.md` содержит ограничения. Граф не перестроен.

## Android SDK: черновик вне сборки
- `apps/android/app/src/trustTunnelPilot/java/ru/trioz/connect/TrustTunnelPilotService.kt`: изолированный экспериментальный нативный сервис; не включён в Gradle, manifest или bridge, не собирался и не запускался.
- `docs/TRUSTTUNNEL-ANDROID-SERVICE-WIP.md`: ограничения, проверка TLS и оставшиеся задачи. Граф не перестроен.

## Индекс получен с connect

На основе пользовательского архива сохранены graph.db.zst и artifact.json с commit 17e5f3ec1d53897713475cf98926a682fe804a67. Граф не включает последующие незакоммиченные наработки этого рабочего архива; предыдущие записи о неизменном графе относятся к моменту их написания. Переиндексировать после интеграции и коммита.

## Локальная упаковка контейнера (черновик)
- `scripts/trusttunnel-pilot-seal.mjs` и тест: офлайн-упаковка фиктивных или предоставленных оператором записей в AES-GCM, без подключения к Endpoint и без развёртывания. Проверка совместимости с обработчиком выполнена на фиктивных данных. Безопасная загрузка, хранение и ротация не реализованы. Граф не перестроен.

## Локальный согласованный снимок пилота
- `apps/vpn/src/trusttunnel_pilot_plan.py` и тест: подготовка в памяти согласованных Endpoint TOML и JSON-контейнера для индивидуальных учётных данных, без записи файлов или подключения к службам.
- `scripts/trusttunnel-pilot-plan-interop.node-test.mjs`: проверка совместимости Python-планировщика и Node-упаковщика на фиктивных данных.
- В веб-обработчике контейнера добавлен отказ при повторном использовании пароля.
- Ограничения и остающиеся блокеры: `docs/TRUSTTUNNEL-PILOT-SNAPSHOT-WIP.md`. Граф не перестроен.

## Android debug и офлайн-подготовка — не релиз
- Добавлены debug-only сервис/мост, строгий валидатор профиля, отдельная панель VPN для проектного ADMIN, операторская проверка наличия профиля и тесты с фиктивными данными. Android ARM64 debug локально собран; устройство и сеть не проверены.
- Добавлен локально собранный AAR SDK TrustTunnel 1.1.12 и лицензия; источник и SHA-256 указаны в docs/TRUSTTUNNEL-ANDROID-SERVICE-WIP.md.
- scripts/trusttunnel-pilot-stage.py и тесты: только закрытая офлайн-подготовка, не применение к серверу.
- Windows TrustTunnel, безопасное применение и отзыв credentials, доставка между узлами и окончательная проверка не реализованы. Пилот не включать. Кодовый граф не перестроен.

## Локальный серверный контур и подготовка Windows — не релиз
- `trusttunnel_pilot_transaction.py`: журналируемое локальное применение и восстановление на фиктивных данных, без межсерверной транзакции.
- `trusttunnel-pilot-apply.py`, `trusttunnel_pilot_stage_verify.py`, `trusttunnel_pilot_gcm.py`: экспериментальное применение и сверка зашифрованного снимка через OpenSSL 3 без Node на VDS; реальная конфигурация и работоспособность на VDS не подтверждены.
- `trustTunnelPilotSecret.ts` и `trusttunnel-pilot-verify-secret.mjs`: чтение и проверка защищённого совмещённого контейнера; безопасная доставка между узлами не реализована.
- `apps/desktop/src/shared/trustTunnelPilotProfile.ts`: проверка формата без Windows-подключения. 51 Python и 4 Node локальных теста на фиктивных данных. Подробности и ограничения: `docs/TRUSTTUNNEL-TRANSACTION-WIP.md`. Граф устарел, требуется переиндексация.
