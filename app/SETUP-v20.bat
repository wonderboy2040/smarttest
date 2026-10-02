@echo off
setlocal enableextensions
REM ============================================================
REM SmartAI PRO v20.4.2 - FULL SETUP (two-desk terminal)
REM
REM YE KYA HAI: complete v20.4.2 site code (India Intraday +
REM CoinDCX desks). FRESH install aur UPGRADE dono kaam karte
REM hain - v20.1 me ye NAYA hai:
REM   [8] node_modules OFFLINE install (payload me bundled -
REM       internet/npm ki zaroorat NAHI)
REM   [9] .env auto-create (purane install ka .env mila to wahi
REM       copy; warna nayi random PIN generate kar ke batayi
REM       jaati hai)
REM Data (positions/journal/secrets), models, node runtime KABHI
REM touch nahi hote - sirf code replace hota hai, purana backup
REM me safe.
REM
REM FUTURE: is zip ka VERSION-MANAGER.bat + ROLLBACK.bat kisi
REM bhi SmartAI version zip ko install/rollback kar sakta hai
REM (upgrade bhi, downgrade bhi).
REM
REM SAFE: backup pehle, verify baad me, fail hua to
REM auto-rollback. Data kabhi delete nahi hota.
REM ============================================================
cd /d "%~dp0"

REM ---- [1/9] payload check ----
REM v20.7.3 FIX: ye script repo me app/ ke ANDAR hai. Agar yahin se chal rahi
REM hai (server\index.js script ke apne folder me hai), payload wahi hai —
REM app\app dhoondhna galat [ERROR] deta tha. Zip layout (script root me)
REM ke liye purana %~dp0app path hi chalega.
if exist "%~dp0server\index.js" (
  set "SRC=%~dp0"
) else (
  set "SRC=%~dp0app"
)
if not exist "%SRC%\server\index.js" (
  echo.
  echo [ERROR] app folder nahi mila. Ye zip PURA extract karo
  echo aur SmartAI-v20.4.2-FULL-win64 folder se SETUP-v20.bat
  echo chalao.
  echo.
  pause
  exit /b 1
)

REM ---- [2/9] app folder locate ----
REM LIVE installs pehle (data/.env/VERSION/backups markers) - zip
REM ka khud ka payload folder kabhi pick NAHI hota jab live install
REM dikhe. Koi live install nahi = zip ka app folder hi install
REM ban jata hai (extract-and-run, fresh PC ke liye).
set "TARGET="
if exist "%~dp0server\index.js" set "TARGET=%~dp0"
if not defined TARGET if exist "%~dp0..\server\index.js" for %%T in ("%~dp0..") do set "TARGET=%%~fT"
if not defined TARGET (
  for %%D in (C D E F G H I J) do if exist "%%D:\" (
    for /d %%X in ("%%D:\SmartAI*") do (
      if not defined TARGET if exist "%%X\app\server\index.js" (
        if exist "%%X\app\server\data" set "TARGET=%%X\app"
        if not defined TARGET if exist "%%X\app\.env" set "TARGET=%%X\app"
        if not defined TARGET if exist "%%X\app\VERSION.json" set "TARGET=%%X\app"
        if not defined TARGET if exist "%%X\app\backups" set "TARGET=%%X\app"
      )
      if not defined TARGET if exist "%%X\server\index.js" (
        if exist "%%X\server\data" set "TARGET=%%X"
        if not defined TARGET if exist "%%X\.env" set "TARGET=%%X"
        if not defined TARGET if exist "%%X\VERSION.json" set "TARGET=%%X"
        if not defined TARGET if exist "%%X\backups" set "TARGET=%%X"
      )
      for /d %%Y in ("%%X\*") do if not defined TARGET if exist "%%Y\app\server\index.js" (
        if exist "%%Y\app\server\data" set "TARGET=%%Y\app"
        if not defined TARGET if exist "%%Y\app\.env" set "TARGET=%%Y\app"
        if not defined TARGET if exist "%%Y\app\VERSION.json" set "TARGET=%%Y\app"
        if not defined TARGET if exist "%%Y\app\backups" set "TARGET=%%Y\app"
      )
    )
  )
)
if not defined TARGET if exist "%SRC%\server\index.js" for %%T in ("%SRC%") do set "TARGET=%%~fT"
if not defined TARGET (
  echo.
  echo  App folder apne aap nahi mila. Apne SmartAI install ka
  echo  path likho - wo folder jahan "server" folder aur
  echo  package.json hain. Example: E:\SmartAI-Pro-FULL-win64-v18.4\SmartAI-Pro-FULL\app
  echo  (blank chhodoge to zip ka app folder hi install ban jayega)
  echo.
  set /p "TARGET=Path: "
)
if not defined TARGET for %%T in ("%SRC%") do set "TARGET=%%~fT"
if not exist "%TARGET%\server\index.js" (
  echo.
  echo [ERROR] is path me server\index.js nahi mila:
  echo   %TARGET%
  echo Path check karo aur dobara try karo.
  echo.
  pause
  exit /b 1
)
for %%T in ("%TARGET%") do set "TARGET=%%~fT"
echo.
echo [1/9] App folder mil gaya: %TARGET%

