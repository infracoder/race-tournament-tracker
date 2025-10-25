#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/mariokart-mdns.pid"
LOG_FILE="/tmp/mariokart-mdns.log"

SERVICE_NAME="Mario Kart Tournament"
SERVICE_TYPE="_http._tcp"
DOMAIN="local"
HOST_LABEL="mariokart.local"
PORT="${PORT:-3000}"

mkdir -p "$(dirname "$PID_FILE")"

# If already running, exit gracefully
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" || true)"
  if [ -n "${PID:-}" ] && ps -p "$PID" -o comm= | grep -q "dns-sd"; then
    echo "mDNS already advertising (PID $PID). Stop it with: npm run mdns:stop"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

# Determine default interface and IPv4
DEFAULT_IFACE="$(route get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
IPV4=""
if [ -n "$DEFAULT_IFACE" ]; then
  IPV4="$(ipconfig getifaddr "$DEFAULT_IFACE" 2>/dev/null || true)"
fi
if [ -z "$IPV4" ]; then
  for IF in en0 en1 en2; do
    IP="$(ipconfig getifaddr "$IF" 2>/dev/null || true)"
    if [ -n "$IP" ]; then IPV4="$IP"; break; fi
  done
fi
if [ -z "$IPV4" ]; then
  echo "Could not determine local IPv4 address. Connect to a network and retry."
  exit 1
fi

echo "Advertising '$SERVICE_NAME' as $HOST_LABEL on $IPV4:$PORT ..."
# Publish proxy records: SRV/TXT + A for mariokart.local
# TXT record includes a friendly path hint; adjust as needed.
nohup dns-sd -P "$SERVICE_NAME" "$SERVICE_TYPE" "$DOMAIN" "$HOST_LABEL" "$PORT" "path=/" "$IPV4" >"$LOG_FILE" 2>&1 &

DNS_SD_PID=$!
echo "$DNS_SD_PID" > "$PID_FILE"
disown "$DNS_SD_PID"

sleep 1
if ! ps -p "$DNS_SD_PID" > /dev/null; then
  echo "dns-sd terminated unexpectedly. See $LOG_FILE for details."
  exit 1
fi

echo "mDNS advertisement started (PID $DNS_SD_PID). Log: $LOG_FILE"
echo "Try: open http://$HOST_LABEL:$PORT"
