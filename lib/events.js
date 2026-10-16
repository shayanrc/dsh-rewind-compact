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

export const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result']);
export const FILE_MODIFYING_TOOLS = new Set(['write', 'edit', 'bash']);

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

/** Message-ish records that may appear in a fork seed. */
export function surfaceEvents(events) {
  return (events ?? []).filter((e) => SURFACE_TYPES.has(e?.type));
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
  return {
    info: (...args) => console.info('[rewind-compact]', ...args),
    warn: (...args) => console.warn('[rewind-compact]', ...args),
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

export function extractPaths(text) {
  const matches =
    text.match(/[^\s'"`()[\]]*(?:\/[^\s'"`()[\]]+)+|(?:^|[\s'"`])(\.{0,2}\/)?[\w.-]+\.\w{1,10}/g) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const p = raw.trim().replace(/^['"`]|['"`]$/g, '');
    if (!p || p.length > 300 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
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

/** Per-boundary, per-mode no-op test: nothing to compact on that side (R6). */
export function isNoOp(boundaries, index, mode) {
  if (boundaries.length === 0) return true;
  if (mode === 'after') return index === boundaries.length - 1;
  if (mode === 'before') return index === 0;
  return false;
}

/** Number of distinct files touched after `boundarySeq` (warn only — R10). */
export function filesChangedSince(events, boundarySeq) {
  const paths = new Set();
  for (const record of events ?? []) {
    if (!Number.isFinite(record.seq) || record.seq <= boundarySeq) continue;
    if (!FILE_MODIFYING_TOOLS.has(record?.data?.name ?? '')) continue;
    const text = JSON.stringify(toolArguments(record.data));
    for (const p of extractPaths(text)) paths.add(p);
  }
  return paths.size;
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

/** Inclusive [start, end] range of the side to compact, per mode. */
export function modeRange(events, boundarySeq, mode) {
  const seqs = events.map((e) => e.seq).filter((s) => Number.isFinite(s));
  const first = seqs.length ? Math.min(...seqs) : 0;
  const last = seqs.length ? Math.max(...seqs) : 0;
  if (mode === 'before') return { start: first, end: boundarySeq };
  return { start: boundarySeq + 1, end: last };
}

/** Resolve a turn index (1-based, negatives count from the end) or id. */
export function boundaryForPoint(boundaries, point) {
  const numeric = Number(point);
  if (Number.isInteger(numeric)) {
    return boundaries[numeric - 1] ?? boundaries[boundaries.length - 1 + (numeric < 0 ? numeric + 1 : 0)];
  }
  return boundaries.find((x) => String(x.turn) === String(point));
}
