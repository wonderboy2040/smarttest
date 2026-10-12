@echo off
REM ============================================================
REM start-laya.cmd — v21.4.0 Laya local AI (manual/sidecar start)
REM Key app\.env se aati hai — do jagah nahi likhni padti.
REM Watchdog ka supervisor (LAYA_AUTOSTART=1) khud adopt/spawn
REM karta hai; ye file haath se chalane (ya bat ke Laya block)
REM ke liye hai. Adopt-first design — double process nahi banta.
REM ============================================================
setlocal enableextensions
title Laya AI (local)
cd /d "%~dp0"
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
