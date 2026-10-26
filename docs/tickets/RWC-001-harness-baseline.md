# RWC-001 — Re-baseline contracts on the installed 0.2.1-rc.2 harness

- **Status:** done
- **Priority:** P0
- **Type:** chore / compatibility
- **Estimate:** M
- **Owner:** wave-0 implementer + remediation (subagents)
- **Created:** 2026-10-27
- **Depends on:** —
- **Blocks:** RWC-002, RWC-003, RWC-004, RWC-005, RWC-009, RWC-012, RWC-013, RWC-016
- **Spec:** §2 facts, §6 verification, §7 hard constraints
- **Review:** baseline drift (version + contracts), 2026-10-27

## Context

The installed harness is `0.2.1-rc.2`, but `docs/HARNESS-CONTRACTS.md` was
verified against `0.1.5-rc.2`, and `package.json` peer ranges end at
`0.2.0-rc.2`. A fresh `dsh plugin add` is therefore outside the documented
version gate, while the existing linked install still boots. The green
`npm run check` does not prove compatibility: it imports lib modules from the
installed profile copy, selects only `session.v3` fixtures, and mirrors old
validator rules (e.g. `tool/result` role `"user"` instead of `"tool"`).

This ticket establishes one declared baseline and makes the probe enforce it.
Functional fixes are separate tickets.

## Tasks

- [x] Decide the supported line(s): at minimum `0.2.1-rc.2`; either drop the
      older rc list or add an explicit compatibility shim and matrix.
- [x] Update `package.json`:
      - add `engines.dsh` for the supported range, and/or extend the
        `@deepseek-ai/dsh-*` peer ranges to include `0.2.1-rc.2`;
      - remove versions that are no longer tested.
- [x] Re-verify and rewrite `docs/HARNESS-CONTRACTS.md` against 0.2.1-rc.2,
      with new file:line anchors for:
      - `createAgent` options (`sessionId`, `seed`, `meta`, `inheritedEventCount`,
        `agentPreset`, `parentSession`, `setup`);
      - `compactRegion` inclusive end and surface-node/balance preconditions;
      - `Session` format 4 and the surface type set (incl. `developer/message`);
      - TUI `tui/rewind-prompt` payload (`seq` is a picked **message** seq) and
        `tui/rewind-done` (`boundarySeq` is the cut, `turnStart.seq - 1`);
      - message source kinds (no `{kind: 'plugin', plugin}`);
      - skill and command registration shapes;
      - profile/version gate behavior.
- [x] Update `scripts/check-contracts.mjs`:
      - assert the running harness version is inside the declared range and
        fail with an actionable message;
      - import lib modules from the **worktree** (or refresh the profile copy
        as an explicit prerequisite);
      - prefer the newest `session.v*.jsonl*` fixture and test both v3 and v4
        only if both lines are supported;
      - use the real role map (`tool/result` → `tool`);
      - add checks for the summary source kind, seed shadowing, and create
        options (static assertion at minimum).
- [x] Update `README.md` / `TESTING.md` / `AGENTS.md` baseline references and
      the install command for the declared line.

## Acceptance criteria

- [x] `node -e "…peerRanges…"` shows the running `0.2.1-rc.2` satisfies the
      declared `engines.dsh` or peer range.
- [x] `npm run check` fails with a clear message when pointed at a harness
      outside the declared range (verify by temporarily overriding the version
      check, not by uninstalling anything).
- [x] `npm run check` on 0.2.1-rc.2 passes using a v4 fixture and the worktree
      code; editing `lib/tool.js` without reinstalling changes the result.
- [x] `dsh plugin --profile <scratch> add --offline file:$PWD` succeeds on
      0.2.1-rc.2, or the documented exemption path is exercised and recorded.
- [x] `docs/HARNESS-CONTRACTS.md` contains no unqualified 0.1.5-only claim and
      has a “verified on” date + version at the top.
- [x] A short compatibility matrix (harness line → supported? → notes) exists
      in README or HARNESS-CONTRACTS.

