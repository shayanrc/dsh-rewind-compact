/**
 * dsh-rewind-compact — bundle entry (harness plugin shape: {name, inject, apply}).
 *
 * Registers the bundle's three surfaces:
 *   1. tool    `rewind_compact`   (model-invoked; compaction ungated, rewind gated)
 *   2. command `/rewind-compact`  (TUI picker; rewind forks to a new session)
 *   3. skill   `rewind-compact`   (runtime skill; body at skill/rewind-compact/SKILL.md)
 *
 * The rewind path follows the harness's fork-at-boundary recipe
 * (agents.create with a sliced seed) and summaries go through
 * `ctx.compaction.compactRegion` — nothing here reimplements session
 * persistence, locking, context assembly, or LLM calls.
 */

import { rewindCompactTool } from './tool.js';
import { rewindCompactCommand } from './command.js';
import { subscribeRewindDecisions } from './tui-rewind.js';
import { readFileSync } from 'node:fs';
import { probeService, probeLogger } from './events.js';

const name = 'rewind-compact';
// Deliberately excludes `compaction` and `logger`: profiles without the
// compaction bundle (e.g. the web template) must still load this entry. Both
// services are accessed optionally and degrade to scaffold-only summaries.
const inject = ['tools', 'commands', 'skills', 'agents'];

// The skill loader validates {content, source, provider} as strings — a path
// alone is not enough for a runtime-registered skill. Ship the body.
const SKILL_BODY = readFileSync(new URL('../skill/rewind-compact/SKILL.md', import.meta.url), 'utf8')
  .replace(/^---\n[\s\S]*?\n---\n?/, '')
  .trim();

function apply(ctx) {
  ctx.effect(function* () {
    // Tool surface (SPEC R3.2): runtime tool seam.
    yield ctx.tools.register(rewindCompactTool(ctx));

    // Command surface (SPEC R3.1): /rewind-compact slash command with picker.
    yield ctx.commands.register(rewindCompactCommand(ctx));

    // Skill surface (SPEC R3.3, R11): runtime skill registration with the
    // body content inline (dsh-skill's validateDefinition requires content,
    // source, and provider as strings).
    yield ctx.skills.register({
      name: 'rewind-compact',
      description:
        'Rewind the conversation to an earlier completed turn and compact the discarded side into a hybrid summary. Use when the context is under pressure, work has derailed, or the user asks to rewind, compact, or start over.',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'dsh-rewind-compact',
      content: SKILL_BODY,
      path: 'skill/rewind-compact/SKILL.md',
    });

    // TUI picker surface (SPEC R3.1, R6): the Double-Esc rewind picker's
    // confirm pane gains the after mode (ADR D5 drops before mode from this
    // surface); on pick, tui/rewind-done appends the scaffold summary to the
    // child. D-7 gates these subscriptions on the `session.rewind.intercept`
    // grant (default deny — see TESTING.md).
    subscribeRewindDecisions(ctx);

    const logger = probeLogger(ctx);
    logger.info('[rewind-compact] entry loaded');
    const compaction = probeService(ctx, 'compaction');
    if (typeof compaction?.compactRegion !== 'function') {
      logger.warn('[rewind-compact] no compaction service in this profile; summaries degrade to scaffold-only');
    }
  }, 'rewind-compact lifecycle');
}

export { apply, inject, name, rewindCompactTool, rewindCompactCommand };
