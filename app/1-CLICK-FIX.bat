@echo off
setlocal enableextensions
REM ============================================================
REM SmartAI PRO v20.0.1 - DEPS FIX (1-CLICK)
REM
REM YE KYA HAI: "Cannot find package 'dotenv'" crash ka fix.
REM v20.0 zip me node_modules missing tha - is zip me OFFLINE
REM bundled hai. Ek click me: crash-loop window band ->
REM dependencies lagao -> naya supervisor + watchdog -> seedha
REM site START.
REM
REM SAFE HAI: sirf ADD karta hai. Data/positions/.env/models
REM delete ya overwrite KABHI nahi. Purani files .bak me safe.
REM ============================================================
title DEPS-FIX SmartAI v20.0.1
cd /d "%~dp0"

REM ---- [1/6] app folder locate (live-install markers) ----
set "TARGET="
if exist "%~dp0server\index.js" if exist "%~dp0package.json" set "TARGET=%~dp0"
if not defined TARGET (
  for %%D in (C D E F G H I J) do if exist "%%D:\" (
    for /d %%X in ("%%D:\SmartAI*") do (
      if not defined TARGET if exist "%%X\app\server\index.js" if exist "%%X\app\package.json" (
        if exist "%%X\app\server\data" set "TARGET=%%X\app"
        if not defined TARGET if exist "%%X\app\.env" set "TARGET=%%X\app"
        if not defined TARGET if exist "%%X\app\VERSION.json" set "TARGET=%%X\app"
        if not defined TARGET if exist "%%X\app\backups" set "TARGET=%%X\app"
      )
      if not defined TARGET if exist "%%X\server\index.js" if exist "%%X\package.json" (
        if exist "%%X\server\data" set "TARGET=%%X"
        if not defined TARGET if exist "%%X\.env" set "TARGET=%%X"
        if not defined TARGET if exist "%%X\VERSION.json" set "TARGET=%%X"
        if not defined TARGET if exist "%%X\backups" set "TARGET=%%X"
      )
      for /d %%Y in ("%%X\*") do if not defined TARGET if exist "%%Y\app\server\index.js" if exist "%%Y\app\package.json" (
        if exist "%%Y\app\server\data" set "TARGET=%%Y\app"
        if not defined TARGET if exist "%%Y\app\.env" set "TARGET=%%Y\app"
        if not defined TARGET if exist "%%Y\app\VERSION.json" set "TARGET=%%Y\app"
        if not defined TARGET if exist "%%Y\app\backups" set "TARGET=%%Y\app"
      )
    )
  )
)
if not defined TARGET (
  echo.
  echo  App folder nahi mila. Apne SmartAI install ka path likho
  echo  - wo folder jahan "server" folder + package.json hain.
  echo  Example: D:\SmartAI26\app
  echo.
  set /p "TARGET=Path: "
)
if not defined TARGET goto :failpath
if not exist "%TARGET%\server\index.js" goto :badpath
if not exist "%TARGET%\package.json" goto :badpath
for %%T in ("%TARGET%") do set "TARGET=%%~fT"
echo.
echo [1/6] App folder mil gaya: %TARGET%

REM ---- [2/6] purani crash-loop window band ----
echo [2/6] Purani watchdog/server band kar rahe hain (agar chal rahe hain)...
taskkill /F /T /FI "WINDOWTITLE eq SmartAI*" >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /F /T /PID %%P >nul 2>&1
timeout /t 2 /nobreak >nul

REM ---- [3/6] node_modules OFFLINE copy (sirf MISSING files add) ----
echo [3/6] node_modules OFFLINE dependencies copy ho rahi hain...
robocopy "%~dp0node_modules" "%TARGET%\node_modules" /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :copyfail
echo        copy complete. Internet ki zaroorat NAHI thi.

REM ---- [4/6] supervisor + watchdog bat (.bak backup pehle) ----
echo [4/6] Naya supervisor + watchdog lag rahe hain (honest crash-reason + auto-install)...
if exist "%TARGET%\server\supervisor.js" copy /Y "%TARGET%\server\supervisor.js" "%TARGET%\server\supervisor.js.v2000.bak" >nul 2>&1
copy /Y "%~dp0server\supervisor.js" "%TARGET%\server\supervisor.js" >nul || goto :copyfail
if exist "%TARGET%\Start-SmartAI-Watchdog.bat" copy /Y "%TARGET%\Start-SmartAI-Watchdog.bat" "%TARGET%\Start-SmartAI-Watchdog.bat.v2000.bak" >nul 2>&1
copy /Y "%~dp0Start-SmartAI-Watchdog.bat" "%TARGET%\Start-SmartAI-Watchdog.bat" >nul || goto :copyfail

