/**
 * Module augmentation for the five-field scaffold summary's message source
 * (RWC-009). 0.2.1's `MessageSourceMap` is merge-extensible and has no
 * catch-all `plugin` kind (dsh-llm/lib/types/message.d.ts:96-108); producers
 * declare their own kind this way (e.g. dsh-compaction's `compact-checkpoint`).
 *
 * Runtime `message.source` is `{kind: 'rewind-compact'}` (lib/seed.js
 * SUMMARY_SOURCE). Consumers that do not know the kind fall through: the Web
 * conversation UI renders an appended user message with a non-`user` source as
 * injected context (producer label = the kind), and session projections keep
 * it out of the human conversation. It is not a compaction checkpoint
 * (`isCompactCheckpointSource` is false), so compaction accounting and
 * checkpoint projections are unaffected.
 */

import '@deepseek-ai/dsh-llm';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'rewind-compact': { readonly kind: 'rewind-compact' };
  }
}

export {};
