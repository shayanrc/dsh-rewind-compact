/**
 * Create-time options for a forked child (SPEC R4, R12) — pure, no harness
 * imports, unit-testable.
 *
 * 0.2.1's `CreateAgentOptions` (dsh-agent/lib/types/index.d.ts:48-104; consumed
 * by dsh-agent-loop createAgent) reads exactly `sessionId`, `seed`, `meta`,
 * `inheritedEventCount`, `agentOptions`, `signal`, `setup`, `parentAgent`.
 * The pre-0.2.1 top-level `inheritedCount`/`parentSession`/`cwd`/`title`
 * aliases are silently ignored, so lineage, workspace grouping and preset
 * composition were lost. `meta` carries the first three; the inherited prefix
 * length is `inheritedEventCount`.
 *
 * The title is NOT a create option: 0.2.1 folds titles from `session/title`
 * events. `buildCreateOptions` appends one in `setup` (before publication),
 * with the payload a manual rename uses. It is best-effort metadata: a failed
 * append never aborts a fork that otherwise succeeded, and an untitled source
 * appends nothing.
 */

/** Suffix SPEC R12 requires on a forked session's title. */
export const REWOUND_TITLE_SUFFIX = ' (rewound)';

/** `<source title> (rewound)`, or undefined when the source has no title. */
export function rewoundTitle(sourceTitle) {
  if (typeof sourceTitle !== 'string') return undefined;
  const trimmed = sourceTitle.trim();
  return trimmed === '' ? undefined : `${trimmed}${REWOUND_TITLE_SUFFIX}`;
}

/**
 * Append the child's title through the event seam (a manual rename's payload:
 * `{title, messageSeqs: [], source: {kind: 'user'}}`, which also pins the
 * title against later automatic generation). Returns whether it landed.
 */
export function appendSessionTitle(session, title) {
  if (typeof title !== 'string' || title.trim() === '') return false;
  try {
    if (typeof session?.append !== 'function') return false;
    session.append('session/title', {
      title,
      messageSeqs: [],
      source: { kind: 'user' },
    });
    return true;
  } catch {
    // Metadata only: never fail the fork for a title.
    return false;
  }
}

/**
 * Build the exact `ctx.agents.create(...)` options for the declared 0.2.1
 * line. `title` is the SOURCE title; the suffix is added here so every fork
 * path gets SPEC R12's name. `seed.length` is the inherited prefix: the seed
 * is the child's inherited state (the summary included), and the constructor
 * appends its `session/end-seed` marker after it.
 *
 * @param {object} options
 * @param {object} [options.source] source live session/session-like object
 * @param {string|number} options.sessionId the fresh child id
 * @param {Array<object>} options.seed composed child seed, contiguous from 0
 * @param {string} [options.cwd] absolute source workspace cwd
 * @param {string} [options.title] source title (suffix added here)
 * @param {string} [options.agentPreset] source agent preset id
 */
export function buildCreateOptions({ source, sessionId, seed, cwd, title, agentPreset }) {
  if (!Array.isArray(seed)) throw new TypeError('buildCreateOptions requires the composed seed array');
  const parentSession = source?.id ?? source?.sessionId;
  return {
    sessionId,
    seed,
    meta: {
      ...(cwd === undefined ? {} : { cwd }),
      ...(parentSession === undefined ? {} : { parentSession }),
      isSeeded: true,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
    inheritedEventCount: seed.length,
    setup: async (_agentCtx, childAgent) => {
      // The cut keeps pre-turn inbox insertions but drops their claims; a new
      // child must not inherit pending input as an actionable claim.
      childAgent?.inbox?.clear?.();
      appendSessionTitle(childAgent?.session, rewoundTitle(title));
    },
  };
}
