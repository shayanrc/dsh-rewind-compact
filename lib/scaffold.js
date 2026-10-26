/**
 * Five-field compaction scaffold (SPEC R5).
 *
 * Pure module — no harness imports — unit-testable with node:test.
 * Builds the mechanical scaffold string that is the summary in v1 (R5).
 * `Files changed` uses the shared conservative derivation (RWC-010): only
 * write/edit tool calls, from structured result metadata or their path
 * argument — never reads, searches, web fetches, or bash output.
 */

import { messageText, recordCallId, toolArguments, toolResultText, changedFiles } from './events.js';

export const SCAFFOLD_FIELDS = [
  'Files changed',
  'Commands run',
  'Errors encountered',
  'Decisions made',
  'Outstanding TODOs',
];

/** Keep the summary readable: list at most this many changed paths. */
export const MAX_SCAFFOLD_FILES = 20;

/**
 * Build the five-field scaffold string from raw session events of the
 * compacted range.
 *
 * @param {Array<{type: string, data?: object}>} events
 * @returns {string} labeled scaffold
 */
export function buildScaffold(events) {
  const list = Array.isArray(events) ? events : [];
  const buckets = new Map(SCAFFOLD_FIELDS.map((field) => [field, []]));
  const push = (field, item) => {
    const arr = buckets.get(field);
    if (!arr.includes(item)) arr.push(item);
  };
  let nested = false;

  // Files changed comes from the one shared conservative derivation (RWC-010);
  // no prose scraping, no read/search/web paths, no bash output paths.
  const changed = changedFiles(list);
  for (const path of changed.slice(0, MAX_SCAFFOLD_FILES)) push('Files changed', path);
  if (changed.length > MAX_SCAFFOLD_FILES) {
    push('Files changed', `+${changed.length - MAX_SCAFFOLD_FILES} more not listed`);
  }

  // Pair tool/result records with their tool/call by callId (either
  // transcript shape), so exit codes and errors attach to the right command.
  const resultsByCallId = new Map();
  for (const record of list) {
    if (record?.type === 'tool/result') {
      const id = recordCallId(record);
      if (id !== undefined) resultsByCallId.set(id, record);
    }
  }

  for (const record of list) {
    const type = record?.type ?? '';
    const data = record?.data ?? {};

    if (type === 'tool/call') {
      const name = data.name ?? data.callName ?? '';
      const args = toolArguments(data);
      const callId = recordCallId(record);
      const resultText = resultsByCallId.has(callId) ? toolResultText(resultsByCallId.get(callId)) : '';

      if (name === 'bash') {
        const cmd = typeof args.command === 'string' ? args.command : '';
        if (cmd) {
          const exit = /\[exit code: (\d+)\]/.exec(resultText)?.[1] ?? /exit code[: ]+(\d+)/i.exec(resultText)?.[1] ?? '';
          push('Commands run', exit ? `${cmd} (exit ${exit})` : cmd);
        }
      }

      if (data.error || data.errorMessage) {
        push('Errors encountered', String(data.error ?? data.errorMessage).slice(0, 300));
      } else if (/\[exit code: [1-9]\d*\]/.test(resultText) || /(?:^|\s)(error|failed|denied)(?:\s|:)/i.test(resultText)) {
        push('Errors encountered', resultText.slice(0, 300));
      }
    } else if (type === 'user/message' || type === 'assistant/message') {
      const text = messageText(record);
      if (/compact summary|prior compact summary/i.test(text)) nested = true;
      for (const m of text.matchAll(/[^.!?]*(?:decid(?:e|ed|ing)|cho(?:se|sen)|agreed|we will|let's)[^.!?]*[.!?]/gi)) {
        const s = m[0].trim();
        if (s.length > 0 && s.length < 300) push('Decisions made', s);
      }
      for (const m of text.matchAll(/[^\n]*(?:TODO|to-?do|outstanding|still need|remaining:)[^\n]*/gi)) {
        const s = m[0].trim();
        if (s.length > 0 && s.length < 300) push('Outstanding TODOs', s);
      }
    }
  }

  const parts = SCAFFOLD_FIELDS.map((field) => {
    const items = buckets.get(field);
    return `## ${field}\n${items.length ? items.map((x) => `- ${x}`).join('\n') : 'none'}`;
  });
  if (nested) parts.push('Note: includes a prior compact summary.');
  return parts.join('\n');
}
