#!/usr/bin/env bash
#
# echo-agent.sh — a minimal custom Rebecca agent in pure bash
#
# Usage:
#   ./echo-agent.sh <room>
#
# Behavior:
#   Joins the room as agent/echo, then loops forever:
#   waits for an @echo mention, replies with "Echo: <text>".
#
# Requirements:
#   - rebecca CLI on PATH
#   - jq (for JSON parsing)
#   - rebecca server running

set -euo pipefail

ROOM=${1:-${REBECCA_ROOM:-}}
if [ -z "$ROOM" ]; then
  echo "Usage: $0 <room>"
  exit 1
fi

ME=agent/echo
NAME=echo

cleanup() {
  echo "Leaving $ROOM..."
  rebecca leave "$ROOM" --as "$ME" || true
  exit 0
}
trap cleanup INT TERM

echo "Joining $ROOM as $NAME..."
rebecca join "$ROOM" --as "$ME" --name "$NAME" --kind agent

# Track the timestamp of the last mention we processed.
# Start at "now" so we don't reply to past mentions on startup.
SINCE=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
echo "Watching for new @$NAME mentions in $ROOM (since $SINCE)..."

while true; do
  # Block until a mention newer than $SINCE arrives
  mention_json=$(rebecca mentions "$ROOM" --for "$ME" --since "$SINCE" --wait --json | head -1)

  if [ -z "$mention_json" ]; then
    continue
  fi

  # Extract fields
  text=$(echo "$mention_json" | jq -r '.content[0].text // ""')
  sender=$(echo "$mention_json" | jq -r '.senderId')
  created=$(echo "$mention_json" | jq -r '.createdAt')
  sender_name=$(echo "$sender" | awk -F/ '{print $NF}')

  echo "Mention from $sender_name at $created: $text"

  # Reply (don't @mention sender to avoid loops; echo just talks)
  rebecca post "$ROOM" "Echo: $text" --as "$ME"

  # Advance the watermark so we don't re-process this mention
  SINCE=$created
done
