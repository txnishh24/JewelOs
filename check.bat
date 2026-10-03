@echo off
REM ============================================================
REM  JewelOS — check everything before you deploy
REM  Double-click this file. Takes about ten seconds.
REM ============================================================
setlocal
cd /d "%~dp0"
set FAILED=0

echo.
echo ============================================================
echo   JewelOS pre-deploy check
echo ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Get it from https://nodejs.org - pick the LTS version.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/3] Checking each file for typos that would break the app...
echo.
for %%F in (js\*.js) do (
  node --check "%%F" >nul 2>&1
  if errorlevel 1 (
    echo   BROKEN: %%F
    node --check "%%F"
    set FAILED=1
  ) else (
    echo   ok  %%F
  )
)

echo.
echo [2/3] Running the regression tests ^(the maths and the logic^)...
echo.
node tests\regression.test.js
if errorlevel 1 set FAILED=1

echo.
echo [3/3] Looking for things the code refers to that were never created...
echo.
pushd checks
node scope.js ..
node handlers.js ..
node ids.js ..
node css.js ..
node loadorder.js ..
node backup-check.js ..
node roundtrip.js ..
node making-basis.js ..
node unquoted-args.js ..
popd

echo.
echo ============================================================
if "%FAILED%"=="1" (
  echo   SOMETHING FAILED. Do not deploy. Scroll up to see what.
) else (
  echo   Tests and syntax passed.
  echo.
  echo   Step 3 above is a list, not a verdict - most entries are
  echo   known false positives. Compare it against the last run
  echo   rather than reading every line as a problem. The two that
  echo   must be clean are backup-check and roundtrip.
)
echo.
echo   NONE OF THIS TESTS THE SCREEN. No button, no layout, no
echo   tap has been checked. Open the app on a real phone before
echo   you trust it.
echo ============================================================
echo.
pause