REM ---- [3/9] node check ----
set "NODE_EXE="
where node >nul 2>&1 && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%TARGET%\node.exe" set "NODE_EXE=%TARGET%\node.exe"
if not defined NODE_EXE if exist "%TARGET%\node\node.exe" set "NODE_EXE=%TARGET%\node\node.exe"
if not defined NODE_EXE if exist "%TARGET%\runtime\node.exe" set "NODE_EXE=%TARGET%\runtime\node.exe"
if defined NODE_EXE (echo [2/9] Node mil gaya: %NODE_EXE%) else (echo [2/9] Node PATH me nahi - verify step skip hoga, install phir bhi hoga)

REM ---- [4/9] chalu server band karo (agar 8080 pe hai) ----
netstat -ano 2>nul | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [3/9] Port 8080 pe server chal raha hai - install ke liye band karna hoga.
  choice /C YN /M "Abhi band kar du (taskkill)"
  if not errorlevel 2 (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /F /T /PID %%P >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo        server band kar diya.
  ) else (
    echo        theek hai - file copy phir bhi chalega, par restart ZAROORI hai.
  )
) else (
  echo [3/9] Port 8080 free hai - server band hai.
)

REM ---- [5/9] backup (extract-and-run self-install me skip) ----
set "STAMP="
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss" 2^>nul') do set "STAMP=%%T"
if not defined STAMP set "STAMP=%RANDOM%"
set "SELFINSTALL=0"
if /i "%SRC%"=="%TARGET%" set "SELFINSTALL=1"
set "BK="
if "%SELFINSTALL%"=="0" (
  set "BK=%TARGET%\backups\backup-%STAMP%"
  mkdir "%BK%" 2>nul
  if exist "%TARGET%\server" robocopy "%TARGET%\server" "%BK%\server" /E /XD data /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\dist" robocopy "%TARGET%\dist" "%BK%\dist" /E /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\public" robocopy "%TARGET%\public" "%BK%\public" /E /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\src" robocopy "%TARGET%\src" "%BK%\src" /E /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\test" robocopy "%TARGET%\test" "%BK%\test" /E /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\telegram-bot" robocopy "%TARGET%\telegram-bot" "%BK%\telegram-bot" /E /XD node_modules /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\ml-service" robocopy "%TARGET%\ml-service" "%BK%\ml-service" /E /XD store __pycache__ /NFL /NDL /NJH /NJS /NP >nul
  if exist "%TARGET%\package.json" copy /Y "%TARGET%\package.json" "%BK%\" >nul
  if exist "%TARGET%\VERSION.json" copy /Y "%TARGET%\VERSION.json" "%BK%\" >nul
  (echo backup of: %STAMP%) > "%BK%\backup-info.txt"
  echo [4/9] Backup ho gaya: %BK%
) else (
  echo [4/9] Extract-and-run install (zip ka app folder hi install hai) - backup skip.
)

