#!/usr/bin/env node
/**
 * Harness-contract probe against the DECLARED harness line
 * (dsh >=0.2.1-rc.2 <0.3.0-0). Run it from anywhere:
 *
 *   node scripts/check-contracts.mjs                # default profile: dsh-tui
 *   node scripts/check-contracts.mjs --profile tui-rc-test
 *
 * Every check mirrors a real 0.2.1 contract, read from the installed packages,
 * not from memory:
 *   1. version gate: the running dsh (the profile's dsh-app-boot version, the
 *      same source the harness gate uses) satisfies package.json engines.dsh
 *      and every @deepseek-ai/dsh* peer range. dsh evaluates engines.dsh alone
 *      (peers are ignored when it is present) with prereleases included —
 *      dsh-app-boot/lib/index.js:252-320. `RWC_PROBE_DSH_VERSION=<v>` overrides
 *      only the probe's view, for verifying the failure path.
 *   2. worktree imports: every lib/*.js imports from THIS checkout, not the
 *      profile's (possibly stale) copy. Harness bare specifiers are resolved
 *      from the profile's node_modules; editing lib here changes the result.
 *   3. harness surface facts: Session format v4 and the developer/message type;
 *      CreateAgentOptions field names; compactRegion's 4-parameter inclusive
 *      surface span and balance preconditions; the source-kind vocabulary.
 *   4. tool contract: rewindCompactTool passes the REAL defineTool validator
 *      (parameters property map, raw-JSON-Schema output dialect).
 *   5. command + skill shapes: the command is a 0.2.1
 *      {name, description, handler} definition returning a CommandResult, and
 *      the skill registration carries string source/content (dsh-skill's
 *      load-time validateDefinition, index.js:471-489).
 *   6. seed contract from a REAL transcript: prefer the newest session.v4
 *      fixture (v3 raw is pre-migration and only a fallback). Rebuilds both
 *      modes with the worktree lib/seed.js and runs the REAL Session.create
 *      validator. Envelope/seq/message-shape checks are failures. A kept
 *      replacement surfaceOp that the built seed flattens to "append" is a
 *      DEVIATION (the RWC-003 shadowing risk), not a failure: 0.2.1's TUI
 *      seed preserves the source envelope and the child folds it. If no
 *      fixture exercises a replacement, a synthetic one is used for that
 *      check.
 *   7. inject contract: no optional service (compaction/logger) wedges
 *      activation on profiles without them.
 *   8. syntax + unit tests: node --check on lib/*.js and node --test tests/.
 *
 * Failures are contract breaks. Deviations (printed with `!`) are real
 * 0.2.1 facts the current implementation does not yet satisfy; they are
 * tracked by functional tickets and do not fail this baseline probe.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const profileFlag = args.indexOf('--profile');
const PROFILE = profileFlag >= 0 ? args[profileFlag + 1] : 'dsh-tui';
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const REPO = resolve(new URL('..', import.meta.url).pathname);

const profileDir = join(DSH_HOME, 'profiles', PROFILE);
const profileNodeModules = join(profileDir, 'node_modules');
// Harness packages are hoisted to the profiles level; profile-local node_modules
// only holds the profile's own dependencies.
const hoistNodeModules = join(DSH_HOME, 'profiles', 'node_modules');
const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const DECLARED_RANGE = manifest.engines?.dsh;

const LIB_FILES = [
  'index.js', 'events.js', 'scaffold.js', 'seed.js', 'rewind.js',
  'tool.js', 'command.js', 'tui-rewind.js', 'errors.js',
];

// 0.2.1 surface vocabulary (dsh-session/lib/types/types.d.ts:443) and the
// harness's real role map (dsh-session/lib/index.js:1190-1196).
const SURFACE_TYPES = new Set([
  'system/message', 'developer/message', 'user/message',
  'assistant/message', 'tool/result',
]);
const MESSAGE_ROLE_BY_TYPE = {
  'system/message': 'system',
  'developer/message': 'developer',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
};

/** A surface record whose marker replaces an earlier span (not an append). */
const isReplaceSurfaceOp = (event) =>
  SURFACE_TYPES.has(event?.type)
  && event.surfaceOp !== null
  && typeof event.surfaceOp === 'object'
  && !Array.isArray(event.surfaceOp)
  && event.surfaceOp.op === 'replace';

