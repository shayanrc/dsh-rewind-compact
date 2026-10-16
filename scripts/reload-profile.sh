#!/usr/bin/env bash
# Reload the bundle into a profile: pnpm's `file:` protocol does NOT re-copy
# changed files ("Already up to date"), so a refresh is remove + add. Then
# verifies the copy and the composed config. Run from anywhere.
#
# Usage: scripts/reload-profile.sh [profile-name]   (default: dsh-tui)

set -euo pipefail
PROFILE="${1:-dsh-tui}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="${TMPDIR:-/tmp}"   # scratch: composed-config dump

echo "== reload $PROFILE =="
dsh plugin --profile "$PROFILE" remove dsh-rewind-compact 2>/dev/null || true
dsh plugin --profile "$PROFILE" add --offline "file:$REPO"

BUNDLE="$HOME/.dsh/profiles/$PROFILE/node_modules/dsh-rewind-compact"
diff -rq "$REPO/lib" "$BUNDLE/lib" >/dev/null && echo "OK: lib copy in sync" || { echo "FAIL: lib copy stale"; exit 1; }

dsh --profile "$PROFILE" --dump-config >"$TMPDIR/rewind-compact-config.txt" 2>/dev/null
grep -q "rewind-compact/entry" "$TMPDIR/rewind-compact-config.txt" && echo "OK: rewind-compact/entry composed" || { echo "FAIL: entry missing from composed tree"; exit 1; }

echo "== done. Restart the profile process for module changes to take effect =="
