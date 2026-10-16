#!/usr/bin/env bash
# Test dsh-rewind-compact on an ISOLATED copy of the web profile.
#
# Never touches the live `web` profile: it initializes a throwaway profile
# from the shipped web template, installs this repo as a bundle, verifies the
# patch composes, and boots the web app on a scratch port.
#
# Usage: scripts/test-web-profile.sh [profile-name] [port]
#   profile-name defaults to web-rewind-test, port defaults to 8123.

set -uo pipefail

PROFILE="${1:-web-rewind-test}"
PORT="${2:-8123}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="${TMPDIR:-/tmp}"   # scratch files: config dump + boot log

say() { printf '\n== %s ==\n' "$*"; }

# 1. Create the test profile from the web template. The launcher boots the
#    profile once after init; we kill that boot (scratch port, we re-boot later).
say "1. init profile '$PROFILE' from web template"
dsh --profile "$PROFILE" --from-default-profile web --port "$PORT" &
INIT_PID=$!
sleep 12
kill "$INIT_PID" 2>/dev/null || true
wait "$INIT_PID" 2>/dev/null || true

# 2. Install this repo as a profile bundle. `dsh plugin` forwards to pnpm and
#    then reconciles dsh.profile.bundles: a dependency declaring `dsh.bundle`
#    joins the layer stack automatically.
say "2. install bundle into profile"
dsh plugin --profile "$PROFILE" add --offline "file:$REPO"

# 3. Compose check: our entry must appear in the composed config tree.
say "3. dump-config check"
dsh --profile "$PROFILE" --dump-config > "$TMPDIR/rewind-compact-config.txt"
if grep -q "rewind-compact/entry" "$TMPDIR/rewind-compact-config.txt"; then
  echo "OK: rewind-compact/entry composed"
else
  echo "FAIL: rewind-compact/entry missing from composed tree" >&2
  cat "$TMPDIR/rewind-compact-config.txt"
  exit 1
fi

# 4. Boot the web app with the bundle loaded and verify registration.
say "4. boot web app on port $PORT and verify registration"
dsh --profile "$PROFILE" --port "$PORT" > "$TMPDIR/rewind-compact-boot.log" 2>&1 &
BOOT_PID=$!
trap 'kill "$BOOT_PID" 2>/dev/null || true' EXIT

LOADED=0
for _ in $(seq 1 30); do
  if grep -q "\[rewind-compact\] entry loaded" "$TMPDIR/rewind-compact-boot.log"; then
    LOADED=1
    break
  fi
  sleep 1
done
if [ "$LOADED" = 1 ]; then
  echo "OK: [rewind-compact] entry loaded"
else
  echo "FAIL: entry never loaded; boot log follows" >&2
  cat "$TMPDIR/rewind-compact-boot.log"
  exit 1
fi

echo "--- rewind-compact lines in boot log ---"
grep -iE "rewind.compact|rewind_compact" "$TMPDIR/rewind-compact-boot.log" | head -10 || true

echo "--- HTTP smoke ---"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:$PORT/" 2>/dev/null \
  || echo "HTTP check failed (the web app may serve on another path or need credentials)"

say "done — boot log at $TMPDIR/rewind-compact-boot.log (app still running, pid $BOOT_PID)"
echo "Manual interactive checks: see TESTING.md. Kill the app with: kill $BOOT_PID"