## Verification

```sh
dsh --version
npm run check
node -e "const p=require('./package.json'); console.log(p.engines, p.peerDependencies)"
grep -n "0\.1\.5\|0\.2\.0-rc\.2\|session\.v3\|tool/result" docs/HARNESS-CONTRACTS.md scripts/check-contracts.mjs
```

Expected: version `0.2.1-rc.2`; check green; no stale fixture/role claims; the
probe reads worktree code.

## Out of scope

- Fixing fork metadata, seed composition, TUI mapping, or compaction ranges
  (RWC-002…RWC-010). This ticket only establishes and enforces the baseline.

## Notes / evidence

- Installed: `dsh 0.2.1-rc.2`; profile packages `@deepseek-ai/dsh-* 0.2.1-rc.2`.
- `package.json:13-17` peer ranges end at `0.2.0-rc.2`.
- `scripts/check-contracts.mjs` fixture search: `session.v3.jsonl.zstd` only.
- `scripts/check-contracts.mjs` `MESSAGE_ROLE_BY_TYPE` has
  `'tool/result': 'user'`; 0.2.1 uses `'tool'`.
- The current dsh-tui profile links `/mnt/Workspace/Workspace/dsh-rewind-compact`;
  the worktree here is a separate checkout. The probe's lib imports come from
  the profile copy.

## Cycle 1 (2026-10-27, superseded)

The first implement/review/verify cycle passed, but the orchestrator found two
baseline defects and a remediation cycle corrected them: the §7 seed rule and
the probe enforced the wrong "flatten every replacement to append" behavior
(which would bless the RWC-003 shadowing bug), and the engines range
`<0.3.0` admitted `0.3.0-rc.1`. The remediation also exercised the fresh
scratch-profile install. See Completion for the final evidence.

## Completion (2026-10-27)

- **Reviewed by:** independent subagent (`RWC-001 review`), verdict **approve**;
  the remediation was re-reviewed by a second independent subagent, verdict
  **approve**.
- **Verified by:** independent subagent (`RWC-001 verify`), verdict **pass**;
  the remediation was re-verified by a second independent verifier, verdict
  **pass**.
- **Changed files:** `package.json`, `docs/HARNESS-CONTRACTS.md`,
  `scripts/check-contracts.mjs`, `README.md`, `TESTING.md`. No `lib/` or
  `tests/` changes belong to this ticket; the RWC-008 lib edits are separate.
- **Baseline:** `engines.dsh = ">=0.2.1-rc.2 <0.3.0-0"` and the three
  `@deepseek-ai/dsh-*` peers mirror it; running `dsh 0.2.1-rc.2` satisfies it
  and `0.3.0-rc.1`/`0.3.0` are rejected.
- **Evidence:**
  - `npm run check` → `ALL CONTRACTS PASS (3 documented deviations: legacy fork
    option aliases, legacy summary source kind, seed flattening owned by
    RWC-003)`.
  - `RWC_PROBE_DSH_VERSION=0.3.0 npm run check` and `...=0.3.0-rc.1 ...` both
    exit 1 on the version gate.
  - The probe imports `lib/` from this checkout, prefers a v4 fixture, uses the
    real role map (`tool/result → tool`), and checks CreateAgentOptions plus the
    summary source kind.
  - Fresh scratch install in a throwaway `/tmp` DSH_HOME: web template →
    `dsh plugin --profile rwc-verify add --offline "file:$PWD"` → `--dump-config`
    shows `# == dsh-rewind-compact` with `rewind-compact/entry`; temp home
    removed.
- **Documentation:** `docs/HARNESS-CONTRACTS.md` now records the corrected
  seed rule (raw slice preserves replacement `surfaceOp`; flattening to
  `append` is the RWC-003 deviation, not a contract) and says the TUI recipe
  stops after seeding (scaffold-only fork summary; child-side compaction is
  unresolved under RWC-004/015).
