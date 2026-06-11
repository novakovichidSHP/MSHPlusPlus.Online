@echo off
setlocal
cd /d "%~dp0"

set PORT=8000

where py >nul 2>&1
if %errorlevel%==0 (
  py -3 -m http.server %PORT%
  goto :eof
)

where python >nul 2>&1
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :eof
)

echo Python not found. Install Python 3 and try again.
pause
