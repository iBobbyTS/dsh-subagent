import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sourceRuntime } from './source-runtime.mjs';
const source = process.env.DSH_TEST_SOURCE_ROOT;

test('native activation and sendMessage restore retained policy after Profile removal; expiry deletes only plugin data', { skip: !source, timeout: 20000 }, async () => {
  const runtime = sourceRuntime(source);
  const { Context } = await runtime.load('@deepseek-ai/cordis');
  const prerequisites = [];
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-agent']) {
    prerequisites.push((await runtime.load(name)).default);
  }
  const NativeExecutor = await runtime.load('@deepseek-ai/dsh-tool-executor-native');
  const { default: AgentLoop } = await runtime.load('@deepseek-ai/dsh-agent-loop');
  const Persistence = await runtime.load('@deepseek-ai/dsh-session-persistence-jsonl');
  const { default: Subagents } = await runtime.load('@deepseek-ai/dsh-subagent');
  const Spawn = await runtime.load('@deepseek-ai/dsh-subagent-spawn-in-process');
  const Control = await runtime.load('@deepseek-ai/dsh-tool-subagent-control');
  const NativeTool = await runtime.load('@deepseek-ai/dsh-tool-subagent');
  const { default: Storage } = await runtime.load('@deepseek-ai/dsh-storage');
  const Json = await runtime.load('@deepseek-ai/dsh-storage-json');
  const Domain = await runtime.load('@deepseek-ai/dsh-storage-domain');
  const { TestSessionQuery } = await runtime.file('packages/subagent/subagent/tests/test-session-query.ts');
  const { mountWorkingDirectoryFixture } = await runtime.file('packages/subagent/subagent/tests/working-directory-fixture.ts');
  const { MockAdapter, textResponse } = await runtime.file('packages/core/agent-loop/tests/mock-adapter.ts');
  const { defineTool } = await runtime.load('@deepseek-ai/dsh-tools');
  const { executeModelToolFixture } = await runtime.load('@deepseek-ai/dsh-tool-testkit');
  const plugin = await import('../lib/index.js');
  const { RETENTION_MS } = await import('../lib/policy-store.js');
  const base = fileURLToPath(new URL('../.agent-work/tmp/profile-retention/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const home = mkdtempSync(join(base, 'continuation-'));
  mkdirSync(join(home, 'agents'));
  const file = join(home, 'agents', 'reader.toml');
  const config = 'provider="mock"\nmodel="child-model"\nreasoning_effort="high"\ndescription="Original reader"\ndeveloper_instruction="Retained read-only persona"\ntool_whitelist=["read"]\n';
  writeFileSync(file, config);
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const ctx = new Context();
  const errors = [];
  ctx.on('agent/error', ({ error }) => { errors.push(error.stack ?? String(error)); });
  let installed;
  try {
    for (const service of prerequisites) await ctx.plugin(service);
    await ctx.plugin(NativeExecutor);
    await mountWorkingDirectoryFixture(ctx);
    await ctx.plugin(Persistence, { root: join(home, 'sessions') });
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(TestSessionQuery);
    await ctx.plugin(Storage);
    await ctx.plugin(Json, { root: join(home, 'storage') });
    await ctx.plugin(Domain, { backend: 'json' });
    await ctx.plugin(Subagents);
    await ctx.plugin(Spawn, { providerName: 'spawn' });
    await ctx.plugin(Control);
    await ctx.plugin(NativeTool, { provider: 'spawn', modelSelection: true, modelDiscovery: true });
    for (const name of ['read', 'write']) ctx.tools.register(defineTool({ name, description: name, parameters: {},
      output: { schema: { type: 'string' }, render: (_, text) => [{ type: 'text', text }] }, execute: async () => name }));
    const adapter = new MockAdapter(Array.from({ length: 30 }, () => textResponse('done')), {
      efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high',
    });
    ctx.llm.registerAdapter(['mock'], adapter);
    installed = ctx.plugin(plugin);
    await installed;
    const parent = await ctx.agentLoop.create(randomUUID(), { provider: 'mock', model: 'parent-model' });
    const signal = new AbortController().signal;
    const call = (name, args = {}) => executeModelToolFixture(parent.ctx, { callId: randomUUID(), name, arguments: args, agent: parent, signal });
    assert.equal(ctx.tools.get('list_subagent_models', parent), undefined);
    assert.ok(ctx.tools.get('list_subagent_profiles', parent));
    const initialCatalog = (await parent.ctx.systemPrompt.assemble({ scope: parent })).sections.find(section => section.name === 'dsh-subagent:profiles').text;
    assert.match(initialCatalog, /Original reader/);
    writeFileSync(file, config.replace('Original reader', 'Fresh description'));
    assert.equal((await parent.ctx.systemPrompt.assemble({ scope: parent })).sections.find(section => section.name === 'dsh-subagent:profiles').text, initialCatalog);
    assert.match((await call('list_subagent_profiles')).value, /Fresh description/);

    const observed = [];
    // Creation listeners can run before later plugin listeners after reload.
    // Assert at the execution boundary, after all awaited initialization has completed.
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (agent.session.header.origin !== 'subagent') return next();
      assert.ok(ctx.tools.get('send_message', agent));
      assert.ok(ctx.tools.get('read', agent));
      assert.equal(ctx.tools.get('write', agent), undefined);
      const sections = (await agent.ctx.systemPrompt.assemble({ scope: agent })).sections;
      assert.equal(sections.find(section => section.name === 'deployment:persona-prefix').text, 'Retained read-only persona');
      if (!observed.includes(agent)) observed.push(agent);
      return next();
    });
    const nextEnd = () => new Promise(resolve => {
      const off = ctx.on('subagent/end', info => { off(); resolve(info); });
    });
    let ending = nextEnd();
    const started = await call('subagent', { profile: 'reader', prompt: 'First task' });
    assert.equal(started.isError, false, JSON.stringify(started));
    const id = started.value.subagentId;
    const ended = await ending;
    assert.equal(ended.id, id);
    assert.equal(ended.stopReason, 'completed', errors.join('\n') + ctx.logger.buffer.filter(message => message.level <= 1).map(message => message.args.map(value => value?.stack ?? String(value)).join(' ')).join('\n'));
    assert.ok(await ctx.sessionPersistence.stat(id), 'first activation must persist native history before any plugin reload; end=' + JSON.stringify(ended));
    assert.equal(ctx.agents.get(id), undefined, 'the first activation really released its live Agent');
    assert.equal(observed[0].options.model, 'child-model');
    await parent.whenIdle();
    // Reopen the real native domain; no cached object from the prior plugin can restore policy.
    await installed.dispose();
    unlinkSync(file);
    installed = ctx.plugin(plugin);
    await installed;
    ending = nextEnd();
    const messageId = await ctx.subagents.sendMessage(parent, id, [{ type: 'text', text: 'Continue old task' }], { signal });
    assert.equal(typeof messageId, 'string');
    assert.equal((await ending).id, id);
    assert.equal(observed.length, 2);
    assert.notEqual(observed[0], observed[1]);
    assert.equal(observed[1].options.model, 'child-model');
    assert.equal(observed[1].options.reasoningEffort, 'high');
    await parent.whenIdle();
    const table = ctx.storageDomain.get('dsh_subagent_policies').table('children');
    await table.update(id, record => ({ ...record, lastUsedAt: Date.now() - RETENTION_MS - 1 }));
    await installed.dispose();
    installed = ctx.plugin(plugin);
    await installed;
    assert.equal(ctx.storageDomain.get('dsh_subagent_policies').table('children').get(id), undefined);
    assert.ok(await ctx.sessionPersistence.stat(id), 'native history survives sidecar cleanup');
    await assert.rejects(() => ctx.subagents.sendMessage(parent, id, [{ type: 'text', text: 'Expired follow-up' }], { signal }),
      error => { const chain = []; for (let current = error; current; current = current.cause) chain.push(current.message);
        return chain.join(' ').includes('POLICY_SNAPSHOT_UNAVAILABLE'); });
    assert.equal(observed.length, 2, 'expired history must not run without its restrictions');
    assert.equal(ctx.agents.get(id), undefined);

    // Native depth rejection rolls back the pre-start sidecar without inventing a lifecycle.
    writeFileSync(file, config);
    await installed.dispose();
    installed = ctx.plugin(plugin, { maxDepth: 0 });
    await installed;
    const rejected = await call('subagent', { profile: 'reader', prompt: 'Forbidden depth' });
    assert.equal(rejected.isError, true);
    assert.equal(ctx.storageDomain.get('dsh_subagent_policies').table('children').size, 0);
    assert.equal((await ctx.subagents.listChildren(parent.id)).length, 1, 'failed startup publishes no new child');
  } finally {
    await installed?.dispose();
    await ctx.fiber.dispose();
    runtime.dispose();
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
  }
});
