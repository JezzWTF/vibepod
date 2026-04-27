#!/usr/bin/env bash
# VibePod dev launcher
# Starts all services and kills the entire process group cleanly on Ctrl+C.

set -uo pipefail

CY=$'\e[36m'; MG=$'\e[35m'; RS=$'\e[0m'

# On any exit (including Ctrl+C) kill every process in this group.
trap 'kill 0' EXIT

prefix() {
    local label=$1 color=$2
    while IFS= read -r line; do
        printf '%s%-10s%s %s\n' "$color" "$label" "$RS" "$line"
    done
}

echo "Starting VibePod — Ctrl+C to stop all"
echo ""

bash server/start.sh  2>&1 | prefix "[SERVER]" "$CY" &
pnpm --filter vibepod-web dev 2>&1 | prefix "[WEB]"    "$MG" &

wait
