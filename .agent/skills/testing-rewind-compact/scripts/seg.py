#!/usr/bin/env python3
"""Print a compact view of one seq range of a dsh session transcript.
Usage: unzstd -c <session> | python3 seg.py LO HI"""
import sys, json, re

lo, hi = int(sys.argv[1]), int(sys.argv[2])


def txt(msg):
    c = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


def one(s, n=140):
    return re.sub(r"\s+", " ", s or "").strip()[:n]


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    seq = r.get("seq")
    if not isinstance(seq, int) or not (lo <= seq <= hi):
        continue
    t = r.get("type")
    d = r.get("data") or {}
    if t == "user/message":
        print(f"{seq:>5} USER[{(d.get('source') or {}).get('kind')}] {one(txt(d))}")
    elif t == "assistant/message":
        for b in ((d.get("message") or {}).get("content") or []):
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text" and b.get("text", "").strip():
                print(f"{seq:>5} ASSIST {one(b['text'])}")
            elif b.get("type") == "tool_use":
                print(f"{seq:>5} CALL {b.get('name')} {one(json.dumps(b.get('input')))}")
    elif t == "tool/result":
        print(f"{seq:>5} RESULT {one(txt(d.get('message') or {}) or str(d.get('result', '')))}")
