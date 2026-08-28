import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

/** Reconcile runs on an async tail; give mounted-state predicates a bounded window. */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(predicate(), 'condition did not hold within the wait window')
}

function fakeProvider(name, inheritsParentContext, continuable) {
  return {
    name,
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext,
    async start() {
      return {
        id: 'fixture-run',
        localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
    ...(continuable ? {
      async prepareContinuable() {
        return { seed: [] }
      },
    } : {}),
  }
}

function fixturePlugin(createScope) {
  return {
    name: 'dsh-subagent-composition-fixture',
    apply(ctx) {
      const agent = { id: 'fixture-agent' }
      const agentScope = createScope(ctx, agent)
      agent.ctx = agentScope.ctx
      const settings = {
        documentPath: undefined,
        describe: () => [{ ns: 'dsh-subagent', user: { profiles: [] } }],
        register(_namespace, schema, options) {
          let value = schema(options?.base)
          options?.validate?.(value)
          const watchers = new Set()
          return {
            get: () => value,
            watch(callback) {
              watchers.add(callback)
              return () => watchers.delete(callback)
            },
            async update(patch) {
              const previous = value
              const candidate = schema({ ...value, ...patch })
              options?.validate?.(candidate)
              value = candidate
              await Promise.all([...watchers].map(callback => callback(value, previous)))
            },
            async replace(section) {
              const previous = value
              const candidate = schema(section)
              options?.validate?.(candidate)
              value = candidate
              await Promise.all([...watchers].map(callback => callback(value, previous)))
            },
          }
        },
      }
      const providers = {
        spawn: fakeProvider('spawn', false, true),
        fork: fakeProvider('fork', true, false),
      }
      const subagents = { getProvider: name => providers[name] }
      const sections = []
      const systemPrompt = {
        section: spec => {
          sections.push(spec)
          return () => {}
        },
        tools: () => () => {},
      }
      const agents = { roots: () => [agent] }
      ctx.provide('settings', settings)
      ctx.provide('agents', agents)
      ctx.provide('subagents', subagents)
      ctx.provide('systemPrompt', systemPrompt)
      globalThis.__dshSubagentComposition = { agent, sections }
    },
  }
}

/** Boot the installed bundle through Loader with only external services mocked. */
test('loads the bundle through a real cordis.yml and disposes Agent-scoped tools', async t => {
  let Context
  let Loader
  let Include
  let createScope
  try {
    ({ Context } = await import('@deepseek-ai/cordis'))
    ;({ default: Loader } = await import('@deepseek-ai/cordis-plugin-loader'))
    ;({ default: Include } = await import('@deepseek-ai/cordis-plugin-include'))
    ;({ createScope } = await import('@deepseek-ai/dsh-scope'))
  } catch (error) {
    t.skip(`workspace Cordis dependencies are unavailable: ${String(error)}`)
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'dsh-subagent-composition-'))
  const context = new Context()
  let observed
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: fixture',
      '  name: dsh-subagent-composition-fixture',
      '- id: tools',
      "  name: '@deepseek-ai/dsh-tools'",
      '- id: dsh-subagent',
      '  name: dsh-subagent',
      '',
    ].join('\n'))
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier) {
        if (specifier === 'dsh-subagent') return import('../index.js')
        if (specifier === '@deepseek-ai/dsh-tools') return import('@deepseek-ai/dsh-tools')
        if (specifier === 'dsh-subagent-composition-fixture') return fixturePlugin(createScope)
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    }
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    observed = globalThis.__dshSubagentComposition
    assert.ok(observed)
    const tools = context.tools
    const management = tools.get('custom_subagent', observed.agent)
    assert.ok(management)
    assert.ok(tools.get('subagent_fast', observed.agent))
    assert.ok(tools.get('subagent_reviewer', observed.agent))
    const added = await management.execute({ action: 'add', name: 'extra' }, {})
    assert.deepEqual(added.profiles.find(profile => profile.name === 'extra'), {
      name: 'extra',
      backend: 'spawn',
      modelRouting: { mode: 'follow-conversation' },
      reasoning: { mode: 'follow-conversation' },
    })
    observed.tools = tools

    // Default-profile designation: management contract plus prompt steering.
    const section = observed.sections.find(item => item.name === 'dsh-subagent:default-profile')
    assert.ok(section)
    assert.equal(section.text({}), '')
    const listed = await management.execute({ action: 'list' }, {})
    assert.equal(listed.defaultProfile, undefined)

    const chosen = await management.execute({ action: 'set-default', name: 'fast' }, {})
    assert.equal(chosen.ok, true)
    assert.equal(chosen.defaultProfile, 'fast')
    await waitFor(() => section.text({}) !== '')
    assert.match(section.text({}), /The default profile is fast \(\`subagent_fast\`/)
    assert.match(section.text({}), /use \`subagent_fast\`/)

    const ghost = await management.execute({ action: 'set-default', name: 'ghost' }, {})
    assert.equal(ghost.ok, false)
    await assert.rejects(
      management.execute({ action: 'set-default', name: 'BAD NAME' }, {}),
      /profile name must match/,
    )

    const guarded = await management.execute({ action: 'remove', name: 'fast' }, {})
    assert.equal(guarded.ok, false)
    assert.match(guarded.error, /is the default subagent/)

    const cleared = await management.execute({ action: 'set-default' }, {})
    assert.equal(cleared.ok, true)
    assert.equal(cleared.defaultProfile, undefined)
    assert.equal(section.text({}), '')
  } finally {
    delete globalThis.__dshSubagentComposition
    await context.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }

  assert.equal(observed.tools.get('custom_subagent', observed.agent), undefined)
  assert.equal(observed.tools.get('subagent_fast', observed.agent), undefined)
  assert.equal(observed.tools.get('subagent_reviewer', observed.agent), undefined)
})