/**
 * Positions where the source record is a replacement but the built seed record
 * is an append: the child surface would resurrect the shadowed originals.
 * `sourceRecords` and `seedRecords` are the aligned kept-side surface lists.
 */
const flattenedReplacementSeqs = (sourceRecords, seedRecords) =>
  sourceRecords.flatMap((source, index) => (
    isReplaceSurfaceOp(source) && seedRecords[index]?.surfaceOp === 'append'
      ? [source.seq]
      : []
  ));

const failures = [];
const deviations = [];
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, err) => {
  console.error(`  ✗ ${label}\n    ${err?.stack ?? err}`);
  failures.push(label);
};
const deviation = (label, detail) => {
  console.log(`  ! ${label}\n    ${detail}`);
  deviations.push(label);
};

// ── minimal semver (prerelease-aware; mirrors dsh's includePrerelease) ──────
function parseVersion(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(input).trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const delta = Number(a) - Number(b);
      if (delta !== 0) return delta < 0 ? -1 : 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.pre, right.pre);
}

function satisfiesVersion(version, range) {
  const parsed = parseVersion(version);
  if (parsed === undefined) return false;
  const comparators = String(range).trim().split(/\s+/).filter(Boolean);
  if (comparators.length === 0) return false;
  for (const comparator of comparators) {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
    const target = parseVersion(match?.[2]);
    if (target === undefined) return false;
    const order = compareVersions(parsed, target);
    const operator = match[1] ?? '=';
    const satisfied =
      operator === '>=' ? order >= 0 :
      operator === '>' ? order > 0 :
      operator === '<=' ? order <= 0 :
      operator === '<' ? order < 0 :
      order === 0;
    if (!satisfied) return false;
  }
  return true;
}

// ── worktree imports: resolve harness packages from the profile hoist ───────
if (!existsSync(profileNodeModules)) {
  console.error(`profile ${PROFILE} has no node_modules at ${profileNodeModules}`);
}
const resolutionAnchor = pathToFileURL(join(hoistNodeModules, '.contract-probe-anchor.mjs')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/')) {
      return nextResolve(specifier, { ...context, parentURL: resolutionAnchor });
    }
    return nextResolve(specifier, context);
  },
});

/** First existing path among the profile-local and profiles-hoisted locations. */
function harnessFile(...segments) {
  for (const root of [profileNodeModules, hoistNodeModules]) {
    const candidate = join(root, ...segments);
    if (existsSync(candidate)) return candidate;
  }
  return join(hoistNodeModules, ...segments);
}

function installedHarnessVersion() {
  // The compatibility gate reads the runtime version from the profile's
  // dsh-app-boot manifest (dsh-app-boot/lib/index.js:271-275), so read that
  // first: the global `dsh` launcher can differ from the profile's app-boot.
  const appBootManifest = harnessFile('@deepseek-ai', 'dsh-app-boot', 'package.json');
  if (existsSync(appBootManifest)) {
    const version = JSON.parse(readFileSync(appBootManifest, 'utf8')).version;
    if (typeof version === 'string' && version !== '') return version;
  }
  // Fall back to the CLI only when no app-boot manifest is installed.
  const probe = spawnSync('dsh', ['--version'], { encoding: 'utf8' });
  const reported = (probe.stdout ?? '').trim().split(/\s+/).pop();
  if (probe.status === 0 && parseVersion(reported) !== undefined) return reported;
  throw new Error(
    `cannot read the running dsh version: no @deepseek-ai/dsh-app-boot manifest under ` +
    `${profileNodeModules} or ${hoistNodeModules}, and 'dsh --version' did not report a parseable version`,
  );
}

function readTranscript(file) {
  if (file.endsWith('.zstd')) {
    // Session logs are appended one zstd frame per flush; `unzstd -c` reads
    // every concatenated frame (Node's zstdDecompressSync stops at the first).
    const result = spawnSync('unzstd', ['-c', '-f', file], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`unzstd failed for ${file}: ${(result.stderr ?? '').trim()}`);
    return result.stdout;
  }
  if (file.endsWith('.gz')) return gunzipSync(readFileSync(file)).toString('utf8');
  return readFileSync(file, 'utf8');
}

