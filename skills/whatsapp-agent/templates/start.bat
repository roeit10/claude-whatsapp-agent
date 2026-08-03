@echo off
REM Windows - double click to start the agent. Close the window to stop it.
cd /d "%~dp0"
echo Starting the agent... (Ctrl+C to stop)
node poller.mjs
pause
