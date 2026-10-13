@echo off
REM ============================================================
REM start-laya.cmd — v21.10 Laya local AI (manual/bat-fallback start)
REM Key app\.env se aati hai — do jagah nahi likhni padti.
REM Watchdog ka supervisor (LAYA_AUTOSTART=1) khud adopt/spawn
REM karta hai; ye file haath se chalane (ya bat ke fallback block)
REM ke liye hai. v21.10: (1) pre-flight health check — double
REM start kabhi nahi; (2) exit par error dikhana — pehle bind
REM [Errno 10048] wali window turant band ho jaati thi aur error
REM chhup jaata tha.
REM ============================================================
setlocal enableextensions
title Laya AI (local)
cd /d "%~dp0"

REM v21.10 pre-flight: healthy laya already baitha hai to double start nahi
curl.exe -s -m 2 http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 (
  echo [laya] pehle se chal raha hai — double start nahi.
  timeout /t 3 >nul
  exit /b 0
)

set "LAYA_HOME=C:\laya-env"
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"LAYA_API_KEY=" ".env"`) do set "LAYA_API_KEY=%%b"
if not defined LAYA_API_KEY (
  echo [laya] LAYA_API_KEY app\.env me nahi mili
  pause & exit /b 1
)
if not exist "%LAYA_HOME%\Scripts\laya-serve.exe" (
  echo [laya] %LAYA_HOME%\Scripts\laya-serve.exe nahi mila — LAYA_HOME check karo.
  pause & exit /b 1
)
set "LAYA_HOST=127.0.0.1"
set "LAYA_PORT=8000"
set "LAYA_MODELS=english"
set "LAYA_DEFAULT_MODEL=english"
set "LAYA_DEVICE=cpu"
set "LAYA_PRELOAD=1"
"%LAYA_HOME%\Scripts\laya-serve.exe"
if errorlevel 1 (
  echo.
  echo [laya] laya-serve exit code %errorlevel% — upar wali error dekho.
  echo        Agar "[Errno 10048] ... bind" hai to port 8000 pe koi aur laya
  echo        already chal raha hai: netstat -ano ^| findstr :8000
  echo        (Watchdog LAYA_AUTOSTART=1 ke saath chal raha hai to ye window
  echo        alag se mat chalao — supervisor khud manage karta hai.)
  pause
)
