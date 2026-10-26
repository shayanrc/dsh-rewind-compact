/**
 * dsh-rewind-compact — bundle entry (harness plugin shape: {name, inject, apply}).
 *
 * Registers the bundle's surfaces:
 *   1. tool    `rewind_compact`   (model-invoked; required on every profile)
 *   2. command `/rewind-compact`  (optional: profiles providing `commands`)
 *   3. skill   `rewind-compact`   (optional: profiles providing `skills`)
 *   4. TUI decision subscriptions (inert where no TUI dispatches them)
 *
 * The rewind path follows the harness's fork-at-boundary recipe
 * (agents.create with a sliced seed) and any LLM summary goes through
 * `ctx.compaction.compactRegion` — nothing here reimplements session
 * persistence, locking, context assembly, or LLM calls.
 */

import { rewindCompactTool } from './tool.js';
import { rewindCompactCommand } from './command.js';
import { subscribeRewindDecisions } from './tui-rewind.js';
import { registerSurfaces } from './surfaces.js';
import { readFileSync } from 'node:fs';
import { probeService, probeLogger } from './events.js';

const name = 'rewind-compact';
// Hard requirements only: the tool surface needs the tool registry, and every
// fork path needs the agent registry.
//
// Deliberately excludes `commands` and `skills` (RWC-012): sdk-minimal ships
// neither service, and a required injection leaves the whole entry PENDING
// there, silently disabling the tool too. Both are probed in `registerSurfaces`
// and only their own surface is skipped. `compaction`, `logger`, and
// `sessionProjections` are probed for the same reason.
const inject = ['tools', 'agents'];

// The skill loader validates {content, source, provider} as strings — a path
// alone is not enough for a runtime-registered skill. Ship the body.
const SKILL_BODY = readFileSync(new URL('../skill/rewind-compact/SKILL.md', import.meta.url), 'utf8')
  .replace(/^---\n[\s\S]*?\n---\n?/, '')
  .trim();

function apply(ctx) {
  ctx.effect(function* () {
    // One effect, per-surface disposers: each yielded registration is owned by
    // this effect, so disposing the entry unregisters every surface at once.
    yield* registerSurfaces(ctx, {
      // Tool surface (SPEC R3.2): runtime tool seam, required everywhere.
      tool: rewindCompactTool(ctx),
      // Command surface (SPEC R3.1): /rewind-compact slash command with picker.
      command: () => rewindCompactCommand(ctx),
      // Skill surface (SPEC R3.3, R11): runtime skill registration with the
      // body content inline (dsh-skill's validateDefinition requires content,
      // source, and provider as strings).
      skill: () => ({
        name: 'rewind-compact',
        description:
          'Rewind the conversation to an earlier completed turn and compact the discarded side into a hybrid summary. Use when the context is under pressure, work has derailed, or the user asks to rewind, compact, or start over.',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'dsh-rewind-compact',
        content: SKILL_BODY,
        path: 'skill/rewind-compact/SKILL.md',
      }),
      // TUI picker surface (SPEC R3.1, R6): the Double-Esc rewind picker's
      // confirm pane gains our two modes; on pick, tui/rewind-done triggers the
      // child-side compaction. D-7 gates these subscriptions on the
      // `session.rewind.intercept` grant (default deny — see TESTING.md).
      decisions: () => subscribeRewindDecisions(ctx),
    });

    const logger = probeLogger(ctx);
    logger.info('[rewind-compact] entry loaded');
    const compaction = probeService(ctx, 'compaction');
    if (typeof compaction?.compactRegion !== 'function') {
      logger.warn('[rewind-compact] no compaction service in this profile; summaries degrade to scaffold-only');
    }
  }, 'rewind-compact lifecycle');
}

export { apply, inject, name, rewindCompactTool, rewindCompactCommand };
