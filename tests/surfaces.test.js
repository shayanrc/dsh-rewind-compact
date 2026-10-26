import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSurfaces } from '../lib/surfaces.js';
import { subscribeRewindDecisions } from '../lib/tui-rewind.js';

/**
 * Minimal ctx double: one effect runner that collects every yielded disposer,
 * plus service registration/log capture. `available` names the optional
 * services this profile provides (sdk-minimal = no `commands`/`skills`).
 */
function fakeCtx(available = [], { throwing = [] } = {}) {
  const logs = [];
  const registered = { tools: [], commands: [], skills: [] };
  const listeners = new Map();
  const disposers = [];
  const disposed = [];
  const effectCalls = [];
  const makeDisposer = (label) => () => disposed.push(label);
  const logger = {
    info: (line) => logs.push(line),
    warn: (line) => logs.push(line),
  };
  const services = {
    agents: {},
    compaction: {},
    commands: { register: (definition) => { registered.commands.push(definition); return makeDisposer('command'); } },
    skills: { register: (definition) => { registered.skills.push(definition); return makeDisposer('skill'); } },
  };
  const ctx = {
    effect(execute, label) {
      effectCalls.push(label);
      const iterator = execute();
      for (;;) {
        const step = iterator.next();
        if (step.done) return step.value;
        disposers.push(step.value);
      }
    },
    tools: {
      register(tool) {
        registered.tools.push(tool);
        return makeDisposer('tool');
      },
    },
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    get(name) {
      if (name === 'logger') return logger;
      if (throwing.includes(name)) throw new Error(`service "${name}" is unavailable`);
      if (available.includes(name)) return services[name];
      throw new Error(`service "${name}" is not provided by this profile`);
    },
  };
  return { ctx, logs, registered, listeners, disposers, disposed, effectCalls };
}

const surfaces = {
  tool: { name: 'rewind_compact' },
  command: () => ({ name: 'rewind-compact' }),
  skill: () => ({ name: 'rewind-compact' }),
};

test('sdk-minimal-like profile (no commands/skills) still registers the tool and TUI surface', () => {
  const fake = fakeCtx(['agents', 'compaction']);
  fake.ctx.effect(function* () {
    yield* registerSurfaces(fake.ctx, surfaces);
  }, 'rewind-compact lifecycle');

  assert.equal(fake.effectCalls.length, 1);
  assert.deepEqual(fake.registered.tools, [surfaces.tool]);
  assert.deepEqual(fake.registered.commands, []);
  assert.deepEqual(fake.registered.skills, []);

  const skipped = fake.logs.filter((line) => line.includes('surface skipped'));
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((line) => line.includes('commands')));
  assert.ok(skipped.some((line) => line.includes('skills')));
});

test('command and skill surfaces register when their services exist', () => {
  const fake = fakeCtx(['agents', 'compaction', 'commands', 'skills']);
  fake.ctx.effect(function* () {
    yield* registerSurfaces(fake.ctx, surfaces);
  }, 'rewind-compact lifecycle');

  assert.equal(fake.registered.commands.length, 1);
  assert.equal(fake.registered.skills.length, 1);
  assert.deepEqual(fake.logs.filter((line) => line.includes('surface skipped')), []);
});

test('each registered surface yields its own disposer from the single effect', () => {
  const fake = fakeCtx(['agents', 'compaction', 'commands', 'skills']);
  fake.ctx.effect(function* () {
    yield* registerSurfaces(fake.ctx, surfaces);
  }, 'rewind-compact lifecycle');

  // tool + command + skill, all yielded to the one effect.
  assert.equal(fake.disposers.length, 3);
  for (const dispose of fake.disposers) assert.equal(typeof dispose, 'function');
  for (const dispose of fake.disposers) dispose();
  assert.deepEqual(fake.disposed, ['tool', 'command', 'skill']);
});

test('a probing service that throws is skipped, not fatal', () => {
  const fake = fakeCtx(['agents', 'compaction', 'skills'], { throwing: ['commands'] });
  fake.ctx.effect(function* () {
    yield* registerSurfaces(fake.ctx, surfaces);
  }, 'rewind-compact lifecycle');

  assert.deepEqual(fake.registered.commands, []);
  assert.equal(fake.registered.skills.length, 1);
  assert.ok(fake.logs.some((line) => line.includes('commands') && line.includes('surface skipped')));
});

test('TUI decision subscriptions return one disposer that removes both listeners', () => {
  const fake = fakeCtx(['agents', 'compaction']);
  const dispose = subscribeRewindDecisions(fake.ctx);

  assert.deepEqual([...fake.listeners.keys()], ['tui/rewind-prompt', 'tui/rewind-done']);
  assert.equal(typeof dispose, 'function');
  dispose();
  assert.equal(fake.listeners.size, 0);
});
