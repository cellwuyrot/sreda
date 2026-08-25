@echo off
rem =========================================================================
rem  TZ Connect - sborka Windows-installyatora (Electron + AmneziaWG).
rem  Versiya pod tekushchee derevo proekta (sentyabr, pravka FIX-WINCLIENT).
rem  Polozhite fayl v koren proekta: D:\sreda\build-desktop.bat
rem  Zapusk: dvoynoy klik. Klyuch noclient - sobrat exe BEZ klienta VPN.
rem  Okno NE zakryvaetsya: skript perezapuskaet sebya v cmd /k, poetomu
rem  vidna lyubaya oshibka, dazhe samaya rannyaya.
rem  Otlichiya ot proshlogo batnika:
rem   * novye fayly VPN (winTunnel.ts, vpnClient.ts) NE obyazatelny: esli ih
rem     net, sborka idet dalshe i tolko preduprezhdaet. Ranshe skript zdes
rem     ostanavlivalsya s "ne ta versiya proekta".
rem   * installyator sobiraetsya shtatnym skriptom proekta:
rem     npm run dist -w apps/desktop -- -c.npmRebuild=false
rem  Priemy, kotorye nelzya ubirat:
rem   * npm install --ignore-scripts - u apps/web v postinstall migracii
rem     Prisma, a bazy na mashine sborki net. Electron stavim vruchnuyu.
rem   * -c.npmRebuild=false - inache electron-builder snova polezet stavit
rem     zavisimosti i vyzovet app-builder.exe, kotoryy chistit antivirus.
rem   * USE_SYSTEM_APP_BUILDER + C:\appbuilder - obhod togo zhe antivirusa.
rem   * FIX-WINCLIENT: ryadom s amneziawg.exe nuzhny ego DLL. Bez nih sluzhba
rem     tunnelya sozdaetsya, no srazu umiraet, i v prilozhenii vidno
rem     "tunnel podnyat, svyazi s uzlom net". Skript beret vsyu papku.
rem   * NI ODNOY pustoy stroki, tolko ASCII, kazhdyy vyzov cherez CALL.
rem =========================================================================
setlocal enableextensions
if /i "%TZ_KEEP%"=="1" goto main
set "TZ_KEEP=1"
cmd /k call "%~f0" %*
exit /b
:main
title TZ Connect - sborka desktop
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\apps\desktop\package.json" set "ROOT=%CD%"
set "LOG=%ROOT%\build-desktop.log"
set "APPBUILDER_DIR=C:\appbuilder"
set "CLIENT_ROOT=C:\triozclient"
set "CLIENT_DIR=C:\triozclient\win32"
set "CLIENT_EXE=amneziawg.exe"
set "USE_SYSTEM_APP_BUILDER=true"
set "PATH=%APPBUILDER_DIR%;%PATH%"
set "TRIOZ_CLIENT_SRC=%CLIENT_ROOT%"
set "TRIOZ_CLIENT_PLATFORM=win32"
set "CLIENT_OK=0"
set "NEWCODE=0"
set "ALLOW_NOCLIENT=0"
if /i "%~1"=="noclient" set "ALLOW_NOCLIENT=1"
echo TZ Connect build %DATE% %TIME% > "%LOG%"
echo ==================================================
echo  TZ Connect - sborka Windows-installyatora
echo  Koren proekta : %ROOT%
echo  Klient VPN    : %CLIENT_EXE% (AmneziaWG)
echo  Log           : %LOG%
echo ==================================================
echo [1/9] Proverka okruzheniya
if not exist "%ROOT%\package.json" goto no_root
if not exist "%ROOT%\apps\desktop\package.json" goto no_root
cd /d "%ROOT%"
if errorlevel 1 goto no_root
where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%V in ('node -v') do echo      node : %%V
if not exist "apps\desktop\src\shared\vpnPlan.ts" goto old_tree
if not exist "packages\shared\package.json" goto old_tree
if not exist "apps\desktop\src\main\winTunnel.ts" goto code_old
if not exist "apps\desktop\src\shared\vpnClient.ts" goto code_old
set "NEWCODE=1"
echo      ok : kod VPN s pravkoy FIX-WINCLIENT na meste
goto step_appbuilder
:code_old
echo      VNIMANIE: v proekte staryy kod VPN.
echo      Net apps\desktop\src\main\winTunnel.ts ili src\shared\vpnClient.ts.
echo      Sborka poydet, no u polzovateley ostanetsya oshibka
echo      "tunnel podnyat, svyazi s VPN-uzlom net". Chtoby ee ubrat,
echo      raspakuyte svezhiy arhiv proekta i soberite snova.
:step_appbuilder
echo [2/9] app-builder
if not exist "%APPBUILDER_DIR%\app-builder.exe" goto appbuilder_none
echo      ok : %APPBUILDER_DIR%\app-builder.exe
goto step_client
:appbuilder_none
set "USE_SYSTEM_APP_BUILDER="
echo      net svoego app-builder.exe, budet vzyat iz node_modules.
echo      Esli sborka upadet s "app-builder.exe ENOENT" - eto antivirus:
echo      polozhite app-builder.exe v %APPBUILDER_DIR% i zapustite snova.
:step_client
echo [3/9] Klient VPN
if not exist "%CLIENT_DIR%" mkdir "%CLIENT_DIR%" >nul 2>nul
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_have
call :grab "%ProgramFiles%\AmneziaWG"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_have
call :grab "%ProgramFiles%\Amnezia\AmneziaWG"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_have
call :grab "%ProgramFiles(x86)%\AmneziaWG"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_have
goto client_none
:client_have
set "CLIENT_OK=1"
echo      ok : %CLIENT_DIR%\%CLIENT_EXE%
if exist "%CLIENT_DIR%\wintun.dll" goto client_dll_ok
if exist "%CLIENT_DIR%\tunnel.dll" goto client_dll_ok
echo      VNIMANIE: ryadom s exe net ni odnoy DLL drayvera.
echo      Sluzhba tunnelya v takoy sborke sozdastsya i srazu umret.
echo      Skopiruyte v %CLIENT_DIR% vsyu papku klienta: exe i DLL.
goto step_deps
:client_dll_ok
echo      ok : DLL drayvera na meste
goto step_deps
:client_none
echo      %CLIENT_EXE% ne nayden.
if "%ALLOW_NOCLIENT%"=="0" goto need_client
echo      rezhim noclient: sborka budet BEZ VPN.
:step_deps
echo [4/9] Zavisimosti - npm install --ignore-scripts
call npm install --ignore-scripts
if errorlevel 1 goto deps_fail
echo [5/9] Electron - skripty byli otklyucheny, stavim vruchnuyu
if not exist "node_modules\electron\install.js" goto no_electron
call node node_modules\electron\install.js
if errorlevel 1 goto fail
echo [6/9] Obshchiy kod - packages/shared
call npm run build:shared
if errorlevel 1 goto shared_fail
if not exist "node_modules\@trioz\shared" goto shared_link
echo [7/9] Sborka koda apps/desktop
call npm run build -w apps/desktop
if errorlevel 1 goto fail
if not exist "apps\desktop\dist\main\index.js" goto fail
if not exist "apps\desktop\dist\preload\index.js" goto fail
if "%NEWCODE%"=="0" goto step_vendor
if not exist "apps\desktop\dist\main\winTunnel.js" goto tsc_partial
echo      ok : winTunnel.js skompilirovan
:step_vendor
echo [8/9] Ukladka klienta v resursy
if "%CLIENT_OK%"=="0" goto vendor_soft
call npm run vendor:client:strict -w apps/desktop
if errorlevel 1 goto fail
if not exist "apps\desktop\resources\wireguard\win32\%CLIENT_EXE%" goto vendor_bad
echo      ok : klient v resources\wireguard\win32
dir /b apps\desktop\resources\wireguard\win32
goto step_dist
:vendor_soft
call npm run vendor:client -w apps/desktop
if errorlevel 1 goto fail
echo      VNIMANIE: sborka budet BEZ klienta VPN.
:step_dist
echo [9/9] Sborka installyatora - electron-builder
call npm run dist -w apps/desktop -- -c.npmRebuild=false
if errorlevel 1 goto dist_fail
if not exist "apps\desktop\release" goto dist_fail
if "%CLIENT_OK%"=="0" goto done_noclient
if not exist "apps\desktop\release\win-unpacked\resources\wireguard\%CLIENT_EXE%" goto no_client_in_build
echo ==================================================
echo  GOTOVO. Installyator sobran, klient AmneziaWG vnutri.
echo ==================================================
dir /b apps\desktop\release\*.exe
goto done
:done_noclient
echo ==================================================
echo  Installyator sobran, NO BEZ klienta VPN.
echo  Knopka vklyucheniya v takoy sborke vydast oshibku.
echo ==================================================
dir /b apps\desktop\release\*.exe
goto done
:grab
if not exist "%~1\%CLIENT_EXE%" exit /b 0
copy /y "%~1\%CLIENT_EXE%" "%CLIENT_DIR%\" >nul 2>nul
copy /y "%~1\*.dll" "%CLIENT_DIR%\" >nul 2>nul
echo      vzyat klient iz %~1
exit /b 0
:tsc_partial
echo Kod sobralsya, no net apps\desktop\dist\main\winTunnel.js.
echo Znachit tsc ne uvidel novyy fayl: proverte, chto winTunnel.ts lezhit
echo imenno v apps\desktop\src\main, i udalite papku apps\desktop\dist.
goto fail
:need_client
echo ==================================================
echo  STOP: net vstroennogo klienta VPN.
echo ==================================================
echo  Nuzhna papka %CLIENT_DIR% s faylami: %CLIENT_EXE% i ego DLL.
echo  Obychnyy wireguard.exe NE goditsya: on ne ponimaet parametry
echo  maskirovki Jc/S1-S4/H1-H4, i uzel budet molchat.
echo  Puti: 1) ustanovit AmneziaWG for Windows - skript naydet sam;
echo        2) sobrat amneziawg-windows-client i skopirovat papku celikom.
echo  Nuzhen exe bez VPN dlya proverki interfeisa: build-desktop.bat noclient
goto fail
:vendor_bad
echo Klient ne popal v resources\wireguard\win32.
echo Proverte LAYOUT v apps\desktop\scripts\vendor-wireguard.mjs
goto fail
:no_client_in_build
echo V sobrannom prilozhenii net klienta:
echo apps\desktop\release\win-unpacked\resources\wireguard
echo Proverte extraResources v apps\desktop\electron-builder.yml
goto fail
:dist_fail
echo Electron-builder ne sobral installyator.
echo Chastye prichiny: zanyat fayl v apps\desktop\release (zakroyte
echo ustanovlennoe prilozhenie i provodnik), libo antivirus s
echo app-builder.exe - polozhite ego v %APPBUILDER_DIR%.
goto fail
:deps_fail
echo Ustanovka zavisimostey ne proshla.
echo Zakroyte TrioZ Connect i npm run dev, zapustite snova.
echo Esli povtoryaetsya EPERM - udalite papku node_modules vruchnuyu.
goto fail
:no_electron
echo Ne nayden node_modules\electron\install.js
echo Udalite node_modules i zapustite skript snova.
goto fail
:shared_fail
echo Ne sobralsya paket packages/shared. Bez nego apps/desktop vydast
echo TS2307 Cannot find module '@trioz/shared'.
goto fail
:shared_link
echo Net ssylki node_modules\@trioz\shared.
echo Zapustite v korne: npm install --ignore-scripts
goto fail
:old_tree
echo V etoy papke net proekta TZ Connect. Nuzhny fayly:
echo   apps\desktop\src\shared\vpnPlan.ts
echo   packages\shared\package.json
goto fail
:no_root
echo Ne nayden proekt ryadom s etim faylom.
echo Polozhite build-desktop.bat v koren proekta - tuda, gde lezhat
echo package.json i papka apps.
echo Papka skripta: %~dp0
goto fail
:no_node
echo Ne nayden node ili npm v PATH.
echo Ustanovite Node.js 20+ i otkroyte okno zanovo.
goto fail
:fail
echo ==================================================
echo  OSHIBKA SBORKI. Smotrite soobshcheniya vyshe.
echo ==================================================
exit /b 1
:done
echo Gotovo. Okno mozhno zakryt.
exit /b 0
