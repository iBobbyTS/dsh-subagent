import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { scanProfiles } from '../profile-store.js';
import { randomUUID } from 'node:crypto';
import { validateProfile } from '../profile-core.js';
import { installChildPolicy } from '../profile-runtime.js';

// Opt-in distribution test: use the exact installed DSH runtime, not a second
// copy of its registries. The private structured helper is only a test probe;
// production code neither imports it nor owns its tool registration.
const anchor = process.env.DSH_TEST_RUNTIME_ANCHOR;
test('protected blacklist errors are visible in the model-facing profile catalog', { skip: !anchor }, async () => {
  const runtime = createRequire(anchor);
  const peers = new Map(['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-home-paths']
    .map(name => [name, pathToFileURL(runtime.resolve(name)).href]));
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(peers.get(specifier) ?? specifier, context);
  } });
  let catalog;
  try { catalog = await import('../index.js'); }
  finally { hook.deregister(); }
  const directory = fileURLToPath(new URL('./fixtures/protected-tools/', import.meta.url));
  const state = await catalog.validatedCatalog({
    tools: { schemas: () => ['read', 'send_message'].map(name => ({ name })) },
    llm: { listProviders: () => [{ id: 'openai-codex' }], resolveCallConfig: async () => ({}) },
  }, {}, () => scanProfiles(directory));
  assert.deepEqual([...state.profiles.keys()], ['reader']);
  const text = catalog.profileCatalogText(state);
  assert.match(text, /Skipped profiles/);
  for (const name of ['blocked-message', 'blocked-structured']) {
    assert.equal(state.diagnostics.get(name).code, 'PROTECTED_TOOL_BLACKLIST');
    assert.ok(text.includes(`${name}: [PROTECTED_TOOL_BLACKLIST]`));
  }
});

test('native tool registry preserves messaging and runtime-injected structured output across whitelist restrictions', { skip: !anchor }, async () => {
  const runtime = createRequire(anchor);
  const load = name => import(pathToFileURL(runtime.resolve(name)).href);
  const { Context, Service } = await load('@deepseek-ai/cordis');
  const { default: Tools, defineTool } = await load('@deepseek-ai/dsh-tools');
  const { createScope } = await load('@deepseek-ai/dsh-scope');
  const { attachStructuredRuntime } = await import(pathToFileURL(join(
    dirname(runtime.resolve('@deepseek-ai/dsh-subagent/package.json')), 'lib/types/structured.js',
  )).href);

  class PromptFixture extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt'); }
    tools() { return () => {}; }
    section() { return () => {}; }
    getSectionOrder() { return 100; }
  }
  const ctx = new Context();
  const prompt = ctx.plugin(PromptFixture);
  await prompt;
  const tools = ctx.plugin(Tools, { mode: 'native' });
  await tools;
  const owner = ctx.inject(['tools', 'systemPrompt'], () => {});
  await owner;
  const testCtx = owner.ctx;
  const unregister = [];
  try {
    for (const name of ['read', 'edit', 'send_message']) unregister.push(testCtx.tools.register(defineTool({
      name, description: `Native registry fixture ${name}`, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => name,
    })));
    const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
    for (const timing of ['before', 'after']) {
      for (const whitelist of [[], ['read'], ['structured_output'], ['read', 'send_message', 'structured_output']]) {
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
            assert.equal(testCtx.tools.get('structured_output', child), undefined, 'policy must not inject output eagerly');
            structured = attachStructuredRuntime(child.ctx, schema, () => true);
          }
          assert.ok(testCtx.tools.get('send_message', child));
          assert.equal(testCtx.tools.get('edit', child), undefined);
          assert.equal(testCtx.tools.get('read', child) !== undefined, whitelist.includes('read'));
          assert.equal(testCtx.tools.schemas(child).filter(t => t.name === 'structured_output').length, 1);
          assert.equal(testCtx.tools.get('structured_output', sibling), undefined);
          assert.ok(testCtx.tools.get('edit', sibling), 'restrictions must not leak to other scopes');
          const call = (name, args) => child.ctx.tools.execute({ callId: randomUUID(), name,
            arguments: args, agent: child, signal: new AbortController().signal });
          const message = await call('send_message', {});
          assert.equal(message.isError, false);
          assert.equal(message.value, 'send_message');
          const denied = await call('edit', {});
          assert.equal(denied.isError, true);
          const output = await call('structured_output', { answer: 'done' });
          assert.equal(output.isError, false);
          assert.deepEqual(structured.captured(), { value: { answer: 'done' } });
          assert.equal(output.concludesTurn, true);
        } finally {
          await siblingScope.dispose();
          await scope.dispose();
        }
        assert.equal(testCtx.tools.get('structured_output', child), undefined, 'native output must disappear with its child scope');
      }
    }
  } finally {
    for (const dispose of unregister.reverse()) dispose();
    await owner.dispose();
    await tools.dispose();
    await prompt.dispose();
  }
});
