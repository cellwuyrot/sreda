# TrioZ — агент сборки приложений

Собирает Android-клиент (APK) и установщик Windows **на сервере**, по нажатию в
админке. Готовые файлы кладёт в то же хранилище загрузок, откуда они раздавались
раньше: адрес скачивания не меняется.

## Как это устроено

Модель «на вытягивание», та же, что у VPN-узла. Агент раз в десять секунд
приходит на `POST /api/builds/next` с токеном, получает задачу, выполняет
скрипт сборки и отчитывается кусками журнала на `POST /api/builds/{id}`.
Входящего порта у агента нет.

Обычно агент работает **на главном сервере** — так и задумано. Но именно из-за
односторонней связи его можно перенести на отдельную машину (в том числе на
настоящую Windows) без единой правки кода: переезжает служба, а не логика.

```
Админка «Сборки» → задача в очереди
        ↓
Агент: /api/builds/next → скрипт → журнал → /api/builds/{id}
        ↓
apps/web/public/desktop/  →  /about и /desktop/ раздают как раньше
```

## Что нужно на машине

| Для чего | Что ставить |
|---|---|
| Всегда | Node 20+, git |
| Android | JDK 17, Android SDK (platforms;android-34, build-tools;34.0.0), `ANDROID_HOME` |
| Windows | `wine64` |

```bash
apt install -y openjdk-17-jdk-headless wine64 unzip
```

Android SDK ставится один раз командной строкой:

```bash
mkdir -p /opt/android-sdk/cmdline-tools && cd /opt/android-sdk/cmdline-tools
# скачать commandlinetools-linux-*.zip с developer.android.com, распаковать в latest/
yes | ./latest/bin/sdkmanager --licenses
./latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
```

## Отдельный клон репозитория

**Сборка не должна идти в рабочем каталоге сайта.** Она делает `git reset
--hard` и перетряхивает `node_modules` — в каталоге, откуда работает
приложение, это означало бы падение сайта посреди сборки. Скрипты это
проверяют и отказываются работать, если видят рядом `apps/web/.env`.

```bash
git clone <репозиторий> /var/lib/trioz-build/repo
```

## Запись в панели и токен

**Серверы → Добавить узел**, назначение **Сборка**, роль дочерняя — даже если
агент физически работает на главном сервере. Запись описывает АГЕНТА, а не
машину; благодаря этому перенос сборки на другой сервер не требует правок.

Токен показывается один раз.

## Служба

`/etc/systemd/system/trioz-builder.service`:

```ini
[Unit]
Description=TrioZ build agent
After=network-online.target

[Service]
Type=simple
User=trioz
WorkingDirectory=/var/lib/trioz-build
Environment=TRIOZ_MAIN_URL=https://ваш.домен
Environment=TRIOZ_AGENT_TOKEN=<токен из панели>
Environment=TRIOZ_BUILD_REPO=/var/lib/trioz-build/repo
Environment=TRIOZ_ARTIFACT_DIR=/var/www/trioz/apps/web/public/desktop
Environment=ANDROID_HOME=/opt/android-sdk
Environment=JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ExecStart=/usr/bin/node /var/lib/trioz-build/repo/apps/builder/src/index.mjs
Restart=always
RestartSec=15
# Сборка не должна отбирать процессор у сайта.
Nice=15
IOSchedulingClass=idle
# И не должна съесть всю память машины.
MemoryMax=4G

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now trioz-builder
journalctl -u trioz-builder -f
```

Пользователю `trioz` нужно право писать в `TRIOZ_ARTIFACT_DIR`.

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `TRIOZ_MAIN_URL` | — | адрес главного сервера, обязательно |
| `TRIOZ_AGENT_TOKEN` | — | токен из панели, обязательно |
| `TRIOZ_BUILD_REPO` | `/var/lib/trioz-build/repo` | отдельный клон под сборку |
| `TRIOZ_ARTIFACT_DIR` | `/var/www/trioz/apps/web/public/desktop` | хранилище загрузок |
| `TRIOZ_POLL_MS` | `10000` | как часто спрашивать работу |
| `TRIOZ_BUILD_TIMEOUT_MS` | `2400000` | предел на одну сборку (40 минут) |
| `TRIOZ_APK_NAME` | `connect.apk` | имя APK в хранилище |

## Подпись

**Android.** Положите `apps/android/app/keystore.properties` (в git его нет):

```
storeFile=app/trioz-release.jks
storePassword=…
keyAlias=trioz
keyPassword=…
```

Есть файл — собирается подписанный release. Нет — собирается debug: неподписанный
release всё равно не установится, и отдавать его людям нечего.

Ключ создаётся один раз и **не теряется**: сменить его нельзя, обновление
приложения с другим ключом система не примет.

```bash
keytool -genkeypair -v -keystore trioz-release.jks -keyalg RSA -keysize 4096 \
  -validity 10000 -alias trioz
```

**Windows.** Подписи Authenticode нет: при установке система покажет «издатель
неизвестен». Подпись требует купленного сертификата — когда он появится,
добавляется отдельным шагом, приложение переделывать не придётся.

## Диагностика

```bash
journalctl -u trioz-builder -n 100     # что делает агент
ls -la /var/www/trioz/apps/web/public/desktop
```

Журнал самой сборки виден в админке, в карточке задачи, — туда его шлёт агент
по ходу работы.

| Что видно | Что означает |
|---|---|
| `401` | токен отозван или узел выключен в панели |
| `Узел не назначен сборщиком` | у записи в панели назначение не «Сборка» |
| задача висит «Ожидает» | агент не запущен или не видит сервер |
| «Агент сборки перестал отвечать» | процесс умер во время сборки; смотреть journalctl |
| `не найден wine` | цель Windows на машине без wine |
