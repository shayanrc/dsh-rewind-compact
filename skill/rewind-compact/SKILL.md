---
name: rewind-compact
description: Rewind the conversation to an earlier turn and compact the discarded side into a hybrid summary. Use when the context is under pressure, work has derailed, or the user asks to rewind, compact, or start over from an earlier point.
disable-model-invocation: false
---

# rewind-compact

Rewind the conversation to a completed-turn boundary and compact one side of it into a hybrid summary; the other side survives verbatim. Everything is recoverable.

## 1. When to propose a rewind-compact

- Context pressure is climbing (long session, thinning signal).
- Work has derailed and continuing costs more than restarting from an earlier point.
- The user signals "start over from X" or asks to rewind / compact.

## 2. Using the rewind_compact tool

- Compaction (either side) runs without approval and is safe: the discarded side always remains recoverable in the pre-rewind session.
- Rewind forks a new session and ALWAYS requires user approval: expect a decision prompt and wait for it. In headless runs the approval fails closed.
- Point is a completed turn **number**, 1-based; `-1` means the newest completed turn (exact turn ids also resolve). Any other value — `0`, an out-of-range number, a decimal like `2.5`, empty input — fails with `REWIND_COMPACT_NO_TURN`: fix the number, never guess or retry with a different one.
- Mode must be exactly `after` (default when omitted; compacts the tail) or `before` (compacts the prefix). Any other token is a usage error. Never pick a mid-turn point.
- Read the result: `applied: false` (with a `note`) means this profile has no compaction service and nothing was summarized. Say so instead of reporting a summary.

## 3. Compact summary format (five-field scaffold)

Every compacted side is summarized as five labeled sections followed by prose:

1. Files changed — created/modified/deleted.
2. Commands run — with exit codes where recorded.
3. Errors encountered.
4. Decisions made.
5. Outstanding TODOs.

If a field has no data, say so. If the range already contains a prior compact summary, note "includes a prior compact summary".

## 4. Post-fork etiquette

- The pre-rewind session keeps existing and is resumable by session id; it holds the discarded side in full.
- Files are NOT reverted in v1: the plugin only reports which files changed. Never claim they were.
- The forked session title is "<original title> (rewound)".
