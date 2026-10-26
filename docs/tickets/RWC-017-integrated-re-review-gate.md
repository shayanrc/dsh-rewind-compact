# RWC-017 — Independent integrated re-review and verification gate

- **Status:** done
- **Priority:** P0
- **Type:** test / gate
- **Estimate:** M
- **Owner:** integration-review lane
- **Created:** 2026-10-27
- **Depends on:** RWC-002, RWC-003, RWC-004, RWC-005, RWC-006, RWC-007, RWC-009, RWC-010, RWC-012, RWC-013, RWC-014, RWC-015
- **Blocks:** RWC-016
- **Spec:** §5, §6
- **Review:** integrated review after the wave-1 merge (`rwc-integrate`)

## Context

Wave 1 merged five lanes into `rwc-integrate` (`c774071`). The integrated tree
was green (`npm test` 68/68, `npm run check` ALL CONTRACTS PASS), but independent
review accepted only **RWC-014**. The other lanes returned changes requested:

- the TUI after-mode scaffold fed `surfaceEvents(tail)` to `buildScaffold`,
  dropping every `tool/call`; `Files changed`/`Commands run`/`Errors` were empty
  while the picker warning counted the same calls (RWC-006, RWC-010);
- a failed TUI append returned `undefined`, leaving the TUI's success toast
  (RWC-006, RWC-007);
- stale pre-ADR text remained in `README.md`, `SKILL.md`, `SPEC.md`,
  `AGENTS.md`, and `docs/HARNESS-CONTRACTS.md` (RWC-011);
- RWC-002 lacked child-JSONL proof, RWC-003 lacked before-mode policy replay
  and a real-validator fixture run, RWC-009's literal grep failed, RWC-005's
  ticket still described both TUI modes, and RWC-012 had mocked-profile
  evidence only.

This ticket is the convergence gate: fixes land, then every changed ticket is
reviewed by an agent that did not implement it and verified by a third agent
before `RWC-016` may start.

## Tasks

- [x] Land the review blockers in `rwc-integrate` (TUI scaffold input, failure
      toast, docs/spec alignment, child-JSONL proof, before-mode policy replay,
      real-validator fixture, literal grep, ticket text, real sdk-minimal run).
- [x] Re-run `npm test` and `npm run check` on the integrated tree.
- [x] For each changed ticket, assign a **reviewer agent** that did not author
      the change; it reads the diff, runs the ticket's verification, and returns
      pass or changes-requested with file:line evidence.
- [x] For each reviewer-passed ticket, assign a **verifier agent** that reruns
      the commands independently and checks the acceptance boxes.
- [x] Record the review/verify verdicts and command output in the ticket's
      Notes/evidence section; close only tickets with both verdicts.
- [x] Update the board and dependency graph as tickets close.
- [x] Hand a green, fully reviewed tree to `RWC-016`.

## Acceptance criteria

- [x] Every ticket in the dependency list is either `done` with review+verify
      evidence, or explicitly descoped in its ticket.
- [x] No open review thread remains changes-requested.
- [x] `npm test` and `npm run check` are green on the integrated tree.
- [x] The TUI after summary contains `Files changed`, `Commands run`, and
      `Errors encountered` from the discarded tail, matching the picker warning.
- [x] A forced append failure produces an error toast, never `undefined` or a
      success toast.
- [x] A real child JSONL proves `cwd`/`parentSession`/`isSeeded`/inherited
      count/`session/title`, and no `_no-cwd` bucket.
- [x] Before mode's seed carries the prefix policy baseline before the tail.
- [x] The `RWC-009` literal grep and the `RWC-012` sdk-minimal dump/boot evidence
      pass.
- [x] `RWC-011` docs contain no shipped-hybrid/in-place/prompt/create-title
      claim.

## Verification

```sh
npm test
npm run check
grep -RIn "{ kind: 'plugin'" lib tests scripts   # expect no output
# per-ticket review/verify commands are recorded in each ticket
```

Expected: green, no changes-requested, evidence recorded, `RWC-016` unblocked.

## Out of scope

- New features or behavior beyond the review blockers.
- Release evidence collection (RWC-016).

## Notes / evidence

- Integrated tree: `/home/xion/orca/workspaces/dsh-rewind-compact/rwc-integrate`
  at `c774071` before remediation.
- Original background workflow `workflow-e4c7740c0fb941ad` was killed by
  teardown; its structured verdicts were lost. The later integrated review is
  the authoritative source for the blockers above.

## Gate result (2026-10-27)

All changed tickets passed independent review and independent verification:

| Lane | Tickets | Review | Verify |
|---|---|---|---|
| fork/seed | RWC-002, RWC-003, RWC-009 | PASS | VERIFIED |
| TUI/tool | RWC-004, RWC-005, RWC-006, RWC-007, RWC-010 | PASS | VERIFIED |
| profiles/docs | RWC-011, RWC-012 | PASS | VERIFIED |
| tests/package | RWC-013, RWC-014 | PASS (013 after gate tests) | VERIFIED |

`npm test` 81/81; `npm run check` ALL CONTRACTS PASS. No changes-requested
thread remains. RWC-016 is unblocked for release verification.
