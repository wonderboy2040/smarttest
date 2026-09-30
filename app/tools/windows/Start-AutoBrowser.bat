@echo off
setlocal
title SmartAI Auto Browser - CDP 9222

rem ============================================================
rem  SmartAI Pro Trader Auto - AUTOMATION BROWSER LAUNCHER v2
rem  (v18.6.2 fix)
rem
rem  FIX: Chrome/Edge 136+ DEFAULT profile pe debug port BLOCK
rem  karta hai (Chromium security change). Isliye ab DEDICATED
rem  profile use hota hai - port 9222 hamesha khulta hai.
rem
rem  IMPORTANT: SmartAI sirf IS automation window ko control
rem  karta hai. Aapke NORMAL browser me khuli CoinDCX/Dhan tabs
rem  COUNT NAHI hoti - unme debug port hota hi nahi.
rem
rem  Ek baar is automation window me login karo - session
rem  profile me save rehta hai (profile alag hai, aapka normal
rem  browser aur uske passwords kuch nahi badalta).
rem ============================================================

rem ---- Chrome dhoondo ----
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined BROWSER goto :launch

rem ---- Edge fallback ----
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER goto :launch

echo [ERROR] Chrome ya Edge nahi mila - pehle koi install karo.
echo.
pause
exit /b 1

:launch
set "PROFILE=%LocalAppData%\SmartAI-AutoBrowser"

echo ============================================================
echo  SMARTAI PRO TRADER AUTO - AUTOMATION BROWSER LAUNCH
echo ============================================================
echo.
echo  Browser : %BROWSER%
echo  Profile : %PROFILE%
echo            (DEDICATED automation profile - normal browser SAFE)
echo  Port    : 9222 (Chrome DevTools)
echo.
echo [1/2] Automation browser start ho raha hai
echo       + CoinDCX aur Dhan tabs khul rahe hain...
start "" "%BROWSER%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --hide-crash-restore-bubble --window-size=1400,900 "https://coindcx.com/trade" "https://web.dhan.co"

echo       5 sec wait (browser boot + port open)...
timeout /t 5 /nobreak >nul

echo [2/2] Port 9222 check...
call :checkport
if "%PORTOK%"=="1" goto :done

echo       10 sec aur wait karke dobara check...
timeout /t 10 /nobreak >nul
call :checkport
if "%PORTOK%"=="1" goto :done

echo.
echo  [X] ERROR: Port 9222 nahi khula. 2 common reasons:
echo.
echo      (a) Purana chrome process is profile pe LOCK kar raha hai.
echo          Task Manager me saare "chrome.exe" END karo, phir ye
echo          file dobara chalao.
echo      (b) Antivirus ne block kiya - Chrome ko allow karo.
echo.
pause
exit /b 1

:done
echo      OK - port 9222 LISTENING hai.
echo.
echo ============================================================
echo  DONE! Ab ye 3 STEPS karo:
echo.
echo   1. Is AUTOMATION window me CoinDCX me LOGIN karo
echo      aur Dhan me bhi LOGIN karo (ek baar karo - session
echo      save rehta hai, dobara login nahi lagega)
echo.
echo   2. Dono tabs KHULE rakho - is window ko band mat karo
echo      (minimize kar sakte ho)
echo.
echo   3. SmartAI.exe chalao - CoinDCX tab me PRO TRADER AUTO
echo      section me CONNECT + HEALTH dabao:
echo      BROWSER 9222 + COINDCX TAB + DHAN TAB - sab GREEN
echo.
echo  NOTE: Aapka NORMAL browser alag chalta rahe sakta hai.
echo        SmartAI ko farak nahi padta - sirf ye automation
echo        window control hota hai.
echo ============================================================
echo.
pause
exit /b 0

:checkport
set "PORTOK=0"
netstat -an | find /I ":9222" | find /I "LISTENING" >nul 2>&1
if not errorlevel 1 set "PORTOK=1"
goto :eof
