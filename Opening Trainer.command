#!/bin/zsh
# Double-click to start the Opening Trainer and open it in the browser.
# Always uses http://localhost:5173: the app's data lives in the browser under that address.

cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
URL="http://localhost:5173"

if ! command -v npm >/dev/null; then
  echo "npm not found. Install Node.js (https://nodejs.org or 'brew install node') and try again."
  read -k1 "?Press any key to close."
  exit 1
fi

# Already running (another window or a dev session): just open it.
if curl -s -o /dev/null "$URL"; then
  echo "Opening Trainer is already running. Opening $URL"
  open "$URL"
  exit 0
fi

if [[ ! -f .env.local ]]; then
  echo "Note: no .env.local, so Lichess explorer features (Build, Mine) will fail."
  echo "Copy .env.example to .env.local and add your Lichess token."
fi

if [[ ! -d node_modules || ! -f public/engine/stockfish.wasm ]]; then
  echo "Installing dependencies (first run)…"
  npm install || { read -k1 "?Install failed. Press any key to close."; exit 1; }
fi

# Open the browser once the server answers.
(
  for _ in {1..60}; do
    if curl -s -o /dev/null "$URL"; then open "$URL"; exit 0; fi
    sleep 0.5
  done
) &

echo "Starting Opening Trainer at $URL. Close this window (or press Ctrl+C) to stop it."
exec npm run dev -- --port 5173 --strictPort
