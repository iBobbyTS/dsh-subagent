import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scanProfiles } from '../lib/profile-store.js';
import { validateProfile } from '../lib/profile-core.js';
import { installChildPolicy } from '../lib/profile-runtime.js';
import { sourceRuntime } from './source-runtime.mjs';

const root = process.env.DSH_TEST_SOURCE_ROOT;
test('current source preserves protected tools, catalog diagnostics and native structured capture', { skip: !root }, async t => {
  const runtime = sourceRuntime(root);
  const { Context } = await runtime.load('@deepseek-ai/cordis');
  const { default: Prompt } = await runtime.load('@deepseek-ai/dsh-system-prompt');
  const { default: Tools, defineTool } = await runtime.load('@deepseek-ai/dsh-tools');
  const executor = await runtime.load('@deepseek-ai/dsh-tool-executor-native');
  const { createScope } = await runtime.load('@deepseek-ai/dsh-scope');
  const { executeModelToolFixture } = await runtime.load('@deepseek-ai/dsh-tool-testkit');
  const { attachStructuredRuntime } = await runtime.file('packages/subagent/subagent/src/structured.ts');
  const catalog = await import('../lib/index.js');
  const ctx = new Context();
  try {
    await ctx.plugin(Prompt);
    await ctx.plugin(Tools);
    await ctx.plugin(executor);
    const owner = ctx.inject(['tools', 'systemPrompt'], () => {});
    await owner;
    const testCtx = owner.ctx;
    for (const name of ['read', 'edit', 'send_message']) testCtx.tools.register(defineTool({
      name, description: `Capability fixture ${name}`, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => name,
    }));
    await t.test('discovery lists descriptions without enforcing spawn-time tool policies', async () => {
      const directory = fileURLToPath(new URL('./fixtures/protected-tools/', import.meta.url));
      const { listProfiles } = await import('../lib/profile-store.js');
      const state = listProfiles(directory);
      for (const name of ['reader', 'blocked-message', 'blocked-structured']) assert.ok(state.profiles.has(name));
      assert.equal(state.diagnostics.size, 0);
    });
    const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
    for (const timing of ['before', 'after']) {
      for (const whitelist of [[], ['read'], ['structured_output'], ['read', 'send_message', 'structured_output']]) {
        await t.test(`structured injection ${timing}, whitelist ${JSON.stringify(whitelist)}`, async () => {
          const child = { id: randomUUID() };
          const scope = createScope(testCtx, child);
          child.ctx = scope.ctx;
          const sibling = { id: randomUUID() };
          const siblingScope = createScope(testCtx, sibling);
          try {
            const profile = validateProfile('protected', { provider: 'test', model: 'test', reasoning_effort: 'high', tool_whitelist: whitelist });
            let structured;
            if (timing === 'before') structured = attachStructuredRuntime(child.ctx, schema, () => true);
            installChildPolicy(child, profile);
            if (timing === 'after') {
              assert.equal(testCtx.tools.get('structured_output', child), undefined);
              structured = attachStructuredRuntime(child.ctx, schema, () => true);
            }
            assert.ok(testCtx.tools.get('send_message', child));
            assert.equal(testCtx.tools.get('edit', child), undefined);
            assert.equal(testCtx.tools.get('read', child) !== undefined, whitelist.includes('read'));
            assert.equal(testCtx.tools.schemas(child).filter(tool => tool.name === 'structured_output').length, 1);
            assert.equal(testCtx.tools.get('structured_output', sibling), undefined);
            assert.ok(testCtx.tools.get('edit', sibling));
            const call = (name, args) => executeModelToolFixture(child.ctx, { callId: randomUUID(), name,
              arguments: args, agent: child, signal: new AbortController().signal });
            assert.equal((await call('send_message', {})).value, 'send_message');
            assert.equal((await call('edit', {})).isError, true);
            const output = await call('structured_output', { answer: 'done' });
            assert.equal(output.isError, false);
            assert.deepEqual(structured.captured(), { value: { answer: 'done' } });
            assert.equal(output.concludesTurn, true);
          } finally {
            await siblingScope.dispose();
            await scope.dispose();
          }
          assert.equal(testCtx.tools.get('structured_output', child), undefined);
        });
      }
    }
  } finally {
    await ctx.fiber.dispose();
    runtime.dispose();
  }
});
