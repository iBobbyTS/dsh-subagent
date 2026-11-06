import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceRuntime } from './source-runtime.mjs';

const source = process.env.DSH_TEST_SOURCE_ROOT;
test('Host plugin shadows real source delegation definitions without rewriting presets or persona', { skip: !source }, async t => {
  const runtime = sourceRuntime(source);
  const { Context, Service } = await runtime.load('@deepseek-ai/cordis');
  const { default: Prompt } = await runtime.load('@deepseek-ai/dsh-system-prompt');
  const { default: Tools, defineTool } = await runtime.load('@deepseek-ai/dsh-tools');
  const executor = await runtime.load('@deepseek-ai/dsh-tool-executor-native');
  const native = await runtime.load('@deepseek-ai/dsh-tool-subagent');
  const { createScope, scopeTarget } = await runtime.load('@deepseek-ai/dsh-scope');
  const { executeModelToolFixture } = await runtime.load('@deepseek-ai/dsh-tool-testkit');
  const plugin = await import('../lib/index.js');
  const { profileLabel, validateProfile } = await import('../lib/profile-core.js');
  const tmp = fileURLToPath(new URL('../.agent-work/tmp/native-shadowing/', import.meta.url));
  mkdirSync(tmp, { recursive: true });
  const home = mkdtempSync(join(tmp, 'runtime-'));
  mkdirSync(join(home, 'agents'));
  writeFileSync(join(home, 'agents', 'reader.toml'), 'provider="fixture"\nmodel="fixture"\nreasoning_effort="high"\ntool_whitelist=["read"]\ndeveloper_instruction="Read-only child instructions"\n');
  for (const [name, filter] of [['denyfork', 'tool_blacklist=["subagent_fork"]'], ['allowfork', 'tool_whitelist=["read","subagent_fork"]']]) {
    writeFileSync(join(home, 'agents', `${name}.toml`), `provider="fixture"\nmodel="fixture"\nreasoning_effort="high"\n${filter}\n`);
  }
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const ctx = new Context();
  const { default: Storage } = await runtime.load('@deepseek-ai/dsh-storage');
  const JsonStorage = await runtime.load('@deepseek-ai/dsh-storage-json');
  const Domain = await runtime.load('@deepseek-ai/dsh-storage-domain');
  const roots = [];
  const agents = [];
  const scopes = [];
  let accepted;
  class Agents extends Service {
    constructor(ctx) { super(ctx, 'agents'); }
    roots() { return [...roots]; }
    list() { return [...agents]; }
  }
  class Projections extends Service {
    constructor(ctx) { super(ctx, 'sessionProjections'); }
    async register() { return { stateOf: () => null }; }
  }
  class Llm extends Service {
    constructor(ctx) { super(ctx, 'llm'); }
    listProviders() { return [{ id: 'fixture' }]; }
    async resolveCallConfig() { return {}; }
  }
  const backend = { name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, depthLimit: true }, prepareContinuable: async () => ({}) };
  class Subagents extends Service {
    constructor(ctx) { super(ctx, 'subagents'); }
    getProvider(name) { return name === 'spawn' ? backend : { ...backend, name: 'fork', inheritsParentContext: true }; }
    resolveMaxDepth() { return 2; }
    async startActivation(spec) {
      assert.ok(spec.request);
      assert.ok(spec.request.parent);
      assert.equal(spec.request.maxDepth, 2);
      accepted = spec;
      return { childId: spec.childId };
    }
  }
  try {
    for (const service of [Prompt, Tools, Agents, Projections, Llm, Subagents]) await ctx.plugin(service);
    await ctx.plugin(Storage);
    await ctx.plugin(JsonStorage, { root: join(home, 'storage') });
    await ctx.plugin(Domain, { backend: 'json' });
    await ctx.plugin(executor);
    const owner = ctx.inject(['tools', 'systemPrompt', 'subagents', 'sessionProjections', 'storageDomain'], () => {});
    await owner;
    const host = owner.ctx;
    const presetKey = {};
    const preset = createScope(host, presetKey);
    scopes.push(preset);
    await preset.ctx.plugin(native, { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true });
    await preset.ctx.plugin(native, { provider: 'fork', toolName: 'subagent_fork' });
    for (const name of ['read', 'send_message', 'list_agents', 'interrupt_agent', 'workflow', 'third_party_tool']) {
      preset.ctx.tools.register(defineTool({ name, description: `Fixture ${name}`, parameters: {},
        output: { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] },
        execute: async () => name }));
    }
    preset.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: -100, text: 'Existing persona prefix' });
    preset.ctx.systemPrompt.section({ name: 'deployment:persona-suffix', order: 1000, text: 'Creator source context must survive' });
    function agent(isRoot, label, id = randomUUID()) {
      const value = { id, options: {} };
      const scope = createScope(host, value, { parent: presetKey });
      value.ctx = scope.ctx;
      value.session = { header: { id: value.id, origin: isRoot ? 'user' : 'subagent' }, snapshotEvents: () => label ? [{ type: 'subagent/descriptor', data: { label } }] : [] };
      scopes.push(scope);
      agents.push(value);
      if (isRoot) roots.push(value);
      return value;
    }
    await t.test('late inherited fork is masked without touching another Agent', async () => {
      const { installRootRouting } = await import('../lib/profile-runtime.js');
      const minimalKey = {};
      const minimal = createScope(host, minimalKey);
      scopes.push(minimal);
      const root = { id: randomUUID() };
      const rootScope = createScope(host, root, { parent: minimalKey });
      root.ctx = rootScope.ctx;
      scopes.push(rootScope);
      const replacement = defineTool({ name: 'subagent', description: 'Replacement', parameters: {},
        output: { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] }, execute: async () => 'replacement' });
      const dispose = installRootRouting(root, replacement);
      await minimal.ctx.plugin(native, { provider: 'fork', toolName: 'subagent_fork' });
      assert.equal(host.tools.get('subagent_fork', root), undefined);
      assert.ok(host.tools.get('subagent_fork', minimalKey));
      dispose();
      assert.ok(host.tools.get('subagent_fork', root));
      assert.equal(host.tools.get('subagent', root), undefined);
    });
    const existing = agent(true);
    const unrelatedChild = agent(false);
    const original = host.tools.get('subagent', existing);
    const fork = host.tools.get('subagent_fork', existing);
    const neighbors = new Map(['send_message', 'list_agents', 'interrupt_agent', 'workflow', 'third_party_tool']
      .map(name => [name, host.tools.get(name, existing)]));
    const persona = async value => (await host.systemPrompt.assemble({ scope: value })).sections
      .filter(section => section.name.startsWith('deployment:persona-'));
    const before = await persona(existing);
    for (let round = 0; round < 2; round++) {
      const installed = ctx.plugin(plugin);
      await installed;
      await t.test(`enable/unload cycle ${round + 1}`, async () => {
        assert.notEqual(host.tools.get('subagent', existing), original);
        assert.deepEqual(host.tools.schemas(existing).find(tool => tool.name === 'subagent').parameters.required, ['profile', 'prompt']);
        assert.equal(host.tools.get('subagent_fork', existing), undefined);
        assert.equal(host.tools.get('list_subagent_models', existing), undefined);
        assert.ok(host.tools.get('list_subagent_profiles', existing));
        assert.equal(host.tools.get('subagent', unrelatedChild), original);
        assert.equal(host.tools.get('subagent_fork', unrelatedChild), fork);
        assert.deepEqual(await persona(existing), before);
        for (const [name, definition] of neighbors) assert.equal(host.tools.get(name, existing), definition, name);
        const late = agent(true);
        await host.serial(scopeTarget(late, late), 'agent/created', { agent: late });
        assert.equal(host.tools.get('subagent_fork', late), undefined);
        const result = await executeModelToolFixture(existing.ctx, { callId: randomUUID(), name: 'subagent',
          arguments: { profile: 'reader', prompt: 'Inspect source', cwd: '/workspace/child' },
          agent: existing, signal: new AbortController().signal });
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.equal(result.value.subagentId, accepted.childId);
        assert.equal(accepted.request.agentOptions.model, 'fixture');
        assert.equal(accepted.request.cwd, '/workspace/child');
        assert.equal(accepted.label, '[dsh-profile:reader] Inspect source');
        // A descriptor-bearing child uses the same shared preset, not the root's
        // local fork mask. Profile policy still protects its communication tool.
        const profile = validateProfile('reader', { provider: 'fixture', model: 'fixture', reasoning_effort: 'high',
          tool_whitelist: ['read'], developer_instruction: 'Read-only child instructions' });
        const child = agent(false, accepted.label, accepted.childId);
        await host.serial(scopeTarget(child, child), 'agent/created', { agent: child });
        assert.ok(host.tools.get('send_message', child));
        assert.equal(host.tools.get('third_party_tool', child), undefined);
        assert.equal(host.tools.get('read', child) !== undefined, true);
        for (const name of ['denyfork', 'allowfork']) {
          const policy = validateProfile(name, { provider: 'fixture', model: 'fixture', reasoning_effort: 'high',
            ...(name === 'denyfork' ? { tool_blacklist: ['subagent_fork'] } : { tool_whitelist: ['read', 'subagent_fork'] }) });
          const load = () => ({ profiles: new Map([[name, policy]]), diagnostics: new Map() });
          const state = (await import('../lib/profile-store.js')).listProfiles(join(home, 'agents'));
          assert.ok(state.profiles.has(name), 'root fork hiding must not invalidate child filters');
          const started = await executeModelToolFixture(existing.ctx, { callId: randomUUID(), name: 'subagent',
            arguments: { profile: name, prompt: 'Check child fork policy' }, agent: existing, signal: new AbortController().signal });
          assert.equal(started.isError, false, JSON.stringify(started));
          const filteredChild = agent(false, accepted.label, accepted.childId);
          await host.serial(scopeTarget(filteredChild, filteredChild), 'agent/created', { agent: filteredChild });
          assert.equal(host.tools.get('subagent_fork', filteredChild) !== undefined, name === 'allowfork');
          assert.ok(host.tools.get('send_message', filteredChild));
          if (name === 'allowfork') {
            const unavailable = agent(false, profileLabel(policy, 'Unavailable fork'));
            await host.storageDomain.get('dsh_subagent_policies').table('children').put(unavailable.id, { policy, lastUsedAt: Date.now() });
            unavailable.ctx.tools.restrict({ deny: ['subagent_fork'] });
            await assert.rejects(() => host.serial(scopeTarget(unavailable, unavailable), 'agent/created', { agent: unavailable }),
              error => error.code === 'TOOL_NOT_FOUND');
            // Failed child initialization is normally disposed by AgentLoop.
            await scopes.find(scope => scope.ctx === unavailable.ctx).dispose();
            agents.splice(agents.indexOf(unavailable), 1);
          }
        }
        // Agent disposal can precede plugin unload. Exact disposers must remain
        // safe and must not unregister the ancestor's native definitions.
        const transient = agent(true);
        await host.serial(scopeTarget(transient, transient), 'agent/created', { agent: transient });
        await scopes.find(scope => scope.ctx === transient.ctx).dispose();
        roots.splice(roots.indexOf(transient), 1);
        agents.splice(agents.indexOf(transient), 1);
        host.emit(scopeTarget(transient, transient), 'agent/disposed', { agent: transient });
        assert.equal(host.tools.get('subagent', transient), original);
        assert.equal(host.tools.get('subagent_fork', transient), fork);
        await installed.dispose();
        assert.equal(host.tools.get('subagent', existing), original);
        assert.equal(host.tools.get('subagent_fork', existing), fork);
        assert.equal(host.tools.get('subagent', late), original);
        assert.equal(host.tools.get('subagent_fork', late), fork);
        assert.equal(host.tools.get('third_party_tool', child), undefined, 'unload must not widen a live child policy');
        assert.deepEqual(await persona(existing), before);
      });
      await installed.dispose();
    }
  } finally {
    for (const scope of scopes.reverse()) await scope.dispose();
    await ctx.fiber.dispose();
    runtime.dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
});
