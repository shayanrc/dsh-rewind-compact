# Claude Code "Rewind" (Checkpointing) and `/compact` — Technical Research Report

*Researched from primary sources (official docs, the official changelog, Anthropic announcements, and the anthropics/claude-code issue tracker), with version attributions where sources state them. Where the docs are silent or sources conflict, that is called out explicitly. "Current" below means the live docs at code.claude.com as of the research date (October 2026) and Claude Code ~2.1.29x. The docs themselves note that transcript/entry formats are internal and change between releases ([sessions docs](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)).*

---

## TL;DR

- **Rewind** (Esc Esc / `/rewind`, aliases `/checkpoint`, `/undo`) was introduced in **Claude Code 2.0.0 (2025-09-29)**. It truncates the conversation back to a chosen user prompt and/or reverts files that Claude's *edit tools* changed after that checkpoint, using pre-edit snapshots. Bash edits, most subagent edits, external edits, and symlinked/hard-linked paths are **not** restored.
- **/compact** replaces the model's view of the conversation with a structured summary written into the transcript as a synthetic `user` message flagged `isCompactSummary: true`, after a `compact_boundary` system record. Auto-compaction has existed since **v0.2.47**; `/compact [instructions]` with focus instructions dates to the 1.x era. There is no un-compact command; the pre-compaction history generally remains in the JSONL on disk but is out of the model context.
- The `~/.claude/projects/<project>/checkpoints/` path from the question **does not appear in any primary source I found**. In 2.0.x, checkpoint backup data was stored **inline in the session JSONL**; since ~Dec 25 2025 (v2.0.7x/2.1.x), pre-edit file snapshots live in **`~/.claude/file-history/<session-id>/`**.

---

## 1. What "rewind" does, and the UI affordances

