@echo off
cd /d "%~dp0"

echo ========================================
echo   IntelliOrder Build
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 goto try_py
set PY=python
goto check_py

:try_py
where py >nul 2>&1
if errorlevel 1 goto no_python
set PY=py -3
goto check_py

:no_python
echo [ERROR] Python not found. Install Python 3 and add to PATH.
pause
exit /b 1

:check_py
echo [1/5] Create venv and install deps...
if exist .venv-build rmdir /s /q .venv-build
%PY% -m venv .venv-build
if errorlevel 1 (
    echo [ERROR] Failed to create venv
    pause
    exit /b 1
)
.venv-build\Scripts\pip install pyinstaller openpyxl --quiet
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo [2/5] Clean old build output...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist IntelliOrder.spec del /q IntelliOrder.spec

echo [3/5] Build EXE...
.venv-build\Scripts\pyinstaller --onefile --console --name IntelliOrder --add-data "frontend\order;frontend\order" --add-data "frontend\dashboard;frontend\dashboard" --collect-all openpyxl --exclude-module PyQt5 --exclude-module PySide6 --exclude-module PyQt6 --exclude-module PySide2 backend\main.py
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo [4/5] Prepare release folder...
if not exist dist\datasource mkdir dist\datasource
if not exist dist\datasource\PIC mkdir dist\datasource\PIC

for %%f in (datasource\*.xlsx) do (
    copy "%%f" "dist\datasource\" >nul 2>&1
)
if exist datasource\PIC (
    xcopy /E /I /Q "datasource\PIC" "dist\datasource\PIC" >nul 2>&1
)

(
echo IntelliOrder
echo ============
echo.
echo Run IntelliOrder.exe to start the server and open the browser.
echo Press Ctrl+C to stop.
echo.
echo URLs:
echo   Order:     http://127.0.0.1:8765/
echo   Dashboard: http://127.0.0.1:8765/dashboard/
echo.
echo Place Excel files in datasource\ next to the EXE:
echo   history, compare, current, size detail, OTB xlsx files
echo   Product images in datasource\PIC\ named by style number
echo.
echo Orders are saved in data\orders.db next to the EXE.
) > dist\README.txt

echo [5/5] Clean temp files...
if exist build rmdir /s /q build
if exist .venv-build rmdir /s /q .venv-build
if exist IntelliOrder.spec del /q IntelliOrder.spec

echo.
echo ========================================
echo   Done. Output: dist\
echo     IntelliOrder.exe
echo     datasource\
echo     README.txt
echo ========================================
echo.
pause
