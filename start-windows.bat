@echo off
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3 lab_connect.py
    goto :eof
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    python lab_connect.py
    goto :eof
)

echo Python 3 is required.
echo Download it from https://www.python.org/downloads/
pause
