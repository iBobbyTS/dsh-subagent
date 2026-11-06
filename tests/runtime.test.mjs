import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, ProfileError, parseProfileLabel } from '../profile-core.js';
import { spawnProfiled, resolveChildProfile, installChildPolicy, installRootRouting, profileIdentityFromSession } from '../profile-runtime.js';
import { scanProfiles } from '../profile-store.js';
import { fileURLToPath } from 'node:url';

const p = validateProfile('explorer', {
  provider: 'openai-codex', model: 'gpt-6-luna', reasoning_effort: 'xhigh',
  description: 'Explore the codebase',
  developer_instruction: 'Explore only, do not edit.',
  tool_whitelist: ['read', 'grep'],
});
const load = () => ({ profiles: new Map([['explorer', p]]), diagnostics: new Map() });
const signal = new AbortController().signal;
const fakeTools = () => ({
  schemas: () => [{ name: 'read' }, { name: 'grep' }, { name: 'edit' }, { name: 'subagent' }, { name: 'send_message' }],
  restrict: (filter) => { assert.deepEqual(filter.allow, ['read', 'grep', 'send_message']); fakeTools.restricted = true; },
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
      resolveMaxDepth: () => 2,
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
    resolveMaxDepth: () => 2,
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
  assert.equal(seen.parent, undefined, 'task options belong to request on rc.1');
  assert.equal(seen.request.parent, agent);
  assert.equal(seen.request.maxDepth, 2);
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
    tools: { schemas: () => [{ name: 'read' }, { name: 'grep' }, { name: 'edit' }, { name: 'send_message' }],
      restrict: (filter) => { child.filter = filter; } },
    systemPrompt: { getSectionOrder: () => 110, section: (definition) => { child.persona = definition; } },
  } };
  installChildPolicy(child, p);
  assert.equal(child.persona.name, 'deployment:persona-prefix');
  assert.equal(child.persona.text, p.developer_instruction);
  assert.deepEqual(child.filter.allow, ['read', 'grep', 'send_message']);
  assert.deepEqual(p.tool_whitelist, ['read', 'grep'], 'effective protection must not mutate persisted profile identity');
});

test('whitelist protection preserves messaging without registering structured output eagerly', () => {
  for (const tool_whitelist of [[], ['read'], ['send_message'], ['structured_output']]) {
    for (const hasStructuredOutput of [false, true]) {
      const profile = validateProfile('protected', { provider: p.provider, model: p.model,
        reasoning_effort: p.reasoning_effort, tool_whitelist });
      const child = { ctx: { tools: {
        schemas: () => ['read', 'send_message', ...(hasStructuredOutput ? ['structured_output'] : [])].map(name => ({ name })),
        restrict: filter => { child.filter = filter; },
        register: () => assert.fail('the native runtime, not this policy, owns structured_output injection'),
      } } };
      installChildPolicy(child, profile);
      assert.deepEqual(child.filter.allow, [...new Set([...tool_whitelist.filter(n => n !== 'structured_output'), 'send_message'])]);
      assert.equal(child.filter.allow.includes('structured_output'), false, 'scope-local tools must not enter inherited restrictions');
    }
  }
});

test('blacklist-only policy leaves messaging intact and never broadens other permissions', () => {
  const profile = validateProfile('denyedit', { provider: p.provider, model: p.model,
    reasoning_effort: p.reasoning_effort, tool_blacklist: ['edit'] });
  const child = { ctx: { tools: {
    schemas: () => ['send_message', 'edit'].map(name => ({ name })),
    restrict: filter => { child.filter = filter; },
  } } };
  installChildPolicy(child, profile);
  assert.deepEqual(child.filter, { deny: ['edit'] });
});

test('missing messaging in child view fails closed even without profile filters', () => {
  const profile = validateProfile('plain', { provider: p.provider, model: p.model, reasoning_effort: p.reasoning_effort });
  const child = { ctx: { tools: { schemas: () => [{ name: 'read' }] } } };
  assert.throws(() => installChildPolicy(child, profile), error => error.code === 'REQUIRED_TOOL_UNAVAILABLE');
});

