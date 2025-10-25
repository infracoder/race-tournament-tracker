#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/mariokart-mdns.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No mDNS PID file found. Nothing to stop."
  exit 0
fi

PID="$(cat "$PID_FILE" || true)"
if [ -z "$PID" ]; then
  echo "PID file empty. Cleaning up."
  rm -f "$PID_FILE"
  exit 0
fi

if ps -p "$PID" -o comm= | grep -q "dns-sd"; then
  echo "Stopping mDNS advertisement (PID $PID)..."
  kill "$PID" || true
  for i in 1 2 3; do
    if ps -p "$PID" > /dev/null; then
      sleep 1
    else
      break
    fi
  done
  if ps -p "$PID" > /dev/null; then
    echo "Force killing dns-sd (PID $PID)..."
    kill -9 "$PID" || true
  fi
else
  echo "Process $PID is not dns-sd. Cleaning up stale PID file."
fi

rm -f "$PID_FILE"
echo "mDNS advertisement stopped."
