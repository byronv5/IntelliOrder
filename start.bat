@echo off
cd /d "%~dp0"

set PORT=8765
set URL=http://127.0.0.1:%PORT%/

echo ========================================
echo   IntelliOrder
echo   Order:  %URL%
echo   Dash:   http://127.0.0.1:%PORT%/dashboard/
echo   Ctrl+C to stop
echo ========================================
echo.

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

where python >nul 2>&1
if errorlevel 1 goto try_py
set PY_CMD=python
goto run_manifest

:try_py
where py >nul 2>&1
if errorlevel 1 goto no_python
set PY_CMD=py -3
goto run_manifest

:no_python
echo [ERROR] Python not found. Install Python 3 and add to PATH.
pause
exit /b 1

:run_manifest
%PY_CMD% backend\generate_manifest.py
if errorlevel 1 (
  echo [WARN] manifest failed. Try: pip install openpyxl
)

echo Starting server...
start "" cmd /c "timeout /t 2 /nobreak >nul && start %URL%"

%PY_CMD% backend\server.py
if errorlevel 1 (
  echo.
  echo [ERROR] Server failed to start.
  pause
)
