import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const CLIENT_RUNTIME = '@deepseek-ai/dsh-client-runtime/client'

/** Minimal snapshot-store double mirroring the client-runtime contract. */
function createSnapshotStoreDouble(initial) {
  let value = initial
  const hook = selector => selector(value)
  hook.update = update => update(value)
  hook.set = next => { value = next }
  hook.getSnapshot = () => value
  return hook
}

/** Keep the section on the same card and control tokens as other Settings surfaces. */
test('uses the Settings card and field visual language', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bstyle\s*:/)
  assert.match(source, /background: var\(--dsw-alias-bg-layer-3\)/)
  assert.match(source, /border: 1px solid var\(--dsw-alias-border-l2\)/)
  assert.match(source, /border-radius: 12px/)
  assert.match(source, /height: 34px/)
  assert.match(source, /dsh-subagents__actions/)
})

/** Render the specialized settings card against live-shaped catalog data. */
test('renders explicit follow and custom model and reasoning controls', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  let forcedBooleans = []
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [typeof value === 'boolean' && forcedBooleans.length > 0 ? forcedBooleans.shift() : value, () => {}]
    },
    useEffect() {},
  }
  function textOf(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join(' ')
    if (typeof node.type === 'function') return textOf(node.type(node.props))
    return textOf(node.props?.children)
  }
  function elementsOf(node, result = []) {
    if (node === null || node === undefined || typeof node === 'boolean'
      || typeof node === 'string' || typeof node === 'number') return result
    if (Array.isArray(node)) {
      for (const child of node) elementsOf(child, result)
      return result
    }
    const rendered = typeof node.type === 'function' ? node.type(node.props) : node
    if (rendered !== node) return elementsOf(rendered, result)
    result.push(node)
    elementsOf(node.props?.children, result)
    return result
  }
  const registrations = []
  const window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  runInNewContext(source, { window, Symbol })

  const createSnapshotStore = createSnapshotStoreDouble

  const plugin = registrations[0].factory(specifier => {
    if (specifier === 'react') return React
    if (specifier === CLIENT_RUNTIME) return { createSnapshotStore }
    throw new Error(`unexpected require: ${specifier}`)
  })
  let component
  let injected
  const slotNames = []
  let sectionOptions
  const ctx = {
    connection: { api: { llm: { models: async () => ({ result: { ok: true, value: { groups: [] } } }) } } },
    locale: {
      bind: namespace => {
        assert.equal(namespace, 'settings.subagent')
        return key => ({ nav: '子代理' })[key]
      },
      register: () => () => {},
    },
    settingsScope: { bind: () => ({ getSnapshot: () => ({ status: 'ready', writable: true, value: { profiles: [] } }) }) },
    remote: { $on: () => () => {} },
    on: () => () => {},
    effect: callback => callback(),
    slots: {
      inject: (name, callback) => {
        slotNames.push(name)
        return callback()
      },
      register: (options, registered) => {
        component = registered
        sectionOptions = options
        injected = options.inject()
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(typeof component, 'function')
  assert.deepEqual(slotNames, ['settings.section'])
  assert.equal(sectionOptions.name, 'settings.section')
  assert.equal(sectionOptions.id, 'subagents')
  assert.equal(sectionOptions.order, 30)
  assert.equal(sectionOptions.locale, 'settings.subagent')
  assert.equal(sectionOptions.label(), '子代理')
  assert.equal(typeof injected.saveDefault, 'function')

  const profiles = [{
    name: 'reviewer',
    description: 'Review changes.',
    backend: 'fork',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'custom', effort: 'high' },
  }]
  const catalog = [{
    id: 'openai-codex',
    name: 'OpenAI Codex',
    models: [{
      id: 'gpt-5.6-luna',
      name: 'GPT 5.6 Luna',
      reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
    }],
  }]
  const markup = textOf(component({
    useSettings: selector => selector({ status: 'ready', writable: true, value: { profiles } }),
    useCatalog: selector => selector({ status: 'ready', groups: catalog, error: undefined }),
    save: async () => {},
    remove: async () => {},
  }))
  assert.match(markup, /默认子代理/)
  assert.match(markup, /不设置/)
  assert.match(markup, /reviewer · subagent_reviewer/)
  assert.match(markup, /未指名 Profile 的子代理请求会使用这里选中的 Profile。/)
  assert.match(markup, /模型跟随当前对话/)
  assert.match(markup, /推理强度 high/)
  assert.match(markup, /编辑/)

  forcedBooleans = [false, true, false]
  const editing = textOf(component({
    useSettings: selector => selector({ status: 'ready', writable: true, value: { profiles } }),
    useCatalog: selector => selector({ status: 'ready', groups: catalog, error: undefined }),
    save: async () => {},
    remove: async () => {},
  }))
  assert.match(editing, /模型配置/)
  assert.match(editing, /跟随当前对话/)
  assert.match(editing, /自定义 Provider 和模型/)
  assert.match(editing, /推理强度配置/)
  assert.match(editing, /自定义推理强度/)

  const staleProfiles = [{
    name: 'stale',
    description: 'Stale route.',
    backend: 'spawn',
    modelRouting: { mode: 'custom', provider: 'removed-provider', model: 'removed-model' },
    reasoning: { mode: 'custom', effort: 'removed-effort' },
  }]
  const staleProps = {
    useSettings: selector => selector({ status: 'ready', writable: true, value: { profiles: staleProfiles } }),
    useCatalog: selector => selector({ status: 'ready', groups: catalog, error: undefined }),
    save: async () => {},
    remove: async () => {},
  }
  forcedBooleans = [false, true, false]
  const staleText = textOf(component(staleProps))
  assert.match(staleText, /当前目录不可用/)
  assert.match(staleText, /请重新选择后保存/)
  forcedBooleans = [false, true, false]
  const saveButton = elementsOf(component(staleProps)).find(node => (
    node.type === 'button' && textOf(node.props.children).includes('保存')
  ))
  assert.equal(saveButton?.props.disabled, true)
  await assert.rejects(
    injected.save(staleProfiles[0]),
    /当前自定义模型或推理强度不在实时模型目录中/,
  )
})