function parseTranscript(file) {
  const events = [];
  for (const line of readTranscript(file).split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* incomplete tail row */ }
  }
  return events;
}

function listTranscripts(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const match = /^session\.v(\d+)\.jsonl(\.zstd|\.gz)?$/.exec(entry.name);
        if (match === null) continue;
        try {
          const info = statSync(full); // follows symlinked fixtures
          if (!info.isFile()) continue;
          found.push({ path: full, version: Number(match[1]), mtime: info.mtimeMs });
        } catch { /* raced deletion */ }
      }
    }
  };
  walk(root);
  return found;
}

console.log(`contract probe — profile ${PROFILE}`);
console.log(`  worktree ${REPO}`);

// ── 1. version gate ─────────────────────────────────────────────────────────
console.log('1. harness version gate');
{
  let runtimeVersion;
  try {
    runtimeVersion = process.env.RWC_PROBE_DSH_VERSION ?? installedHarnessVersion();
  } catch (err) {
    fail('running harness version', err);
  }
  if (runtimeVersion !== undefined) {
    if (typeof DECLARED_RANGE !== 'string' || DECLARED_RANGE.trim() === '') {
      fail('engines.dsh declared', new Error('package.json has no engines.dsh range; declare the supported dsh line'));
    } else {
      let accepted = false;
      try {
        accepted = satisfiesVersion(runtimeVersion, DECLARED_RANGE);
      } catch (err) {
        fail('engines.dsh range parses', err);
      }
      if (accepted) {
        ok(`dsh ${runtimeVersion} satisfies engines.dsh "${DECLARED_RANGE}"`);
      } else {
        fail(
          'engines.dsh gate',
          new Error(
            `running dsh ${runtimeVersion} is OUTSIDE engines.dsh "${DECLARED_RANGE}" (package.json). ` +
            `Install a dsh in the declared line or update package.json + docs/HARNESS-CONTRACTS.md together.`,
          ),
        );
      }
    }
    const peers = Object.entries(manifest.peerDependencies ?? {}).filter(
      ([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
    );
    const rejected = peers.filter(([, range]) => !satisfiesVersion(runtimeVersion, range));
    if (rejected.length === 0) {
      ok(`${peers.length} @deepseek-ai/dsh* peer range(s) accept ${runtimeVersion}`);
    } else {
      fail(
        'peer ranges',
        new Error(
          `${rejected.map(([name, range]) => `${name} "${range}"`).join(', ')} reject running dsh ${runtimeVersion}; ` +
          `narrow/extend the peer ranges in package.json`,
        ),
      );
    }
  }
}

// ── 2. lib modules import from the worktree ─────────────────────────────────
console.log('2. lib modules import cleanly from the worktree');
for (const file of LIB_FILES) {
  try {
    await import(pathToFileURL(join(REPO, 'lib', file)).href);
    ok(`lib/${file}`);
  } catch (err) {
    fail(`lib/${file} import`, err);
  }
}

// ── 3. harness surface facts ────────────────────────────────────────────────
console.log('3. harness surface facts (Session v4 / createAgent / compactRegion)');
{
  try {
    const { SESSION_FORMAT_VERSION, KNOWN_SESSION_EVENT_TYPES } = await import('@deepseek-ai/dsh-session');
    if (SESSION_FORMAT_VERSION === 4) ok('Session format v4');
    else fail('Session format', new Error(`expected v4, got v${SESSION_FORMAT_VERSION}`));
    const missingTypes = ['developer/message', 'user/message', 'assistant/message', 'tool/result']
      .filter((type) => !KNOWN_SESSION_EVENT_TYPES.has(type));
    if (missingTypes.length === 0) ok('known event types include developer/message + tool/result');
    else fail('known event types', new Error(`missing: ${missingTypes.join(', ')}`));
  } catch (err) {
    fail('Session format facts', err);
  }

  try {
    const agentTypes = readFileSync(
      harnessFile('@deepseek-ai', 'dsh-agent', 'lib', 'types', 'index.d.ts'), 'utf8',
    );
    const block = /export interface CreateAgentOptions \{([\s\S]*?)\n\}/.exec(agentTypes)?.[1] ?? '';
    const missing = ['sessionId', 'meta', 'inheritedEventCount', 'seed', 'setup']
      .filter((field) => !new RegExp(`\\b${field}\\??:`).test(block));
    const missingMeta = ['cwd', 'parentSession', 'isSeeded', 'agentPreset']
      .filter((field) => !new RegExp(`\\b${field}\\??:`).test(block));
    if (missing.length === 0 && missingMeta.length === 0) {
      ok('CreateAgentOptions = sessionId, seed, inheritedEventCount, setup, meta{cwd,parentSession,isSeeded,agentPreset}');
    } else {
      fail('CreateAgentOptions shape', new Error(`missing top-level: ${missing.join(', ')}; missing meta: ${missingMeta.join(', ')}`));
    }
  } catch (err) {
    fail('CreateAgentOptions shape', err);
  }

  try {
    const engineTypes = readFileSync(
      harnessFile('@deepseek-ai', 'dsh-compaction', 'lib', 'types', 'index.d.ts'), 'utf8',
    );
    const signatureOk = /compactRegion\(start: SessionSeq, end: SessionSeq, agent: CompactionAgentContext, signal\?: AbortSignal\)/.test(engineTypes);
    const basic = readFileSync(
      harnessFile('@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'), 'utf8',
    );
    const inclusiveOk = basic.includes('nodes.slice(startIdx, endIdx + 1)');
    const balanceOk = basic.includes('is not a balanced boundary');
    if (signatureOk && inclusiveOk && balanceOk) {
      ok('compactRegion(start, end, agent, signal?) is 4-param, inclusive, surface-node + balance checked');
    } else {
      fail('compactRegion contract', new Error(`signature=${signatureOk} inclusive=${inclusiveOk} balance=${balanceOk}`));
    }
  } catch (err) {
    fail('compactRegion contract', err);
  }

  try {
    const messageTypes = readFileSync(
      harnessFile('@deepseek-ai', 'dsh-llm', 'lib', 'types', 'message.d.ts'), 'utf8',
    );
    const sourceMap = /export interface MessageSourceMap \{([\s\S]*?)\n\}/.exec(messageTypes)?.[1] ?? '';
    // `user` is inline; the other three are referenced source interfaces.
    const declared = ['user', 'model', 'tool', 'system-prompt']
      .every((kind) => messageTypes.includes(`kind: '${kind}'`));
    const noCatchAll = !/kind:\s*'plugin'/.test(sourceMap);
    if (declared && noCatchAll) ok('message source kinds = user/model/tool/system-prompt (no catch-all plugin)');
    else fail('message source kinds', new Error(`declared=${declared} noCatchAll=${noCatchAll}`));
  } catch (err) {
    fail('message source kinds', err);
  }

  try {
    // Static audit of the fork call site: 0.2.1 CreateAgentOptions carries
    // parent lineage/cwd/isSeeded under `meta` and the inherited length as
    // `inheritedEventCount`; the agent factory reads only those keys
    // (dsh-agent-loop/lib/index.js:1893-1904).
    const loop = readFileSync(harnessFile('@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js'), 'utf8');
    const factoryReadsMeta = /options\.meta/.test(loop);
    const factoryReadsInherited = /options\.inheritedEventCount/.test(loop);
    const rewind = readFileSync(join(REPO, 'lib', 'rewind.js'), 'utf8');
    const block = /ctx\.agents\.create\(\{([\s\S]*?)\n  \}\);/.exec(rewind)?.[1];
    if (block === undefined) throw new Error('lib/rewind.js has no ctx.agents.create({...}) call to audit');
    const currentKeys = new Set(['sessionId', 'parentAgent', 'meta', 'inheritedEventCount', 'seed', 'agentOptions', 'signal', 'setup']);
    const legacyKeys = { inheritedCount: 'meta.isSeeded: true + inheritedEventCount', parentSession: 'meta.parentSession', cwd: 'meta.cwd', title: 'not a CreateAgentOptions field' };
    const direct = [...block.matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*[:,]/gm)].map((match) => match[1]);
    const spread = [...block.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g)].map((match) => match[1]);
    const used = new Set([...direct, ...spread]);
    const unknown = [...used].filter((key) => !currentKeys.has(key) && !(key in legacyKeys));
    const legacy = Object.keys(legacyKeys).filter((key) => used.has(key));
    const missing = ['sessionId', 'seed'].filter((key) => !used.has(key));
    if (unknown.length > 0) {
      fail('create call keys', new Error(`unknown keys ${unknown.join(', ')} — not CreateAgentOptions and not known legacy aliases`));
    } else if (missing.length > 0) {
      fail('create call keys', new Error(`missing ${missing.join(', ')}`));
    } else if (!factoryReadsMeta || !factoryReadsInherited) {
      fail('factory option consumption', new Error(`factory reads meta=${factoryReadsMeta} inheritedEventCount=${factoryReadsInherited}`));
    } else {
      ok('create call passes sessionId + seed; factory consumes meta + inheritedEventCount');
      if (legacy.length > 0) {
        deviation(
          `fork create call still uses legacy option(s): ${legacy.join(', ')}`,
          `0.2.1 ignores them (the factory reads meta/inheritedEventCount), so the child forks without lineage/cwd metadata. ` +
          `Replace with ${legacy.map((key) => `${key} -> ${legacyKeys[key]}`).join('; ')}.`,
        );
      }
    }
  } catch (err) {
    fail('create call shape', err);
  }
}

