============================================================
 SMARTAI PRO v20.0.1 - DEPS FIX (instant patch)
 "Cannot find package 'dotenv'" crash ka 1-click fix
============================================================

PROBLEM KYA THI:
---------------
v20.0 full setup zip me node_modules (server dependencies)
missing tha. Fresh install pe Start-SmartAI-Watchdog chalate
hi server crash-loop me gir gaya:
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv'
Supervisor GALAT "port conflict" message bhi de raha tha.

AB KYA HAI (v20.0.1):
---------------------
* Is zip me node_modules OFFLINE bundled hai - internet
  KI ZAROORAT NAHI. (pure-JS, Windows-safe)
* Naya supervisor: crash ki ASLI wajah batata hai
  ("DEPENDENCY MISSING") aur agar kabhi deps missing ho
  to KHUD npm install kar leta hai.
* Naya honest "server UP" message - pehla ping OK hone
  pe hi UP bolta hai.

KAISE USE KARE (2 minute):
--------------------------
1. Ye zip KAHIN BHI extract karo (Desktop pe bhi chalega).
2. 1-CLICK-FIX.bat double-click karo. Bas.
   - Wo khud aapka SmartAI folder dhoondhega
     (jaise D:\SmartAI26\app).
   - Purani crash-loop window band karega.
   - node_modules copy + naya supervisor + watchdog.
   - .env missing hai to purana copy / naya PIN banayega.
   - Last me site khud START kar dega.
3. Browser: localhost:8080

PIN KA NOTE:
-----------
* Purane install ka .env mila -> wahi purani PIN.
* Naya bana -> 1-CLICK-FIX window me LOGIN PIN print
  hota hai (note kar lo). .env me APP_PIN=... saved hai.

SAFE HAI:
---------
* Sirf ADD karta hai - positions/journal/secrets/data
  KABHI delete nahi hote.
* Purani supervisor/watchdog files .bak naam se safe.
* Idempotent - beech me band ho jaye to dobara chalao.

VERIFY:
-------
Watchdog window me ye lines aani chahiye:
  [watchdog] server START (pid ...) - pehla /api/ping OK
  [watchdog] server UP (pid ...) - /api/ping OK
Phir browser me localhost:8080 kholo.

PHIR BHI DIKKAT:
---------------
Ye 2 files bhejo (ab sab diagnosable hai):
  app\server\data\logs\server.log
  app\server\data\exit-reasons.log
