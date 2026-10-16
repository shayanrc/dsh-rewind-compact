#!/usr/bin/env python3
"""Print the shell commands a past session ran, with the first line of each result.
Usage: unzstd -c <session> | python3 cmds.py [pattern] [max]

This harness records calls as tool/call events ({data:{name, arguments, callId}})
and their output as tool/result events, not as assistant tool_use blocks.
"""
import sys, json, re

pat = sys.argv[1] if len(sys.argv) > 1 else "."
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 60
rx = re.compile(pat, re.I)


def one(s, n=200):
    return re.sub(r"\s+", " ", s or "").strip()[:n]


def result_text(d):
    m = d.get("message") or {}
    c = m.get("content") if isinstance(m, dict) else None
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict))
    return str(d.get("result") or d.get("error") or "")


rows = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rows.append(json.loads(line))
    except Exception:
        pass

results = {}
for r in rows:
    if r.get("type") == "tool/result":
        d = r.get("data") or {}
        results[d.get("callId") or d.get("resultCallId")] = result_text(d)

n = 0
for r in rows:
    if r.get("type") != "tool/call":
        continue
    d = r.get("data") or {}
    name = d.get("name")
    args = d.get("arguments")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {"_raw": args}
    if not isinstance(args, dict):
        args = {}
    cmd = args.get("command") or args.get("code") or args.get("prompt") or ""
    cmd = one(str(cmd), 240)
    if not rx.search(cmd):
        continue
    res = one(results.get(d.get("callId"), ""), 110)
    print(f"seq {r.get('seq'):>5} {name:<8} $ {cmd}")
    if res:
        print(f"            -> {res}")
    n += 1
    if n >= limit:
        break
