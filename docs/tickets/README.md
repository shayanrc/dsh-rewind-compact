# rewind-compact ticket backlog

Backlog created **2026-10-27** from the spec/runtime review. Each ticket is a
self-contained markdown file with context, tasks, acceptance criteria,
dependencies, and verification. The review evidence is in
`docs/research/` and the review conversation; the authoritative contracts are
`SPEC.md` and `docs/HARNESS-CONTRACTS.md`.

> **Baseline note:** the installed harness at review time was **0.2.1-rc.2**.
> `docs/HARNESS-CONTRACTS.md` was verified against 0.1.5-rc.2 and the
> `package.json` peer range ends at 0.2.0-rc.2. Several tickets below exist
> because of that drift; RWC-001 resolves the baseline before the fixes are
> considered stable.

> **Status 2026-10-27 04:10:** `RWC-001`, `RWC-008`, `RWC-014`, and `RWC-015` are **done**.
> All five wave-1 lanes merged in `rwc-integrate`; remediation and the
> independent re-review are active. `RWC-017` is the convergence gate;
> `011` waits on the code fixes, `007` on `004`+`006`, and `016` on a
> green `RWC-017`.

## Conventions

- **ID:** `RWC-NNN` (stable; do not renumber).
- **Status:** `open` (ready), `blocked` (waiting on a decision/dependency),
  `in-progress`, `done`.
- **Priority:** `P0` correctness or data integrity, `P1` user-visible quality,
  `P2` docs/packaging.
- **Estimate:** `S` (≤ half day), `M` (1–2 days), `L` (3+ days), relative to
  one engineer familiar with the harness.
- **Depends on** is a hard ordering constraint. **Blocks** records the inverse.
- A ticket is done only when every acceptance box is checked, `npm run check`
  is green on the declared harness line, and the verification commands were
  run and recorded.
- Update `Status` in both the ticket and the board table when it changes.

### Review labels referenced in tickets

- **P0-1** — in-place compaction cannot run on 0.2.1 (RWC-004, RWC-007)
- **P0-2** — fork create options ignored / title missing (RWC-002)
- **P0-3** — TUI picker seq mismatch (RWC-005)
- **P1-4** — TUI before-mode composition (RWC-006)
- **P1-5** — hand-rolled seed / shadowed messages (RWC-003)
- **P1-6** — failure atomicity and swallowed errors (RWC-007)
- **P1-7** — out-of-range turn points (RWC-008)
- **P1-8** — retired `plugin` message source (RWC-009)
- **P2-10** — “Files changed” accuracy (RWC-010)
- **P2-11** — README/SKILL/SPEC overclaims (RWC-011)
- **P2-12** — test/probe gaps (RWC-013)
- **P2-13** — package metadata (RWC-014)
- **baseline drift** — contracts/fixtures/version gate (RWC-001)
- **R9 partial** — sdk-minimal PENDING (RWC-012)
- **spec audit** — R1–R12 clause comparison (RWC-015, RWC-016)

## Board

| ID | Title | P | Status | Type | Est | Depends on | Spec |
|---|---|---|---|---|---|---|---|
| [RWC-001](RWC-001-harness-baseline.md) | Re-baseline contracts on 0.2.1-rc.2 | P0 | done | chore | M | — | §2, §6 |
| [RWC-002](RWC-002-fork-create-metadata.md) | Correct fork creation metadata and title | P0 | done | bug | M | 001 | R4, R12 |
| [RWC-003](RWC-003-surface-correct-seed.md) | Surface-correct fork seed + inherited state | P0 | done | bug | L | 001 (coord. 002) | R4, R5 |
| [RWC-004](RWC-004-in-place-compaction.md) | Retire the in-place compaction path (D2) | P0 | done | bug | S | 001 (015 signed) | R2, R5 |
| [RWC-005](RWC-005-tui-picker-mapping.md) | TUI picker: map picked message → turn | P0 | done | bug | S | 001 | R3, R6 |
| [RWC-006](RWC-006-tui-before-mode.md) | Drop TUI before mode (D5) | P1 | done | bug | M | 005 (015 signed) | R4, R5 |
| [RWC-007](RWC-007-failure-atomicity.md) | Failure atomicity and error surfacing | P0 | done | bug | M | 004, 006 | R5, §5 |
| [RWC-008](RWC-008-turn-point-validation.md) | Fail closed on invalid turn points | P1 | done | bug | S | — | R6 |
| [RWC-009](RWC-009-message-source-kind.md) | Replace retired plugin message source | P1 | done | bug | S | 003 | R5 |
| [RWC-010](RWC-010-files-changed-accuracy.md) | Make "Files changed" accurate | P1 | done | bug | M | 001 | R5, R6, R10 |
| [RWC-011](RWC-011-docs-spec-alignment.md) | Align README, SKILL, SPEC, AGENTS | P1 | done | docs | M | 002, 003, 004, 005, 006, 015 | R11, R12 |
| [RWC-012](RWC-012-profile-coverage.md) | Load on every profile (sdk-minimal) | P1 | done | bug | M | 001 | R9 |
| [RWC-013](RWC-013-test-probe-hardening.md) | Harden tests and contract probe | P1 | done | test | L | 001; final gate after the code fixes | §5, §6 |
| [RWC-014](RWC-014-package-distribution.md) | Fix package/distribution metadata | P2 | done | chore | S | 001 (coord. 013) | R1 |
| [RWC-015](RWC-015-spec-decisions.md) | Resolve spec ambiguities (ADR) | P0 | done | decision | M | — | R4–R7, R11, R12 |
| [RWC-016](RWC-016-release-verification.md) | Fresh-profile release verification | P1 | done | test | M | 001, 012, 013, 014; all P0/P1 code tickets | §6, §7 |
| [RWC-017](RWC-017-integrated-re-review-gate.md) | Independent integrated re-review + verify gate | P0 | done | test | M | 002–007, 009, 010, 012–015 | §5, §6 |
| [RWC-018](RWC-018-tui-decision-event-host.md) | TUI picker host DecisionEvents integration | P0 | done (descoped v1) | bug | L | 015 | R3.1, R6 |

