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

/**
 * Tools that actually create/modify a file (RWC-010). Read/search/web tools and
 * `bash` are deliberately absent: their paths are mentions, not changes. A
 * `bash` command can of course write a file, but 0.2.1's bash result carries no
 * structured change fact (its `presentationMeta` is only `{cwd}`), so the v1
 * rule is conservative and does not count bash at all.
 */
export const FILE_CHANGING_TOOLS = new Set(['write', 'edit']);

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
