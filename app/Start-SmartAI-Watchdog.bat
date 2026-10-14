@echo off
REM v20.9.0: UTF-8 console (Hindi text readable on default OEM codepages)
chcp 65001 >nul
setlocal enableextensions
REM ============================================================
REM SmartAI PRO v21.13.1 - ANTI-FREEZE WATCHDOG (recommended launcher)
REM
REM KYA HAI: ye SUPERVISOR hai. Server ko child banake chalata hai
REM aur har 20s /api/ping probe karta hai APNE event-loop se.
REM Server HANG ho jaye (process zinda, site atki) -> force-kill
REM + auto-restart. CRASH ho jaye -> backoff auto-restart.
REM Yahi "site atak rahi hai" ka complete fix hai.
REM
REM v20.1: node_modules missing ho to supervisor KHUD npm install
REM chala dega (pehli baar, internet chahiye) - fresh installs bhi
REM seedha chalega.
REM
REM v20.8.3 ALWAYS-LATEST: dist/ (frontend build) STALE ya missing
REM ho to supervisor KHUD npm install + vite build chala dega. Matlab:
REM naya code zip/copy se update karo -> Watchdog chalao -> FRESH
REM site guaranteed. "purana version serve ho raha hai" bug khatam.
REM (Pehli baar / build ke waqt internet chahiye, 2-5 min.)
REM
REM v20.9.0 SINGLE-INSTANCE: dusra watchdog double-click karo to wo khud
REM band ho jayega (lock file + port check) - node_modules corruption
REM (do npm install ek saath) aur masked crash-loop dono khatam.
REM
REM v21.6.0 LAYA SIDECAR: LAYA_AUTOSTART=1 (app/.env) hone par supervisor
REM Laya local AI ko bhi manage karta hai (adopt/spawn/hang-restart/
REM clean-stop). Neeche ka bat-block fallback hai - health check ke
REM baad start hota hai, double spawn kabhi nahi.
REM
REM v21.10 WAR-PROOF: v21.6-v21.9 me LIVE BUG tha — ye bat-block
REM UNCONDITIONALLY chalta tha, aur LAYA_AUTOSTART=1 par supervisor
REM sidecar BHI laya-serve spawn karta tha. Bat ka 2s curl-probe
REM booting-laye ko miss kar deta tha (~8-10s bind hota hai) → DONO
REM spawn → port 8000 [Errno 10048] bind-war → exit(3) crash-loop
REM (5s→60s backoff) + CPU churn + event-loop freeze. Ab bat pehle
REM scripts\laya-autostart-check.mjs se puchta hai (sidecar ke hi
REM .env parser se): sidecar ARMED hai to bat-block SKIP. Single
REM owner = war impossible.
REM
REM USE: double-click karo, window khuli/minimized rakho.
REM      startai.exe iske SAATH mat chalao (port 8080 clash).
REM      Band karna = Ctrl+C ya window close.
REM ============================================================
title SmartAI PRO v21.13.1 - Anti-Freeze Watchdog
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>&1 && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"
if not defined NODE_EXE if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"
if not defined NODE_EXE if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if not defined NODE_EXE (
  echo.
  echo [ERROR] node nahi mila - PATH me nahi, app folder me bhi nahi.
  echo startai.exe use karo - uske andar bundled node hai.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo  SMARTAI PRO v21.13.1 - ANTI-FREEZE SUPERVISOR
echo  Laya   : local AI sidecar (LAYA_AUTOSTART=1 hone par)
echo  Site   : localhost:8080
echo  Engine : %NODE_EXE%
echo  Hang   : FREEZE detect - force-kill + restart
echo  Crash  : backoff restart - site kabhi down nahi
echo  Deps   : missing ho to auto npm-install (v20.3)
echo  Build  : dist/ stale/mismatch ho to AUTO npm install
echo          + vite build (v20.8.3+ - latest code guaranteed)
echo ============================================================
echo.

REM --- Laya local AI (optional) — v21.10 WAR-PROOF ---
REM Supervisor sidecar ARMED hai (LAYA_AUTOSTART=1 + LAYA_ENABLED=1 +
REM LAYA_API_KEY + loopback) to Laya start karna SIRF sidecar karega —
REM ye bat-block SKIP. Warna (autostart off) ye fallback block chalega.
REM Check node se hota hai (scripts\laya-autostart-check.mjs — sidecar
REM ke hi .env parser se, BOM/CRLF-safe): dono layers kabhi disagree
REM nahi karte, double-spawn 10048 war impossible.
set "LAYA_BAT_FALLBACK=1"
if exist "%~dp0scripts\laya-autostart-check.mjs" (
  "%NODE_EXE%" "%~dp0scripts\laya-autostart-check.mjs" >nul 2>&1
  if not errorlevel 1 set "LAYA_BAT_FALLBACK=0"
)
if "%LAYA_BAT_FALLBACK%"=="0" (
  echo [laya] LAYA_AUTOSTART=1 - Laya ko SUPERVISOR sidecar manage karega ^(bat fallback SKIP - double-spawn war safe^).
) else if exist "%~dp0start-laya.cmd" (
  REM Health-check pehle - double start kabhi nahi.
  curl.exe -s -m 2 http://127.0.0.1:8000/health >nul 2>&1
  if errorlevel 1 (
    echo [laya] start ho raha hai...
    start "Laya AI" /min cmd /c "%~dp0start-laya.cmd"
  ) else (
    echo [laya] pehle se chal raha hai.
  )
)

"%NODE_EXE%" server\supervisor.js
echo.
echo [watchdog] supervisor band hua. Dobara chalane ke liye
echo is file ko phir se double-click karo.
pause
