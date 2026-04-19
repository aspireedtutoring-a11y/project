@echo off
REM ── Event Impact Window – FX Spot Analyzer ──────────────
REM
REM Starts both the Bloomberg bridge server and the web app.
REM Run this on the Bloomberg Terminal machine.
REM
REM Prerequisites:
REM   - Python 3.8+ with blpapi installed
REM   - Node.js (for npx serve) OR Python http.server as fallback
REM   - Bloomberg Terminal logged in (for live data)
REM

echo.
echo  Event Impact Window - FX Spot Analyzer
echo  =======================================
echo.

REM ── Start Bloomberg bridge in background ────────────────
echo Starting Bloomberg bridge server on port 8085...
start "BBG Bridge" cmd /k "cd /d %~dp0server && python bloomberg_bridge.py || pause"
timeout /t 2 /nobreak >nul

REM ── Start web server ────────────────────────────────────
echo Starting web server on port 3000...
cd /d %~dp0
where npx >nul 2>nul
if %errorlevel% equ 0 (
    start "Web Server" cmd /k "npx --yes serve -l 3000 . || pause"
) else (
    start "Web Server" cmd /k "python -m http.server 3000 || pause"
)

timeout /t 2 /nobreak >nul

echo.
echo  Ready! Open http://localhost:3000 in your browser.
echo.
echo  Bloomberg bridge: http://127.0.0.1:8085/api/health
echo  Close this window to stop.
echo.
pause
