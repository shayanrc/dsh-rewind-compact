/**
 * Shared transcript accessors — the single place that knows the session event
 * shape (SPEC R2: never reimplement session storage; one module gathers what
 * changes together, so a transcript-shape change is a one-place edit).
 *
 * Real transcripts carry TWO shapes, both supported here:
 *  - agent-session records: tool/call {data.callId, data.name,
 *    data.arguments (JSON string or object)}; tool/result {data.callId,
 *    data.result, data.error}.
 *  - surface/child-seed records: tool/result {data.message.content (text),
 *    data.message.source.callId}; arguments as a JSON string.
 */

// Keep this set aligned with the harness's isSurfaceEligibleType
// (dsh-session/lib/index.js SURFACE_EVENT_TYPES); the contract probe asserts
// it across the full vocabulary. developer/message is surface-eligible in
// 0.2.1 and must travel with the seed.
export const SURFACE_TYPES = new Set([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
]);
export const FILE_MODIFYING_TOOLS = new Set(['write', 'edit', 'bash']);

/**
 * Tools that actually create/modify a file (RWC-010). Read/search/web tools and
 * `bash` are deliberately absent: their paths are mentions, not changes. A
 * `bash` command can of course write a file, but 0.2.1's bash result carries no
 * structured change fact (its `presentationMeta` is only `{cwd}`), so the v1
 * rule is conservative and does not count bash at all.
 */
export const FILE_CHANGING_TOOLS = new Set(['write', 'edit']);

/** Log-only policy facts a fork keeps so the child does not silently reset its
 *  permission baseline (the TUI's INITIAL_POLICY_EVENTS). */
export const POLICY_FACT_TYPES = new Set([
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  'plan/mode',
]);

/** Non-surface records a composed (before-mode) seed keeps after the cut:
 *  policy facts, turn boundaries, and a post-creation preset selection. */
export const KEPT_LOG_TYPES = new Set([
  ...POLICY_FACT_TYPES,
  'turn/start',
  'turn/end',
  'agent-preset/selected',
]);

export function recordCallId(record) {
  const data = record?.data ?? {};
  return data.callId ?? data.resultCallId ?? data.message?.source?.callId;
}

