# RWC-015 — Resolve spec ambiguities in an ADR

- **Status:** done
- **Priority:** P0
- **Type:** decision
- **Estimate:** M
- **Owner:** user (signed off in session)
- **Created:** 2026-10-27
- **Signed off:** 2026-10-27 (user, in session)
- **Depends on:** —
- **Blocks:** RWC-004, RWC-006, RWC-011, RWC-016
- **Spec:** R4, R5, R6, R7, R11, R12
- **Review:** 2026-10-27 spec audit, “Spec-internal tensions”

## Context

Several failures are not implementation bugs alone: the spec assumes a seam or
behavior the harness does not provide, or contradicts another clause. Coding
before deciding will produce churn. This ticket records decisions with
rationale and links them from the affected tickets.

Decisions needed:

1. **R4 vs R7.** R4 says “a rewind-compact run always forks”; R7 explicitly
   allows the tool’s ungated in-place path. Choose: scope R4 to rewind runs, or
   remove the in-place mode. Recommendation: scope R4 to `rewind: true`; the
   in-place path is a compaction, not a rewind.
2. **R5 hybrid.** Repair the in-place path, or retire it and accept
   scaffold-only for forks? If repair, must the scaffold be inside the range, or
   is “summary then scaffold” acceptable? Recommendation: retire the in-place
   path for v1 if it cannot meet the surface/balance contract; deliver a testable
   scaffold-only fork and rename the feature honestly.
3. **R5 child-side compaction.** Is “child-side unavailable” proven on 0.2.1
   (`compactRegion` requires an open turn; `compactNow` exists for idle
   sessions)? If hybrid forks are required, specify seeding the discarded side
   and compacting in the child, or the first-turn path.
4. **R6 row model.** The TUI overlay lists user messages, not turn boundaries.
   Adopt “picked message → enclosing completed turn” as the contract; define
   behavior for a row in the open turn.
5. **Before mode on the TUI.** The TUI child is prefix-only and append-only.
   Choose: drop before from the TUI surface, or let the plugin create a
   summary-first child and switch to it.
6. **R11 approval wording.** “Surface a decision prompt” vs R7’s direct-human
   authority check. Pick one; update the skill.
7. **R12 title.** The harness logs `session/title`; there is no create-time
   title. Define the suffix as an event-based operation and whether it is
   best-effort.
8. **R10/field 1.** Define “Files changed” derivation precisely (write/edit
   only; conservative bash rule) or rename the field.
9. **R2 scope.** Does “summaries go through `ctx.compaction`” bind the fork
   fallback too? If yes, the fallback is non-conforming; if no, say so.
10. **Verification §6.3.** Keep the “temporary dsh-tui copy + `--dump-config`”
    requirement, or replace it with the actual scratch-profile + E2E workflow?

## Tasks

- [x] Write `docs/decisions/RWC-015-spec-decisions.md` (or a small ADR per
      decision) with: context, options, recommendation, decision, consequences,
      affected tickets, and spec text to change.
- [x] Get explicit owner sign-off on decisions 1–7 (the behavior-changing ones).
- [x] Edit `SPEC.md` in place if it is still the living spec; otherwise add an
      addendum and mark the superseded clauses.
- [x] Update the affected tickets’ Context/Tasks/Out-of-scope to match.
- [x] Update the board/status (RWC-004/RWC-006/RWC-011 become unblocked).
- [x] Record the decision date and harness line.

## Acceptance criteria

- [x] Every one of the ten decisions has a recorded outcome and rationale.
- [x] No affected ticket still describes a rejected design as required.
- [x] `SPEC.md` (or the ADR addendum) is internally consistent: R4/R7, R5
      fallback, R6 mapping, R11 approval, R12 title, R2 scope.
- [x] The owner has signed off (name/date in the ADR).
- [x] RWC-004/RWC-006/RWC-011 are unblocked or explicitly closed as
      won’t-do.

## Verification

Review-only: the ADR links resolve, the spec has no remaining contradiction,
and the affected ticket statuses match the decisions.

## Out of scope

- Implementing any decision (separate tickets).
- Changing the harness.

## Notes / evidence

- Review’s “Spec-internal tensions” list: R4/R7, R5/fallback, R6 row model,
  R3.1 before-mode feasibility, R11 prompt, R12 title, R5 field 1.
- Installed 0.2.1 `compactRegion` requires an open turn; `compactNow` is the
  idle-session entry point.
- The TUI row contract: `tui/rewind-prompt.seq` is the picked message; the done
  event carries the cut.

## Draft status (2026-10-27)

- **Draft:** [`docs/decisions/RWC-015-spec-decisions.md`](../decisions/RWC-015-spec-decisions.md)
  (10 decisions + D2b; each says “Recommended - awaiting owner sign-off”).
- **Reviewed by:** independent subagent (`RWC-015 review`), verdict **approve**
  with 10 non-blocking corrections to apply before the SPEC delta is merged.
- **Verified by:** independent subagent (`RWC-015 verify`), verdict **pass**
  (coverage, links, no SPEC/code/ticket edits; all 10 decisions present).
- **Signed off:** 2026-10-27. The ADR is the decision record; RWC-011 applies
  the SPEC delta and the editorial corrections from the ADR review.
- **Recommended dispositions for sign-off:** D1 scope R4 to rewind runs; D2
  retire in-place and ship scaffold-only forks; D3 defer child-side compaction;
  D4 map picked message → enclosing completed turn; D5 drop before mode from the
  TUI; D6 direct-human check only; D7 best-effort `session/title`; D8
  conservative write/edit file derivation; D9 bind R2 to LLM summaries only;
  D10 keep the dump-config gate plus live scratch runs.
- **Reviewer corrections to fold in before signing:** use
  `ctx.sessionTitle.rename` for D7 (raw append as fallback); correct the
  “unblocked by this ADR” wording; fix the D2b before-mode rationale and the D4
  “inflates” wording; name the TUI 0.17.0 line in the sign-off table; and
  reconcile the tension-coverage numbering.

## Completion (2026-10-27)

- **Signed by:** user (direct instruction in session); sign-off table filled in
  the ADR.
- **Artifact:** `docs/decisions/RWC-015-spec-decisions.md` — 10 decisions + D2b,
  all accepted; decision fields updated to “Accepted — owner sign-off
  2026-10-27”.
- **Unblocked:** RWC-004 (retire in-place), RWC-006 (drop TUI before mode), and
  RWC-011 (docs/SPEC delta), subject to their remaining dependencies.
- **Follow-ups for RWC-011:** use `ctx.sessionTitle.rename` for D7 (raw append
  as fallback); correct the D2b before-mode rationale and the D4 “inflates”
  wording; name TUI 0.17.0 in the sign-off record; reconcile the
  tension-coverage numbering; update the affected tickets and SPEC text.
- **No harness or live-profile changes.**