// ── 4. tool passes the REAL defineTool validator ────────────────────────────
console.log('4. defineTool output/parameters dialect');
try {
  const { defineTool } = await import('@deepseek-ai/dsh-tools');
  const { rewindCompactTool } = await import(pathToFileURL(join(REPO, 'lib', 'tool.js')).href);
  const tool = rewindCompactTool({ tools: { register: () => {} } });
  if (typeof tool?.name !== 'string' || tool.name !== 'rewind_compact') throw new Error('tool name missing');
  // defineTool already ran valueSchemaSpecToJsonSchema on output.schema; reaching
  // here proves the raw-JSON-Schema dialect (dsh-tools/lib/index.js:792,838).
  ok('rewind_compact accepted by defineTool (output.schema + parameters dialects)');
} catch (err) {
  fail('defineTool validation', err);
}

// ── 5. command + skill registration shapes ──────────────────────────────────
console.log('5. command + skill registration shapes');
try {
  const { rewindCompactCommand } = await import(pathToFileURL(join(REPO, 'lib', 'command.js')).href);
  const command = rewindCompactCommand({});
  const result = await command.handler({ rawInput: '', agent: undefined });
  if (command.name !== 'rewind-compact') throw new Error(`command name is ${command.name}`);
  if (typeof command.description !== 'string' || command.description.trim() === '') throw new Error('command description missing');
  if (typeof command.handler !== 'function') throw new Error('command handler missing');
  if (result?.kind !== 'error' && result?.kind !== 'success') throw new Error(`handler result kind is ${result?.kind}`);
  ok('command = {name, description, handler} returning {kind, text}');
} catch (err) {
  fail('command registration shape', err);
}

