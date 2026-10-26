# RWC-011 — Align README, SKILL, SPEC, and AGENTS with actual behavior

- **Status:** done
- **Priority:** P1
- **Type:** docs / spec
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-002, RWC-003, RWC-004, RWC-005, RWC-006, RWC-015
- **Blocks:** RWC-016
- **Spec:** R11, R12, §5
- **Review:** 2026-10-27 review, P2-11; spec audit R11/R12

## Post-ADR note (2026-10-27)

RWC-015 is signed. Apply the ADR's SPEC delta and the reviewer's editorial
corrections (sessionTitle.rename for D7, D2b/D4 wording, TUI 0.17.0 line,
tension numbering). The ticket is still blocked on the code fixes
(RWC-002–007, 010, 012); do not claim hybrid in-place behavior.

## Context

The docs currently promise behavior the code does not deliver:

- **README** headline: “hybrid (scaffold + LLM prose)”. Every fork path is
  scaffold-only; the in-place hybrid path does not run on 0.2.1. The
  “verified end-to-end” claim is scoped to a web profile with no compaction.
- **README** harness seams: says “schemastery parameter specs” (the tool uses a
  per-property map; schemastery is unused) and lists `ctx.skills.register({
  ..., path })` without the required inline `content`/`source`.
- **SKILL** says compaction is always recoverable in the pre-rewind session
  (false for in-place), promises a decision prompt (R7 is a direct-human check,
  no prompt), claims a ` (rewound)` title (not set), and says every compacted
  side gets five sections followed by prose (fork paths are scaffold-only).
- **SPEC** has internal tensions: R4 vs R7; R5’s hybrid requirement vs the
  fallback being the default; R6 assuming the TUI rows are turn boundaries;
  R11’s “decision prompt”; R12’s create-time title.
- **AGENTS.md** repeats the exclusive-`compactRegion`-end claim (0.2.1 uses an
  inclusive end) and the “known limitation” framing for `_no-cwd`, which is a
  bug (RWC-002).
- `docs/task_dependencies.mmd` marks TUI picker integration as done.

This ticket assumes RWC-015 has recorded the decisions; it does not decide them.

## Tasks

- [x] Update `README.md`:
      - state the tested harness line(s) and the supported profiles;
      - describe the actual summary behavior per surface (hybrid in-place vs
        scaffold-only fork, or the retired behavior);
      - replace “schemastery parameter specs” with the per-property map and
        raw JSON Schema output dialect;
      - document the skill registration requirements (`content`, `source`,
        `provider` defaults);
      - remove fixed known limitations that RWC-002 fixes; keep real ones;
      - scope the E2E claim to what `scripts/e2e-web-test.py` actually proves.
- [x] Update `skill/rewind-compact/SKILL.md`:
      - remove the decision-prompt promise unless RWC-015 adds one;
      - state the recovery semantics separately for fork vs in-place;
      - state the title behavior (or drop the claim);
      - state scaffold-only vs prose accurately;
      - keep the four required parts in order and the frontmatter triggers.
- [x] Update `SPEC.md` (or add `docs/decisions/RWC-015-*.md` and link it):
      - scope R4 to rewind runs and reference R7;
      - define R5’s fallback and field derivations, or mark the in-place path
        retired;
      - fix R6’s row→turn mapping and the `rewind-done` cut semantics;
      - reconcile R11’s prompt wording with R7;
      - define R12’s title mechanism as an event, not a create option.
- [x] Update `AGENTS.md`:
      - correct the `compactRegion` end/range invariants;
      - update the seed/fork invariants if RWC-002/003 change them;
      - add `docs/tickets/README.md` to the navigation pointers;
      - replace the stale `docs/task_dependencies.mmd` pointer with the ticket
        graph (or mark the old file historical).
- [x] Update `TESTING.md`:
      - expected TUI confirm-pane modes;
      - expected child header/title;
      - expected compaction-enabled result and failure messages;
      - remove claims not backed by a run.
- [x] Grep for stale claims: `hybrid`, “decision prompt”, `(rewound)`,
      “schemastery”, “exclusive end”, “every profile”, `_no-cwd`.

## Acceptance criteria

- [x] Every claim about behavior in README/SKILL/TESTING is backed by a test,
      a recorded manual run, or a linked ticket that changes it.
- [x] README and SKILL agree on: summary mode per surface, recovery semantics,
      approval behavior, and title behavior.
- [x] SPEC (or linked ADR) has no unresolved contradiction for R4/R7, R5
      fallback, R6 mapping, R11, R12.
- [x] AGENTS.md points to the ticket index and contains no stale end-semantics
      or “known limitation” claim.
- [x] The stale phrases above are gone or explicitly historical.
- [x] `npm run check` and the docs links still pass.

## Verification

```sh
grep -RIn "hybrid\|decision prompt\|(rewound)\|schemastery\|exclusive end\|_no-cwd" README.md SKILL.md TESTING.md AGENTS.md SPEC.md skill/
```

Expected: only accurate, scoped statements remain.

## Out of scope

- Implementing the behavior (RWC-002…RWC-010).
- Rewriting the research notes.

## Notes / evidence

- `README.md:3` “hybrid (scaffold + LLM prose)”; `:36-37` known limitations;
  `:42-49` seam descriptions.
- `skill/rewind-compact/SKILL.md` §2–§4.
- `AGENTS.md` Gotchas: “compactRegion … takes an exclusive end”; opposite in
  0.2.1.
- Spec audit: R5/R6 not met; R4/R12 partial; R11 content contradictions.

## Evidence (2026-10-27 remediation)

- `SPEC.md` applied the ADR RWC-015 consolidated delta (R2/R3/R4/R5/R6/R7/R10/
  R11/R12/§6.3/§7) and records the revision provenance.
- `README.md` states scaffold-only v1, retired `rewind:false`, direct-human/no
  prompt, after-only TUI, `meta`/`inheritedEventCount`/best-effort
  `session/title`, and the per-property + raw-JSON-Schema tool dialect.
- `skill/rewind-compact/SKILL.md` keeps the four parts in order and describes
  per-surface recovery, scaffold-only summaries, no prompt, and the error toast.
- `AGENTS.md` / `docs/HARNESS-CONTRACTS.md` no longer describe a shipped
  in-place/hybrid path, a decision prompt, an exclusive `compactRegion` end, or
  a create-time title; the ticket board/graph are linked and the old
  `task_dependencies.mmd` is historical.
- `TESTING.md` uses the ADR D10 two-gate scratch-profile run, after-only TUI,
  child header/title/summary, and failure messages.
- `.agent/skills/testing-rewind-compact/SKILL.md` updated to v4 paths, the
  workspace bucket, after-only TUI, retired `rewind:false`, and `src=rewind-compact`.
- Remaining `hybrid`/`_no-cwd` mentions are explicitly scoped as v2/historical
  or corrective (e.g. "there is no `_no-cwd` bucket").

- Independent review (2026-10-27): **PASS** after fixes. Verified picker scope, probe-import wording, stale-claim audit, and title event in `setup` before publication across SPEC/ADR/README/SKILL/HARNESS/TESTING.

- Independent verification (2026-10-27): **VERIFIED**. Reran 77/77 + check; v1 claims, title-in-setup, picker scope, scoped hybrid/plugin mentions, and 107/107 relative links all pass.
