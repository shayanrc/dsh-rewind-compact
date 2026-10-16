#!/usr/bin/env bash
# Dump a session transcript's tail as readable records — the single most
# useful debugging tool for this plugin (the transcript is ground truth when
# the UI misleads and stdout logs are buffered away).
#
# Usage: scripts/session-tail.sh [session-id-or-path] [count]
#   - session id  -> resolves under $DSH_HOME/sessions
#   - file path   -> dumps that session.v3.jsonl.zstd directly
#   - count       -> last N records (default 25)

set -euo pipefail
TARGET="${1:?usage: session-tail.sh <session-id|path> [count]}"
COUNT="${2:-25}"

if [[ "$TARGET" == *.zstd ]]; then
  FILE="$TARGET"
else
  FILE="$(find "$HOME/.dsh/sessions" -path "*$TARGET/session.v3.jsonl.zstd" 2>/dev/null | head -1)"
fi
[[ -n "${FILE:-}" && -f "$FILE" ]] || { echo "session not found: $TARGET" >&2; exit 1; }

unzstd -c "$FILE" 2>/dev/null | python3 -c "
import json, sys, time
recs = [json.loads(l) for l in sys.stdin]
for r in recs[-$COUNT:]:
    t, d = r['type'], r.get('data', {})
    line = t
    if t == 'user/message' or t == 'assistant/message':
        c = d.get('message', {}).get('content', '')
        if isinstance(c, list): c = ' '.join(str(x.get('text', '')) for x in c if isinstance(x, dict))
        line += f' :: {str(c)[:160]}'
    elif t == 'tool/call': line += f' :: {d.get(\"name\")} {str(d.get(\"arguments\"))[:120]}'
    elif t == 'tool/result': line += f' :: {str(d.get(\"result\") or d.get(\"error\") or \"\")[:160]}'
    elif t in ('command/run', 'command/done'): line += f' :: {str(d)[:180]}'
    else: line += f' :: {str(d)[:120]}'
    print(f\"{r.get('seq')} {time.strftime('%H:%M:%S', time.localtime(r.get('time', 0) / 1000))} {line}\")
"