### What it is
Claude Code automatically "captures the state of your code before each prompt you send that starts a turn" and lets you rewind the conversation and/or code to an earlier point ([Checkpointing docs](https://code.claude.com/docs/en/checkpointing)).

The official 2.0 launch announcement (2025-09-29) describes it as:

> "Our new checkpoint system automatically saves your code state before each change, and you can instantly rewind to previous versions by tapping Esc twice or using the /rewind command. … When you rewind to a checkpoint, you can choose to restore the code, the conversation, or both to the prior state. Checkpoints apply to Claude's edits and not user edits or bash commands, and we recommend using them in combination with version control." — [Enabling Claude Code to work more autonomously, anthropic.com, Sep 29 2025](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously)

The [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) entry for **2.0.0** is simply: *"/rewind a conversation to undo code changes"*. The companion [Sonnet 4.5 announcement](https://www.anthropic.com/news/claude-sonnet-4-5) calls checkpoints "one of our most requested features."

### Triggers / UI

Current (2.1.x) affordances, per the [Checkpointing docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize):

- **`/rewind` command** — opens the rewind menu. Aliases: **`/checkpoint`, `/undo`** ([commands reference](https://code.claude.com/docs/en/commands#all-commands); `/undo` became an alias in 2.1.108 per the [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
- **`Esc` + `Esc`** with an empty prompt input opens the same rewind menu. If the input has text, double-Esc clears the draft instead (saved to history, `Up` recalls it) ([interactive-mode docs](https://code.claude.com/docs/en/interactive-mode#general-controls), [checkpointing docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize)).
- **VS Code extension**: Esc-twice (or `/rewind`) opens a keyboard-navigable rewind picker (added 2.1.83 per [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)); rewind functionality was enabled for all VS Code users in 2.1.19. Note: the Nov 2025 archived [VS Code docs](https://web.archive.org/web/20251112123954/https://code.claude.com/docs/en/vs-code) still listed "Conversation rewinding: The /rewind command is coming soon" — i.e., at 2.0 launch the extension did not have it.
- **Version note for v1.x**: before 2.0, `Esc`+`Esc` meant *"Edit previous message — Double-escape to modify"*, not a rewind menu ([archived v1.x interactive-mode docs, Aug 2025](https://web.archive.org/web/20250801210045/https://docs.anthropic.com/en/docs/claude-code/interactive-mode)). There was no rewind at all pre-2.0.

### The rewind menu
It "lists the prompts you sent during the session." Selecting a point offers ([Checkpointing docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize)):

| Action | Effect |
|---|---|
| **Restore code and conversation** | revert both code and conversation to that point |
| **Restore conversation** | rewind to that message while keeping current code |
| **Restore code** | revert file changes while keeping the conversation |
| **Summarize from here** | compress the conversation from this point forward into a summary |
| **Summarize up to here** (2.1.141+) | compress the conversation before this point, keep later messages |
| **Never mind** | back out |

- The two code-restore options only appear when the selected checkpoint actually has tracked file changes to revert; otherwise only conversation restore/summarize options are offered ([docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize)).
- After **Restore conversation** or **Summarize from here**, "the original prompt from the selected message is restored into the input field so you can re-send or edit it" ([docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize)).
- A 2.0.76-era screenshot of the confirm screen shows the UX then: *"Confirm you want to restore to the point before you sent this message: … The conversation will be forked. The code will be restored +20 -29 in main.dart and 2 other files."* plus the warning *"⚠ Rewinding does not affect files edited manually or via bash."* ([issue #15403](https://github.com/anthropics/claude-code/issues/15403)). The current docs no longer use the "forked" wording.
- **Rewind past `/clear`**: since 2.1.191, if you ran `/clear` earlier in the same Claude Code process, the menu shows an extra `/resume <session-id> (previous session)` entry at the top to resume the pre-`/clear` conversation ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [docs](https://code.claude.com/docs/en/checkpointing#rewind-past-a-cleared-conversation)).
- **Guided summaries**: you can highlight a Summarize option and type instructions ("add context (optional)") to steer the summary ([docs](https://code.claude.com/docs/en/checkpointing#guide-a-summary)).

---

## 2. What happens to the conversation after rewinding

This is the least explicitly documented part; here is what the sources support:

- **The conversation is truncated to the selected message.** The docs describe rewind as reverting "code and conversation to that point." The changelog repeatedly refers to the post-rewind messages as *"the removed turns"* — e.g. 2.1.295: *"Fixed the prompt sent after a `/rewind` being lost, and the removed turns coming back, when the session was moved to the background or resumed after being killed"* ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)). So in current versions, the turns after the rewind point are removed from the active conversation and (after that fix) do not come back on resume.
- **"Restore conversation" does not touch files**: "rewind to that message while keeping current code" ([docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize)).
- **Are the removed messages recoverable?** The docs never promise a redo/"rewind forward," and no such mechanism is documented. There are open feature-request/complaint issues arguing that rewind is destructive rather than a lossless undo: issue [#89646](https://github.com/anthropics/claude-code/issues/89646) ("Claude Code's undo (labelled rewind for some reason) does not implement undo, it instead drops the entire context and starts a completely new session", claims the full conversation survives only in the append-only JSONL and that a filesystem snapshot was needed to get it back) and [#99611](https://github.com/anthropics/claude-code/issues/99611) ("Add confirmation and undo for Rewind"). The early-2.0 UI's "The conversation will be forked" line ([#15403](https://github.com/anthropics/claude-code/issues/15403)) suggests the original intent was fork-like divergence, but current docs describe rewind as restoring-to-a-point, with the selected prompt re-queued for you to re-send. **Whether the removed tail stays in the raw JSONL file is version-dependent and not documented** — treat it as destroyed for practical purposes.
- Contrast with **summarize** (which keeps history): "Summarizing doesn't change files on disk, and the original messages stay in the session transcript, so Claude can still reference the details" ([docs](https://code.claude.com/docs/en/checkpointing#guide-a-summary)).

---

## 3. What state is rewound vs. kept

### Files (code restore)
- **Rewound**: changes made by Claude's **file-editing tools** (Write/Edit/etc.) after the checkpoint. Restore works by writing back pre-edit snapshots and deleting files created since; the docs describe restore as writing/deleting through tracked paths ([errors reference](https://code.claude.com/docs/en/errors#rewind-warnings-and-errors)). The 2.0.76 screenshot showed a per-checkpoint diff preview (`+20 -29 in main.dart and 2 other files`) ([#15403](https://github.com/anthropics/claude-code/issues/15403)).
- **Not tracked / not restored** ([Checkpointing docs → Limitations](https://code.claude.com/docs/en/checkpointing#limitations)):
  - **Bash command changes** (`rm`, `mv`, `cp`, `git commit`, scripts, etc.) — cannot be undone by rewind.
  - **Subagent edits** — usually not captured in your session's checkpoints; "rewinding doesn't restore the edits. Use git to revert them." Exception: a **foreground** forked skill (`context: fork`, `background: false`) edits your tree during your turn, and its edits *are* restored.
  - **External changes** — manual edits outside Claude Code, or other concurrent sessions, are normally not captured (unless they touch the same files).
  - **Symlinked and hard-linked paths** — skipped since 2.1.216; you get `Restored the code, but skipped N files` and the skipped files keep their current contents ([docs](https://code.claude.com/docs/en/checkpointing#symlinked-and-hard-linked-paths-not-restored), [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)). Debug log `~/.claude/debug/<session-id>.txt` names the skipped paths ([errors reference](https://code.claude.com/docs/en/errors#restored-the-code-but-skipped-files)).
- **Actions with side effects are never reverted** — a 2026 feature request catalogs the gap: `git push`, DB migrations, deploys, MCP side-effect tools survive rewind even though the conversation claims otherwise ([issue #101249](https://github.com/anthropics/claude-code/issues/101249)).

### Conversation / model context
- "Restore conversation" (and "Restore code and conversation") rewinds the **transcript/context** to that message; the prompt is restored to the input box for re-sending ([docs](https://code.claude.com/docs/en/checkpointing#rewind-and-summarize)). "Restore code" keeps the conversation intact while reverting files.
- The underlying **model context** is whatever the truncated conversation yields on the next request — there is no separate "context snapshot" beyond the transcript itself.

### Checkpoint granularity
- Checkpoints are created **per user prompt that starts a turn** (docs: "Every prompt you send that starts a turn creates a new checkpoint"; the Nov 2025 archived docs said "Every user prompt creates a new checkpoint" — [archived checkpointing docs, 2025-11-06](https://web.archive.org/web/20251106153838/https://code.claude.com/docs/en/checkpointing)).
- Known gap: **messages typed while Claude is still working** get no checkpoint of their own; they're marked "No code restore" in the menu, and their edits count toward the prompt that started the turn ([docs](https://code.claude.com/docs/en/checkpointing#messages-sent-mid-turn-not-checkpointed); the 2.1.290 changelog fixed `/rewind` not even listing such prompts).
- Another gap: **AskUserQuestion answers** (tool results, not user messages) never create rewind checkpoints, so you can't rewind to "before I answered question 3" ([issue #61965](https://github.com/anthropics/claude-code/issues/61965); a docs-troubleshooting PR about this is [PR #61968](https://github.com/anthropics/claude-code/pull/61968)).

---

## 4. How `/compact` works

### Trigger paths
1. **Manual**: `/compact [instructions]` — "Free up context by summarizing the conversation so far. Optionally pass focus instructions for the summary" ([commands reference](https://code.claude.com/docs/en/commands#all-commands)). The `[instructions]` form is documented back to v1.x: the May-2025 archived docs show *"`/compact [instructions]` — Compact conversation with optional focus instructions"* ([archived slash-commands, June 2025](https://web.archive.org/web/20250623152754/https://docs.anthropic.com/en/docs/claude-code/slash-commands)) and *"`/compact Focus on code samples and API usage` tells Claude what to preserve during summarization"* ([archived v1.x costs page, May 2025](https://web.archive.org/web/20250512032016/https://docs.anthropic.com/en/docs/claude-code/costs)).
2. **Auto-compact**: since **v0.2.47** — "Automatic conversation compaction for infinite conversation length (toggle with /config)" ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)). It runs as the conversation approaches the context limit. Defaults today: compacts at the model's context limit; Sonnet 4.6/Opus 4.6 without extended context compact at the 200K boundary; native-1M models (Fable, Sonnet 5+, Haiku 5.5, Opus 4.7+) compact at ~967K ([model-config docs](https://code.claude.com/docs/en/model-config#default-auto-compact-thresholds)). Tunable via `/autocompact <tokens>` (since 2.1.221), `autoCompactWindow` setting, `--autocompact` flag, `CLAUDE_CODE_AUTO_COMPACT_WINDOW` ([docs](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window)); disable with `DISABLE_COMPACT` ([changelog 2.1.98](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
3. **Idle compaction** (2.1.299): "a 200K+ token conversation left idle for about 54 minutes is compacted before its one-hour prompt cache expires" — configurable via `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` / `"idleCompaction": false` ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
4. **Partial compaction via the rewind menu**: "Summarize from here" (2.1.32+) and "Summarize up to here" (2.1.141+), which the docs describe as "like a targeted `/compact`" that keeps you in the same session ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [checkpointing docs](https://code.claude.com/docs/en/checkpointing#guide-a-summary)).

### What it produces (structure of the compacted summary)
Compaction is a **separate model call** with its own summarization prompt (community-verified: [compact-canon research](https://github.com/tonydzi/compact-canon/blob/main/MEASUREMENTS.md)). It replaces the model's view of the conversation with a structured summary:

- In the JSONL transcript, a `compact_boundary` system record is followed by a synthetic **user** message with `"isCompactSummary": true, "isVisibleInTranscriptOnly": true`, whose `message.content` is (verified structure from [issue #82509](https://github.com/anthropics/claude-code/issues/82509)):

  > "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n## 1. … ## 9. …" plus a trailing instructions block ("If you need specific details from before compaction… read the full transcript at: <path>" / "Continue the conversation from where it left off…").

- The sibling system record carries `"compactMetadata": {"trigger": "manual"|"auto", "preTokens": …, "postTokens": …, "preservedMessages": {"anchorUuid": …}}` ([#82509](https://github.com/anthropics/claude-code/issues/82509); [compact-canon](https://github.com/tonydzi/compact-canon/blob/main/MEASUREMENTS.md) notes `compactMetadata` lives on a *sibling* record, not the summary record, and the `<command-name>/compact</command-name>` record is written out of timestamp order).
- The TUI shows a collapsed `Compacted (ctrl+o to see full summary)` line; VS Code shows a collapsible "Compacted chat" card (2.1.69+, [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
- The docs' simulation describes what the summary keeps: "your requests and intent, key technical concepts, files examined or modified with important code snippets, errors and how they were fixed, pending tasks, and current work. It replaces the verbatim conversation: full tool outputs and intermediate reasoning are gone." ([context-window docs](https://code.claude.com/docs/en/context-window))
- Older (v2.0.x) JSONL transcripts begin with a different `{"type":"summary","summary":"…","leafUuid":"…"}` record — that one is the **session title**, not compaction ([community schema research, ccrider](https://github.com/neilberkman/ccrider/blob/main/research/schema.md)).

### What survives compaction (re-injection)
The docs' table ([context-window → What survives compaction](https://code.claude.com/docs/en/context-window#what-survives-compaction)): system prompt/output style persist; project CLAUDE.md + unscoped rules, auto memory, the plan-mode plan and a fresh git-status snapshot are re-injected from disk; path-scoped rules and nested CLAUDE.md reload on demand; **up to 5 most-recently-modified files Claude read/edited are re-read** (files >5k tokens return as "Referenced file" path references); invoked skill bodies are re-injected capped at 5,000 tokens/skill and 25,000 total; background tasks keep running and Claude is reminded of them; `SessionStart` hooks matching the `compact` source re-run. The skill *listing* is not re-injected.

### Reversibility
- **There is no un-compact/expand command**, and none is documented. PreCompact hooks can *block* compaction (exit 2 / `{"decision":"block"}`; manual vs auto have different block semantics) and PostCompact hooks (2.1.76+) receive the generated `compact_summary`, but cannot undo it ([hooks reference](https://code.claude.com/docs/en/hooks#precompact)).
- The pre-compaction history is **not deleted from the on-disk transcript**: the fullscreen TUI keeps "the full pre-compaction history in scrollback across repeated compactions" (2.1.224, [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)), and community scans read old messages + summary records from the same JSONL ([compact-canon](https://github.com/tonydzi/compact-canon/blob/main/MEASUREMENTS.md)). However, once compacted, the model context uses the summary; there's no documented way to get the verbatim history back into context other than transcript surgery. Rewind interacts with compaction only insofar as summaries stay in the transcript — the docs' "Summarize from here" note says "the original messages stay in the session transcript" ([docs](https://code.claude.com/docs/en/checkpointing#guide-a-summary)), but the docs do **not** document rewinding across a `/compact` boundary. (Bug evidence that they interact: 2.1.295 "a scheduled task being lost on resume after Esc or a rewind following a compaction"; 2.0.31 made `/compact` "respect existing compact boundaries" — [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).)
- A documented lever for steering: a **"Compact Instructions" section in CLAUDE.md**, or `/compact focus on …` ([how-Claude-Code-works docs](https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up)). **Community caution**: a 3-month, 447-compaction measurement found the CLAUDE.md section was applied in **0/447** instruction-free compactions — the compactor is a separate model call that doesn't see CLAUDE.md; only inline `/compact <instructions>` demonstrably reached the summarizer (5/9 lifetime, 4/5 recent) ([compact-canon MEASUREMENTS.md](https://github.com/tonydzi/compact-canon/blob/main/MEASUREMENTS.md); related requests [issue #14160](https://github.com/anthropics/claude-code/issues/14160), [#43733](https://github.com/anthropics/claude-code/issues/43733)). The official docs and the community measurement conflict here — flag this as disputed.

---

## 5. Checkpoint/restore storage, naming, formats

Primary sources for the layout: the [`.claude` directory docs](https://code.claude.com/docs/en/claude-directory#application-data) and [issue #15403](https://github.com/anthropics/claude-code/issues/15403)'s reverse-engineering (confirmed by an Anthropic-maintained doc row).

- **Transcripts**: `~/.claude/projects/<project>/<session-id>.jsonl` — JSONL, one JSON object per message/tool-call/metadata entry; format explicitly "internal to Claude Code and changes between versions" ([sessions docs](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)).
- **Checkpoint/file-snapshot storage — current (2.1.x)**: **`~/.claude/file-history/<session-id>/`** — "Pre-edit snapshots of files Claude changed, used for checkpoint restore. Holds snapshots for the 100 most recent checkpoints; snapshot files that no retained checkpoint references are deleted, except each file's first snapshot" ([claude-directory docs](https://code.claude.com/docs/en/claude-directory#application-data)). Snapshot files observed in the wild are named like `<hash>@v1` ([#15403](https://github.com/anthropics/claude-code/issues/15403)).
- **Checkpoint/snapshot storage — 2.0.x (until ~Dec 25 2025)**: backup data was stored **inline in the session JSONL** as `{"type":"file-history-snapshot","snapshot":{"trackedFileBackups":{"<path>":{"backupFileName":null,"version":1,"backupTime":…}}},"isSnapshotUpdate":true}` entries; the switch to external `backupFileName` references happened server-side around 2025-12-25 and initially broke rewind in 2.0.76 ([issue #15403](https://github.com/anthropics/claude-code/issues/15403)).
- **The `checkpoints/` directory asked about does not exist in any documented/observed release.** Pre-2.0 Claude Code had no rewind checkpoints at all; 2.0.x stored snapshots inline in the JSONL; 2.1.x uses `~/.claude/file-history/<session>/`. (A `shell-snapshots/` directory exists but holds shell env, not checkpoints.) I did not find any primary source referencing `~/.claude/projects/<project>/checkpoints/`.
- **Retention**: a background sweep deletes transcripts and session file snapshots after `cleanupPeriodDays` (default **30 days**, min 1; set e.g. `"cleanupPeriodDays": 20` in `settings.json`) ([settings-reference](https://code.claude.com/docs/en/settings-reference#cleanupperioddays)). After sweep, `/rewind` still lists checkpoints but a code restore can fail with **`No files were restored`** ([errors reference](https://code.claude.com/docs/en/errors#no-files-were-restored)). Snapshots are also pruned to the **100 most recent checkpoints** per session ([checkpointing docs](https://code.claude.com/docs/en/checkpointing#automatic-tracking)). Forks copy the original's backups; if the copy fails (disk full) restores in the fork fail ([errors reference](https://code.claude.com/docs/en/errors#no-files-were-restored)).
- **Checkpoints persist across resume**: "Claude Code saves checkpoints with the conversation, so you can still run `/rewind` after you resume a session" ([docs](https://code.claude.com/docs/en/checkpointing#automatic-tracking)).
- There is also a CLI flag `--rewind-files` (mentioned in the 2.1.260 changelog entry) and SDK-side file checkpointing ([Agent SDK file checkpointing docs](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)) — a related but separate API-level mechanism.

---

## 6. Version / date timeline (from the official changelog + announcements)

| Version | Date | Change |
|---|---|---|
| 0.2.47 | early 2025 | "Automatic conversation compaction for infinite conversation length" ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)) |
| 1.0.48 | Apr 2025 | PreCompact hook added |
| 1.x | 2025 | `/compact [instructions]` documented ([archived docs](https://web.archive.org/web/20250623152754/https://docs.anthropic.com/en/docs/claude-code/slash-commands)); Esc-Esc = "edit previous message" ([archived docs](https://web.archive.org/web/20250801210045/https://docs.anthropic.com/en/docs/claude-code/interactive-mode)) |
| **2.0.0** | **2025-09-29** | **"/rewind a conversation to undo code changes"** + checkpoints ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [announcement](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously)) |
| 2.0.31 | Oct 2025 | `/compact` respects existing compact boundaries |
| 2.0.64 | Nov 2025 | "Made auto-compacting instant" |
| 2.1.19 / 2.1.83 | Nov–Dec 2025 | VS Code: rewind for all users; Esc-twice rewind picker |
| 2.1.32 / 2.1.141 | 2026 | "Summarize from here" / "Summarize up to here" in rewind menu |
| 2.1.76 / 2.1.105 | 2026 | PostCompact hook; PreCompact can block (exit 2 / decision block) |
| 2.1.108 | 2026 | `/undo` alias for `/rewind` |
| 2.1.191 | 2026 | Rewind can resume the conversation from before `/clear` |
| 2.1.198 | 2026 | Summarization inherits session extended-thinking config ([context-window docs](https://code.claude.com/docs/en/context-window#what-survives-compaction)) |
| 2.1.216 | 2026 | `/rewind` skips symlinks/hard links and reports skipped paths |
| 2.1.221 | 2026 | `/autocompact` command |
| 2.1.260 | 2026 | `/rewind`/`--rewind-files` no longer silently "succeed" when backups are missing |
| 2.1.290 / 2.1.295 | 2026 | Rewind-menu fixes (mid-turn prompts, background/resume removed-turn bugs) |
| 2.1.299 | 2026 | Idle compaction (200K+ tokens, ~54 min idle) |

---

## 7. Known gotchas and public discussion

- **Rewind is not git and not full-system undo.** Bash/`git push`/DB/deploy/MCP side effects survive rewind ([docs](https://code.claude.com/docs/en/checkpointing#limitations), [issue #101249](https://github.com/anthropics/claude-code/issues/101249)). Also open: [#101188](https://github.com/anthropics/claude-code/issues/101188) — rewind reported failure but still overwrote ~20h of edits.
- **Destructiveness complaints**: rewind removes the post-checkpoint conversation with no built-in redo — [#89646](https://github.com/anthropics/claude-code/issues/89646), [#99611](https://github.com/anthropics/claude-code/issues/99611).
- **Checkpoint gaps**: mid-turn messages ([docs](https://code.claude.com/docs/en/checkpointing#messages-sent-mid-turn-not-checkpointed)), AskUserQuestion answers ([#61965](https://github.com/anthropics/claude-code/issues/61965)).
- **Storage/cleanup**: snapshots deleted ~30 days after last save → `No files were restored` on old sessions; before 2.1.260 this failed silently ([errors reference](https://code.claude.com/docs/en/errors#no-files-were-restored)); the Dec 2025 inline→external backup migration broke rewind in 2.0.76 ([#15403](https://github.com/anthropics/claude-code/issues/15403)).
- **Compaction gotchas**: silent context loss complaints ([#13171](https://github.com/anthropics/claude-code/issues/13171)); auto-compact thrash loop with stop-after-3 circuit breaker (2.1.89/2.1.76, [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)); "Instant auto-compaction not instant" ([#13664](https://github.com/anthropics/claude-code/issues/13664)); Ctrl+O failing to render the stored summary (fixed by 2.1.233, [#82509](https://github.com/anthropics/claude-code/issues/82509)); CLAUDE.md "Compact Instructions" section empirically ignored in auto-compaction ([compact-canon](https://github.com/tonydzi/compact-canon/blob/main/MEASUREMENTS.md)); compaction is a separate model call (its own system prompt) — this is why focus instructions only flow via inline `/compact <args>`.
- **Third-party tooling** for transcripts/summaries exists: [ccrider schema research](https://github.com/neilberkman/ccrider/blob/main/research/schema.md), [claude-compaction-viewer (PyPI)](https://pypi.org/project/claude-compaction-viewer/).

## 8. Explicitly ambiguous / undocumented

1. **Post-rewind transcript tail**: whether the JSONL file itself is truncated vs. the removed turns merely being excluded from the resumed conversation is not documented; issue reports conflict with the changelog's "removed turns coming back" bug (2.1.295). No official statement of redo/"rewind forward."
2. **Rewind across `/compact` boundaries** is not documented; the two systems interact only through transcript markers.
3. **`~/.claude/projects/<project>/checkpoints/`** does not match any source found; actual locations are the inline JSONL records (2.0.x) and `~/.claude/file-history/<session>/` (2.1.x).
4. **CLAUDE.md "Compact Instructions" vs. reality**: officially recommended ([docs](https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up)); community measurement says it never reaches the auto-compactor ([compact-canon](https://github.com/tonydzi/compact-canon/blob/main/MEASUREMENTS.md)).
5. **Exact snapshot-file naming/format** (`<hash>@v1`) comes from a user issue, not official docs; the docs only describe the directory's purpose.

---

### Primary source list
- [Checkpointing — Claude Code Docs (current)](https://code.claude.com/docs/en/checkpointing)
- [Explore the context window — Claude Code Docs](https://code.claude.com/docs/en/context-window)
- [Manage sessions / Where transcripts are stored](https://code.claude.com/docs/en/sessions)
- [Explore the .claude directory — Application data](https://code.claude.com/docs/en/claude-directory)
- [Commands reference (`/rewind`, `/compact`, `/clear`, `/autocompact`)](https://code.claude.com/docs/en/commands)
- [Interactive mode — keyboard shortcuts](https://code.claude.com/docs/en/interactive-mode)
- [Hooks reference — PreCompact/PostCompact](https://code.claude.com/docs/en/hooks)
- [Errors reference — Rewind warnings and errors](https://code.claude.com/docs/en/errors)
- [Settings reference — cleanupPeriodDays](https://code.claude.com/docs/en/settings-reference)
- [Model configuration — auto-compact thresholds](https://code.claude.com/docs/en/model-config)
- [How Claude Code works — checkpoints & when context fills up](https://code.claude.com/docs/en/how-claude-code-works)
- [CHANGELOG.md (anthropics/claude-code)](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Enabling Claude Code to work more autonomously (Anthropic, 2025-09-29)](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously)
- [Introducing Claude Sonnet 4.5 (Anthropic, 2025-09-29)](https://www.anthropic.com/news/claude-sonnet-4-5)
- Archived 1.x docs: [slash-commands (2025-06)](https://web.archive.org/web/20250623152754/https://docs.anthropic.com/en/docs/claude-code/slash-commands), [interactive-mode (2025-08)](https://web.archive.org/web/20250801210045/https://docs.anthropic.com/en/docs/claude-code/interactive-mode), [costs (2025-05)](https://web.archive.org/web/20250512032016/https://docs.anthropic.com/en/docs/claude-code/costs), [checkpointing (2025-11)](https://web.archive.org/web/20251106153838/https://code.claude.com/docs/en/checkpointing), [vs-code (2025-11)](https://web.archive.org/web/20251112123954/https://code.claude.com/docs/en/vs-code)
- GitHub issues: [#15403](https://github.com/anthropics/claude-code/issues/15403), [#82509](https://github.com/anthropics/claude-code/issues/82509), [#61965](https://github.com/anthropics/claude-code/issues/61965), [#89646](https://github.com/anthropics/claude-code/issues/89646), [#101249](https://github.com/anthropics/claude-code/issues/101249), [#13171](https://github.com/anthropics/claude-code/issues/13171), [#13664](https://github.com/anthropics/claude-code/issues/13664), [#14160](https://github.com/anthropics/claude-code/issues/14160), [#43733](https://github.com/anthropics/claude-code/issues/43733), [#99611](https://github.com/anthropics/claude-code/issues/99611), [#101188](https://github.com/anthropics/claude-code/issues/101188), PR [#61968](https://github.com/anthropics/claude-code/pull/61968)
- Community: [tonydzi/compact-canon](https://github.com/tonydzi/compact-canon), [neilberkman/ccrider schema](https://github.com/neilberkman/ccrider/blob/main/research/schema.md)

---

# Addendum: Can a plugin/hook/command programmatically trigger rewind or /compact?

*Requested follow-up for a plugin-design decision. Primary sources: the plugin manifest/components/mods docs, hooks reference, Agent SDK TypeScript reference, cross-session-messaging docs, channels reference, CLI reference, and changelog — all at code.claude.com (current, ~v2.1.29x).*

## A1. Complete plugin manifest (plugin.json) field list

From the [Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference):

**Metadata fields**: `$schema`, `name` (required, kebab-case), `displayName`, `version`, `description`, `author` (`name` required, optional `email`/`url`), `homepage`, `repository`, `license`, `keywords`.
**Directory-listing fields** (Anthropic directory only, ignored at load): `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`.
**Behavior fields**: `defaultEnabled` (default `true`), `dependencies`, `settings` (only `agent` and `subagentStatusLine` take effect; a plugin-root `settings.json` overrides it).
**Component fields** (paths relative to plugin root; [components docs](https://code.claude.com/docs/en/plugins/components)):
- `skills` — directories of `SKILL.md` folders (path-only field)
- `commands` — `.md` files / directory / object map `{ name: { source|content, description, argumentHint, model, allowedTools } }`; run as `/plugin:name`
- `agents` — `.md` subagent definitions (path-only)
- `hooks` — path to `hooks.json` (wrapped in a top-level `"hooks"` key) / inline event map / array of both — same schema as `settings.json` hooks
- `mcpServers` — path, inline config, MCP bundle paths or URLs
- `lspServers` — language-server plugins
- `experimental.monitors`, `experimental.themes`, `outputStyles`, `workflows`
- **`channels`** — the manifest also has a Channels section (MCP-channel declarations)
- **`userConfig` / environment-variable schemas** for user-configurable plugin settings

**Standard layout**: `.claude-plugin/plugin.json` + `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `monitors/`, `output-styles/`, `themes/`, `settings.json` ([manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference#standard-layout)).

Separately, **mods** (the newer 2.1.2xx extension mechanism) have a hooks module with events and the "mods API" (`$.*` namespaces) — [mods reference](https://code.claude.com/docs/en/plugins/mods/reference).

## A2. Hook events — full list; PreCompact capabilities

Full hook event list (current): `SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd` ([hooks reference](https://code.claude.com/docs/en/hooks#hook-events)). **There is no rewind event and no compaction-trigger event.**

[PreCompact](https://code.claude.com/docs/en/hooks#precompact): matcher `manual` (`/compact`) | `auto` (auto-compact + idle compaction). Input includes `trigger` and `custom_instructions` (the `/compact` args; `null` for auto). It can **only block** (exit code 2, or `{"decision":"block"}`); "Claude Code discards a PreCompact hook's `systemMessage` and `continue` fields" — i.e., **it cannot inject or steer summary instructions**. PostCompact receives the generated `compact_summary` and "has no decision control." UserPromptSubmit can block or add `additionalContext` but cannot rewrite the prompt text ([hooks reference](https://code.claude.com/docs/en/hooks#userpromptsubmit-decision-control)).

## A3. Can anything programmatically trigger /rewind or /compact?

**Conversation rewind: strictly interactive — no public API.** Only `/rewind` / Esc-Esc / the VS Code picker. The only programmatic rewind surface anywhere is the Agent SDK's **`rewindFiles(userMessageId, {dryRun})`**, which restores *files only* (not the conversation) and requires `enableFileCheckpointing: true`; forks don't carry checkpoints ([Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript#query-object)). No SDK control exists for conversation rewind or for triggering compaction (the full `Query` interface lists `interrupt, rewindFiles, setPermissionMode, setModel, setMaxThinkingTokens, applyFlagSettings, updateSettings, …` — nothing compaction-related; `SDKCompactBoundaryMessage` is passive observation only).

**/compact: no dedicated API, but several side-door paths:**
1. **Agent SDK prompt injection (works today, documented behavior)**: `SDKUserMessage.client_composed` defaults to `false`; in that state Claude Code treats the text as user-typed, and the docs state that setting it to `true` is what makes Claude Code "not run text that starts with `/` as a command" ([SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage)) — i.e., without `client_composed`, a prompt of `/compact` (or `/rewind`) is processed as the slash command. The 2.1.299 changelog bug ("a prompt starting with `/`, sent with the Agent SDK's `verbatimPrompts` option, running as a slash command" after resume) confirms programmatic prompts reach the command layer ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
2. **CLI print mode**: `claude -p --resume <id> "/compact"` runs the slash command (changelog 2.1.267: "resuming a session after `/compact` or another slash command ran via `-p --resume`…"). `/rewind` in headless mode is an interactive overlay — its `-p` behavior is undocumented (likely unusable without a TTY).
3. **Mods**: the [mods API method table](https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods) lists **`$.session.compact`** among `$.session` methods, but I could not find prose documentation of what it does — treat as listed-but-undocumented. The **`session.compact`** mod hook event fires when the conversation is about to be compacted and a hook can return `{ skip: reason }` to cancel it ([mods reference](https://code.claude.com/docs/en/plugins/mods/reference#session)). Mods have **no rewind event or method at all** (zero "rewind" mentions in the mods docs). `$.prompt.submit({ text, asUser: true })` submits text "as the user's own words" ([mods API](https://code.claude.com/docs/en/plugins/mods/api#start-a-turn-from-a-background-job)); whether a leading `/` then executes as a command is not documented.
4. **Explicitly NOT a path — cross-session messaging**: "a command in the message's text, such as `/compact`, arrives as plain text. Claude Code never executes it", and inbound messages "can't approve anything / can't change configuration" ([cross-session-messaging docs](https://code.claude.com/docs/en/cross-session-messaging#how-the-receiving-session-treats-a-message)). This covers the `SendMessage` tool and mods' `$.session.send`.
5. **Channels** push text into a session where Claude reacts to it ([channels reference](https://code.claude.com/docs/en/channels-reference)); no slash-command execution is documented.
6. **Hooks** cannot trigger or steer compaction (see A2). **Slash commands/skills** are just prompts handed to Claude — they can't truncate the transcript; the model invoking user-reserved commands is a bug class that Anthropic has been fixing (2.1.286, 2.1.292 changelog entries).

**Transcript truncation/rewrite: no supported API.** The mods `session.append` hook can rewrite the content of rows as they are stored ("rewrite the row's text blocks"), not delete them ([mods reference](https://code.claude.com/docs/en/plugins/mods/reference#session)). Mods' `$.fs`/`$.process` run with the user's permissions, so a mod *could* edit `~/.claude/projects/<project>/<session>.jsonl` out-of-band, but the format is explicitly internal and version-volatile ([sessions docs](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)) — unsupported transcript surgery (users do it; e.g. [issue #101916](https://github.com/anthropics/claude-code/issues/101916) notes edited transcripts are silently accepted).

**Design implication**: a plugin that wants "compact now" has three real routes — (a) ship a user-invoked command/skill that runs `/compact` (supported, interactive), (b) run through the Agent SDK and inject a `/compact` prompt without `client_composed` (works for SDK-hosted sessions), or (c) mods' `$.session.compact` (listed API, undocumented prose). For rewind, nothing programmatic exists beyond SDK `rewindFiles()` (file-only); conversation rewind remains an interactive-only, Esc-Esc//rewind feature with no public API.
