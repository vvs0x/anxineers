#!/bin/bash
# Double-click this file in Finder. It installs what is missing, asks once for the ElevenLabs key, starts the server and opens the browser.
cd "$(dirname "$0")/web" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install the LTS version from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org"; read -n 1 -s -r -p "Press any key to close."; exit 1
fi
[ -d node_modules ] || npm install
if [ ! -f .env ] || ! grep -q "ELEVENLABS_API_KEY=." .env; then
  echo "Paste your ElevenLabs API key and press Enter (leave empty to skip voice):"
  read -r KEY
  cp -n .env.example .env 2>/dev/null
  sed -i '' "s|^ELEVENLABS_API_KEY=.*|ELEVENLABS_API_KEY=$KEY|" .env
fi
if command -v adb >/dev/null 2>&1 && adb devices | grep -q "device$"; then
  adb reverse tcp:8080 tcp:8080 && echo "Quest connected by USB: open http://localhost:8080 in the Quest browser."
fi
(sleep 2; open "http://localhost:8080") &
npm start