REM ---- [6/9] apply (MIR = stale files cleanup; data/node_modules EXCLUDED) ----
echo [5/9] v20.4.2 files apply ho rahi hain...
if "%SELFINSTALL%"=="1" goto :applyskip
robocopy "%SRC%\server" "%TARGET%\server" /MIR /XD data /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\dist" "%TARGET%\dist" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\public" "%TARGET%\public" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\src" "%TARGET%\src" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\test" "%TARGET%\test" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\telegram-bot" "%TARGET%\telegram-bot" /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\ml-service" "%TARGET%\ml-service" /MIR /XD __pycache__ store /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
robocopy "%SRC%\scripts" "%TARGET%\scripts" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
if exist "%SRC%\tools" robocopy "%SRC%\tools" "%TARGET%\tools" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :applyfail
:applyskip
copy /Y "%SRC%\package.json" "%TARGET%\" >nul
copy /Y "%SRC%\.env.example" "%TARGET%\" >nul
copy /Y "%SRC%\index.html" "%TARGET%\" >nul
copy /Y "%SRC%\vite.config.ts" "%TARGET%\" >nul
copy /Y "%SRC%\tsconfig.json" "%TARGET%\" >nul
copy /Y "%SRC%\vitest.config.ts" "%TARGET%\" >nul
copy /Y "%SRC%\docs\CHANGES.md" "%TARGET%\docs\CHANGES.md" >nul 2>&1
copy /Y "%SRC%\Start-SmartAI-Watchdog.bat" "%TARGET%\" >nul
echo        copy complete.

REM ---- [7/9] verify ----
echo [6/9] verify ho raha hai...
if defined NODE_EXE (
  "%NODE_EXE%" --check "%TARGET%\server\index.js" >nul 2>&1 || goto :verifyfail
  "%NODE_EXE%" --check "%TARGET%\server\supervisor.js" >nul 2>&1 || goto :verifyfail
  "%NODE_EXE%" --check "%TARGET%\server\ai\consoleGuard.js" >nul 2>&1 || goto :verifyfail
)
if not exist "%TARGET%\dist\index.html" goto :verifyfail
findstr /C:"SmartAI Pro v20" "%TARGET%\dist\index.html" >nul 2>&1 || goto :verifyfail
> "%TARGET%\VERSION.json" (
  echo {"version": "20.4.2", "installedAt": "%STAMP%", "layout": "smartai-v20-app"}
)
echo        verify OK - v20 markers sab mil gaye.

REM ---- [8/9] node_modules: OFFLINE payload copy ya npm ----
if not exist "%TARGET%\node_modules\dotenv" (
  if exist "%SRC%\node_modules\dotenv" (
    echo [7/9] node_modules missing - payload wali OFFLINE copy lag rahi hai ^(internet ki zaroorat nahi^)...
    robocopy "%SRC%\node_modules" "%TARGET%\node_modules" /E /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto :applyfail
  ) else (
    where npm >nul 2>&1
    if not errorlevel 1 (
      echo [7/9] node_modules missing - npm install chal raha hai ^(internet, 1-3 min^)...
      pushd "%TARGET%"
      call npm install --omit=dev --omit=optional --no-audit --no-fund --loglevel=error
      if errorlevel 1 (echo        npm FAIL - koi baat nahi, watchdog khud retry karega.) else (echo        npm install OK.)
      popd
    ) else (
      echo [7/9] node_modules missing + npm nahi mila - Start-SmartAI-Watchdog
      echo        chalaoge to supervisor khud install karega ^(internet chahiye^).
    )
  )
) else (
  echo [7/9] node_modules already hai - touch NAHI kiya.
)

