# AWG 3.1: выполненные проверки

## Локально пройдено

- 306 тестов Vitest в 12 файлах: существующая VPN-логика, API выдачи и отчётов,
  фильтры агента, валидация 3.x, импорт ключа узла, сборка .conf, упаковка vpn://,
  сохранение каскадного Endpoint, desktop-парсеры и UAPI.
- TypeScript --strict --noEmit: awg3.ts, awgParams.ts, wgKeys.ts,
  amneziaVpnProfile.ts, desktop awg3Uapi.ts. Это не полный typecheck монорепозитория.
- node --check для агента и скрипта проверки компонентов.
- Java 17: скомпилированы все 25 Java-файлов локального awg-tunnel с Android API 34
  из Robolectric android-all и compile dependencies. Это не Gradle/Android-сборка.
- Kotlin 2.2.0, JVM 17: скомпилированы VpnProfile.kt и VpnKeyStore.kt против новой
  Java-библиотеки и Android API. Controller/service APK таким способом не проверены.
- Сверены JNI export-символы официального libwg-go.so с Java native API.
- SHA-256 MSI/APK совпадают с GitHub asset digest; проверены хеши вложенных
  Windows EXE/DLL и Android SO. Windows amneziawg.exe в исходном архиве уже был
  побайтово тем же официальным 3.1.0.

## Команда тестов (после установки зависимостей проекта)

Из корня репозитория:

```bash
node scripts/verify-awg31-components.mjs
node --check apps/vpn/src/index.mjs
npm exec -- vitest run --config apps/web/vitest.config.ts \
  apps/web/src/lib/nodeKey-awg3.test.ts \
  apps/web/src/lib/awg3.test.ts \
  apps/web/src/lib/awgParams.test.ts \
  apps/web/src/lib/wgKeys.test.ts \
  apps/web/src/lib/amneziaVpnProfile.test.ts \
  apps/web/src/lib/vpn.test.ts \
  apps/web/src/app/api/servers/report/route.test.ts \
  apps/web/src/app/api/vpn/me/route.test.ts \
  apps/vpn/src/awg-params.test.mjs \
  apps/vpn/src/rules.test.mjs \
  apps/desktop/src/shared/awg3Uapi.test.ts \
  apps/desktop/src/shared/vpnEmbedded.test.ts
```

Добавлен Android-тест VpnProfileTest.preservesAwg31AndCascadeEndpoint. Он должен
запускаться через Android Gradle test pipeline на машине с SDK/JDK. Здесь этот
Robolectric-тест не запускался, в число 306 не входит.

## Не выполнено

- Полные npm build/typecheck монорепозитория, Gradle assemble/test, сборка и подпись
  установщика Windows/APK, проверка обновления приложения на устройстве.
- Нативный запуск Android JNI, VPN consent/foreground service, Windows UAC/service,
  реальные AWG handshakes, скорость и доступ в интернет с новыми параметрами.
- Запуск или изменение каких-либо команд на FINLAND/turn/основном сервере.

Исправление не объявляется production-проверенным. Серверные параметры и ключи
остаются неизменными до отдельного согласованного переключения.
