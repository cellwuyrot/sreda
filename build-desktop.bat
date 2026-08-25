@echo off
rem ==========================================================================
rem  TZ Connect - sborka Windows-installyatora (Electron).
rem
rem  Osobennosti etogo faila (vse - iz-za realnyh problem, ne dlya krasoty):
rem   * NI ODNOY pustoy stroki. Pri peredache faila v pustye stroki popadali
rem     nevidimye simvoly U+200B, i konsol pisala: "tAL" ne yavlyaetsya
rem     vnutrenney ili vneshney komandoy. Pustyh strok net - problemy net.
rem   * Koren proekta beretsya iz papki, gde lezhit SAM etot fail (%~dp0),
rem     a ne iz zhestko propisannogo puti.
rem   * Tolko ASCII, bez chcp - nezavisimo ot kodovoy stranicy konsoli.
rem   * Bez mnogostrochnyh blokov v skobkah, kazhdyy vyzov cherez CALL,
rem     proverka IF ERRORLEVEL, i lyuboy vyhod cherez PAUSE.
rem ==========================================================================
setlocal enableextensions
title TZ Connect - sborka desktop
set "LOG=%~dp0build-desktop.log"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
rem  Zapasnye puti - esli fail zapuskayut ne iz kornya proekta.
if not exist "%ROOT%\apps\desktop\package.json" set "ROOT=D:\ttt\4\trioztest"
if not exist "%ROOT%\apps\desktop\package.json" set "ROOT=%CD%"
set "APPBUILDER_DIR=C:\appbuilder"
set "CLIENT_ROOT=C:\triozclient"
set "CLIENT_DIR=C:\triozclient\win32"
set "WORK=C:\triozclient\work"
set "WINTUN_VER=0.14.1"
set "WG_GO_REPO=https://git.zx2c4.com/wireguard-go"
set "USE_SYSTEM_APP_BUILDER=true"
set "PATH=%APPBUILDER_DIR%;%PATH%"
set "TRIOZ_CLIENT_SRC=%CLIENT_ROOT%"
set "TRIOZ_CLIENT_PLATFORM=win32"
set "WINTUN_OK=0"
set "WGGO_OK=0"
set "BUILD_WITH_CLIENT=0"
set "ALLOW_NOCLIENT=0"
if /i "%~1"=="noclient" set "ALLOW_NOCLIENT=1"
echo TZ Connect build %DATE% %TIME% > "%LOG%"
echo ==================================================
echo  TZ Connect - sborka Windows-installyatora
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
if not exist "apps\desktop\src\main\tunnelAgent.ts" goto old_tree
if not exist "apps\desktop\build\installer.nsh" goto old_tree
echo      sluzhebnyy komponent tunnelya : est
echo [1/9] ok, ROOT=%CD% >> "%LOG%"
echo [2/9] app-builder
if exist "%APPBUILDER_DIR%\app-builder.exe" goto appbuilder_ok
if not exist "%APPBUILDER_DIR%" mkdir "%APPBUILDER_DIR%"
pushd "%APPBUILDER_DIR%"
call npm pack app-builder-bin@5.0.0-alpha.10
if errorlevel 1 goto appbuilder_fail
for %%F in (app-builder-bin-*.tgz) do call tar -xf "%%F"
if not exist "package\win\x64\app-builder.exe" goto appbuilder_fail
copy /y "package\win\x64\app-builder.exe" "%APPBUILDER_DIR%\app-builder.exe" >nul
popd
:appbuilder_ok
if not exist "%APPBUILDER_DIR%\app-builder.exe" goto appbuilder_fail
echo      ok : %APPBUILDER_DIR%\app-builder.exe
goto step_wintun
:appbuilder_fail
popd 2>nul
echo      NE UDALOS podgotovit app-builder.exe
goto fail
:step_wintun
echo [3/9] wintun.dll - drayver setevogo ustroystva
if not exist "%CLIENT_DIR%" mkdir "%CLIENT_DIR%"
if not exist "%WORK%" mkdir "%WORK%"
if exist "%CLIENT_DIR%\wintun.dll" goto wintun_ok
call curl -L --fail -o "%WORK%\wintun.zip" "https://www.wintun.net/builds/wintun-%WINTUN_VER%.zip"
if errorlevel 1 goto wintun_skip
if exist "%WORK%\wintun" rmdir /s /q "%WORK%\wintun"
mkdir "%WORK%\wintun"
call tar -xf "%WORK%\wintun.zip" -C "%WORK%\wintun"
if errorlevel 1 goto wintun_skip
if not exist "%WORK%\wintun\wintun\bin\amd64\wintun.dll" goto wintun_skip
copy /y "%WORK%\wintun\wintun\bin\amd64\wintun.dll" "%CLIENT_DIR%\wintun.dll" >nul
if not exist "%CLIENT_DIR%\wintun.dll" goto wintun_skip
:wintun_ok
set "WINTUN_OK=1"
echo      ok : %CLIENT_DIR%\wintun.dll
goto step_wggo
:wintun_skip
echo      PROPUSK: wintun.dll ne poluchen - net seti ili blokirovka.
echo      Ruchnoy put: iz wintun-%WINTUN_VER%.zip fail bin\amd64\wintun.dll
echo      polozhit v %CLIENT_DIR%\wintun.dll
echo [3/9] wintun skipped >> "%LOG%"
goto step_wggo
:step_wggo
echo [4/9] wireguard-go.exe - vstroennyy klient tunnelya
if exist "%CLIENT_DIR%\wireguard-go.exe" goto wggo_ok
where go >nul 2>nul
if errorlevel 1 goto wggo_skip_go
where git >nul 2>nul
if errorlevel 1 goto wggo_skip_git
if not exist "%WORK%\wireguard-go\go.mod" call git clone --depth 1 "%WG_GO_REPO%" "%WORK%\wireguard-go"
if not exist "%WORK%\wireguard-go\go.mod" goto wggo_skip
pushd "%WORK%\wireguard-go"
set "GOOS=windows"
set "GOARCH=amd64"
set "CGO_ENABLED=0"
call go build -trimpath -ldflags "-s -w" -o "%CLIENT_DIR%\wireguard-go.exe" .
popd
if not exist "%CLIENT_DIR%\wireguard-go.exe" goto wggo_skip
:wggo_ok
set "WGGO_OK=1"
echo      ok : %CLIENT_DIR%\wireguard-go.exe
goto step_deps
:wggo_skip_go
echo      PROPUSK: ne nayden Go. Ustanovite Go 1.21+ s https://go.dev/dl/
goto wggo_skip
:wggo_skip_git
echo      PROPUSK: ne nayden git. Ustanovite Git for Windows.
goto wggo_skip
:wggo_skip
echo      Sborka prodolzhitsya, no BEZ vstroennogo klienta tunnelya.
echo [4/9] wireguard-go skipped >> "%LOG%"
goto step_deps
:step_deps
echo      itog po klientu: wireguard-go.exe=%WGGO_OK% wintun.dll=%WINTUN_OK% (1 = est)
echo [5/9] Zavisimosti - npm install --ignore-scripts
if exist node_modules rmdir /s /q node_modules
call npm install --ignore-scripts
if errorlevel 1 goto fail
echo [5/9] ok >> "%LOG%"
echo [6/9] Electron - skripty byli otklyucheny, stavim vruchnuyu
call node node_modules\electron\install.js
if errorlevel 1 goto fail
echo [6/9] ok >> "%LOG%"
echo [7/9] Obshchiy kod - packages/shared
call npm run build:shared
if errorlevel 1 goto fail
echo [7/9] ok >> "%LOG%"
echo [8/9] Ukladka vstroennogo klienta v resursy
if not "%WINTUN_OK%%WGGO_OK%"=="11" goto vendor_soft
call npm run vendor:client:strict -w apps/desktop
if errorlevel 1 goto fail
if not exist "apps\desktop\resources\wireguard\win32\wireguard-go.exe" goto vendor_bad
if not exist "apps\desktop\resources\wireguard\win32\wintun.dll" goto vendor_bad
echo      ok : klient i drayver v resources\wireguard\win32
set "BUILD_WITH_CLIENT=1"
goto step_dist
:vendor_soft
if "%ALLOW_NOCLIENT%"=="0" goto need_client
call npm run vendor:client -w apps/desktop
if errorlevel 1 goto fail
echo      VNIMANIE: sborka budet BEZ tunnelya - net wireguard-go.exe ili wintun.dll.
set "BUILD_WITH_CLIENT=0"
goto step_dist
:need_client
echo ==================================================
echo  STOP: net vstroennogo klienta tunnelya.
echo  Imenno poetomu prilozhenie govorit:
echo  "Vstroennyy klient otsutstvuet v etoy sborke".
echo ==================================================
echo  Nuzhny DVA faila v %CLIENT_DIR% :
if "%WGGO_OK%"=="0" echo    - wireguard-go.exe  (NET)
if "%WGGO_OK%"=="1" echo    - wireguard-go.exe  (est)
if "%WINTUN_OK%"=="0" echo    - wintun.dll        (NET)
if "%WINTUN_OK%"=="1" echo    - wintun.dll        (est)
echo  Chto sdelat:
echo    1. Ustanovit Go: winget install --id GoLang.Go -e
echo       ili installyator s https://go.dev/dl/
echo    2. Ustanovit Git: winget install --id Git.Git -e
echo    3. Zakryt i otkryt okno konsoli (chtoby obnovilsya PATH)
echo    4. Zapustit etot skript snova - shagi 3 i 4 sdelayut vse sami
echo  Esli nuzhen exe BEZ tunnelya (dlya proverki interfeisa):
echo    build-desktop.bat noclient
echo [8/9] stop: net klienta >> "%LOG%"
goto fail
:vendor_bad
echo      Klient ne popal v resources\wireguard\win32.
goto fail
:step_dist
echo [9/9] Sborka installyatora - electron-builder
call npm run dist -w apps/desktop -- -c.npmRebuild=false
if errorlevel 1 goto fail
if not exist "apps\desktop\release" goto fail
if not exist "apps\desktop\dist\main\tunnelAgent.js" goto no_service_in_build
echo [9/9] ok >> "%LOG%"
if "%BUILD_WITH_CLIENT%"=="0" goto done_noclient
if not exist "apps\desktop\release\win-unpacked\resources\wireguard\wireguard-go.exe" goto no_client_in_build
if not exist "apps\desktop\release\win-unpacked\resources\wireguard\wintun.dll" goto no_client_in_build
echo ==================================================
echo  GOTOVO. Installyator sobran, klient tunnelya vnutri.
echo  Nikakie sluzhby i prilozheniya WireGuard ne nuzhny.
echo ==================================================
dir apps\desktop\release\*.exe
goto done
:done_noclient
echo ==================================================
echo  Installyator sobran, NO BEZ vstroennogo klienta.
echo  Knopka vklyucheniya v takoy sborke skazhet:
echo  "Vstroennyy klient otsutstvuet v etoy sborke".
echo  Publikovat takuyu sborku nelzya - sdelayte shagi 3 i 4.
echo ==================================================
dir apps\desktop\release\*.exe
goto done
:no_client_in_build
echo V sobrannom prilozhenii net klienta ili drayvera:
echo apps\desktop\release\win-unpacked\resources\wireguard
echo Proverte extraResources v apps\desktop\electron-builder.yml
goto fail
:old_tree
echo V etoy papke staraya versiya proekta: net sluzhebnogo komponenta tunnelya.
echo Nuzhny faily:
echo   apps\desktop\src\main\tunnelAgent.ts
echo   apps\desktop\build\installer.nsh
echo Raspakuyte svezhiy arhiv proekta i zapustite sborku iz nego.
goto fail
:no_service_in_build
echo Komponent tunnelya ne skompilirovan: apps\desktop\dist\main\tunnelAgent.js
echo Bez nego adapter trioz ne sozdaetsya bez prav administratora,
echo i kazhdoe vklyuchenie budet prosit povysheniya prav.
echo Proverte shag tsc v skripte build paketa apps/desktop.
goto fail
:no_root
echo Ne nayden proekt ryadom s etim failom.
echo Polozhite build-desktop.bat v koren proekta - tuda, gde lezhat
echo package.json i papka apps, i zapustite snova.
echo Tekushchaya papka skripta: %~dp0
goto fail
:no_node
echo Ne nayden node ili npm v PATH.
echo Ustanovite Node.js 20+ - https://nodejs.org/ - i otkroyte okno zanovo.
goto fail
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
