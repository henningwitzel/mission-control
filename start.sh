#!/bin/bash
# Mission Control + ngrok startup script
# Starts the server and tunnels it via ngrok, sends URL to Telegram

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$HOME/.openclaw/workspace/logs/mission-control.log"
PID_FILE="$HOME/.openclaw/workspace/logs/mission-control.pid"

mkdir -p "$(dirname "$LOG_FILE")"

# Kill any existing instances
if [ -f "$PID_FILE" ]; then
    kill $(cat "$PID_FILE") 2>/dev/null
fi
pkill -f "node server.js" 2>/dev/null
pkill -f "ngrok http 3456" 2>/dev/null
sleep 1

# Start the server
cd "$SCRIPT_DIR"
node server.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 2

# Start ngrok in background
ngrok http 3456 --log=stdout --log-level=info > "$HOME/.openclaw/workspace/logs/ngrok.log" 2>&1 &
NGROK_PID=$!
echo $NGROK_PID >> "$PID_FILE"
sleep 8

# Get the public URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tunnels = data.get('tunnels', [])
    if tunnels:
        print(tunnels[0]['public_url'])
except:
    pass
" 2>/dev/null)

if [ -n "$NGROK_URL" ]; then
    # Send URL to Telegram
    /Users/henning/.nvm/versions/node/v24.14.0/bin/openclaw message send \
        --channel telegram \
        -t 8443107584 \
        --message "🖥 Mission Control is live: $NGROK_URL" 2>/dev/null
    echo "$(date): Mission Control running at $NGROK_URL" >> "$LOG_FILE"
else
    echo "$(date): ngrok failed to start" >> "$LOG_FILE"
fi
