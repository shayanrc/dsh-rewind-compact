#!/usr/bin/env python3
"""Dump the interesting parts of a forked child transcript.
Usage: unzstd -c <session.v3.jsonl.zstd> | python3 dumpchild.py"""
import sys, json

rows = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rows.append(json.loads(line))
    except Exception:
        pass

print("events:", len(rows))
for r in rows:
    t = r.get("type")
    d = r.get("data") or {}
    if t == "session":
        rec = {k: v for k, v in r.items() if k != "data"}
        print("session record:", json.dumps(rec)[:240])
        continue
    c = d.get("content")
    txt = ""
    if isinstance(c, list):
        txt = " ".join(p.get("text", "") for p in c if isinstance(p, dict))
    mid = d.get("id") or (d.get("message") or {}).get("id")
    src = (d.get("source") or {}).get("kind") if isinstance(d.get("source"), dict) else None
    print("  seq", r.get("seq"), t, "id=", str(mid)[:22], "src=", src, "op=", r.get("surfaceOp"))
    if "## Outstanding TODOs" in txt or txt.startswith("## Files changed"):
        print("     SCAFFOLD SUMMARY (first 6 lines):")
        for line in txt.splitlines()[:6]:
            print("       " + line[:100])
    elif txt:
        print("       " + txt.replace("\n", " | ")[:110])