/** Arguments as an object, whatever the transcript shape (string or object). */
export function toolArguments(data) {
  const raw = data?.arguments ?? data?.args ?? {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

/** Result/error text, whatever the transcript shape. */
export function toolResultText(record) {
  const data = record?.data ?? {};
  const result = data.result ?? data.output ?? data.error ?? data.errorMessage ?? data.message?.content ?? '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Structured tool-result metadata (the harness stores `presentationMeta` under
 * `data.meta`; child-seed envelopes may nest it under `data.message`).
 * Scraping prose is never used as a substitute for this.
 */
export function toolResultMeta(record) {
  const data = record?.data ?? {};
  const meta = data.meta ?? data.presentationMeta ?? data.result?.meta ?? data.message?.meta;
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined;
}

/** True when a tool result records a failure (no file change happened). */
export function toolResultIsError(record) {
  const data = record?.data ?? {};
  return data.error !== undefined
    || data.errorMessage !== undefined
    || data.isError === true
    || data.message?.isError === true;
}

/**
 * Normalize one path token, or return `undefined` when it is not a path we
 * should report (RWC-010): URLs, version strings, and empty/oversized tokens
 * are rejected; `\` becomes `/`, `.`/`..` segments and duplicate separators are
 * folded so the same file counts once.
 */
export function normalizePathToken(token) {
  if (typeof token !== 'string') return undefined;
  let path = token.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!path || path.length > 300) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return undefined;
  if (/^v?\d+(?:\.\d+){1,4}(?:[-+][0-9A-Za-z.-]+)?$/i.test(path)) return undefined;
  path = path.replace(/\\/g, '/');
  const absolute = path.startsWith('/');
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (!absolute) segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  const normalized = `${absolute ? '/' : ''}${segments.join('/')}`;
  return normalized === '' || normalized === '/' ? undefined : normalized;
}

/**
 * The `Files changed` derivation, in one place (RWC-010): only `write`/`edit`
 * calls count, using structured result metadata (`meta.path`/`meta.diffs`) when
 * present and their `file_path` argument otherwise. Failed calls are skipped.
 * Returns normalized, de-duplicated paths in transcript order.
 */
export function changedFiles(events) {
  const list = Array.isArray(events) ? events : [];
  const resultsByCallId = new Map();
  for (const record of list) {
    if (record?.type !== 'tool/result') continue;
    const id = recordCallId(record);
    if (id !== undefined) resultsByCallId.set(id, record);
  }

  const seen = new Set();
  const paths = [];
  const add = (token) => {
    const path = normalizePathToken(token);
    if (path === undefined || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };

  for (const record of list) {
    if (record?.type !== 'tool/call') continue;
    const data = record?.data ?? {};
    const name = data.name ?? data.callName ?? '';
    if (!FILE_CHANGING_TOOLS.has(name)) continue;
    const callId = recordCallId(record);
    const result = callId === undefined ? undefined : resultsByCallId.get(callId);
    if (result !== undefined && toolResultIsError(result)) continue;

    const meta = toolResultMeta(result);
    const structured = [];
    if (meta !== undefined) {
      if (typeof meta.path === 'string') structured.push(meta.path);
      if (Array.isArray(meta.diffs)) {
        for (const diff of meta.diffs) {
          if (typeof diff?.path === 'string') structured.push(diff.path);
        }
      }
    }
    if (structured.length > 0) {
      for (const path of structured) add(path);
    } else {
      const args = toolArguments(data);
      add(args.file_path);
      add(args.path);
    }
  }
  return paths;
}

/** Message-ish records that may appear in a fork seed. */
export function surfaceEvents(events) {
  return (events ?? []).filter((e) => SURFACE_TYPES.has(e?.type));
}

/**
 * One real session event (not the persisted header line). Transcript files
 * start with the physical header (`{type:"session", version, cwd, …}`) which
 * has no `seq`/`time`/`data`; `snapshotEvents()` never contains it. Seeds must
 * exclude it — the harness validates seq/time/data on every seed entry.
 */
export function isSeedSourceEvent(event) {
  return (
    event !== null
    && typeof event === 'object'
    && !Array.isArray(event)
    && typeof event.type === 'string'
    && Number.isSafeInteger(event.seq)
    && event.seq >= 0
    && Number.isSafeInteger(event.time)
    && event.data !== undefined
  );
}

/** Real session events, sorted by seq, header line and torn rows removed. */
export function seedSourceEvents(events) {
  return (Array.isArray(events) ? events : [])
    .filter(isSeedSourceEvent)
    .slice()
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Fold the surface markers in a log to its CURRENT model-visible records.
 *
 * Replaying a replacement marker (`{op:'replace', startSeq, endSeq}`) removes
 * the shadowed nodes and puts the replacement in their slot; replaying it as
 * an append would resurrect the originals (the RWC-003 shadowing bug). A
 * composed seed uses this to keep the replacement summary and drop what it
 * shadowed.
 */
export function foldSurfaceRecords(events) {
  const list = seedSourceEvents(events);
  const bySeq = new Map(list.map((event) => [event.seq, event]));
  const nodes = [];
  for (const event of list) {
    if (!SURFACE_TYPES.has(event.type)) continue;
    const op = event.surfaceOp;
    if (op !== null && typeof op === 'object' && !Array.isArray(op) && op.op === 'replace') {
      const startIdx = nodes.indexOf(op.startSeq);
      const endIdx = nodes.indexOf(op.endSeq);
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) nodes.push(event.seq);
      else nodes.splice(startIdx, endIdx - startIdx + 1, event.seq);
    } else {
      nodes.push(event.seq);
    }
  }
  return nodes.map((seq) => bySeq.get(seq)).filter((event) => event !== undefined);
}

/**
 * The seq ranges the current surface fold collapsed (RWC-019). A replacement
 * marker is effective only when its start/end seqs are live surface nodes when
 * it applies — the same splice rule as `foldSurfaceRecords` (an ineffective
 * marker is a plain append and shadows nothing). An effective marker shadows
 * its whole inclusive `[startSeq, endSeq]` range: the surface nodes it
 * replaced AND the log-only rows inside it (tool calls, turn markers).
 */
export function shadowedSeqRanges(events) {
  const list = seedSourceEvents(events);
  const ranges = [];
  const nodes = [];
  for (const event of list) {
    if (!SURFACE_TYPES.has(event.type)) continue;
    const op = event.surfaceOp;
    if (op !== null && typeof op === 'object' && !Array.isArray(op) && op.op === 'replace') {
      const startIdx = nodes.indexOf(op.startSeq);
      const endIdx = nodes.indexOf(op.endSeq);
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) nodes.push(event.seq);
      else {
        ranges.push([op.startSeq, op.endSeq]);
        nodes.splice(startIdx, endIdx - startIdx + 1, event.seq);
      }
    } else {
      nodes.push(event.seq);
    }
  }
  return ranges;
}

/**
 * The log minus every shadowed range (RWC-019): the rows the current
 * model-visible context still shows. Rows without a seq (the physical header)
 * pass through unchanged. With no live replacement marker this is the input
 * list itself.
 */
export function inContextEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const ranges = shadowedSeqRanges(list);
  if (ranges.length === 0) return list;
  return list.filter((event) => {
    if (!Number.isFinite(event?.seq)) return true;
    return !ranges.some(([start, end]) => event.seq >= start && event.seq <= end);
  });
}

