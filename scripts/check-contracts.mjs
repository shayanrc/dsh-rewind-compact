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
 *   6. seed contract from a REAL v4 transcript (v3 raw is pre-migration and a
 *      failure on this line, not a fallback). Rebuilds both modes with the
 *      worktree lib/seed.js and runs the REAL Session.create validator.
 *      Envelope/seq/message-shape checks are failures. After mode must preserve
 *      a kept replacement surfaceOp (sourceEventSeqs is covered by the seed unit test); before mode folds
 *      the current tail by design. A targeted replacement fixture is always
 *      run through Session.create for both modes, asserting the child surface
 *      keeps the replacement and drops the shadowed original.
 *   7. surface/inject contract: only `tools`+`agents` are required;
 *      `commands`/`skills` (and compaction/logger/sessionProjections) are
 *      optional and probed. Drives the REAL entry `apply()` with a profile
 *      double for sdk-minimal (no commands/skills) and a full profile, and
 *      checks the tool always registers, skipped surfaces log exactly once,
 *      and every surface yields a disposer from the single effect.
 *   8. syntax + unit tests: node --check on lib/*.js and node --test tests/.
 *
 * Failures are contract breaks; the probe exits non-zero if any check fails.
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
  'index.js', 'events.js', 'scaffold.js', 'seed.js', 'create.js', 'rewind.js',
  'tool.js', 'command.js', 'tui-rewind.js', 'surfaces.js', 'errors.js',
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
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, err) => {
  console.error(`  ✗ ${label}\n    ${err?.stack ?? err}`);
  failures.push(label);
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
    // The worktree keeps a local surface-type set (pure modules, no harness
    // import in `npm test`); this asserts it matches the harness vocabulary —
    // developer/message included (RWC-003).
    const { isSurfaceEligibleType } = await import('@deepseek-ai/dsh-session');
    const { SURFACE_TYPES: localSurfaceTypes } = await import(pathToFileURL(join(REPO, 'lib', 'events.js')).href);
    const vocabulary = ['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'];
    const mismatched = vocabulary.filter((type) => isSurfaceEligibleType(type) !== localSurfaceTypes.has(type));
    if (mismatched.length === 0 && localSurfaceTypes.size === vocabulary.length) {
      ok(`surface vocabulary matches isSurfaceEligibleType (${vocabulary.length} types incl. developer/message)`);
    } else {
      fail('surface vocabulary', new Error(`local SURFACE_TYPES diverges on: ${mismatched.join(', ') || '(extra types)'}`));
    }
  } catch (err) {
    fail('surface vocabulary', err);
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
    // The fork call site must go through buildCreateOptions: 0.2.1
    // CreateAgentOptions carries parent lineage/cwd/isSeeded under `meta` and
    // the inherited length as `inheritedEventCount`; the factory reads only
    // those keys (dsh-agent-loop/lib/index.js:1893-1904) and silently ignores
    // the pre-0.2.1 top-level aliases.
    const loop = readFileSync(harnessFile('@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js'), 'utf8');
    const factoryReadsMeta = /options\.meta/.test(loop);
    const factoryReadsInherited = /options\.inheritedEventCount/.test(loop);
    const rewind = readFileSync(join(REPO, 'lib', 'rewind.js'), 'utf8');
    if (!/ctx\.agents\.create\(buildCreateOptions\(/.test(rewind)) {
      throw new Error('lib/rewind.js must call ctx.agents.create(buildCreateOptions({...})) so the options are auditable');
    }
    const { buildCreateOptions } = await import(pathToFileURL(join(REPO, 'lib', 'create.js')).href);
    const probeSeed = [{
      type: 'user/message', seq: 0, time: 1, surfaceOp: 'append',
      data: { id: 'probe-seed', role: 'user', content: [{ type: 'text', text: 'seed' }], source: { kind: 'rewind-compact' } },
    }];
    const options = buildCreateOptions({
      source: { id: 'probe-source' },
      sessionId: 'probe-child',
      seed: probeSeed,
      cwd: REPO,
      title: 'Probe source title',
      agentPreset: 'standard',
    });
    const legacyKeys = ['inheritedCount', 'parentSession', 'cwd', 'title'];
    const legacy = legacyKeys.filter((key) => Object.hasOwn(options, key));
    const unknown = Object.keys(options).filter((key) => !['sessionId', 'seed', 'meta', 'inheritedEventCount', 'setup'].includes(key));
    const metaKeys = Object.keys(options.meta).sort();
    const badMeta = !options.meta.isSeeded
      || options.meta.cwd !== REPO
      || options.meta.parentSession !== 'probe-source'
      || options.meta.agentPreset !== 'standard';
    if (legacy.length > 0) {
      fail('create call keys', new Error(`ignored 0.2.1 top-level alias(es): ${legacy.join(', ')}`));
    } else if (unknown.length > 0) {
      fail('create call keys', new Error(`unknown options ${unknown.join(', ')} — not in CreateAgentOptions`));
    } else if (options.inheritedEventCount !== probeSeed.length) {
      fail('create call keys', new Error(`inheritedEventCount ${options.inheritedEventCount} !== seed length ${probeSeed.length}`));
    } else if (badMeta || metaKeys.join(',') !== 'agentPreset,cwd,isSeeded,parentSession') {
      fail('create meta', new Error(`unexpected meta ${JSON.stringify(options.meta)}`));
    } else if (!factoryReadsMeta || !factoryReadsInherited) {
      fail('factory option consumption', new Error(`factory reads meta=${factoryReadsMeta} inheritedEventCount=${factoryReadsInherited}`));
    } else if (typeof options.setup !== 'function') {
      fail('create setup', new Error('setup must clear the child inbox and append the title event'));
    } else {
      // Exercise the title seam exactly as the factory will: a
      // `session/title` event, not a create option.
      const appended = [];
      let cleared = 0;
      await options.setup({}, {
        inbox: { clear: () => { cleared += 1; } },
        session: { append: (type, data) => { appended.push({ type, data }); } },
      });
      const titleEvent = appended.find((entry) => entry.type === 'session/title');
      const titleOk = titleEvent?.data?.title === 'Probe source title (rewound)'
        && Array.isArray(titleEvent.data.messageSeqs)
        && titleEvent.data.source?.kind === 'user';

      if (cleared !== 1) fail('create setup', new Error('setup must clear the child inbox'));
      else if (!titleOk) fail('create title seam', new Error(`unexpected title append ${JSON.stringify(appended)}`));
      else ok('create options = meta{cwd,parentSession,isSeeded,agentPreset} + inheritedEventCount; title appended as session/title');

      // Real persistence proof (RWC-002): spawn a separate process so the
      // persistence backend's transitive imports resolve from the installed
      // profile, not this probe's @deepseek-ai resolver hook.
      const jsonlProbe = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-create-jsonl.mjs')], {
        encoding: 'utf8',
        env: { ...process.env, DSH_HOME },
      });
      if (jsonlProbe.status !== 0) {
        fail('child JSONL header/title', new Error(jsonlProbe.stderr || jsonlProbe.stdout || 'probe exited non-zero'));
      } else {
        ok(jsonlProbe.stdout.trim().split('\n').at(-1));
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

  ok(`fixture ${fixtureName} (v4, ${events.length} events)`);

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

  // The summary payload every append/seed site shares (lib/seed.js) and the
  // declared message-source kind it uses (RWC-009).
  let summaryKind;
  try {
    const { summaryMessage, SUMMARY_SOURCE_KIND } = await import(pathToFileURL(join(REPO, 'lib', 'seed.js')).href);
    const summary = summaryMessage('probe');
    if (typeof summary.id !== 'string' || summary.id === '') throw new Error('summaryMessage must carry an id');
    if (summary.role !== 'user' || !Array.isArray(summary.content)) {
      throw new Error('summaryMessage does not match the user/message shape');
    }
    summaryKind = summary.source?.kind;
    if (typeof summaryKind !== 'string' || summaryKind === '') {
      throw new Error('summaryMessage source.kind must be a non-empty string');
    }
    if (summaryKind === 'plugin' || Object.hasOwn(summary.source ?? {}, 'plugin')) {
      fail(
        'summary source kind',
        new Error(
          'the retired {kind:"plugin", plugin} wrapper is not a 0.2.1 MessageSourceMap kind and is rejected at V4 admission; ' +
          `declare and document a producer kind (expected "${SUMMARY_SOURCE_KIND}")`,
        ),
      );
    } else if (summaryKind !== SUMMARY_SOURCE_KIND) {
      fail('summary source kind', new Error(`summary source.kind is "${summaryKind}", expected the declared kind "${SUMMARY_SOURCE_KIND}"`));
    } else {
      ok(`summary message carries id/role/content and the declared source.kind="${summaryKind}"`);
      const declaration = readFileSync(join(REPO, 'lib', 'message-source.d.ts'), 'utf8');
      const augments = /declare module '@deepseek-ai\/dsh-llm'/.test(declaration)
        && new RegExp(`'${SUMMARY_SOURCE_KIND}'\\s*:\\s*\\{\\s*readonly kind:\\s*'${SUMMARY_SOURCE_KIND}'`).test(declaration);
      if (augments) ok(`lib/message-source.d.ts declares MessageSourceMap['${SUMMARY_SOURCE_KIND}']`);
      else fail('summary source declaration', new Error('lib/message-source.d.ts does not augment MessageSourceMap with the kind'));
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
      // Surface alignment uses the same accessor as lib/seed.js; developer
      // messages are surface-eligible and do travel with the seed.
      const { surfaceEvents } = await import(pathToFileURL(join(REPO, 'lib', 'events.js')).href);
      const starts = events.filter((event) => event.type === 'turn/start' && Number.isFinite(event.seq));
      const boundary = starts.length > 0 ? starts[starts.length - 1].seq - 1 : Math.max(0, Math.floor(events.length / 2));

      for (const mode of ['after', 'before']) {
        const seed = buildSeed(events, boundary, mode, { id: 'probe-summary', time: 1 });
        // The kept side travels verbatim: the prefix for "after", the tail for
        // "before". A replacement envelope in it must survive the seed build;
        // flattening it to "append" would resurrect the shadowed originals.
        const keptSource = surfaceEvents(events).filter((event) => (
          mode === 'after' ? event.seq <= boundary : event.seq > boundary
        ));
        const seedSurface = seed.filter((event) => SURFACE_TYPES.has(event.type));
        const keptSeed = mode === 'after'
          ? seedSurface.filter((event) => event.seq <= boundary)
          : seedSurface.slice(1);
        // After mode keeps the source prefix verbatim, so a replacement must
        // survive. Before mode deliberately folds the current tail and
        // renumbers it, so its markers are expected to become appends.
        if (mode === 'after') {
          const flattened = flattenedReplacementSeqs(keptSource, keptSeed);
          if (flattened.length > 0) {
            fail(
              'seed after preserves kept replacement surfaceOps',
              new Error(
                `the source kept replacement(s) at seq ${flattened.slice(0, 3).join(', ')} became appends; ` +
                'replaying a replacement as an append resurrects the shadowed originals in the child surface.',
              ),
            );
          }
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

      // RWC-003 targeted fixture: before mode must replay the discarded
      // prefix's policy baseline before the kept tail. The real fixture may or
      // may not hold policy facts, so pin the ordering on a deterministic v4
      // transcript and run the REAL Session.create validator over it.
      const policyEvents = [
        {
          type: 'system/message', seq: 0, time: 1, surfaceOp: 'append',
          data: { turn: 1, step: 0, message: { id: 'sys', role: 'system', content: [{ type: 'text', text: 'system' }], source: { kind: 'system-prompt' } } },
        },
        { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
        {
          type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
          data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } },
        },
        { type: 'permission/preset', seq: 3, time: 4, data: { preset: 'workspace-write' } },
        { type: 'sandbox/mode', seq: 4, time: 5, data: { mode: 'workspace-write' } },
        { type: 'turn/end', seq: 5, time: 6, data: { turn: 1 } },
        { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
        {
          type: 'user/message', seq: 7, time: 8, surfaceOp: 'append',
          data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } },
        },
        { type: 'turn/end', seq: 8, time: 9, data: { turn: 2 } },
      ];
      const policySeed = buildSeed(policyEvents, 5, 'before', { id: 'policy-summary', time: 10 });
      const presetIndex = policySeed.findIndex((event) => event.type === 'permission/preset' && event.data.preset === 'workspace-write');
      const sandboxIndex = policySeed.findIndex((event) => event.type === 'sandbox/mode' && event.data.mode === 'workspace-write');
      const tailIndex = policySeed.findIndex((event) => event.type === 'user/message' && event.data.id === 'u2');
      const ordered = presetIndex > 0 && sandboxIndex > presetIndex && tailIndex > sandboxIndex;
      try {
        const policyChild = Session.create(
          SessionId('contract-probe-policy'),
          policySeed,
          { version: formatVersion, id: 'contract-probe-policy', createdAt: 1, cwd: REPO, isSeeded: true },
          policySeed.length,
        );
        const policySurface = policyChild.surface.nodes.length;
        if (!ordered) throw new Error(`policy baseline order wrong: preset=${presetIndex} sandbox=${sandboxIndex} tail=${tailIndex}`);
        ok(`before-mode policy baseline replayed before the tail and accepted by Session.create (surface ${policySurface})`);
      } catch (err) {
        fail('before-mode policy baseline', err);
      }

      // RWC-003 targeted replacement fixture: run both modes through the REAL
      // Session.create validator and assert the folded child surface keeps the
      // replacement and drops the shadowed original.
      const replacementEvents = [
        {
          type: 'system/message', seq: 0, time: 1, surfaceOp: 'append',
          data: { turn: 1, step: 0, message: { id: 'sys', role: 'system', content: [{ type: 'text', text: 'system' }], source: { kind: 'system-prompt' } } },
        },
        { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
        {
          type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
          data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'kept' }], source: { kind: 'user' } },
        },
        {
          type: 'user/message', seq: 3, time: 4, surfaceOp: 'append',
          data: { id: 'shadowed', role: 'user', content: [{ type: 'text', text: 'shadowed prefix' }], source: { kind: 'user' } },
        },
        {
          type: 'user/message', seq: 4, time: 5, surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3],
          data: { id: 'replacement', role: 'user', content: [{ type: 'text', text: 'replacement prefix' }], source: { kind: 'user' } },
        },
        { type: 'turn/end', seq: 5, time: 6, data: { turn: 1 } },
        { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
        {
          type: 'user/message', seq: 7, time: 8, surfaceOp: 'append',
          data: { id: 'tail-shadowed', role: 'user', content: [{ type: 'text', text: 'shadowed tail' }], source: { kind: 'user' } },
        },
        {
          type: 'user/message', seq: 8, time: 9, surfaceOp: { op: 'replace', startSeq: 7, endSeq: 7 }, sourceEventSeqs: [7],
          data: { id: 'tail-replacement', role: 'user', content: [{ type: 'text', text: 'replacement tail' }], source: { kind: 'user' } },
        },
        { type: 'turn/end', seq: 9, time: 10, data: { turn: 2 } },
      ];
      for (const mode of ['after', 'before']) {
        try {
          const seed = buildSeed(replacementEvents, 5, mode, { id: `replacement-${mode}`, time: 100 });
          const child = Session.create(
            SessionId(`contract-probe-replacement-${mode}`),
            seed,
            { version: formatVersion, id: `contract-probe-replacement-${mode}`, createdAt: 1, cwd: REPO, isSeeded: true },
            seed.length,
          );
          const ids = child.surface.nodes.map((seq) => child.log[seq]?.data?.id ?? child.log[seq]?.data?.message?.id);
          const expected = mode === 'after'
            ? ['sys', 'u1', 'replacement', `replacement-${mode}`]
            : [`replacement-${mode}`, 'tail-replacement'];
          if (JSON.stringify(ids) !== JSON.stringify(expected)) {
            fail(`replacement fixture ${mode}`, new Error(`child surface ${JSON.stringify(ids)} != ${JSON.stringify(expected)}`));
          } else {
            ok(`replacement fixture ${mode}: Session.create keeps the replacement and drops the shadowed original`);
          }
        } catch (err) {
          fail(`replacement fixture ${mode}`, err);
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

// ── 7. surface contract: required inject only; optional surfaces probed ─────
console.log('7. surface contract (commands/skills optional, tools/agents required)');
{
  const source = readFileSync(join(REPO, 'lib', 'index.js'), 'utf8');
  const injectMatch = /const inject = \[(.*?)\];/s.exec(source);
  const inject = injectMatch ? injectMatch[1].match(/'([^']+)'/g).map((entry) => entry.replace(/'/g, '')) : [];
  const optional = inject.filter((name) =>
    ['commands', 'skills', 'compaction', 'logger', 'sessionProjections'].includes(name));
  const required = ['tools', 'agents'].filter((name) => !inject.includes(name));
  if (optional.length === 0 && required.length === 0) ok(`inject = [${inject.join(', ')}]`);
  else fail('inject list', new Error(`optional services in inject: ${optional}; missing required: ${required}`));

  // Profile double: a sdk-minimal-like tree provides no commands/skills;
  // a base-backed profile provides both. `ctx.get()` throws for anything the
  // profile does not provide, exactly like Cordis does for uninjected services.
  const makeEntryCtx = (available) => {
    const logs = [];
    const registrations = { tools: [], commands: [], skills: [] };
    const listeners = new Map();
    const disposers = [];
    const effectLabels = [];
    const logger = { info: (line) => logs.push(line), warn: (line) => logs.push(line) };
    const services = {
      agents: {},
      compaction: { compactRegion() {} },
      commands: { register(definition) { registrations.commands.push(definition); return () => {}; } },
      skills: { register(definition) { registrations.skills.push(definition); return () => {}; } },
    };
    const ctx = {
      effect(execute, label) {
        effectLabels.push(label);
        const iterator = execute();
        for (;;) {
          const step = iterator.next();
          if (step.done) return step.value;
          disposers.push(step.value);
        }
      },
      tools: { register(tool) { registrations.tools.push(tool); return () => {}; } },
      on(name) { listeners.set(name, true); return () => listeners.delete(name); },
      get(serviceName) {
        if (serviceName === 'logger') return logger;
        if (available.has(serviceName)) return services[serviceName];
        throw new Error(`service "${serviceName}" is not provided by this profile`);
      },
    };
    return { ctx, logs, registrations, listeners, disposers, effectLabels };
  };

  try {
    const { apply } = await import(pathToFileURL(join(REPO, 'lib', 'index.js')).href);

    // sdk-minimal: tools + agents + compaction, deliberately no commands/skills.
    const minimal = makeEntryCtx(new Set(['agents', 'compaction']));
    apply(minimal.ctx);
    if (minimal.effectLabels.length === 1) ok('single effect for sdk-minimal-like profile');
    else fail('entry effect count', new Error(`expected 1 effect, got ${minimal.effectLabels.length}`));
    if (minimal.registrations.tools.length === 1) ok('rewind_compact tool still registers without commands/skills');
    else fail('tool registration on sdk-minimal', new Error(`tool registrations: ${minimal.registrations.tools.length}`));
    if (minimal.registrations.commands.length === 0 && minimal.registrations.skills.length === 0) {
      ok('no command/skill surface registered where the services are absent');
    } else {
      fail('optional surface registration', new Error('command/skill registered without its service'));
    }
    const minimalSkips = minimal.logs.filter((line) => line.includes('surface skipped'));
    const skippedCommands = minimalSkips.filter((line) => line.includes('commands'));
    const skippedSkills = minimalSkips.filter((line) => line.includes('skills'));
    if (skippedCommands.length === 1 && skippedSkills.length === 1) {
      ok('missing command and skill surfaces each log once');
    } else {
      fail('skip logging', new Error(`command skips: ${skippedCommands.length}; skill skips: ${skippedSkills.length}`));
    }
    if (minimal.listeners.has('tui/rewind-prompt') && minimal.listeners.has('tui/rewind-done')) {
      ok('TUI decision subscriptions register without commands/skills');
    } else {
      fail('TUI subscriptions', new Error(`listeners: ${[...minimal.listeners.keys()].join(', ')}`));
    }
    if (minimal.disposers.length === 2) ok('tool + TUI surfaces yield per-surface disposers');
    else fail('per-surface disposers', new Error(`expected 2 disposers, got ${minimal.disposers.length}`));

    // Base-backed profile: all three surfaces plus the TUI subscriptions.
    const full = makeEntryCtx(new Set(['agents', 'compaction', 'commands', 'skills']));
    apply(full.ctx);
    if (full.registrations.tools.length === 1
      && full.registrations.commands.length === 1
      && full.registrations.skills.length === 1) {
      ok('tool, command, and skill surfaces register on a full profile');
    } else {
      fail('full-profile surfaces', new Error(
        `tools=${full.registrations.tools.length} commands=${full.registrations.commands.length} skills=${full.registrations.skills.length}`,
      ));
    }
    if (full.logs.filter((line) => line.includes('surface skipped')).length === 0) {
      ok('no skip lines when every optional service is present');
    } else {
      fail('unexpected skip logging', new Error(full.logs.join('\n')));
    }
    if (full.effectLabels.length === 1 && full.disposers.length === 4) {
      ok('one effect owns four per-surface disposers on a full profile');
    } else {
      fail('full-profile cleanup', new Error(
        `effects=${full.effectLabels.length} disposers=${full.disposers.length}`,
      ));
    }
  } catch (err) {
    fail('entry apply simulation', err);
  }
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
  console.log('\nALL CONTRACTS PASS');
} else {
  console.log(`\n${failures.length} CONTRACT CHECK(S) FAILED`);
}
process.exit(failures.length === 0 ? 0 : 1);
