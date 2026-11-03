import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, ProfileError, parseProfileLabel } from '../profile-core.js';
import { spawnProfiled, resolveChildProfile, installChildPolicy, profileIdentityFromSession } from '../profile-runtime.js';

const p = validateProfile('explorer', {
  provider: 'openai-codex', model: 'gpt-6-luna', reasoning_effort: 'xhigh',
  description: 'Explore the codebase',
  developer_instruction: 'Explore only, do not edit.',
  tool_whitelist: ['read', 'grep'],
});
const load = () => ({ profiles: new Map([['explorer', p]]), diagnostics: new Map() });
const signal = new AbortController().signal;
const fakeTools = () => ({
  schemas: () => [{ name: 'read' }, { name: 'grep' }, { name: 'edit' }, { name: 'subagent' }],
  restrict: (filter) => { assert.deepEqual(filter.allow, ['read', 'grep']); fakeTools.restricted = true; },
});
const agent = { ctx: { tools: fakeTools(), systemPrompt: {
  getSectionOrder: () => 100,
  section: (section) => { agent.injectedSection = section; },
} }, session: { header: { id: 'parent' } } };

function baseContext(overrides = {}) {
  return {
    llm: { listProviders: () => [{ id: 'openai-codex' }], resolveCallConfig: async () => ({}) },
    subagents: {
      getProvider: () => ({ inheritsParentContext: false, capabilities: { agentOptions: true }, prepareContinuable: async () => ({}) }),
      startActivation: async (spec) => ({ childId: spec.childId }),
    },
    ...overrides,
  };
}

test('spawn uses exact fixed route and official activation; preserves pending child identity', async () => {
  const pending = new Map();
  let seen;
  const ctx = baseContext({ subagents: {
    getProvider: () => ({ inheritsParentContext: false, capabilities: { agentOptions: true }, prepareContinuable: async () => ({}) }),
    startActivation: async (spec) => {
      seen = spec;
      assert.equal(pending.get(spec.childId), p);
      const resume = { header: { origin: 'subagent', id: spec.childId }, snapshotEvents: () => [
        { type: 'subagent/descriptor', data: { label: spec.label } },
      ] };
      assert.equal(resolveChildProfile(resume, pending, load), p);
      return { childId: spec.childId };
    },
  } });
  const result = await spawnProfiled({ ctx, agent, args: {
    profile: 'explorer', prompt: 'Trace auth functions', description: 'Investigate login',
  }, pending, load, signal });
  assert.equal(result.kind, 'activation');
  assert.equal(result.subagentId, seen.childId);
  assert.equal(seen.provider, 'spawn');
  assert.equal(seen.delivery, 'parent');
  assert.equal(seen.request.agentOptions.provider, 'openai-codex');
  assert.equal(seen.request.agentOptions.model, 'gpt-6-luna');
  assert.equal(seen.request.agentOptions.reasoningEffort, 'xhigh');
  assert.equal(seen.request.prompt[0].text, 'Trace auth functions');
  assert.equal(pending.size, 0);
});

test('child descriptor permits cold resume and refuses drifted Profile', () => {
  const label = '[dsh-profile:explorer:';
  const runtimeLabel = (() => {
    let stored;
    const pending = new Map();
    return import('../profile-core.js').then(({ profileLabel }) => profileLabel(p, 'Inspect login'));
  })();
  return runtimeLabel.then(text => {
    assert.ok(text.startsWith(label));
    const session = { header: { id: 'child-1', origin: 'subagent' }, snapshotEvents: () => [
      { type: 'subagent/descriptor', data: { label: text } },
    ] };
    assert.deepEqual(profileIdentityFromSession(session), parseProfileLabel(text));
    assert.equal(resolveChildProfile(session, new Map(), load), p);
    const changed = validateProfile('explorer', {
      provider: 'openai-codex', model: 'other', reasoning_effort: 'xhigh',
    });
    assert.throws(() => resolveChildProfile(session, new Map(), () => ({
      profiles: new Map([['explorer', changed]]), diagnostics: new Map(),
    })), error => error.code === 'PROFILE_CHANGED');
  });
});

test('child instructions are scoped to child, not the main-agent schema', () => {
  const child = { ctx: {
    tools: { schemas: () => [{ name: 'read' }, { name: 'grep' }, { name: 'edit' }],
      restrict: (filter) => { child.filter = filter; } },
    systemPrompt: { getSectionOrder: () => 110, section: (definition) => { child.persona = definition; } },
  } };
  installChildPolicy(child, p);
  assert.equal(child.persona.name, 'deployment:persona-prefix');
  assert.equal(child.persona.text, p.developer_instruction);
  assert.deepEqual(child.filter.allow, ['read', 'grep']);
});

test('unknown or malformed profile errors are returned to caller, not silently substituted', async () => {
  const ctx = baseContext();
  const pending = new Map();
  for (const args of [{ prompt: 'hello' }, { profile: 'missing', prompt: 'hello' }]) {
    await assert.rejects(() => spawnProfiled({ ctx, agent, args, load, pending, signal }),
      error => error instanceof ProfileError && ['PROFILE_REQUIRED', 'PROFILE_NOT_FOUND'].includes(error.code));
  }
});

test('official activation failures preserve the meaningful cause and code', async () => {
  const ctx = baseContext({ subagents: {
    getProvider: () => ({ inheritsParentContext: false, capabilities: { agentOptions: true }, prepareContinuable: async () => ({}) }),
    startActivation: async () => { throw new Error('Active subagent limit reached'); },
  } });
  const pending = new Map();
  await assert.rejects(() => spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'work' }, load, pending, signal }),
    e => e instanceof ProfileError && e.code === 'SPAWN_FAILED' && /limit/.test(e.message));
  assert.equal(pending.size, 0);
});
