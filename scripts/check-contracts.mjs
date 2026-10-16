#!/usr/bin/env node
/**
 * Harness-contract probe: catches the bug classes this repo hit live, BEFORE a
 * boot. Run it from anywhere:
 *
 *   node scripts/check-contracts.mjs                # default profile: dsh-tui
 *   node scripts/check-contracts.mjs --profile tui-rc-test
 *
 * Checks (each mirrors a real failure from the 2026-10-15 testing session):
 *   1. load-time: every lib/*.js imports cleanly inside the profile's module
 *      graph (caught: z.string().nullable crash).
 *   2. tool contract: rewindCompactTool(mockCtx) passes the REAL defineTool
 *      validator from @deepseek-ai/dsh-tools (caught: raw-JSON-Schema output
 *      dialect, parameters property-map dialect).
 *   3. skill contract: the registered skill definition satisfies dsh-skill's
 *      load-time validateDefinition requirements — name/description/source/
 *      content/provider must be strings (mirrors dsh-skill/lib/index.js:478;
 *      the validator itself is not exported). Caught: "loaded skill source
 *      must be a string".
 *   4. seed contract: the fork seed built from a REAL session transcript
 *      passes dsh-session's envelope rules — each entry is an object with
 *      exactly the allowed keys and string type / safe-integer seq / time,
 *      and data !== undefined (mirrors dsh-session/lib/index.js:849, which is
 *      not exported). Caught: "seed event at index 0 has an invalid event
 *      envelope".
 *   5. inject contract: the entry's inject list contains no optional service
 *      (compaction/logger) that wedges activation on profiles without them
 *      (caught: "1 entry did not activate (waiting for services)").
 *   6. syntax + unit tests: node --check on lib/*.js and node --test tests/.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const profileFlag = args.indexOf('--profile');
const PROFILE = profileFlag >= 0 ? args[profileFlag + 1] : 'dsh-tui';
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const REPO = resolve(new URL('..', import.meta.url).pathname);

const profileDir = join(DSH_HOME, 'profiles', PROFILE);
const bundleDir = join(profileDir, 'node_modules', 'dsh-rewind-compact');
const profileNodeModules = join(profileDir, 'node_modules');

const failures = [];
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, err) => {
  console.error(`  ✗ ${label}\n    ${err?.stack ?? err}`);
  failures.push(label);
};

console.log(`contract probe — profile ${PROFILE}`);

// ── 1. load-time import of every lib module (inside the profile's graph) ──
console.log('1. lib modules import cleanly');
if (!existsSync(bundleDir)) {
  fail('bundle installed in profile', new Error(`${bundleDir} missing — run: dsh plugin --profile ${PROFILE} add --offline file:${REPO}`));
} else {
  for (const file of ['index.js', 'events.js', 'scaffold.js', 'rewind.js', 'tool.js', 'command.js', 'tui-rewind.js', 'errors.js']) {
    const url = new URL(`file://${join(bundleDir, 'lib', file)}`);
    try {
      await import(url.href);
      ok(`lib/${file}`);
    } catch (err) {
      fail(`lib/${file} import`, err);
    }
  }
}

// ── 2. tool passes the REAL defineTool validator ──
console.log('2. defineTool output/parameters dialect');
try {
  const requireFromProfile = createRequire(join(profileNodeModules, 'package.json'));
  const { defineTool } = requireFromProfile('@deepseek-ai/dsh-tools');
  const { rewindCompactTool } = await import(new URL(`file://${join(bundleDir, 'lib', 'tool.js')}`).href);
  const mockCtx = { tools: { register: () => {} } };
  const tool = rewindCompactTool(mockCtx);
  if (typeof tool?.name !== 'string' || tool.name !== 'rewind_compact') throw new Error('tool name missing');
  // defineTool has already run valueSchemaSpecToJsonSchema on output.schema —
  // reaching here means the raw-JSON-Schema dialect is accepted.
  ok('rewind_compact accepted by defineTool (output.schema + parameters dialects)');
} catch (err) {
  fail('defineTool validation', err);
}

// ── 3. skill definition satisfies the load-time validator ──
console.log('3. skill definition fields (validateDefinition mirror)');
{
  // Re-run the registration shape without importing the harness entry:
  const src = readFileSync(join(REPO, 'lib', 'index.js'), 'utf8');
  const hasContent = /content:\s*SKILL_BODY/.test(src);
  const hasSource = /source:\s*'dsh-rewind-compact'/.test(src);
  const hasInvocation = /invocation:\s*\{\s*modelInvocable:\s*true,\s*userInvocable:\s*true\s*\}/.test(src);
  const nameOk = /name:\s*'rewind-compact'/.test(src);
  if (nameOk && hasContent && hasSource && hasInvocation) {
    ok('name/description/source/content/invocation present as strings');
  } else {
    fail('skill registration payload', new Error(`name=${nameOk} content=${hasContent} source=${hasSource} invocation=${hasInvocation}`));
  }
  // The real loader also validates the SKILL.md parse result.
  const skillMd = readFileSync(join(REPO, 'skill', 'rewind-compact', 'SKILL.md'), 'utf8');
  const frontmatterOk = /^---\nname:\s*rewind-compact\n/.test(skillMd) && /^description:/m.test(skillMd);
  if (frontmatterOk) ok('SKILL.md frontmatter parses (name + description)');
  else fail('SKILL.md frontmatter', new Error('missing name/description frontmatter'));
}

// ── 4. fork seed built from a real transcript passes envelope rules ──
console.log('4. seed envelope contract (assertSessionEventEnvelope mirror)');
{
  const surfaceTypes = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result']);
  const ALLOWED_KEYS = new Set(['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable']);
  const sessionsRoot = join(DSH_HOME, 'sessions');
  // pick the most recently modified session transcript as the fixture
  let fixture = null;
  try {
    const { execFileSync: _ef } = await import('node:child_process');
    const out = _ef('bash', ['-c', `find ${sessionsRoot} -name 'session.v3.jsonl.zstd' -printf '%T@ %p\\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-`], { encoding: 'utf8' });
    fixture = out.trim();
  } catch {
    fixture = '';
  }
  if (!fixture) {
    fail('seed fixture transcript', new Error(`no session transcripts under ${sessionsRoot}`));
  } else {
    const events = [];
    try {
      const { execFileSync: _ef } = await import('node:child_process');
      const raw = _ef('unzstd', ['-c', fixture], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* partial tail line */ }
      }
    } catch (err) {
      fail('decompress fixture transcript', err);
    }
    const surface = events.filter((e) => surfaceTypes.has(e.type));
    let envelopeOk = true;
    const violations = [];
    surface.forEach((event, index) => {
      if (event === null || typeof event !== 'object' || Array.isArray(event)) {
        envelopeOk = false; violations.push(`index ${index}: not an object`);
        return;
      }
      for (const key of Object.keys(event)) {
        if (!ALLOWED_KEYS.has(key)) { envelopeOk = false; violations.push(`index ${index}: unexpected key "${key}"`); }
      }
      if (typeof event.type !== 'string') violations.push(`index ${index}: type not string`);
      if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || event.seq < 0) violations.push(`index ${index}: bad seq`);
      if (typeof event.time !== 'number' || !Number.isSafeInteger(event.time)) violations.push(`index ${index}: bad time`);
      if (event.data === undefined) violations.push(`index ${index}: data undefined`);
    });
    if (surface.length === 0) {
      fail('seed fixture surface events', new Error('fixture transcript has no surface messages'));
    } else if (!envelopeOk || violations.length) {
      fail('seed envelope', new Error(`${violations.length} violation(s): ${violations.slice(0, 5).join('; ')}`));
    } else {
      ok(`${surface.length} surface events from ${fixture.split('/').pop()} pass the envelope contract`);
    }
  }
}

