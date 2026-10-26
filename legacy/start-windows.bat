@echo off
setlocal EnableExtensions
title Lab Connect
chcp 65001 >nul 2>nul

set "APP_DIR=%~dp0"
set "SCRIPT=%APP_DIR%lab_connect.py"
set "LOG_DIR=%USERPROFILE%\.lab-connect"
set "LOG_FILE=%LOG_DIR%\launcher.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul

echo.
echo ============================================================
echo  Lab Connect - Windows Launcher
echo ============================================================
echo.

if not exist "%SCRIPT%" (
    call :fail "lab_connect.py was not found next to this BAT file."
    goto :end
)

where py >nul 2>nul
if not errorlevel 1 (
    py -3 --version >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON=py -3"
        goto :python_found
    )
)

where python >nul 2>nul
if not errorlevel 1 (
    python --version >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON=python"
        goto :python_found
    )
)

echo Python 3 is not installed.
echo.
where winget >nul 2>nul
if not errorlevel 1 (
    choice /C YN /N /M "Install Python 3 now with winget? [Y/N]: "
    if not errorlevel 2 (
        echo.
        echo Installing Python 3...
        winget install --id Python.Python.3.12 --exact --source winget --accept-package-agreements --accept-source-agreements
        if errorlevel 1 (
            call :fail "Python installation failed. See the output above."
            goto :end
        )
        echo.
        echo Python was installed. Close this window, then run start-windows.bat again.
        goto :end
    )
)

call :fail "Python 3 was not found. Install it from https://www.python.org/downloads/windows/ and select Add Python to PATH."
goto :end

:python_found
echo Python command: %PYTHON%
%PYTHON% --version
if errorlevel 1 (
    call :fail "The Python command exists but could not start."
    goto :end
)

echo Starting the local setup page...
echo Keep this window open while using Lab Connect.
echo Launcher errors: %LOG_FILE%
echo.

%PYTHON% "%SCRIPT%" 2>>"%LOG_FILE%"
set "APP_EXIT=%ERRORLEVEL%"

if not "%APP_EXIT%"=="0" (
    call :fail "Lab Connect exited with code %APP_EXIT%."
    goto :end
)

echo Lab Connect has stopped normally.
goto :eof

:fail
echo ERROR: %~1
echo [%DATE% %TIME%] ERROR: %~1>>"%LOG_FILE%"
echo Diagnostic log: %LOG_FILE%
goto :eof

:end
echo.
pause
endlocal
