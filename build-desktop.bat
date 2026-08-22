@echo off
setlocal enableextensions
title TZ Connect - build desktop (AmneziaWG)
rem ==========================================================================
rem  FIX-AWG-ONLY: sborka kladet v installyator TOLKO klient AmneziaWG.
rem
rem  Pochemu: uzly proekta podnimayut tolko AmneziaWG. Obychnyy wireguard.exe
rem  profil s parametrami maskirovki podnimaet BEZ oshibki, no uzel takie
rem  pakety otbrasyvaet - snaruzhi eto vyglyadit kak "tunnel est, interneta net".
rem  Poetomu klient odin i on obyazatelen.
rem
rem  Gde vzyat amneziawg.exe:
rem    1) ustanovite AmneziaWG for Windows (amneziawg-windows-client) -
rem       skript sam skopiruet exe iz Program Files;
rem    2) libo polozhite amneziawg.exe v C:\triozclient\win32 vruchnuyu.
rem ==========================================================================
set "ERR="
set "HINT="
set "LOG=%~dp0build-desktop.log"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\apps\desktop\package.json" set "ROOT=%CD%"
set "APPBUILDER_DIR=C:\appbuilder"
set "CLIENT_ROOT=C:\triozclient"
set "CLIENT_DIR=%CLIENT_ROOT%\win32"
set "CLIENT_EXE=amneziawg.exe"
set "USE_SYSTEM_APP_BUILDER=true"
set "PATH=%APPBUILDER_DIR%;%PATH%"
set "TRIOZ_CLIENT_SRC=%CLIENT_ROOT%"
set "TRIOZ_CLIENT_PLATFORM=win32"
set "WG_OK=0"
set "BUILD_WITH_CLIENT=0"
set "ALLOW_NOCLIENT=0"
if /i "%~1"=="noclient" set "ALLOW_NOCLIENT=1"
echo TZ Connect build %DATE% %TIME% > "%LOG%"
echo ==================================================
echo  TZ Connect - sborka Windows-installyatora
echo  VPN klient: AmneziaWG (%CLIENT_EXE%)
echo  Log: %LOG%
echo ==================================================
rem [1/8] environment
echo [1/8] Proverka okruzheniya
if not exist "%ROOT%\package.json" set "HINT=root"
if not exist "%ROOT%\package.json" set "ERR=[1/8] ryadom so skriptom net package.json"
if "%ERR%"=="" if not exist "%ROOT%\apps\desktop\package.json" set "HINT=root"
if "%ERR%"=="" if not exist "%ROOT%\apps\desktop\package.json" set "ERR=[1/8] net apps\desktop\package.json"
if "%ERR%"=="" cd /d "%ROOT%"
if "%ERR%"=="" echo      koren proekta : %CD%
if "%ERR%"=="" where node >nul 2>nul
if "%ERR%"=="" if errorlevel 1 set "HINT=node"
if "%ERR%"=="" if errorlevel 1 set "ERR=[1/8] ne nayden node v PATH"
if "%ERR%"=="" where npm >nul 2>nul
if "%ERR%"=="" if errorlevel 1 set "HINT=node"
if "%ERR%"=="" if errorlevel 1 set "ERR=[1/8] ne nayden npm v PATH"
if "%ERR%"=="" for /f "delims=" %%V in ('node -v') do echo      node          : %%V
if "%ERR%"=="" if not exist "apps\desktop\build\installer.nsh" set "HINT=tree"
if "%ERR%"=="" if not exist "apps\desktop\build\installer.nsh" set "ERR=[1/8] net apps\desktop\build\installer.nsh"
if "%ERR%"=="" echo [1/8] ok, ROOT=%CD% >> "%LOG%"
rem [2/8] app-builder
if "%ERR%"=="" echo [2/8] app-builder
if "%ERR%"=="" if not exist "%APPBUILDER_DIR%" mkdir "%APPBUILDER_DIR%"
if "%ERR%"=="" if not exist "%APPBUILDER_DIR%\app-builder.exe" cd /d "%APPBUILDER_DIR%"
if "%ERR%"=="" if not exist "%APPBUILDER_DIR%\app-builder.exe" call npm pack app-builder-bin@5.0.0-alpha.10
if "%ERR%"=="" if not exist "%APPBUILDER_DIR%\app-builder.exe" for %%F in (app-builder-bin-*.tgz) do call tar -xf "%%F"
if "%ERR%"=="" if not exist "%APPBUILDER_DIR%\app-builder.exe" if exist "package\win\x64\app-builder.exe" copy /y "package\win\x64\app-builder.exe" "%APPBUILDER_DIR%\app-builder.exe" >nul
if "%ERR%"=="" cd /d "%ROOT%"
if "%ERR%"=="" if not exist "%APPBUILDER_DIR%\app-builder.exe" set "ERR=[2/8] ne udalos podgotovit app-builder.exe"
if "%ERR%"=="" echo      ok : %APPBUILDER_DIR%\app-builder.exe
if "%ERR%"=="" echo [2/8] ok >> "%LOG%"
rem [3/8] AmneziaWG client
if "%ERR%"=="" echo [3/8] %CLIENT_EXE% - klient AmneziaWG dlya Windows
if "%ERR%"=="" if not exist "%CLIENT_DIR%" mkdir "%CLIENT_DIR%"
if "%ERR%"=="" if exist "%CLIENT_DIR%\%CLIENT_EXE%" set "WG_OK=1"
rem Ishchem uzhe ustanovlennyy klient v tipichnyh mestah ustanovki.
if "%ERR%"=="" if "%WG_OK%"=="0" if exist "%ProgramFiles%\AmneziaWG\%CLIENT_EXE%" copy /y "%ProgramFiles%\AmneziaWG\%CLIENT_EXE%" "%CLIENT_DIR%\%CLIENT_EXE%" >nul
if "%ERR%"=="" if "%WG_OK%"=="0" if exist "%ProgramFiles%\Amnezia\AmneziaWG\%CLIENT_EXE%" copy /y "%ProgramFiles%\Amnezia\AmneziaWG\%CLIENT_EXE%" "%CLIENT_DIR%\%CLIENT_EXE%" >nul
if "%ERR%"=="" if "%WG_OK%"=="0" if exist "%ProgramFiles(x86)%\AmneziaWG\%CLIENT_EXE%" copy /y "%ProgramFiles(x86)%\AmneziaWG\%CLIENT_EXE%" "%CLIENT_DIR%\%CLIENT_EXE%" >nul
if "%ERR%"=="" if "%WG_OK%"=="0" if exist "%LOCALAPPDATA%\Programs\AmneziaWG\%CLIENT_EXE%" copy /y "%LOCALAPPDATA%\Programs\AmneziaWG\%CLIENT_EXE%" "%CLIENT_DIR%\%CLIENT_EXE%" >nul
rem Zapasnoy variant: exe polozhili v koren C:\triozclient bez podkataloga.
if "%ERR%"=="" if "%WG_OK%"=="0" if exist "%CLIENT_ROOT%\%CLIENT_EXE%" copy /y "%CLIENT_ROOT%\%CLIENT_EXE%" "%CLIENT_DIR%\%CLIENT_EXE%" >nul
if "%ERR%"=="" if exist "%CLIENT_DIR%\%CLIENT_EXE%" set "WG_OK=1"
if "%WG_OK%"=="1" echo      ok : %CLIENT_DIR%\%CLIENT_EXE%
if "%WG_OK%"=="1" echo [3/8] ok >> "%LOG%"
if "%ERR%"=="" if "%WG_OK%"=="0" echo      NET: %CLIENT_DIR%\%CLIENT_EXE%
if "%ERR%"=="" if "%WG_OK%"=="0" echo      Ustanovite AmneziaWG for Windows ili polozhite %CLIENT_EXE% v %CLIENT_DIR%
if "%ERR%"=="" if "%WG_OK%"=="0" if "%ALLOW_NOCLIENT%"=="0" set "HINT=client"
if "%ERR%"=="" if "%WG_OK%"=="0" if "%ALLOW_NOCLIENT%"=="0" set "ERR=[3/8] net %CLIENT_EXE%"
rem [4/8] dependencies
if "%ERR%"=="" echo [4/8] Zavisimosti - npm install --ignore-scripts
if "%ERR%"=="" echo      samyy dolgiy shag: 5-20 minut
if "%ERR%"=="" echo [4/8] start npm install >> "%LOG%"
if "%ERR%"=="" if exist node_modules rmdir /s /q node_modules
if "%ERR%"=="" call npm install --ignore-scripts
if "%ERR%"=="" if errorlevel 1 set "ERR=[4/8] npm install zavershilsya oshibkoy"
if "%ERR%"=="" echo [4/8] ok >> "%LOG%"
rem [5/8] electron
if "%ERR%"=="" echo [5/8] Electron
set "EL_DIR="
if "%ERR%"=="" if exist "node_modules\electron\package.json" set "EL_DIR=node_modules\electron"
if "%ERR%"=="" if "%EL_DIR%"=="" if exist "apps\desktop\node_modules\electron\package.json" set "EL_DIR=apps\desktop\node_modules\electron"
if "%ERR%"=="" if "%EL_DIR%"=="" call npm install --ignore-scripts -w apps/desktop
if "%ERR%"=="" if "%EL_DIR%"=="" if exist "node_modules\electron\package.json" set "EL_DIR=node_modules\electron"
if "%ERR%"=="" if "%EL_DIR%"=="" if exist "apps\desktop\node_modules\electron\package.json" set "EL_DIR=apps\desktop\node_modules\electron"
if "%ERR%"=="" if "%EL_DIR%"=="" set "HINT=electron"
if "%ERR%"=="" if "%EL_DIR%"=="" set "ERR=[5/8] paket electron ne ustanovlen npm"
if "%ERR%"=="" echo      paket electron : %EL_DIR%
if "%ERR%"=="" if not exist "%EL_DIR%\dist\electron.exe" if exist "%EL_DIR%\install.js" call node "%EL_DIR%\install.js"
if "%ERR%"=="" if not exist "%EL_DIR%\dist\electron.exe" call npm rebuild electron --foreground-scripts
if "%ERR%"=="" if not exist "%EL_DIR%\dist\electron.exe" call npm rebuild electron -w apps/desktop --foreground-scripts
if "%ERR%"=="" if not exist "%EL_DIR%\dist\electron.exe" set "HINT=electron"
if "%ERR%"=="" if not exist "%EL_DIR%\dist\electron.exe" set "ERR=[5/8] Electron ne skachalsya: net dist\electron.exe"
if "%ERR%"=="" echo [5/8] ok >> "%LOG%"
rem [6/8] shared
if "%ERR%"=="" echo [6/8] Obshchiy kod - packages/shared
if "%ERR%"=="" call npm run build:shared
if "%ERR%"=="" if errorlevel 1 set "ERR=[6/8] ne sobralsya packages/shared"
if "%ERR%"=="" echo [6/8] ok >> "%LOG%"
rem [7/8] vendor client
if "%ERR%"=="" echo [7/8] Ukladka %CLIENT_EXE% v resursy
if "%ERR%"=="" if "%WG_OK%"=="1" call npm run vendor:client:strict -w apps/desktop
if "%ERR%"=="" if "%WG_OK%"=="0" call npm run vendor:client -w apps/desktop
if "%ERR%"=="" if errorlevel 1 set "ERR=[7/8] ne udalos ulozhit %CLIENT_EXE% v resursy"
if "%ERR%"=="" if "%WG_OK%"=="1" if not exist "apps\desktop\resources\wireguard\win32\%CLIENT_EXE%" set "ERR=[7/8] %CLIENT_EXE% ne popal v resources\wireguard\win32"
if "%ERR%"=="" if "%WG_OK%"=="1" set "BUILD_WITH_CLIENT=1"
if "%ERR%"=="" if "%BUILD_WITH_CLIENT%"=="1" echo      ok : resources\wireguard\win32\%CLIENT_EXE%
if "%ERR%"=="" if "%BUILD_WITH_CLIENT%"=="0" echo      VNIMANIE: sborka budet BEZ VPN klienta.
if "%ERR%"=="" echo [7/8] ok >> "%LOG%"
rem [8/8] installer
if "%ERR%"=="" echo [8/8] Sborka installyatora - electron-builder
if "%ERR%"=="" call npm run dist -w apps/desktop -- -c.npmRebuild=false
if "%ERR%"=="" if errorlevel 1 set "ERR=[8/8] electron-builder zavershilsya oshibkoy"
if "%ERR%"=="" if not exist "apps\desktop\release" set "ERR=[8/8] net papki apps\desktop\release"
if "%ERR%"=="" if "%BUILD_WITH_CLIENT%"=="1" if not exist "apps\desktop\release\win-unpacked\resources\wireguard\%CLIENT_EXE%" set "ERR=[8/8] v sborke net %CLIENT_EXE%"
if "%ERR%"=="" echo [8/8] ok >> "%LOG%"
rem result
echo ==================================================
if "%ERR%"=="" if "%BUILD_WITH_CLIENT%"=="1" echo  GOTOVO. Installyator sobran, klient AmneziaWG vnutri.
if "%ERR%"=="" if "%BUILD_WITH_CLIENT%"=="0" echo  Installyator sobran, NO BEZ VPN klienta. Publikovat nelzya.
if "%ERR%"=="" dir apps\desktop\release\*.exe
if "%ERR%"=="" echo GOTOVO >> "%LOG%"
if not "%ERR%"=="" echo  OSHIBKA SBORKI: %ERR%
if not "%ERR%"=="" echo OSHIBKA: %ERR% >> "%LOG%"
if "%HINT%"=="root" echo  Polozhite build-desktop.bat v koren proekta.
if "%HINT%"=="node" echo  Ustanovite Node.js 20+ i otkroyte okno zanovo.
if "%HINT%"=="tree" echo  Raspakuyte svezhiy arhiv proekta.
if "%HINT%"=="client" echo  Nuzhen %CLIENT_DIR%\%CLIENT_EXE% - klient AmneziaWG dlya Windows.
if "%HINT%"=="client" echo  Ustanovite AmneziaWG for Windows: skript sam skopiruet exe pri sleduyuschem zapuske.
if "%HINT%"=="client" echo  Obychnyy wireguard.exe NE podhodit: uzly rabotayut tolko s maskirovkoy.
if "%HINT%"=="electron" echo  Electron ne skachalsya. Proverte set/proxy/antivirus.
echo ==================================================
if "%TZ_NOPAUSE%"=="1" goto finish
echo Nazhmite lyubuyu klavishu, chtoby zakryt okno...
pause >nul
:finish
if not "%ERR%"=="" endlocal & exit /b 1
endlocal & exit /b 0