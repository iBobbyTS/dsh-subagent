import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, ProfileError, profileLabel } from '../lib/profile-core.js';
import { spawnProfiled, installChildPolicy, installRootRouting, profileIdentityFromSession, profilePolicy, ensureChildPolicy } from '../lib/profile-runtime.js';
import { memoryPolicies } from './policy-fixture.mjs';

const p = validateProfile('explorer', { provider: 'fixture', model: 'model', reasoning_effort: 'high',
  description: 'Explore', developer_instruction: 'Explore only.', tool_whitelist: ['read', 'grep'] });
const signal = new AbortController().signal;
const agent = { id: 'parent', ctx: { tools: { schemas: () => ['read', 'grep', 'edit', 'send_message'].map(name => ({ name })) } } };
function context(start = async spec => ({ childId: spec.childId })) {
  const listeners = new Set();
  return { listeners, root: { on: (_event, handler) => { listeners.add(handler); return () => listeners.delete(handler); } },
    logger: { warn() {} }, llm: { listProviders: () => [{ id: 'fixture' }], resolveCallConfig: async () => ({}) },
    subagents: { getProvider: () => ({ inheritsParentContext: false, capabilities: { agentOptions: true }, prepareContinuable() {} }),
      resolveMaxDepth: () => 2, startActivation: start } };
}

 test('each spawn reads its selected profile and saves only immutable child policy', async () => {
  const { store, records } = memoryPolicies();
  let seen;
  const ctx = context(async spec => {
    seen = spec;
    assert.deepEqual(store.restore(spec.childId), profilePolicy(p));
    return { childId: spec.childId };
  });
  let reads = 0;
  const read = name => { assert.equal(name, 'explorer'); reads++; return p; };
  const result = await spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'Trace auth', cwd: '/workspace' }, read, store, signal });
  assert.equal(result.subagentId, seen.childId);
  assert.equal(seen.request.parent, agent);
  assert.equal(seen.parent, undefined);
  assert.equal(seen.request.maxDepth, 2);
  assert.deepEqual(seen.request.agentOptions, { provider: 'fixture', model: 'model', reasoningEffort: 'high' });
  assert.equal(seen.label, '[dsh-profile:explorer] Trace auth');
  assert.equal(ctx.listeners.size, 0);
  assert.equal(records.size, 1);
  await spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'Again' }, read, store, signal });
  assert.equal(reads, 2);
});

test('failed activation keeps its cause and releases its snapshot and initializer', async () => {
  const { store, records } = memoryPolicies();
  const ctx = context(async () => { throw Object.assign(new Error('depth exceeded'), { code: 'MAX_DEPTH' }); });
  await assert.rejects(() => spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'work' }, read: () => p, store, signal }),
    error => error.code === 'SPAWN_FAILED' && error.cause.code === 'MAX_DEPTH' && error.message.includes('MAX_DEPTH'));
  assert.equal(records.size, 0);
  assert.equal(ctx.listeners.size, 0);
});

test('bad profiles and unavailable messaging never reach activation', async () => {
  const { store } = memoryPolicies();
  const ctx = context(() => assert.fail('must not start'));
  const read = name => { throw new ProfileError('PROFILE_NOT_FOUND', name); };
  for (const args of [{ prompt: 'work' }, { profile: 'missing', prompt: 'work' }]) {
    await assert.rejects(() => spawnProfiled({ ctx, agent, args, read, store, signal }), error => ['PROFILE_REQUIRED', 'PROFILE_NOT_FOUND'].includes(error.code));
  }
  await assert.rejects(() => spawnProfiled({ ctx, agent: { ctx: { tools: { schemas: () => [] } } },
    args: { profile: 'explorer', prompt: 'work' }, read: () => p, store, signal }), error => error.code === 'REQUIRED_TOOL_UNAVAILABLE');
});

test('depth configuration uses the native resolver including provider-managed and zero', async () => {
  for (const limit of [undefined, 0, 3, 'provider-managed']) {
    const ctx = context(async spec => {
      const cap = limit === 'provider-managed' ? undefined : limit;
      assert.equal(spec.request.maxDepth, cap);
      assert.equal(Object.hasOwn(spec.request, 'maxDepth'), cap !== undefined);
      return { childId: spec.childId };
    });
    ctx.subagents.resolveMaxDepth = configured => { assert.equal(configured, limit); return configured === 'provider-managed' ? undefined : configured; };
    await spawnProfiled({ ctx, agent, args: { profile: 'explorer', prompt: 'work' }, read: () => p, store: memoryPolicies().store, signal, maxDepth: limit });
  }
});

test('identity reads only the own descriptor, not an inherited ancestor', () => {
  const events = [{ type: 'subagent/descriptor', data: { label: profileLabel(p, 'Ancestor') } },
    { type: 'session/end-seed' }, { type: 'subagent/descriptor', data: { label: 'Unrelated native child' } }];
  const session = { header: { origin: 'subagent' }, inheritedEventCount: 1, snapshotEvents: from => events.slice(from) };
  assert.equal(profileIdentityFromSession(session), undefined);
  events[2].data.label = profileLabel(p, 'Own');
  assert.deepEqual(profileIdentityFromSession(session), { name: p.name });
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
  assert.deepEqual(child.filter.allow, ['grep', 'read', 'send_message']);
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
      assert.deepEqual(child.filter.allow, [...new Set([...tool_whitelist.filter(n => n !== 'structured_output'), 'send_message'])].sort());
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

test('policy initialization is child-owned and happens only once', () => {
  let installs = 0;
  const child = { ctx: { tools: { schemas: () => [{ name: 'send_message' }], restrict: () => installs++ } } };
  const policy = { name: 'role', tool_whitelist: [] };
  ensureChildPolicy(child, policy);
  ensureChildPolicy(child, { name: 'different', tool_whitelist: ['read'] });
  assert.equal(installs, 1);
});

test('root masks fork and model discovery independently, restores exactly once', () => {
  const actions = [];
  const root = { ctx: { on: () => () => {}, tools: {
    get: name => ['subagent_fork', 'list_subagent_models'].includes(name) ? {} : undefined,
    register: definition => { actions.push('register:' + definition.name); return () => actions.push('remove:' + definition.name); },
    restrict: filter => { actions.push('deny:' + filter.deny[0]); return () => actions.push('allow:' + filter.deny[0]); },
  } } };
  const dispose = installRootRouting(root, { name: 'subagent' }, { name: 'list_subagent_profiles' });
  dispose(); dispose();
  assert.deepEqual(actions, ['register:subagent', 'register:list_subagent_profiles', 'deny:subagent_fork', 'deny:list_subagent_models',
    'allow:list_subagent_models', 'allow:subagent_fork', 'remove:list_subagent_profiles', 'remove:subagent']);
});

test('partial root setup failure rolls back without changing ancestor tools', () => {
  let released = 0;
  const error = new Error('scope collision');
  assert.throws(() => installRootRouting({ ctx: { tools: { register: () => () => released++, get: () => ({}), restrict: () => { throw error; } } } },
    { name: 'subagent' }), caught => caught === error);
  assert.equal(released, 1);
});
