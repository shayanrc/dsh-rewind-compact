#!/usr/bin/env python3
"""Compact conversation-history extractor for dsh session transcripts.

  unzstd -c <session.v3.jsonl.zstd> | python3 hist.py prompts [max]
  unzstd -c <session.v3.jsonl.zstd> | python3 hist.py tools  [max]
  unzstd -c <session.v3.jsonl.zstd> | python3 hist.py grep PATTERN [max] [window]

Prints a digest, not the transcript: prompts for the narrative skeleton, tools
for what actually ran, grep for a targeted drill-down.
"""
import sys, json, re

mode = sys.argv[1] if len(sys.argv) > 1 else "prompts"
arg = sys.argv[2] if len(sys.argv) > 2 else None
extra = sys.argv[3] if len(sys.argv) > 3 else None


def blocks(msg):
    c = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    return c if isinstance(c, list) else []


def text_of(msg):
    return " ".join(b.get("text", "") for b in blocks(msg)
                    if isinstance(b, dict) and b.get("type") == "text")


def one_line(s, n):
    return re.sub(r"\s+", " ", s or "").strip()[:n]


rows = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rows.append(json.loads(line))
    except Exception:
        pass

if mode == "prompts":
    limit = int(arg) if arg else 40
    n = 0
    for r in rows:
        d = r.get("data") or {}
        if r.get("type") != "user/message":
            continue
        src = (d.get("source") or {}).get("kind")
        if src != "user":
            continue
        t = one_line(text_of(d) if "content" in d else text_of(d.get("message") or {}), 160)
        print(f"seq {r.get('seq'):>5}  {t}")
        n += 1
        if n >= limit:
            break

elif mode == "tools":
    limit = int(arg) if arg else 60
    results = {}
    for r in rows:
        if r.get("type") == "tool/result":
            results[(r.get("data") or {}).get("callId")] = r
    n = 0
    for r in rows:
        d = r.get("data") or {}
        if r.get("type") == "tool/call":
            args = d.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    pass
            summary = one_line(json.dumps(args) if not isinstance(args, str) else args, 150)
            print(f"seq {r.get('seq'):>5}  CALL {d.get('name')}  {summary}")
            n += 1
        elif r.get("type") == "tool/result":
            msg = d.get("message") or {}
            print(f"seq {r.get('seq'):>5}  RESULT  {one_line(text_of(msg) or str(d.get('result','')), 150)}")
            n += 1
        if n >= limit:
            break

elif mode == "grep":
    pat = arg or ""
    limit = int(extra) if extra else 8
    window = 120
    hits = 0
    rx = re.compile(pat, re.I)
    for r in rows:
        blob = json.dumps(r)
        for m in rx.finditer(blob):
            s = max(0, m.start() - window)
            print(f"seq {r.get('seq'):>5} {r.get('type'):<18} …{blob[s:m.end()+window]}…")
            hits += 1
            break
        if hits >= limit:
            break
