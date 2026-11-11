#!/bin/bash
# Double-click to start Cursor Rig. Installs what it needs the first time.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Already running? Don't start another copy (this is what used to pile up windows).
if pgrep -f "Cursor Rig MONSTERTRAP FORK/node_modules/electron" >/dev/null 2>&1 || pgrep -f "electron \." >/dev/null 2>&1; then
  echo "Cursor Rig is already running (look for it in the menu bar)."
  sleep 1
  osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
  exit 0
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get it from https://nodejs.org, then double-click this again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
if [ ! -d node_modules/electron ]; then
  echo "First run: installing (a minute or two)..."
  npm install || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }
fi
# an update that changed package.json (a newer Electron or library) needs one install before it starts
if [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
  echo "Updating components (a minute or two)..."
  npm install && touch node_modules/.package-lock.json || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }
fi
nohup npm start >/dev/null 2>&1 &
disown
echo "Cursor Rig is starting."
sleep 2
osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