{
  const source = readFileSync(join(REPO, 'lib', 'index.js'), 'utf8');
  const hasContent = /content:\s*SKILL_BODY/.test(source);
  const hasSource = /source:\s*'dsh-rewind-compact'/.test(source);
  const hasProvider = /provider:\s*'/.test(source);
  const hasInvocation = /invocation:\s*\{\s*modelInvocable:\s*true,\s*userInvocable:\s*true\s*\}/.test(source);
  const nameOk = /name:\s*'rewind-compact'/.test(source);
  if (nameOk && hasContent && hasSource && hasInvocation) {
    // dsh-skill validateDefinition (index.js:471-489) makes source provider-
    // defaulted but content mandatory; provider itself may be omitted.
    ok(`skill = name + description + content + source${hasProvider ? ' + provider' : ''}`);
  } else {
    fail('skill registration payload', new Error(`name=${nameOk} content=${hasContent} source=${hasSource} invocation=${hasInvocation}`));
  }
  const skillMd = readFileSync(join(REPO, 'skill', 'rewind-compact', 'SKILL.md'), 'utf8');
  const frontmatterOk = /^---\nname:\s*rewind-compact\n/.test(skillMd) && /^description:/m.test(skillMd);
  if (frontmatterOk) ok('SKILL.md frontmatter parses (name + description)');
  else fail('SKILL.md frontmatter', new Error('missing name/description frontmatter'));
}

