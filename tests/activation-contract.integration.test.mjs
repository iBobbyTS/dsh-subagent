import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRuntime } from './source-runtime.mjs';
import { spawnProfiled } from '../profile-runtime.js';

const root = process.env.DSH_TEST_SOURCE_ROOT;
test('profiled spawn satisfies the actual release activation method', { skip: !root }, async () => {
  const runtime = sourceRuntime(root);
  try {
    const { SubagentRuntime } = await runtime.load('@deepseek-ai/dsh-subagent');
    const profile = { name: 'fixture', provider: 'fixture', model: 'model', reasoning_effort: 'high' };
    const agent = { id: 'parent', ctx: { tools: { schemas: () => [{ name: 'send_message' }] } } };
    const backend = { inheritsParentContext: false, capabilities: { agentOptions: true }, prepareContinuable() {} };
    let accepted;
    const native = {
      ctx: { get: () => ({ get: () => agent }) },
      expectProvider: () => backend,
      assertCapabilities: (_provider, request) => assert.equal(request.agentOptions.model, 'model'),
      requireManager: () => ({ startLocal: async spec => { accepted = spec; return { childId: spec.childId }; } }),
    };
    const ctx = {
      llm: { listProviders: () => [{ id: 'fixture' }], resolveCallConfig: async () => ({}) },
      subagents: { getProvider: () => backend, resolveMaxDepth: () => 2,
        startActivation: spec => SubagentRuntime.prototype.startActivation.call(native, spec) },
    };
    const result = await spawnProfiled({ ctx, agent, args: { profile: 'fixture', prompt: 'Inspect', cwd: '/tmp' },
      load: () => ({ profiles: new Map([['fixture', profile]]), diagnostics: new Map() }), pending: new Map(), signal: new AbortController().signal });
    assert.equal(result.subagentId, accepted.childId);
    assert.equal(accepted.request.parent, agent);
    assert.equal(accepted.request.cwd, '/tmp');
    assert.equal(accepted.request.prompt[0].text, 'Inspect');
  } finally { runtime.dispose(); }
});