REM ---- [9/9] .env: purana copy ya naya PIN ----
if exist "%TARGET%\.env" (
  echo [8/9] .env already hai - PIN wahi purani chalegi. Touch nahi kiya.
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
echo [8/9] Purane install ka .env mil gaya - copy ho gaya.
echo        Purani hi PIN chalegi. Source: %OLDENV%
echo        (AI keys etc. sab wahi aa gaye.)
goto :envdone
:envnew
set "PIN="
for /f %%P in ('powershell -NoProfile -Command "Get-Random -Minimum 10000000 -Maximum 99999999" 2^>nul') do set "PIN=%%P"
if not defined PIN set "PIN=%RANDOM%%RANDOM%%RANDOM%"
> "%TARGET%\.env" echo APP_PIN=%PIN%
>> "%TARGET%\.env" echo REM AI provider keys etc. yahan add karo - template: .env.example
>> "%TARGET%\.env" echo REM CoinDCX: COINDCX_API_KEY= / COINDCX_SECRET= (optional)
echo [8/9] NAYA .env banaya ^(fresh install^).
echo        ===============================================
echo         LOGIN PIN : %PIN%
echo        ===============================================
echo        Ye note kar lo! (.env file me saved hai - badal sakte ho)
goto :envdone
:envdone

echo.
echo ============================================================
echo  [9/9] SMARTAI PRO v20.4.2 INSTALL COMPLETE
echo.
echo  AB KAISE CHALANA HAI (hang-free, RECOMMENDED):
echo    1. %TARGET%\Start-SmartAI-Watchdog.bat double-click
echo       karo - ANTI-FREEZE supervisor. Window khuli/minimized
echo       rakho. Site atak-nahi-sakti isme.
echo    2. Browser: localhost:8080
echo.
echo  VERIFY:
echo    localhost:8080/health me "selfheal armed" + consoleguard
echo    block dikhna chahiye.
echo.
echo  AGAR KUCH GALAT HO JAYE:
echo    ROLLBACK.bat chalao - purana version wapas 1-click me.
if defined BK echo    Backup folder: %BK%
echo.
echo  NOTE: startai.exe abhi bhi chalega, par watchdog
echo  recommended hai (hang protection sirf usme hai).
echo ============================================================
echo.
pause
exit /b 0

:applyfail
echo.
echo [ERROR] file copy fail hua - backup se wapas kar rahe hain...
if "%SELFINSTALL%"=="1" (echo self-install me rollback skip - payload already fresh. & pause & exit /b 1)
call :restorebackup
echo Rollback complete. Problem fix karke dobara try karo.
pause
exit /b 1

:verifyfail
echo.
echo [ERROR] verify FAIL - v20 markers nahi mile. Backup wapas...
if "%SELFINSTALL%"=="1" (echo self-install me rollback skip. & pause & exit /b 1)
call :restorebackup
echo Rollback complete - purana version wapas chal raha hai.
pause
exit /b 1

:restorebackup
robocopy "%BK%\server" "%TARGET%\server" /MIR /XD data /NFL /NDL /NJH /NJS /NP >nul 2>&1
robocopy "%BK%\dist" "%TARGET%\dist" /MIR /NFL /NDL /NJH /NJS /NP >nul 2>&1
robocopy "%BK%\public" "%TARGET%\public" /MIR /NFL /NDL /NJH /NJS /NP >nul 2>&1
robocopy "%BK%\src" "%TARGET%\src" /MIR /NFL /NDL /NJH /NJS /NP >nul 2>&1
robocopy "%BK%\test" "%TARGET%\test" /MIR /NFL /NDL /NJH /NJS /NP >nul 2>&1
robocopy "%BK%\telegram-bot" "%TARGET%\telegram-bot" /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP >nul 2>&1
if exist "%BK%\ml-service" robocopy "%BK%\ml-service" "%TARGET%\ml-service" /MIR /XD store __pycache__ /NFL /NDL /NJH /NJS /NP >nul 2>&1
if exist "%BK%\package.json" copy /Y "%BK%\package.json" "%TARGET%\" >nul 2>&1
if exist "%BK%\VERSION.json" copy /Y "%BK%\VERSION.json" "%TARGET%\" >nul 2>&1
goto :eof