/** Latest folded `session/title` text (titles are events, not live state). */
export function sourceTitle(events) {
  let title;
  for (const event of events ?? []) {
    if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim() !== '') {
      title = event.data.title;
    }
  }
  return title;
}

/** Current agent preset: the creation header plus later blank-session choices. */
export function sourceAgentPreset(session, events) {
  let preset = session?.header?.agentPreset ?? session?.agentPreset;
  for (const event of events ?? []) {
    if (event?.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string' && event.data.agentPreset !== '') {
      preset = event.data.agentPreset;
    }
  }
  return typeof preset === 'string' && preset !== '' ? preset : undefined;
}

/** Workspace cwd: the live header, the legacy session event, then the agent. */
export function sourceCwd(session, events) {
  const direct = session?.header?.cwd ?? session?.cwd ?? session?.identity?.cwd;
  if (typeof direct === 'string' && direct !== '') return direct;
  const header = (events ?? []).find((event) => event?.type === 'session');
  const fromEvent = header?.cwd ?? header?.data?.cwd;
  return typeof fromEvent === 'string' && fromEvent !== '' ? fromEvent : undefined;
}

/** Source session id (the child's `meta.parentSession`). */
export function sourceSessionId(session, events) {
  const direct = session?.id ?? session?.sessionId ?? session?.identity?.id;
  if (typeof direct === 'string' && direct !== '') return direct;
  const header = (events ?? []).find((event) => event?.type === 'session');
  const fromEvent = header?.id ?? header?.data?.id;
  return typeof fromEvent === 'string' && fromEvent !== '' ? fromEvent : undefined;
}

/**
 * Cordis throws on access to any property not declared in `inject`, so
 * optional services must be probed through ctx.get() inside try/catch.
 * Returns undefined when the profile does not provide the service.
 */
export function probeService(ctx, name) {
  try {
    return ctx?.get?.(name);
  } catch {
    return undefined;
  }
}

/** Logger probe with a console fallback (ctx.logger also needs inject). */
export function probeLogger(ctx) {
  const logger = probeService(ctx, 'logger');
  if (logger && typeof logger.info === 'function') return logger;
  // Messages already carry the `[rewind-compact]` prefix; adding it here too
  // produced `[rewind-compact] [rewind-compact] …` on logger-less profiles
  // (sdk-minimal), which made the RWC-012 skip lines hard to read.
  return {
    // stderr, never stdout: the sdk/serve transport uses stdout for JSON-RPC
    // frames, and sdk-minimal has no logger service. A console.info fallback
    // injected non-JSON lines into that channel (RWC-012 evidence).
    info: (...args) => console.error(...args),
    warn: (...args) => console.warn(...args),
  };
}

