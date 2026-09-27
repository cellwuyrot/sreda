# Проверка исправления на Windows (ещё не выполнена)

1. На Wi-Fi A включить VPN: убедиться, что сайт открывается и внешний IP соответствует VPN. Если нет, сохранить сообщение ошибки, `%ProgramData%\TrioZ\vpn\install.log` и вывод read-only команд ниже до повторных попыток.
2. Не выключая VPN, переключиться на hotspot телефона. Подождать 30–90 секунд и подтвердить UAC, если запрос появится. Проверить «Переподключение…» → «Соединение активно», доступ сайта и новый внешний IP через VPN.
3. Вернуться на Wi-Fi A без ручного «Выкл/Вкл»; повторить проверки. В Task Manager/sc queryex должен быть не более одного TrioZ tunnel PID.
4. Выключить VPN: адаптер `trioz` и созданный приложением /32 должны исчезнуть. Сменить сеть при VPN OFF: служба не должна запускаться. Проверить также паузу без gateway и crash/restart.

Read-only диагностика (PowerShell):
```powershell
Get-Service 'AmneziaWGTunnel$trioz' -ErrorAction SilentlyContinue
Get-NetAdapter -Name 'trioz' -ErrorAction SilentlyContinue
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Format-Table InterfaceIndex,InterfaceAlias,NextHop,RouteMetric
Get-NetRoute -AddressFamily IPv4 | Where-Object DestinationPrefix -Like '*/32' | Format-Table DestinationPrefix,InterfaceIndex,NextHop
```

Не публикуйте `trioz.conf`: в нём приватный ключ. Эти команды ничего не меняют в системе. Если после предыдущего варианта остался `endpoint-route.json` или маршрут через старый gateway и новая версия не смогла очистить его из-за отказа UAC, пришлите точный вывод и лог: нельзя удалять все `/32` или чужие VPN-маршруты вслепую.

**Статус:** тесты A–D на настоящем Windows-ноутбуке не проведены; до них acceptance criteria не подтверждены.