// ── 6. fork seed from a REAL transcript ─────────────────────────────────────
console.log('6. seed contract from a real transcript (Session.create validates)');
{
  try {
  const ALLOWED_KEYS = new Set([
    'type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable',
  ]);

  const fixture = (() => {
    const sessionsRoot = join(DSH_HOME, 'sessions');
    if (!existsSync(sessionsRoot)) {
      throw new Error(`no sessions directory at ${sessionsRoot}`);
    }
    const byNewest = (a, b) => b.mtime - a.mtime;
    const candidates = [
      ...listTranscripts(sessionsRoot).filter((entry) => entry.version === 4).sort(byNewest),
      // Raw v3 is pre-migration; keep it only as a limited fallback.
      ...listTranscripts(sessionsRoot).filter((entry) => entry.version === 3).sort(byNewest).slice(0, 10),
    ];
    for (const candidate of candidates) {
      try {
        const events = parseTranscript(candidate.path);
        if (events.some((event) => SURFACE_TYPES.has(event?.type))) return { ...candidate, events };
      } catch { /* unreadable fixture: try the next one */ }
    }
    throw new Error(`no session.v4 fixture with surface events under ${sessionsRoot}`);
  })();
  const { events } = fixture;
  const fixtureName = fixture.path.split('/').slice(-2).join('/');

  if (fixture.version === 4) {
    ok(`fixture ${fixtureName} (v4, ${events.length} events)`);
  } else {
    deviation(
      `fixture ${fixtureName} (v3 fallback)`,
      'raw v3 rows are pre-migration (tool/result role "user"); current-format seed checks need a v4 transcript',
    );
  }

  const surface = events.filter((event) => SURFACE_TYPES.has(event?.type));
  let envelopeViolations = [];
  for (const [index, event] of surface.entries()) {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      envelopeViolations.push(`index ${index}: not an object`);
      continue;
    }
    for (const key of Object.keys(event)) {
      if (!ALLOWED_KEYS.has(key)) envelopeViolations.push(`index ${index}: unexpected key "${key}"`);
    }
    if (typeof event.type !== 'string') envelopeViolations.push(`index ${index}: type not string`);
    if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || event.seq < 0) envelopeViolations.push(`index ${index}: bad seq`);
    if (typeof event.time !== 'number' || !Number.isSafeInteger(event.time)) envelopeViolations.push(`index ${index}: bad time`);
    if (event.data === undefined) envelopeViolations.push(`index ${index}: data undefined`);
  }
  if (envelopeViolations.length === 0) {
    ok(`${surface.length} surface events pass the envelope contract`);
  } else {
    fail('seed envelope', new Error(`${envelopeViolations.length} violation(s): ${envelopeViolations.slice(0, 5).join('; ')}`));
  }

  // The summary payload every append/seed site shares (lib/seed.js).
  let summaryKind;
  try {
    const { summaryMessage } = await import(pathToFileURL(join(REPO, 'lib', 'seed.js')).href);
    const summary = summaryMessage('probe');
    if (typeof summary.id !== 'string' || summary.id === '') throw new Error('summaryMessage must carry an id');
    if (summary.role !== 'user' || !Array.isArray(summary.content)) {
      throw new Error('summaryMessage does not match the user/message shape');
    }
    summaryKind = summary.source?.kind;
    if (typeof summaryKind !== 'string' || summaryKind === '') {
      throw new Error('summaryMessage source.kind must be a non-empty string');
    }
    ok(`summary message carries id/role/content and source.kind="${summaryKind}"`);
    if (summaryKind === 'plugin' || Object.hasOwn(summary.source ?? {}, 'plugin')) {
      deviation(
        'summary source kind is the legacy {kind:"plugin", plugin} shape',
        '0.2.1 MessageSourceMap has no catch-all "plugin" kind (module augmentation declares producer kinds). ' +
        'The session validator accepts any non-empty user-source kind, so seeds load; consumers cannot interpret it.',
      );
    }
  } catch (err) {
    fail('summary message shape', err);
  }

  // Build both modes from the fixture and run the harness's own validator.
  let Session;
  let SessionId;
  let formatVersion;
  try {
    ({ Session, SessionId, SESSION_FORMAT_VERSION: formatVersion } = await import('@deepseek-ai/dsh-session'));
  } catch (err) {
    fail('Session validator import', err);
  }

  if (surface.length > 0 && Session !== undefined) {
    try {
      const { buildSeed } = await import(pathToFileURL(join(REPO, 'lib', 'seed.js')).href);
      // lib/seed.js keeps exactly this set, so alignment with the built seed
      // uses the same accessor (developer/message is not seed-carried today).
      const { surfaceEvents } = await import(pathToFileURL(join(REPO, 'lib', 'events.js')).href);
      const starts = events.filter((event) => event.type === 'turn/start' && Number.isFinite(event.seq));
      const boundary = starts.length > 0 ? starts[starts.length - 1].seq - 1 : Math.max(0, Math.floor(events.length / 2));

      let sawReplacement = false;
      for (const mode of ['after', 'before']) {
        const seed = buildSeed(events, boundary, mode, { id: 'probe-summary', time: 1 });
        // The kept side travels verbatim: the prefix for "after", the tail for
        // "before". A replacement envelope in it must survive the seed build;
        // flattening it to "append" would resurrect the shadowed originals.
        const keptSource = surfaceEvents(events).filter((event) => (
          mode === 'after' ? event.seq <= boundary : event.seq > boundary
        ));
        const keptSeed = mode === 'after' ? seed.slice(0, keptSource.length) : seed.slice(1);
        sawReplacement ||= keptSource.some(isReplaceSurfaceOp);
        const flattened = flattenedReplacementSeqs(keptSource, keptSeed);
        if (flattened.length > 0) {
          deviation(
            `seed ${mode} flattens ${flattened.length} kept replacement surfaceOp(s) to append`,
            `the source kept replacement(s) at seq ${flattened.slice(0, 3).join(', ')}; ` +
            'lib/seed.js materializeEvent() re-marks every surface record "append" and drops sourceEventSeqs. ' +
            'Replaying a replacement as an append resurrects the shadowed originals in the child surface ' +
            '(the RWC-003 shadowing bug). 0.2.1\'s TUI seed preserves the source envelope; a renumbered ' +
            'seed must remap the seq references instead of flattening them.',
          );
        }

        const violations = [];
        seed.forEach((event, index) => {
          if (event === null || typeof event !== 'object' || Array.isArray(event)) {
            violations.push(`seed[${index}]: not an object`);
            return;
          }
          for (const key of Object.keys(event)) {
            if (!ALLOWED_KEYS.has(key)) violations.push(`seed[${index}]: unexpected key "${key}"`);
          }
          if (event.seq !== index) violations.push(`seed[${index}]: seq not contiguous from 0`);
          if (typeof event.time !== 'number' || !Number.isSafeInteger(event.time)) violations.push(`seed[${index}]: bad time`);
          if (event.data === undefined) violations.push(`seed[${index}]: data undefined`);

          // Raw v3 rows predate the current message shape (no role on
          // tool/result, nested content blocks); the current-format role check
          // and the real Session.create run only on a v4 fixture.
          if (fixture.version !== 4) return;
          const role = MESSAGE_ROLE_BY_TYPE[event.type];
          if (role === undefined) return;
          const message = event.type === 'user/message' ? event.data : event.data?.message;
          if (typeof message?.id !== 'string' || message.id === '') {
            violations.push(`seed[${index}] (${event.type}): lacks an identified message`);
          } else if (message.role !== role) {
            violations.push(`seed[${index}] (${event.type}): role must be "${role}", got "${message.role}"`);
          } else if (typeof message.source?.kind !== 'string' || message.source.kind === '') {
            violations.push(`seed[${index}] (${event.type}): invalid source`);
          } else if (!Array.isArray(message.content)) {
            violations.push(`seed[${index}] (${event.type}): invalid content`);
          }
        });

        if (violations.length > 0) {
          fail(`seed ${mode} shape`, new Error(`${violations.length} violation(s): ${violations.slice(0, 5).join('; ')}`));
          continue;
        }

        if (fixture.version !== 4) continue;
        const childId = `contract-probe-${mode}`;
        const header = {
          version: formatVersion,
          id: childId,
          createdAt: 1,
          parentSession: 'contract-probe-source',
          cwd: REPO,
          isSeeded: true,
        };
        try {
          const child = Session.create(SessionId(childId), seed, header, seed.length);
          if (child.surface.nodes.length === 0) throw new Error('validated child has an empty surface');
          ok(`seed ${mode}: ${seed.length} events accepted by Session.create (surface ${child.surface.nodes.length})`);
        } catch (err) {
          fail(`seed ${mode} Session.create`, err);
        }
      }

      if (!sawReplacement) {
        // No fixture in this profile exercises a replacement marker. Synthesize
        // the minimal kept-side shadowing case so the RWC-003 deviation stays
        // visible; this is a probe fixture, not part of the Session.create run.
        const synthetic = [
          {
            type: 'user/message', seq: 0, time: 1, surfaceOp: 'append',
            data: {
              id: 'probe-shadowed', role: 'user', source: { kind: 'probe' },
              content: [{ type: 'text', text: 'shadowed original' }],
            },
          },
          {
            type: 'user/message', seq: 1, time: 2,
            surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, sourceEventSeqs: [0],
            data: {
              id: 'probe-replacement', role: 'user', source: { kind: 'probe' },
              content: [{ type: 'text', text: 'replacement' }],
            },
          },
        ];
        const syntheticSeed = buildSeed(synthetic, 1, 'after', { id: 'probe-synthetic-summary', time: 3 });
        const flattened = flattenedReplacementSeqs(synthetic, syntheticSeed.slice(0, synthetic.length));
        if (flattened.length > 0) {
          deviation(
            'seed flattens a synthetic kept replacement surfaceOp to append',
            `no v4 fixture in this profile contains a replacement surfaceOp, so the probe synthesized one at seq ${flattened[0]}; ` +
            'lib/seed.js materializeEvent() re-marks it "append" and drops sourceEventSeqs. ' +
            'That resurrects the shadowed original in the child surface (the RWC-003 shadowing bug); ' +
            '0.2.1\'s TUI seed preserves the source envelope, and a renumbered seed must remap the seq references.',
          );
        }
      }
    } catch (err) {
      fail('seed build', err);
    }
  }
  } catch (err) {
    fail('seed contract', err);
  }
}

