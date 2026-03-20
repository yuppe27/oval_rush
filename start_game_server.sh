#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

PORT="${PORT:-8000}"
URL="http://localhost:${PORT}/"

echo "Starting game server in \"$SCRIPT_DIR\""
echo
echo "Open this URL in your browser:"
echo "$URL"
echo

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 &
fi

if command -v python3 >/dev/null 2>&1; then
    exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
    exec python -m http.server "$PORT"
fi

echo "Python was not found."
echo "Install Python 3 and make sure \"python3\" or \"python\" is available in PATH."
exit 1
