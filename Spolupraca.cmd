@echo off
setlocal
cd /d "%~dp0"
"%~dp0.runtime\node\node.exe" "%~dp0scripts\development-workflow.mjs" status
echo.
echo Postup a prikazy: docs\WORKFLOW.md
pause
