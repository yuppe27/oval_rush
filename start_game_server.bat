@echo off
setlocal

cd /d "%~dp0"

set "PORT=8000"
set "URL=http://localhost:%PORT%/"

echo Starting game server in "%CD%"
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    echo Open this URL in your browser:
    echo %URL%
    echo.
    start "" %URL%
    py -m http.server %PORT%
    goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo Open this URL in your browser:
    echo %URL%
    echo.
    start "" %URL%
    python -m http.server %PORT%
    goto :end
)

echo Python was not found.
echo Install Python and make sure "py" or "python" is available in PATH.
echo.
pause

:end
endlocal