// ── 7. inject list must not require optional services ──────────────────────
console.log('7. inject contract (no optional services)');
{
  const source = readFileSync(join(REPO, 'lib', 'index.js'), 'utf8');
  const injectMatch = /const inject = \[(.*?)\];/s.exec(source);
  const inject = injectMatch ? injectMatch[1].match(/'([^']+)'/g).map((entry) => entry.replace(/'/g, '')) : [];
  const optional = inject.filter((name) => ['compaction', 'logger', 'sessionProjections'].includes(name));
  const required = ['tools', 'commands', 'skills', 'agents'].filter((name) => !inject.includes(name));
  if (optional.length === 0 && required.length === 0) ok(`inject = [${inject.join(', ')}]`);
  else fail('inject list', new Error(`optional services in inject: ${optional}; missing required: ${required}`));
}

// ── 8. syntax + unit tests ──────────────────────────────────────────────────
console.log('8. syntax + unit tests');
{
  for (const file of LIB_FILES) {
    const result = spawnSync('node', ['--check', join(REPO, 'lib', file)], { encoding: 'utf8' });
    if (result.status === 0) ok(`node --check lib/${file}`);
    else fail(`node --check lib/${file}`, new Error(result.stderr));
  }
  const tests = spawnSync('node', ['--test', join(REPO, 'tests')], { encoding: 'utf8' });
  if (tests.status === 0) ok('node --test tests/');
  else fail('node --test tests/', new Error(tests.stderr.slice(-600)));
}

if (failures.length === 0) {
  const suffix = deviations.length === 0 ? '' : ` (${deviations.length} documented deviation(s) above)`;
  console.log(`\nALL CONTRACTS PASS${suffix}`);
} else {
  console.log(`\n${failures.length} CONTRACT CHECK(S) FAILED`);
}
process.exit(failures.length === 0 ? 0 : 1);