## Traceability: review finding → ticket

| Review finding / theme | Ticket(s) |
|---|---|
| Harness baseline drift, stale probe/fixtures, version gate | RWC-001 |
| Fork create options ignored; title missing | RWC-002, RWC-012 |
| Seed resurrects shadowed messages; loses policy facts/turns/developer | RWC-003 |
| In-place compaction invalid range/open step/system head | RWC-004, RWC-007 |
| TUI prompt never offers modes; warning uses wrong seq | RWC-005 |
| TUI before mode wrong order/duplicates prefix/drops users | RWC-006 |
| Stray scaffold + swallowed TUI errors | RWC-007 |
| Out-of-range points and invalid mode default | RWC-008 |
| Retired `{kind:'plugin'}` source | RWC-009 |
| “Files changed” includes reads/URLs/bash listings | RWC-010 |
| README/SKILL/SPEC/AGENTS overclaims; stale task graph | RWC-011 |
| `sdk-minimal` PENDING on required commands/skills | RWC-012 |
| Missing tests for TUI/tool/command/rewind; probe holes | RWC-013 |
| No `files`/`engines`; unused schemastery peer; private decision | RWC-014 |
| Spec contradictions (R4/R7, R5 fallback, R6 rows, R11, R12) | RWC-015 |
| Verification uses web not temp dsh-tui; in-place/TUI unverified | RWC-016, RWC-018 |

## Spec coverage

| Spec clause | Status in review | Tickets |
|---|---|---|
| R1 bundle | met | RWC-014 (packaging) |
| R2 composition | met (scaffold-only scoped) | RWC-003, RWC-004, RWC-015 |
| R3 surfaces | met (TUI command/tool/skill; picker descoped) | RWC-005, RWC-006, RWC-009, RWC-018 |
| R4 fork semantics | met | RWC-002, RWC-003, RWC-006 |
| R5 five-field scaffold (v1) | met | RWC-003, RWC-004, RWC-007, RWC-009, RWC-010, RWC-015 |
| R6 picker | descoped for v1 (RWC-018) | RWC-005, RWC-008, RWC-010, RWC-018 |
| R7 gating | met | RWC-004, RWC-007, RWC-015 |
| R8 coexistence | met | RWC-013 (patch regression check) |
| R9 profiles | met (load/registration; release evidence in 016) | RWC-012, RWC-016 |
| R10 files warn | met | RWC-010 |
| R11 skill content | met | RWC-011, RWC-015 |
| R12 naming/title | met (best-effort event) | RWC-002, RWC-011 |

## Final sequence

1. **Done:** all tickets RWC-001–RWC-018.
2. **TUI picker:** descoped for v1 by RWC-018; the TUI command and tool ship.
3. **Gate:** RWC-017 reviewed and verified every changed ticket.
4. **Release:** RWC-016 records the web E2E, packaging, profile, uninstall, and
   contract evidence on throwaway profiles.

## Dependency graph and agent waves

- [`dependency-graph.md`](dependency-graph.md) — the coordination view: diagram,
  wave/lane plan, critical path, shared-file rules, status protocol.
- [`dependencies.mmd`](dependencies.mmd) — the Mermaid source of truth for the
  diagram (keep it in sync with the page).

The older `docs/task_dependencies.mmd` is historical: it marks “TUI picker
integration” and “Live TUI fork verified” as done, which the 2026-10-27 review
found not to be true (the picker never offers the plugin’s modes). Use the
ticket graph.

## Global definition of done

- Every acceptance box in the ticket is checked.
- Unit/integration tests cover the regression; the test fails before the fix.
- `npm run check` is green on the declared harness line.
- `README.md`, `SKILL.md`, `AGENTS.md`, and `docs/HARNESS-CONTRACTS.md` are
  updated where the ticket changes behavior or invariants.
- No direct writes to `~/.dsh` sessions, profiles, or locks; tests use
  throwaway profiles.
- Status updated here and in the ticket file.

## Creating a new ticket

Copy [`TEMPLATE.md`](TEMPLATE.md), use the next free `RWC-NNN`, fill every
section, and add a row to the board.
