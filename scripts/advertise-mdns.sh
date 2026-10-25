#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/mariokart-mdns.pid"
LOG_FILE="/tmp/mariokart-mdns.log"
JOB_LABEL="com.mariokart.mdns"

SERVICE_NAME="Mario Kart Tournament"
SERVICE_TYPE="_http._tcp"
DOMAIN="local"
HOST_LABEL="mariokart.local"
PORT="${PORT:-3000}"

mkdir -p "$(dirname "$PID_FILE")"

managed_pid() {
  launchctl list "$JOB_LABEL" 2>/dev/null | awk '/"PID" =/ {gsub(/;/, "", $3); print $3}'
}

MANAGED_PID="$(managed_pid || true)"
if [ -n "$MANAGED_PID" ] && ps -p "$MANAGED_PID" -o comm= | grep -q "dns-sd"; then
  echo "$MANAGED_PID" > "$PID_FILE"
fi

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
if launchctl list "$JOB_LABEL" >/dev/null 2>&1; then
  launchctl remove "$JOB_LABEL"
fi
launchctl submit -l "$JOB_LABEL" -o "$LOG_FILE" -e "$LOG_FILE" -- \
  /usr/bin/dns-sd -P "$SERVICE_NAME" "$SERVICE_TYPE" "$DOMAIN" "$PORT" "$HOST_LABEL" "$IPV4" "path=/"

sleep 1
DNS_SD_PID="$(managed_pid || true)"
if [ -z "$DNS_SD_PID" ] || ! ps -p "$DNS_SD_PID" > /dev/null; then
  echo "dns-sd terminated unexpectedly. See $LOG_FILE for details."
  exit 1
fi
echo "$DNS_SD_PID" > "$PID_FILE"

echo "mDNS advertisement started (PID $DNS_SD_PID). Log: $LOG_FILE"
echo "Try: open http://$HOST_LABEL:$PORT"