REM ---- [5/6] verify: node + saari deps resolve ----
REM (BLOCK-FREE restructure: node -e ke JS parens ^( ^) aur echo
REM ke parens batch ke paren-blocks ko todte hain - isliye koi
REM if-block NAHI, sirf goto flow.)
set "NODE_EXE="
where node >nul 2>&1 && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%TARGET%\node.exe" set "NODE_EXE=%TARGET%\node.exe"
if not defined NODE_EXE if exist "%TARGET%\node\node.exe" set "NODE_EXE=%TARGET%\node\node.exe"
if not defined NODE_EXE if exist "%TARGET%\runtime\node.exe" set "NODE_EXE=%TARGET%\runtime\node.exe"
if not defined NODE_EXE goto :nodecheckskip
echo [5/6] Verify ho raha hai...
"%NODE_EXE%" --check "%TARGET%\server\supervisor.js" >nul 2>&1 || goto :verifyfail
pushd "%TARGET%"
"%NODE_EXE%" -e "for (const m of ['dotenv','express','ws','node-cron','compression','node-telegram-bot-api']) require(m); console.log('DEPS-OK')" || goto :verifyfail
popd
echo        DEPS-OK - saari dependencies resolve ho rahi hain.
goto :envcheck
:nodecheckskip
echo [5/6] Node PATH me nahi mila - verify skip. Watchdog window
echo        me node ka apna check chalega - wahan dikhega agar dikkat.
goto :envcheck
:envcheck

REM ---- [6/6] .env: purana copy ya NAYA PIN ----
set "PIN="
if exist "%TARGET%\.env" (
  echo [6/6] .env already hai - PIN wahi purani chalegi. Touch nahi kiya.
  goto :envdone
)
set "OLDENV="
for %%D in (C D E F G H I J) do if exist "%%D:\" (
  if not defined OLDENV for /d %%X in ("%%D:\SmartAI*") do (
    if not defined OLDENV if exist "%%X\app\.env" if /i not "%%X\app"=="%TARGET%" set "OLDENV=%%X\app\.env"
    if not defined OLDENV if exist "%%X\.env" if /i not "%%X"=="%TARGET%" set "OLDENV=%%X\.env"
    if not defined OLDENV for /d %%Y in ("%%X\*") do (
      if not defined OLDENV if exist "%%Y\app\.env" if /i not "%%Y\app"=="%TARGET%" set "OLDENV=%%Y\app\.env"
      if not defined OLDENV if exist "%%Y\.env" if /i not "%%Y"=="%TARGET%" set "OLDENV=%%Y\.env"
    )
  )
)
if not defined OLDENV goto :envnew
copy /Y "%OLDENV%" "%TARGET%\.env" >nul
echo [6/6] Purane install ka .env copy ho gaya - PIN wahi purani.
echo        Source: %OLDENV%
goto :envdone
:envnew
for /f %%P in ('powershell -NoProfile -Command "Get-Random -Minimum 10000000 -Maximum 99999999" 2^>nul') do set "PIN=%%P"
if not defined PIN set "PIN=%RANDOM%%RANDOM%%RANDOM%"
> "%TARGET%\.env" echo APP_PIN=%PIN%
>> "%TARGET%\.env" echo REM AI provider keys etc. yahan add karo - template: .env.example
>> "%TARGET%\.env" echo REM CoinDCX: COINDCX_API_KEY= / COINDCX_SECRET= ^(optional^)
echo [6/6] NAYA .env banaya - LOGIN PIN neeche hai:
echo        ===============================================
echo         LOGIN PIN : %PIN%
echo        ===============================================
echo        Ye note kar lo! ^(.env me saved hai - badal sakte ho^)
goto :envdone
:envdone

echo.
echo ============================================================
echo  FIX COMPLETE - site START ho rahi hai...
echo ============================================================
echo  Watchdog nayi window me khul raha hai - us window ko
echo  khuli/minimized rakho. Phir browser me kholo:
echo    localhost:8080
if defined PIN echo  LOGIN PIN: %PIN%
echo.
echo  Phir bhi dikkat ho to ye 2 files bhejo:
echo    %TARGET%\server\data\logs\server.log
echo    %TARGET%\server\data\exit-reasons.log
echo ============================================================
start "SmartAI PRO v20.0.1 - Anti-Freeze Watchdog" /D "%TARGET%" "%TARGET%\Start-SmartAI-Watchdog.bat"
echo.
echo  Ye fix-window ab band kar sakte ho.
pause
exit /b 0

:failpath
echo.
echo [ERROR] path khali - kuch nahi kiya. Path likh kar dobara chalao.
pause
exit /b 1

:badpath
echo.
echo [ERROR] is path me server\index.js + package.json nahi mile:
echo   %TARGET%
echo Zip KAHIN BHI extract karke dobara 1-CLICK-FIX chalao
echo (wo khud dhoondh lega).
pause
exit /b 1

:copyfail
echo.
echo [ERROR] file copy fail. Ye window ko "Run as administrator"
echo karke dobara chalao.
pause
exit /b 1

:verifyfail
popd 2>nul
echo.
echo [ERROR] verify FAIL. Upar wali problem lines ka screenshot
echo bhejo (server.log + exit-reasons.log ke saath).
pause
exit /b 1
