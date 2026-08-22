@echo off
rem ==========================================================================
rem  TZ Connect - sborka Windows-installyatora (Electron + AmneziaWG).
rem  Struktura i priemy vzyaty iz rabochey versii skripta, izmenen klient:
rem   * Ranshe: wireguard-go.exe + wintun.dll (svoya realizaciya tunnelya).
rem     Teper: amneziawg.exe iz amneziawg-windows-client. Prichina - provayder
rem     MGTS rezhet transportnye pakety obychnogo WireGuard, i tunnel
rem     podnimalsya, no trafik ne shel. AmneziaWG maskiruet ih.
rem   * Obychnyy wireguard.exe NE goditsya: on ne ponimaet parametry
rem     Jc/Jmin/Jmax/S1-S4/H1-H4, i uzel takie pakety otbrasyvaet molcha.
rem  Priemy, kotorye nelzya ubirat:
rem   * USE_SYSTEM_APP_BUILDER + svoy app-builder.exe v C:\appbuilder. Binarnik
rem     v node_modules regulyarno vychishchaet antivirus, i electron-builder
rem     padaet s nechitaemym "spawn ... app-builder.exe ENOENT".
rem   * npm install --ignore-scripts. U apps/web v postinstall stoit
rem     "prisma generate && prisma migrate deploy", a migracii trebuyut zhivoy
rem     bazy, kotoroy na mashine sborki net. Electron stavim vruchnuyu posle.
rem   * dist s -c.npmRebuild=false - inache electron-builder snova polezet
rem     stavit production dependencies i snova vyzovet app-builder.
rem   * NI ODNOY pustoy stroki, tolko ASCII, kazhdyy vyzov cherez CALL,
rem     proverka IF ERRORLEVEL, lyuboy vyhod cherez PAUSE.
rem ==========================================================================
setlocal enableextensions
title TZ Connect - sborka desktop
set "LOG=%~dp0build-desktop.log"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\apps\desktop\package.json" set "ROOT=%CD%"
set "APPBUILDER_DIR=C:\appbuilder"
set "APPBUILDER_VER=5.0.0-alpha.10"
set "CLIENT_ROOT=C:\triozclient"
set "CLIENT_DIR=C:\triozclient\win32"
set "CLIENT_EXE=amneziawg.exe"
set "USE_SYSTEM_APP_BUILDER=true"
set "PATH=%APPBUILDER_DIR%;%PATH%"
set "TRIOZ_CLIENT_SRC=%CLIENT_ROOT%"
set "TRIOZ_CLIENT_PLATFORM=win32"
set "CLIENT_OK=0"
set "ALLOW_NOCLIENT=0"
if /i "%~1"=="noclient" set "ALLOW_NOCLIENT=1"
echo TZ Connect build %DATE% %TIME% > "%LOG%"
echo ==================================================
echo  TZ Connect - sborka Windows-installyatora
echo  Klient VPN: %CLIENT_EXE% (AmneziaWG)
echo  Log: %LOG%
echo ==================================================
echo [1/9] Proverka okruzheniya
if not exist "%ROOT%\package.json" goto no_root
if not exist "%ROOT%\apps\desktop\package.json" goto no_root
cd /d "%ROOT%"
if errorlevel 1 goto no_root
echo      koren proekta : %CD%
where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%V in ('node -v') do echo      node          : %%V
if not exist "apps\desktop\src\shared\vpnPlan.ts" goto old_tree
if not exist "apps\desktop\build\installer.nsh" goto old_tree
if not exist "packages\shared\package.json" goto old_tree
echo      versiya proekta : AmneziaWG-only
echo [1/9] ok, ROOT=%CD% >> "%LOG%"
echo [2/9] app-builder - svoy binarnik vne node_modules
if exist "%APPBUILDER_DIR%\app-builder.exe" goto appbuilder_ok
if not exist "%APPBUILDER_DIR%" mkdir "%APPBUILDER_DIR%"
pushd "%APPBUILDER_DIR%"
call npm pack app-builder-bin@%APPBUILDER_VER%
if errorlevel 1 goto appbuilder_fail
for %%F in (app-builder-bin-*.tgz) do call tar -xf "%%F"
if not exist "package\win\x64\app-builder.exe" goto appbuilder_fail
copy /y "package\win\x64\app-builder.exe" "%APPBUILDER_DIR%\app-builder.exe" >nul
popd
:appbuilder_ok
if not exist "%APPBUILDER_DIR%\app-builder.exe" goto appbuilder_fail
echo      ok : %APPBUILDER_DIR%\app-builder.exe
goto step_client
:appbuilder_fail
popd 2>nul
echo      NE UDALOS podgotovit app-builder.exe
echo      Esli fail propadaet srazu posle raspakovki - eto antivirus.
echo      Dobavte %APPBUILDER_DIR% v isklyucheniya Defender.
goto fail
:step_client
echo [3/9] %CLIENT_EXE% - vstroennyy klient AmneziaWG
if not exist "%CLIENT_DIR%" mkdir "%CLIENT_DIR%"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_ok
if exist "%CLIENT_ROOT%\%CLIENT_EXE%" call :grab "%CLIENT_ROOT%\%CLIENT_EXE%"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_ok
if exist "%ProgramFiles%\AmneziaWG\%CLIENT_EXE%" call :grab "%ProgramFiles%\AmneziaWG\%CLIENT_EXE%"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_ok
if exist "%ProgramFiles%\Amnezia\AmneziaWG\%CLIENT_EXE%" call :grab "%ProgramFiles%\Amnezia\AmneziaWG\%CLIENT_EXE%"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_ok
if exist "%ProgramFiles(x86)%\AmneziaWG\%CLIENT_EXE%" call :grab "%ProgramFiles(x86)%\AmneziaWG\%CLIENT_EXE%"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_ok
if exist "%LOCALAPPDATA%\Programs\AmneziaWG\%CLIENT_EXE%" call :grab "%LOCALAPPDATA%\Programs\AmneziaWG\%CLIENT_EXE%"
if exist "%CLIENT_DIR%\%CLIENT_EXE%" goto client_ok
goto client_skip
:client_ok
set "CLIENT_OK=1"
echo      ok : %CLIENT_DIR%\%CLIENT_EXE%
goto step_deps
:client_skip
echo      PROPUSK: %CLIENT_EXE% ne nayden.
echo [3/9] klient ne nayden >> "%LOG%"
goto step_deps
:step_deps
echo      itog po klientu: %CLIENT_EXE%=%CLIENT_OK% (1 = est)
if "%CLIENT_OK%"=="1" goto do_deps
if "%ALLOW_NOCLIENT%"=="0" goto need_client
:do_deps
echo [4/9] Zavisimosti - npm install --ignore-scripts
call npm install --ignore-scripts
if errorlevel 1 goto deps_fail
echo [4/9] ok >> "%LOG%"
echo [5/9] Electron - skripty byli otklyucheny, stavim vruchnuyu
if not exist "node_modules\electron\install.js" goto no_electron
call node node_modules\electron\install.js
if errorlevel 1 goto fail
echo [5/9] ok >> "%LOG%"
echo [6/9] Obshchiy kod - packages/shared
call npm run build:shared
if errorlevel 1 goto shared_fail
if not exist "node_modules\@trioz\shared" goto shared_link
echo [6/9] ok >> "%LOG%"
echo [7/9] Sborka koda apps/desktop
call npm run build -w apps/desktop
if errorlevel 1 goto fail
if not exist "apps\desktop\dist\preload\index.js" goto fail
echo [7/9] ok >> "%LOG%"
echo [8/9] Ukladka klienta v resursy
if "%CLIENT_OK%"=="0" goto vendor_soft
call npm run vendor:client:strict -w apps/desktop
if errorlevel 1 goto fail
if not exist "apps\desktop\resources\wireguard\win32\%CLIENT_EXE%" goto vendor_bad
echo      ok : klient v resources\wireguard\win32
goto step_dist
:vendor_soft
call npm run vendor:client -w apps/desktop
if errorlevel 1 goto fail
echo      VNIMANIE: sborka budet BEZ klienta VPN.
goto step_dist
:step_dist
echo [9/9] Sborka installyatora - electron-builder
call npm run dist -w apps/desktop -- -c.npmRebuild=false
if errorlevel 1 goto fail
if not exist "apps\desktop\release" goto fail
echo [9/9] ok >> "%LOG%"
if "%CLIENT_OK%"=="0" goto done_noclient
if not exist "apps\desktop\release\win-unpacked\resources\wireguard\%CLIENT_EXE%" goto no_client_in_build
echo ==================================================
echo  GOTOVO. Installyator sobran, klient AmneziaWG vnutri.
echo  Storonnie prilozheniya WireGuard ne nuzhny.
echo ==================================================
dir apps\desktop\release\*.exe
goto done
:done_noclient
echo ==================================================
echo  Installyator sobran, NO BEZ klienta VPN.
echo  Knopka vklyucheniya v takoy sborke vydast oshibku.
echo  Publikovat takuyu sborku nelzya.
echo ==================================================
dir apps\desktop\release\*.exe
goto done
:need_client
echo ==================================================
echo  STOP: net vstroennogo klienta VPN.
echo ==================================================
echo  Nuzhen odin fail: %CLIENT_DIR%\%CLIENT_EXE%
echo  Vazhno: wireguard.exe ot obychnogo WireGuard NE goditsya -
echo  on ne ponimaet parametry maskirovki, i uzel budet molchat.
echo  Chto sdelat, lyuboy iz dvuh putey:
echo    1. Ustanovit AmneziaWG for Windows - skript naydet exe sam
echo       v Program Files pri sleduyushchem zapuske.
echo    2. Sobrat amneziawg-windows-client iz istochnikov:
echo       https://github.com/amnezia-vpn/amneziawg-windows-client
echo       i polozhit gotovyy %CLIENT_EXE% v %CLIENT_DIR%
echo  Esli nuzhen exe BEZ VPN (dlya proverki interfeisa):
echo    build-desktop.bat noclient
echo [3/9] stop: net klienta >> "%LOG%"
goto fail
:vendor_bad
echo      Klient ne popal v resources\wireguard\win32.
echo      Proverte LAYOUT v apps\desktop\scripts\vendor-wireguard.mjs
goto fail
:no_client_in_build
echo V sobrannom prilozhenii net klienta:
echo apps\desktop\release\win-unpacked\resources\wireguard
echo Proverte extraResources v apps\desktop\electron-builder.yml
goto fail
:deps_fail
echo Ustanovka zavisimostey ne proshla.
echo Chastaya prichina - fayly zanyaty: zakroyte TrioZ Connect i npm run dev,
echo zatem zapustite skript snova. Esli povtoryaetsya EPERM - udalite
echo papku node_modules vruchnuyu.
goto fail
:no_electron
echo Ne nayden node_modules\electron\install.js
echo Znachit ustanovka zavisimostey proshla ne polnostyu.
echo Udalite node_modules i zapustite skript snova.
goto fail
:shared_fail
echo Ne sobralsya obshchiy paket packages/shared.
echo Bez nego apps/desktop ne skompiliruetsya: tsc vydast
echo TS2307 Cannot find module '@trioz/shared'.
goto fail
:shared_link
echo Net ssylki node_modules\@trioz\shared.
echo Zapustite v korne: npm install --ignore-scripts
goto fail
:old_tree
echo V etoy papke ne ta versiya proekta.
echo Nuzhny fayly:
echo   apps\desktop\src\shared\vpnPlan.ts
echo   apps\desktop\build\installer.nsh
echo   packages\shared\package.json
echo Raspakuyte svezhiy arhiv proekta i zapustite sborku iz nego.
goto fail
:no_root
echo Ne nayden proekt ryadom s etim faylom.
echo Polozhite build-desktop.bat v koren proekta - tuda, gde lezhat
echo package.json i papka apps, i zapustite snova.
echo Tekushchaya papka skripta: %~dp0
goto fail
:no_node
echo Ne nayden node ili npm v PATH.
echo Ustanovite Node.js 20+ i otkroyte okno zanovo.
goto fail
:grab
copy /y "%~1" "%CLIENT_DIR%\%CLIENT_EXE%" >nul 2>nul
exit /b 0
:fail
echo ==================================================
echo  OSHIBKA SBORKI. Smotrite soobshcheniya vyshe.
echo  Kratkiy log: %LOG%
echo ==================================================
echo Nazhmite lyubuyu klavishu, chtoby zakryt okno...
pause >nul
endlocal
exit /b 1
:done
echo Nazhmite lyubuyu klavishu, chtoby zakryt okno...
pause >nul
endlocal
exit /b 0