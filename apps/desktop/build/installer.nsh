; SERVICE-TUNNEL: регистрация служебного компонента туннеля.
;
; Права администратора запрашиваются ОДИН раз — здесь, на установке. Дальше
; кнопка включения работает без UAC: приложение просит туннель у собственного
; компонента, а тот уже работает с правами системы: создаёт адаптер Wintun,
; правит маршруты и DNS.
;
; Почему команды идут через .bat, а не прямым вызовом nsExec: `schtasks /TR`
; требует вложенных кавычек вокруг пути с пробелами («Program Files»), а через
; три слоя разбора строки (NSIS → CreateProcess → CRT) это тихо ломает путь и
; даёт задание, которое никогда не запускается. В .bat текст пишется буквально.

!macro customInstall
  DetailPrint "VPN: используется встроенный клиент AmneziaWG"
  ; Старый служебный компонент TrioZ больше не устанавливается: Windows-туннель
  ; поднимает официальный wireguard.exe через /installtunnelservice.
!macroend

!macro customUnInstall
  ; FIX-UNINSTALL: удаление программы обязано уводить ЗА СОБОЙ и сетевое
  ; оборудование. Раньше снимались только задание и каталог заявок, а адаптер
  ; Wintun, его маршруты и DNS оставались в системе — то есть программы уже нет,
  ; а трафик продолжал уходить в исчезнувший интерфейс.
  ;
  ; Порядок важен: сначала гасим задание и клиента (иначе компонент поднимет
  ; адаптер заново сразу после удаления), потом снимаем маршруты, и только
  ; потом убираем само устройство.
  SetShellVarContext all
  DetailPrint "Удаление сетевого оборудования VPN..."
  FileOpen $0 "$PLUGINSDIR\trioz-service-off.bat" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "schtasks /End /TN $\"TriozTunnelAgent$\"$\r$\n"
  FileWrite $0 "schtasks /Delete /TN $\"TriozTunnelAgent$\" /F$\r$\n"
  FileWrite $0 "taskkill /F /IM wireguard.exe$\r$\n"
  FileWrite $0 "taskkill /F /IM amneziawg.exe$\r$\n"
  ; Маршруты °двух половин° и DNS туннеля — теми же командами, что и при
  ; обычном выключении: единый список проще держать в согласии.
  FileWrite $0 "netsh interface ipv4 delete route 0.0.0.0/1 interface=trioz store=active$\r$\n"
  FileWrite $0 "netsh interface ipv4 delete route 128.0.0.0/1 interface=trioz store=active$\r$\n"
  FileWrite $0 "netsh interface ipv4 set dnsservers name=trioz dhcp validate=no$\r$\n"
  ; Само устройство: Wintun создаёт его как обычный сетевой адаптер, и сам он
  ; не исчезает, если клиент был снят аварийно. Удаляем по InstanceId — имя
  ; адаптера могло быть переименовано системой (trioz, trioz 2 и так далее).
  FileWrite $0 "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Get-PnpDevice -Class Net -ErrorAction SilentlyContinue | Where-Object { $$_.FriendlyName -match 'Wintun|TrioZ|trioz' } | ForEach-Object { pnputil /remove-device $$_.InstanceId }$\"$\r$\n"
  FileWrite $0 "sc delete AmneziaWGTunnel$$trioz$\r$\n"
  FileWrite $0 "sc delete WireGuardTunnel$$trioz$\r$\n"
  FileWrite $0 "ipconfig /flushdns$\r$\n"
  FileClose $0
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c "$PLUGINSDIR\trioz-service-off.bat"'
  Pop $1
  DetailPrint "Уборка сетевого компонента: код $1"
  ; Каталог заявок и всё содержимое: профиль, сводки, журнал клиента.
  RMDir /r "$APPDATA\TrioZ"
!macroend
