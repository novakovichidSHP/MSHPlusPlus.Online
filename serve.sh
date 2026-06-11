#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-8000}"

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
fi

if command -v python >/dev/null 2>&1; then
  exec python -m http.server "$PORT"
fi

echo "Python 3 not found. Install Python and try again." >&2
exit 1