export function messageText(record) {
  const content = record?.data?.message?.content ?? record?.data?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  }
  return '';
}

/**
 * Path-looking tokens in free text. Kept for display/tests only: `Files
 * changed` no longer scrapes prose with it (RWC-010). URLs and version strings
 * are filtered, and results are normalized/deduplicated.
 */
export function extractPaths(text) {
  const matches =
    String(text ?? '').match(/[^\s'"`()[\]]*(?:\/[^\s'"`()[\]]+)+|(?:^|[\s'"`])(\.{0,2}\/)?[\w.-]+\.\w{1,10}/g) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const path = normalizePathToken(raw);
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** A selectable rewind point: one completed turn boundary (SPEC R6). */
export function listTurnBoundaries(events) {
  const ends = new Set((events ?? []).filter((e) => e.type === 'turn/end').map((e) => e.data?.turn));
  return (events ?? [])
    .filter((e) => e.type === 'turn/start' && ends.has(e.data?.turn))
    .map((e) => ({
      seq: e.seq,
      turn: e.data?.turn,
      label: `turn ${e.data?.turn}`,
    }));
}

/**
 * Completed-turn boundaries that still have at least one message in the
 * session's CURRENT derived surface (SPEC R3.1/R6, RWC-019): a turn whose
 * every message is shadowed by a compaction checkpoint (or replaced by a
 * compact summary) is no longer in the model-visible context, and the picker
 * never advertises it. Explicit points — the command fast path and the tool's
 * `point` — keep resolving over ALL completed turns (`listTurnBoundaries`);
 * that is the recorded recovery-path decision (RWC-019).
 *
 * Each entry extends `listTurnBoundaries` with `endSeq` (its turn/end seq) so
 * per-turn derivations (preview, files-changed) bound to the same in-context
 * view.
 */
export function inContextTurnBoundaries(events) {
  const list = Array.isArray(events) ? events : [];
  const boundaries = listTurnBoundaries(list);
  if (boundaries.length === 0) return [];
  const visibleSeqs = new Set(foldSurfaceRecords(list).map((event) => event.seq));
  const endByTurn = new Map();
  const visible = new Set();
  let turn;
  for (const event of list) {
    if (event?.type === 'turn/start') {
      turn = event.data?.turn;
      continue;
    }
    if (event?.type === 'turn/end') {
      endByTurn.set(event.data?.turn, event.seq);
      turn = undefined;
      continue;
    }
    // Rows between turns (a scaffold summary after a fork, stray surface
    // rows) belong to no turn and never make one visible.
    if (turn !== undefined && visibleSeqs.has(event.seq)) visible.add(turn);
  }
  return boundaries
    .filter((boundary) => visible.has(boundary.turn))
    .map((boundary) => ({ ...boundary, endSeq: endByTurn.get(boundary.turn) }));
}

/**
 * The `turn/start` event enclosing a picked transcript row (SPEC R6, ADR D4).
 *
 * `tui/rewind-prompt.seq` is the picked MESSAGE's seq, never a turn/start seq,
 * so the picker must walk back to the enclosing turn before it can find the
 * chronological boundary. The turn must have ended: a row whose turn is still
 * open is ineligible (there is no boundary to fork at yet), and a row that sits
 * after a turn/end belongs to no turn. Both return `undefined`.
 *
 * Callers derive the fork cut as `turnStart.seq - 1` — the same cut
 * `tui/rewind-done` receives as `boundarySeq`.
 */
export function enclosingCompletedTurnStart(events, rowSeq) {
  const list = Array.isArray(events) ? events : [];
  if (!Number.isFinite(rowSeq)) return undefined;

  // Locate by seq value, not by array index: real transcripts number seqs
  // contiguously, but imported slices/tests can carry gaps.
  let rowIndex = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.seq === rowSeq) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) return undefined;

  let startIndex = -1;
  for (let i = rowIndex; i >= 0; i -= 1) {
    if (list[i]?.type === 'turn/start') {
      startIndex = i;
      break;
    }
    // The walk crossed an earlier turn's end: the row is not inside a turn
    // (surface rows appended after turn/end, or a row on the end marker).
    if (list[i]?.type === 'turn/end') return undefined;
  }
  if (startIndex < 0) return undefined;

  const start = list[startIndex];
  const turn = start.data?.turn;
  for (let i = startIndex + 1; i < list.length; i += 1) {
    const event = list[i];
    // A new turn began without this one closing: treat it as open.
    if (event?.type === 'turn/start') return undefined;
    if (event?.type === 'turn/end' && event.data?.turn === turn) return start;
  }
  return undefined;
}

/** Per-boundary, per-mode no-op test: nothing to compact on that side (R6). */
export function isNoOp(boundaries, index, mode) {
  if (boundaries.length === 0) return true;
  if (mode === 'after') return index === boundaries.length - 1;
  if (mode === 'before') return index === 0;
  return false;
}

/**
 * Number of distinct files changed after `boundarySeq` (warn only — R10).
 * Uses the same conservative derivation as the scaffold's first field, so the
 * picker warning and the summary always agree.
 */
export function filesChangedSince(events, boundarySeq) {
  const boundary = Number.isFinite(boundarySeq) ? boundarySeq : Number.NEGATIVE_INFINITY;
  const after = (events ?? []).filter((record) => Number.isFinite(record?.seq) && record.seq > boundary);
  return changedFiles(after).length;
}

/**
 * Fork cut, per the TUI's rewind recipe: walk back from the selected row to
 * its enclosing turn/start and cut just before it (inclusive seed slice ends
 * at turnStart.seq - 1). Stop at an open turn/end (cannot rewind into one).
 *
 * Invariant: transcripts number seq contiguously from 0, so seq === array
 * index — `rowSeq` is used as an index exactly like the TUI's own loop does
 * (session-rewind.js iterates `for (let i = row.seq; ...)`).
 */
export function forkBoundarySeq(events, rowSeq) {
  for (let i = rowSeq; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined) break;
    if (event.type === 'turn/start') return event.seq - 1;
    if (event.type === 'turn/end') break;
  }
  return undefined;
}

/**
 * Resolve a rewind point to a completed-turn boundary (SPEC R6). Fails closed:
 * returns `undefined` for anything that is not an exact match — there is no
 * fallback to the newest boundary.
 *
 * Accepted:
 *  - a 1-based turn number in range: "1".."N" -> boundaries[n - 1];
 *  - `-1`, the documented alias for the newest completed turn;
 *  - an exact turn-id match (a boundary whose `turn` equals the point string).
 *
 * Rejected: 0, other negatives, out-of-range positives ("99"), non-integers
 * ("2.5"), empty/blank strings, and anything that matches no boundary.
 */
export function boundaryForPoint(boundaries, point) {
  const list = Array.isArray(boundaries) ? boundaries : [];
  if (list.length === 0) return undefined;
  if (typeof point !== 'string' && typeof point !== 'number') return undefined;
  if (typeof point === 'number' && !Number.isFinite(point)) return undefined;
  const text = String(point).trim();
  if (text === '') return undefined;
  // Strict integer syntax: "1.0", "1e0", "0x10" are not turn numbers.
  if (/^[+-]?\d+$/.test(text)) {
    const numeric = Number(text);
    if (numeric === -1) return list[list.length - 1];
    if (numeric < 1 || numeric > list.length) return undefined;
    return list[numeric - 1];
  }
  return list.find((boundary) => String(boundary?.turn) === text);
}

/**
 * Parse the `/rewind-compact` fast-path mode token (SPEC R6). Only `after`
 * and `before` are accepted; an omitted token defaults to `after`. Returns
 * `undefined` for any other token so the caller can render a usage error
 * instead of silently compacting after.
 */
export function parseRewindMode(token) {
  if (token === undefined) return 'after';
  return token === 'after' || token === 'before' ? token : undefined;
}
