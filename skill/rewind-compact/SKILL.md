---
name: rewind-compact
description: Rewind the conversation to an earlier completed turn and summarize the discarded side as a five-field scaffold. Use when the context is under pressure, work has derailed, or the user asks to rewind, compact, or start over from an earlier point.
disable-model-invocation: false
---

# rewind-compact

Rewind the conversation to a completed-turn boundary and summarize one side of it as the mechanical five-field scaffold; the other side survives verbatim. Everything is recoverable.

## 1. When to propose a rewind-compact

- Context pressure is climbing (long session, thinning signal).
- Work has derailed and continuing costs more than restarting from an earlier point.
- The user signals "start over from X" or asks to rewind / compact.

## 2. Using the rewind_compact tool

- `rewind: true` forks a new session at the boundary and puts the five-field scaffold on the compacted side; the other side stays verbatim. It requires **direct human authority in the current turn** and fails closed (`REWIND_COMPACT_APPROVAL_REQUIRED`) when there is no human (headless/sdk/goal-round). The plugin does **not** show a decision prompt — if you are unsure the user wants a fork, ask in conversation before calling.
- `rewind: false` (or omitted) is the **retired in-place path**: nothing is forked, appended, or compacted. It returns `ok: false`, `applied: false`, `reason: "in_place_retired"`, `hybrid: false`, and a `note` pointing at `rewind: true`. Do not use it to "compact in place"; use `rewind: true` (or `/rewind-compact`) to fork.
- Point is a completed turn **number**, 1-based; `-1` means the newest completed turn (exact turn ids also resolve). Any other value — `0`, an out-of-range number, a decimal like `2.5`, empty input — fails with `REWIND_COMPACT_NO_TURN`: fix the number, never guess or retry with a different one. A turn no longer in the current context (its messages were compacted away) still resolves — that is the recovery path; the interactive `/rewind-compact` picker, by contrast, only lists turns still in the current context.
- Mode must be exactly `after` (default when omitted; compacts the tail) or `before` (compacts the prefix). Any other token is a usage error. Never pick a mid-turn point.
- Read the result: a successful fork returns `ok: true`, `applied: true`, `forked: true`, `hybrid: false` (v1 is scaffold-only). `applied: false` means nothing happened — for the retired path, call again with `rewind: true`; never report that a summary was produced.

## 3. Compact summary format (five-field scaffold)

v1 summaries are **scaffold-only**: every compacted side becomes the mechanical five-field scaffold below. There is no LLM prose in v1 (it is deferred), so never promise or invent prose.

1. Files changed — created/modified/deleted, derived conservatively from `write`/`edit` calls; reads, searches, fetches, and `bash` output do not count.
2. Commands run — with exit codes where recorded.
3. Errors encountered.
4. Decisions made.
5. Outstanding TODOs.

If a field has no data, say so. If the range already contains a prior compact summary, note "includes a prior compact summary".

## 4. Post-fork etiquette

- The pre-rewind session keeps existing and is resumable by session id; it holds the discarded side in full.
- Files are NOT reverted in v1: the plugin only reports which files changed. Never claim they were.
- Recovery differs by surface:
  - **Command/tool fork** — the result names the child and the source session; the source keeps the discarded side. The direct-human check is the only authority gate (no prompt).
  - **TUI** — use the `/rewind-compact` command or the tool. The Esc-Esc picker mode is descoped for v1 on dsh-tui 0.17.0 (RWC-018: backend bundle cannot register host DecisionEvents); use the command/tool and do not claim the picker is available. If the picker ever runs, the TUI forks and the plugin appends the scaffold; a failed append is an error toast.
  - **Retired in-place (`rewind: false`)** — nothing happened, so there is nothing to recover; call with `rewind: true` to fork.
- The forked session title is best-effort: a `session/title` event `<original title> (rewound)` is appended in the child's `setup`, before publication. An untitled source gets no title event, and a failed title append does not abort the fork, so the suffix may be absent or appear late.
