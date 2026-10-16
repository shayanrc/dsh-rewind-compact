/**
 * Shared error factory (harness convention: typed errors with codes, like
 * HarnessError in @deepseek-ai/dsh-llm).
 */

import { HarnessError } from '@deepseek-ai/dsh-llm';

/** Fail loudly with an actionable, coded rewind-compact error. */
export function rewindCompactError(message, code = 'REWIND_COMPACT_FAILED') {
  return new HarnessError(message, code);
}