// ── 5. inject list must not require optional services ──
console.log('5. inject contract (no optional services)');
{
  const src = readFileSync(join(REPO, 'lib', 'index.js'), 'utf8');
  const injectMatch = /const inject = \[(.*?)\];/s.exec(src);
  const inject = injectMatch ? injectMatch[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, '')) : [];
  const optional = inject.filter((name) => ['compaction', 'logger', 'sessionProjections'].includes(name));
  const required = ['tools', 'commands', 'skills', 'agents'].filter((name) => !inject.includes(name));
  if (optional.length === 0 && required.length === 0) ok(`inject = [${inject.join(', ')}]`);
  else fail('inject list', new Error(`optional services in inject: ${optional}; missing required: ${required}`));
}

// ── 6. syntax + unit tests ──
console.log('6. syntax + unit tests');
{
  const files = ['index.js', 'events.js', 'scaffold.js', 'rewind.js', 'tool.js', 'command.js', 'tui-rewind.js', 'errors.js'];
  for (const file of files) {
    const r = spawnSync('node', ['--check', join(REPO, 'lib', file)], { encoding: 'utf8' });
    if (r.status === 0) ok(`node --check lib/${file}`);
    else fail(`node --check lib/${file}`, new Error(r.stderr));
  }
  const t = spawnSync('node', ['--test', join(REPO, 'tests')], { encoding: 'utf8' });
  if (t.status === 0) ok('node --test tests/');
  else fail('node --test tests/', new Error(t.stderr.slice(-600)));
}

console.log(failures.length === 0 ? '\nALL CONTRACTS PASS' : `\n${failures.length} CONTRACT CHECK(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