test('blacklisted protected tools appear as scan diagnostics and never reach model preflight or native spawn', async () => {
  const directory = fileURLToPath(new URL('./fixtures/protected-tools/', import.meta.url));
  const scanned = scanProfiles(directory);
  assert.deepEqual([...scanned.profiles.keys()], ['reader']);
  for (const name of ['blocked-message', 'blocked-structured']) {
    const error = scanned.diagnostics.get(name);
    assert.equal(error.code, 'PROTECTED_TOOL_BLACKLIST');
    const ctx = { llm: { listProviders: () => assert.fail('invalid profile reached route preflight') },
      subagents: { startActivation: () => assert.fail('invalid profile reached native spawn') } };
    const pending = new Map();
    await assert.rejects(() => spawnProfiled({ ctx, agent, args: { profile: name, prompt: 'work' },
      load: () => scanned, pending, signal }), caught => caught === error);
    assert.equal(pending.size, 0);
  }
});

test('missing messaging in parent view blocks spawn before backend activation', async () => {
  const parent = { ctx: { tools: { schemas: () => [{ name: 'read' }, { name: 'grep' }] } } };
  const ctx = baseContext({ subagents: { startActivation: () => assert.fail('missing communication must block spawn') } });
  await assert.rejects(() => spawnProfiled({ ctx, agent: parent, args: { profile: 'explorer', prompt: 'work' },
    load, pending: new Map(), signal }), error => error.code === 'REQUIRED_TOOL_UNAVAILABLE');
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
    resolveMaxDepth: () => 2,
    startActivation: async () => { throw new Error('Active subagent limit reached'); },
  } });
  const pending = new Map();
  await assert.rejects(() => spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'work' }, load, pending, signal }),
    e => e instanceof ProfileError && e.code === 'SPAWN_FAILED' && /limit/.test(e.message));
  assert.equal(pending.size, 0);
});

test('root routing hides fork when present and restores both effects exactly once', () => {
  for (const hasFork of [false, true]) {
    const actions = [];
    const root = { ctx: { on: () => () => {}, tools: {
      get: (name, scope) => { assert.equal(name, 'subagent_fork'); assert.equal(scope, root); return hasFork ? {} : undefined; },
      register: definition => { assert.equal(definition.name, 'subagent'); actions.push('register'); return () => actions.push('unregister'); },
      restrict: filter => { assert.deepEqual(filter, { deny: ['subagent_fork'] }); actions.push('restrict'); return () => actions.push('unrestrict'); },
    } } };
    const dispose = installRootRouting(root, { name: 'subagent' });
    dispose();
    dispose();
    assert.deepEqual(actions, hasFork ? ['register', 'restrict', 'unrestrict', 'unregister'] : ['register', 'unregister']);
  }
});

test('failed root restriction rolls back registration without removing another owner', () => {
  let released = 0;
  const collision = new Error('scope-local fork is not restrictable');
  assert.throws(() => installRootRouting({ ctx: { tools: {
    register: () => () => released++, get: () => ({}), restrict: () => { throw collision; },
  } } }, { name: 'subagent' }), error => error === collision);
  assert.equal(released, 1);
});

test('host depth cap and native rejection are preserved; cwd stays in request', async () => {
  for (const cap of [undefined, 0, 3]) {
    const ctx = baseContext();
    ctx.subagents.resolveMaxDepth = () => cap;
    ctx.subagents.startActivation = async spec => {
      assert.equal(spec.request.cwd, '/workspace/child');
      assert.equal(Object.hasOwn(spec.request, 'maxDepth'), cap !== undefined);
      assert.equal(spec.request.maxDepth, cap);
      if (cap === 0) throw Object.assign(new Error('Maximum subagent depth reached'), { code: 'MAX_DEPTH' });
      return { childId: spec.childId };
    };
    const pending = new Map();
    const run = () => spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'work', cwd: '/workspace/child' }, load, pending, signal });
    if (cap === 0) await assert.rejects(run, error => error.code === 'SPAWN_FAILED' && /MAX_DEPTH/.test(error.message));
    else assert.equal((await run()).kind, 'activation');
    assert.equal(pending.size, 0);
  }
});
