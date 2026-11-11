@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js isn't installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist node_modules\electron (echo First run: installing... & call npm install)
powershell -nologo -noprofile -command "if ((Get-Item package.json).LastWriteTime -gt (Get-Item node_modules\.package-lock.json).LastWriteTime) { exit 1 }" >nul 2>nul
if errorlevel 1 (echo Updating components... & call npm install & copy /b node_modules\.package-lock.json +,, >nul 2>nul)
start "" /min cmd /c npm start
