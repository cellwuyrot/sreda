@echo off
setlocal
cd /d D:\ttt\4\trioztest

set USE_SYSTEM_APP_BUILDER=true
set PATH=C:\appbuilder;%PATH%

echo ===== [1/6] Checking app-builder.exe =====
if exist C:\appbuilder\app-builder.exe goto ab_ok
mkdir C:\appbuilder 2>nul
call npm pack app-builder-bin@5.0.0-alpha.10
if errorlevel 1 goto fail
tar -xf app-builder-bin-5.0.0-alpha.10.tgz
copy /y package\win\x64\app-builder.exe C:\appbuilder\
rmdir /s /q package
del app-builder-bin-5.0.0-alpha.10.tgz
:ab_ok
C:\appbuilder\app-builder.exe --version
if errorlevel 1 goto fail

echo ===== [2/6] Clean node_modules =====
if exist node_modules rmdir /s /q node_modules

echo ===== [3/6] npm install (no scripts) =====
call npm install --ignore-scripts
if errorlevel 1 goto fail

echo ===== [4/6] Download Electron binary =====
call node node_modules\electron\install.js
if errorlevel 1 goto fail

echo ===== [5/6] Build shared package =====
call npm run build:shared
if errorlevel 1 goto fail

echo ===== [6/6] Build desktop installers =====
call npm run dist -w apps/desktop -- -c.npmRebuild=false
if errorlevel 1 goto fail

echo.
echo ================================================
echo   SUCCESS! Installers are in apps\desktop\release
echo ================================================
dir apps\desktop\release\*.exe
pause
exit /b 0

:fail
echo.
echo ================================================
echo   BUILD FAILED - see the error above
echo ================================================
pause
exit /b 1