@echo off
chcp 65001 >nul
setlocal enableextensions

rem ============================================================================
rem  TZ Connect - sborka desktop-prilozheniya so VSTROENNYM klientom tunnelya.
rem
rem  CHTO IZMENILOS: ranshe shag [2] dostaval iz oficialnogo MSI faily
rem  wireguard.exe i wg.exe. Imenno iz-za etogo knopka vklyucheniya padala s
rem  "The specified service does not exist as an installed service" i inogda
rem  otkryvalos okno WireGuard: wireguard.exe umeet tolko prosit sluzhbu-menedzher
rem  WireGuard, kotoraya poyavlyaetsya tolko pri ustanovke storonnego produkta.
rem  Teper v resursy klodetsya wireguard-go.exe (obychnyy process, bez sluzhb i
rem  okon) i wintun.dll (drayver setevogo ustroystva).
rem ============================================================================

set "ROOT=D:\ttt\4\trioztest"
set "CLIENT_DIR=C:\triozclient\win32"
set "WORK=C:\triozclient\work"
set "WINTUN_VER=0.14.1"
set "WG_GO_REPO=https://git.zx2c4.com/wireguard-go"

set "USE_SYSTEM_APP_BUILDER=true"
set "PATH=C:\appbuilder;%PATH%"
set "TRIOZ_CLIENT_SRC=C:\triozclient"
set "TRIOZ_CLIENT_PLATFORM=win32"

cd /d "%ROOT%" || goto :fail

echo.
echo [1/9] app-builder
if not exist "C:\appbuilder\app-builder.exe" (
  if not exist "C:\appbuilder" mkdir "C:\appbuilder" || goto :fail
  pushd "C:\appbuilder" || goto :fail
  call npm pack app-builder-bin@5.0.0-alpha.10 || goto :fail
  for %%F in (app-builder-bin-*.tgz) do tar -xf "%%F" || goto :fail
  copy /y "package\win\x64\app-builder.exe" "C:\appbuilder\app-builder.exe" || goto :fail
  popd
)
echo     app-builder: C:\appbuilder\app-builder.exe

echo.
echo [2/9] wintun.dll - podpisannyy drayver s wintun.net
if not exist "%CLIENT_DIR%" mkdir "%CLIENT_DIR%" || goto :fail
if not exist "%WORK%" mkdir "%WORK%" || goto :fail
if not exist "%CLIENT_DIR%\wintun.dll" (
  curl -L --fail -o "%WORK%\wintun.zip" "https://www.wintun.net/builds/wintun-%WINTUN_VER%.zip" || goto :fail
  if exist "%WORK%\wintun" rmdir /s /q "%WORK%\wintun"
  mkdir "%WORK%\wintun" || goto :fail
  tar -xf "%WORK%\wintun.zip" -C "%WORK%\wintun" || goto :fail
  for /r "%WORK%\wintun\wintun\bin\amd64" %%F in (wintun.dll) do copy /y "%%F" "%CLIENT_DIR%\wintun.dll" >nul
)
if not exist "%CLIENT_DIR%\wintun.dll" (
  echo     NE NAYDEN wintun.dll.
  echo     Skachayte https://www.wintun.net/builds/wintun-%WINTUN_VER%.zip
  echo     i polozhite fayl bin\amd64\wintun.dll v %CLIENT_DIR%\wintun.dll
  goto :fail
)
echo     ok: %CLIENT_DIR%\wintun.dll

echo.
echo [3/9] wireguard-go.exe - sobiraem iz ishodnikov, gotovyh binarnikov pod Windows net
if not exist "%CLIENT_DIR%\wireguard-go.exe" (
  where go >nul 2>nul || (
    echo     NE NAYDEN Go. Ustanovite Go 1.21+ s https://go.dev/dl/ i zapustite skript snova.
    goto :fail
  )
  where git >nul 2>nul || (
    echo     NE NAYDEN git. Ustanovite Git for Windows.
    goto :fail
  )
  if not exist "%WORK%\wireguard-go" git clone --depth 1 "%WG_GO_REPO%" "%WORK%\wireguard-go" || goto :fail
  pushd "%WORK%\wireguard-go" || goto :fail
  set "GOOS=windows"
  set "GOARCH=amd64"
  set "CGO_ENABLED=0"
  go build -trimpath -ldflags "-s -w" -o "%CLIENT_DIR%\wireguard-go.exe" .
  popd
)
if not exist "%CLIENT_DIR%\wireguard-go.exe" (
  echo     Sborka wireguard-go.exe ne udalas.
  goto :fail
)
echo     ok: %CLIENT_DIR%\wireguard-go.exe

echo.
echo [4/9] chistaya ustanovka zavisimostey
if exist node_modules rmdir /s /q node_modules
call npm install --ignore-scripts || goto :fail

echo.
echo [5/9] electron - skripty byli otklyucheny, stavim vruchnuyu
call node node_modules\electron\install.js || goto :fail

echo.
echo [6/9] obshchiy kod
call npm run build:shared || goto :fail

echo.
echo [7/9] ukladka vstroennogo klienta v resursy
call npm run vendor:client:strict -w apps/desktop || goto :fail
if not exist "apps\desktop\resources\wireguard\win32\wireguard-go.exe" (
  echo     Klient ne popal v resources\wireguard\win32.
  goto :fail
)
if not exist "apps\desktop\resources\wireguard\win32\wintun.dll" (
  echo     Net wintun.dll v resources\wireguard\win32.
  goto :fail
)

echo.
echo [8/9] sborka installyatora
call npm run dist -w apps/desktop -- -c.npmRebuild=false || goto :fail

echo.
echo [9/9] proverka gotovoy sborki
if not exist "apps\desktop\release\win-unpacked\resources\wireguard\wireguard-go.exe" (
  echo     V sobrannom prilozhenii net klienta - takoy installyator vypuskat nelzya.
  goto :fail
)
if not exist "apps\desktop\release\win-unpacked\resources\wireguard\wintun.dll" (
  echo     V sobrannom prilozhenii net wintun.dll - takoy installyator vypuskat nelzya.
  goto :fail
)

echo.
echo ==================================================
echo  GOTOVO. Klient vstroen, sluzhby WireGuard bolshe
echo  ne trebuyutsya.
echo ==================================================
dir apps\desktop\release\*.exe
echo.
pause
exit /b 0

:fail
echo.
echo ==================================================
echo  OSHIBKA SBORKI. Smotrite soobshcheniye vyshe.
echo ==================================================
echo.
pause
exit /b 1
