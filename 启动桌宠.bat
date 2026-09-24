@echo off
setlocal
cd /d "%~dp0"

set "ELECTRON=node_modules\electron\dist\electron.exe"

rem ---- ASCII only in this file ----
rem cmd decodes .bat as the OEM codepage (GBK on zh-CN). UTF-8 Chinese in here
rem can decode into characters like | or ^ and break command parsing, so all
rem messages stay English. Chinese docs live in README.md.

rem Pulling the 181MB Electron binary straight from GitHub Releases times out
rem often on mainland networks. Redirect to a mirror unless already set.
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

if exist "%ELECTRON%" goto :launch

echo [ds-fish-pet] First run: Electron runtime not found, installing dependencies...
echo [ds-fish-pet] This downloads a few hundred MB and may take a while.
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [ds-fish-pet] Node.js not found ^(npm is missing^).
  echo.
  echo   Option A: install Node.js 18+ from https://nodejs.org then run this again.
  echo   Option B: grab the ready-to-run build from the GitHub Releases page.
  echo             That package needs nothing installed - just unzip and run.
  echo.
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo.
  echo [ds-fish-pet] npm install failed. Check your network and run this again.
  pause
  exit /b 1
)

rem Recent npm versions print "install scripts not yet covered by allowScripts".
rem On npm 11.17 that is only a warning and electron's postinstall still runs,
rem but if a future version turns it into a real block we would end up with no
rem binary. So always verify, and fall back to running electron's own installer.
if not exist "%ELECTRON%" (
  if exist "node_modules\electron\install.js" (
    echo [ds-fish-pet] Electron binary missing, running its installer directly...
    call node "node_modules\electron\install.js"
  )
)

if not exist "%ELECTRON%" (
  echo.
  echo [ds-fish-pet] Still no Electron binary. This is usually a network problem.
  echo [ds-fish-pet] A mirror is already set; try again on a better connection.
  echo.
  pause
  exit /b 1
)

:launch
rem Launch detached so the console window closes immediately and the pet keeps
rem running. Passing the app dir explicitly avoids relying on the cwd.
start "" "%ELECTRON%" "%~dp0."

endlocal