/** The designation rides the same settings namespace writes as profile edits. */
test('writes and guards the default designation through the settings namespace', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const registrations = []
  const window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  runInNewContext(source, { window, Symbol })
  const plugin = registrations[0].factory(specifier => {
    if (specifier === 'react') return { createElement: () => ({}) }
    if (specifier === CLIENT_RUNTIME) return { createSnapshotStore: createSnapshotStoreDouble }
    throw new Error(`unexpected require: ${specifier}`)
  })

  let written
  let injected
  const ctx = {
    connection: { api: { llm: { models: async () => ({ result: { ok: true, value: { groups: [] } } }) } } },
    locale: { bind: () => () => '', register: () => () => {} },
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({
          status: 'ready',
          writable: true,
          value: {
            profiles: [{
              name: 'fast',
              backend: 'spawn',
              modelRouting: { mode: 'follow-conversation' },
              reasoning: { mode: 'follow-conversation' },
            }],
            defaultProfile: 'fast',
          },
        }),
        set: async (key, value) => { written = [key, value] },
      }),
    },
    remote: { $on: () => () => {} },
    on: () => () => {},
    effect: callback => callback(),
    slots: {
      inject: (name, callback) => callback(),
      register: (options, registered) => {
        injected = options.inject()
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  await injected.saveDefault(undefined)
  assert.deepEqual(written, ['defaultProfile', undefined])
  await injected.saveDefault('fast')
  assert.deepEqual(written, ['defaultProfile', 'fast'])
  await assert.rejects(injected.remove('fast'), /默认子代理/)
})

/** Evaluate the shipped classic bundle against the ModuleLoader handoff. */
test('registers the dsh-subagent client factory and exports its plugin namespace', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(?:import|export)\b/m)

  const registrations = []
  const window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      },
    },
  }
  runInNewContext(source, { window, Symbol })

  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  assert.equal(registration.id, 'dsh-subagent')
  assert.equal(typeof registration.factory, 'function')

  const required = []
  const react = { createElement() {} }
  const runtime = { createSnapshotStore() {} }
  const plugin = registration.factory(specifier => {
    required.push(specifier)
    if (specifier === 'react') return react
    if (specifier === CLIENT_RUNTIME) return runtime
    throw new Error(`unexpected require: ${specifier}`)
  })

  assert.deepEqual(required, ['react', CLIENT_RUNTIME])
  assert.deepEqual(Object.keys(plugin).sort(), ['apply', 'inject', 'name'])
  assert.equal(plugin.name, 'dsh-subagent-client')
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  assert.equal(typeof plugin.apply, 'function')
})
