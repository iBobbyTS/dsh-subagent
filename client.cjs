window.__ModuleLoader__.load({ id: "dsh-subagent", factory: (require) => {
const React = require('react')
const clientRuntime = require('@deepseek-ai/dsh-client-runtime/client')

const createSnapshotStore = clientRuntime.createSnapshotStore ?? clientRuntime.default?.createSnapshotStore
if (typeof createSnapshotStore !== 'function') throw new Error('dsh-subagent: client runtime does not provide createSnapshotStore')
const e = React.createElement
const NS = 'dsh-subagent'
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,23}$/

const STYLE = `
.dsh-subagents { display: flex; flex-direction: column; gap: 12px; max-width: 720px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-subagents__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-subagents__title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.45; }
.dsh-subagents__help, .dsh-subagents__secondary { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.55; }
.dsh-subagents__help { margin: 4px 0 0; }
.dsh-subagents__list { display: flex; flex-direction: column; gap: 12px; }
.dsh-subagents__card { display: flex; flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); }
.dsh-subagents__card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-subagents__identity { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-subagents__name { font-size: 14px; font-weight: 600; line-height: 1.45; }
.dsh-subagents__tool { color: var(--dsw-alias-label-tertiary); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
.dsh-subagents__route { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsh-subagents__fields { display: flex; flex-direction: column; gap: 12px; }
.dsh-subagents__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-subagents__label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
.dsh-subagents__control { box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; }
.dsh-subagents__control:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-subagents__control:disabled { color: var(--dsw-alias-label-dimmed); cursor: not-allowed; }
.dsh-subagents__actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-subagents__button { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 36px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 14px; line-height: 22px; }
.dsh-subagents__button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-subagents__button--primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dsh-subagents__button--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsh-subagents__button:disabled { color: var(--dsw-alias-label-dimmed); cursor: not-allowed; opacity: .6; }
.dsh-subagents__error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.5; }
.dsh-subagents__empty { padding: 28px 16px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; color: var(--dsw-alias-label-secondary); text-align: center; }
@media (max-width: 600px) {
  .dsh-subagents__heading, .dsh-subagents__card-header { flex-direction: column; }
  .dsh-subagents__heading > .dsh-subagents__button { width: 100%; }
}
`

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function modelRoutingCopy(value) {
  if (value?.mode === 'custom') {
    return { mode: 'custom', provider: value.provider || '', model: value.model || '' }
  }
  return { mode: 'follow-conversation' }
}

function reasoningCopy(value) {
  if (value?.mode === 'custom') return { mode: 'custom', effort: value.effort || '' }
  return { mode: 'follow-conversation' }
}

function profileCopy(profile) {
  const copy = {
    name: profile.name,
    backend: profile.backend || 'spawn',
    modelRouting: modelRoutingCopy(profile.modelRouting),
    reasoning: reasoningCopy(profile.reasoning),
  }
  for (const key of [
    'description', 'maxTokens', 'persona', 'maxDepth', 'backgroundMode', 'toolFilter',
  ]) {
    if (profile[key] !== undefined && profile[key] !== '') copy[key] = profile[key]
  }
  return copy
}

function routeText(profile) {
  const route = profile.modelRouting?.mode === 'custom'
    ? `${profile.modelRouting.provider} / ${profile.modelRouting.model}`
    : '模型跟随当前对话'
  if (profile.reasoning?.mode === 'custom') return `${route} · 推理强度 ${profile.reasoning.effort}`
  return `${route} · 推理强度跟随当前对话`
}

function catalogProvider(catalog, provider) {
  return catalog.find(item => item.id === provider)
}

function catalogModel(catalog, provider, model) {
  return catalogProvider(catalog, provider)?.models?.find(item => item.id === model)
}

function catalogEfforts(catalog) {
  const efforts = new Map()
  for (const provider of catalog) {
    for (const model of provider.models || []) {
      for (const effort of model.reasoning?.efforts || []) efforts.set(effort.id, effort.name || effort.id)
    }
  }
  return [...efforts].map(([id, name]) => ({ id, name }))
}

function DraftFields({ draft, catalog, set }) {
  const modelRouting = modelRoutingCopy(draft.modelRouting)
  const reasoning = reasoningCopy(draft.reasoning)
  const provider = catalogProvider(catalog, modelRouting.provider)
  const model = catalogModel(catalog, modelRouting.provider, modelRouting.model)
  const efforts = modelRouting.mode === 'custom' && model !== undefined
    ? model.reasoning?.efforts || []
    : catalogEfforts(catalog)
  const providerOptions = catalog.map(item => e('option', { key: item.id, value: item.id },
    item.name && item.name !== item.id ? `${item.id}（${item.name}）` : item.id))
  if (modelRouting.mode === 'custom' && modelRouting.provider && provider === undefined) {
    providerOptions.unshift(e('option', { key: 'stale', value: modelRouting.provider }, `${modelRouting.provider}（当前目录不可用）`))
  }
  const modelOptions = (provider?.models || []).map(item => e('option', { key: item.id, value: item.id },
    item.name && item.name !== item.id ? `${item.id}（${item.name}）` : item.id))
  if (modelRouting.mode === 'custom' && modelRouting.model && model === undefined) {
    modelOptions.unshift(e('option', { key: 'stale', value: modelRouting.model }, `${modelRouting.model}（当前目录不可用）`))
  }
  const effortOptions = efforts.map(item => e('option', { key: item.id, value: item.id }, item.name || item.id))
  if (reasoning.mode === 'custom' && reasoning.effort
    && !efforts.some(item => item.id === reasoning.effort)) {
    effortOptions.unshift(e('option', { key: 'stale', value: reasoning.effort }, `${reasoning.effort}（当前目录不可用）`))
  }
  const customRoute = modelRouting.mode === 'custom'
  const customReasoning = reasoning.mode === 'custom'
  const valid = draftValid(draft, catalog)
  return e('div', { className: 'dsh-subagents__fields' },
    e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '描述'),
      e('input', {
        className: 'dsh-subagents__control',
        value: draft.description || '',
        placeholder: '这个子代理负责什么',
        onChange: event => set('description', event.target.value),
      })),
    e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '后端'),
      e('select', {
        className: 'dsh-subagents__control',
        value: draft.backend || 'spawn',
        onChange: event => set('backend', event.target.value),
      },
      e('option', { value: 'spawn' }, 'spawn · 独立上下文'),
      e('option', { value: 'fork' }, 'fork · 继承本对话'))),
    e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '模型配置'),
      e('select', {
        className: 'dsh-subagents__control',
        value: modelRouting.mode,
        onChange: event => set('modelRouting', event.target.value === 'custom'
          ? { mode: 'custom', provider: '', model: '' }
          : { mode: 'follow-conversation' }),
      },
      e('option', { value: 'follow-conversation' }, '跟随当前对话'),
      e('option', { value: 'custom' }, '自定义 Provider 和模型'))),
    customRoute ? e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, 'Provider'),
      e('select', {
        className: 'dsh-subagents__control',
        value: modelRouting.provider,
        'aria-invalid': modelRouting.provider === '' || provider === undefined,
        onChange: event => {
          set('modelRouting', { mode: 'custom', provider: event.target.value, model: '' })
          set('reasoning', { mode: 'follow-conversation' })
        },
      },
      e('option', { value: '' }, '选择 Provider'),
      ...providerOptions)) : null,
    customRoute ? e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '模型'),
      e('select', {
        className: 'dsh-subagents__control',
        value: modelRouting.model,
        disabled: !modelRouting.provider,
        'aria-invalid': modelRouting.provider !== '' && model === undefined,
        onChange: event => {
          set('modelRouting', { ...modelRouting, model: event.target.value })
          set('reasoning', { mode: 'follow-conversation' })
        },
      },
      e('option', { value: '' }, modelRouting.provider ? '选择模型' : '需先选择 Provider'),
      ...modelOptions)) : null,
    e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '推理强度配置'),
      e('select', {
        className: 'dsh-subagents__control',
        value: reasoning.mode,
        onChange: event => set('reasoning', event.target.value === 'custom'
          ? { mode: 'custom', effort: '' }
          : { mode: 'follow-conversation' }),
      },
      e('option', { value: 'follow-conversation' }, customRoute
        ? '自动适配自定义模型'
        : '跟随当前对话'),
      e('option', { value: 'custom' }, '自定义推理强度'))),
    customReasoning ? e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '推理强度'),
      e('select', {
        className: 'dsh-subagents__control',
        value: reasoning.effort,
        disabled: efforts.length === 0,
        'aria-invalid': !efforts.some(item => item.id === reasoning.effort),
        onChange: event => set('reasoning', { mode: 'custom', effort: event.target.value }),
      },
      e('option', { value: '' }, efforts.length > 0 ? '选择推理强度' : '当前目录没有可选强度'),
      ...effortOptions)) : null,
    !valid ? e('div', { className: 'dsh-subagents__error', role: 'alert' },
      '当前自定义模型或推理强度不在实时模型目录中，请重新选择后保存。') : null,
    e('div', { className: 'dsh-subagents__secondary', 'aria-live': 'polite' },
      customRoute
        ? '自定义路由固定使用所选 Provider 和模型。'
        : '创建子代理时解析当前对话的 Provider 和模型。',
      ' ',
      customReasoning
        ? '推理强度使用显式配置。'
        : customRoute
          ? '未显式指定强度时使用所选模型的默认设置。'
          : '推理强度跟随当前对话。'),
  )
}

function draftFrom(profile) {
  return { ...profileCopy(profile), description: profile.description || '' }
}

function draftValid(draft, catalog) {
  const route = modelRoutingCopy(draft.modelRouting)
  const reasoning = reasoningCopy(draft.reasoning)
  let model
  if (route.mode === 'custom') {
    const provider = catalogProvider(catalog, route.provider)
    model = catalogModel(catalog, route.provider, route.model)
    if (provider === undefined || model === undefined) return false
  }
  if (reasoning.mode === 'custom') {
    const efforts = model === undefined ? catalogEfforts(catalog) : model.reasoning?.efforts || []
    if (!efforts.some(item => item.id === reasoning.effort)) return false
  }
  return true
}

function ProfileCard({ profile, catalog, writable, save, remove, setError }) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(() => draftFrom(profile))
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setDraft(draftFrom(profile))
  }, [profile, editing])

  function set(key, value) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  async function commit() {
    setBusy(true)
    try {
      await save(profileCopy(draft))
      setEditing(false)
    } catch (error) {
      setError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  async function destroy() {
    setBusy(true)
    try {
      await remove(profile.name)
    } catch (error) {
      setError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return e('article', { className: 'dsh-subagents__card' },
    e('div', { className: 'dsh-subagents__card-header' },
      e('div', { className: 'dsh-subagents__identity' },
        e('div', { className: 'dsh-subagents__name' }, profile.name),
        e('div', { className: 'dsh-subagents__tool' }, `subagent_${profile.name}`)),
      e('div', { className: 'dsh-subagents__route' }, routeText(profile))),
    editing
      ? e(DraftFields, { draft, catalog, set })
      : e('div', { className: 'dsh-subagents__secondary' }, profile.description || '未填写描述'),
    e('div', { className: 'dsh-subagents__actions' },
      editing
        ? e(React.Fragment, null,
          e('button', { type: 'button', className: 'dsh-subagents__button', disabled: busy, onClick: () => setEditing(false) }, '放弃'),
          e('button', { type: 'button', className: 'dsh-subagents__button dsh-subagents__button--primary', disabled: busy || !writable || !draftValid(draft, catalog), onClick: commit }, '保存'))
        : e(React.Fragment, null,
          e('button', { type: 'button', className: 'dsh-subagents__button', disabled: busy || !writable, onClick: destroy }, '删除'),
          e('button', { type: 'button', className: 'dsh-subagents__button', disabled: busy || !writable, onClick: () => setEditing(true) }, '编辑'))))
}

function NewProfileCard({ catalog, writable, save, cancel, setError }) {
  const [name, setName] = React.useState('')
  const [draft, setDraft] = React.useState({
    backend: 'spawn',
    description: '',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'follow-conversation' },
  })
  const [busy, setBusy] = React.useState(false)

  function set(key, value) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  async function commit() {
    if (!PROFILE_NAME.test(name)) {
      setError('名称必须以小写字母开头，只能含小写字母、数字、连字符、下划线，最长 24 位')
      return
    }
    setBusy(true)
    try {
      await save({ ...profileCopy(draft), name })
      cancel()
    } catch (error) {
      setError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return e('article', { className: 'dsh-subagents__card' },
    e('div', { className: 'dsh-subagents__card-header' },
      e('div', { className: 'dsh-subagents__identity' },
        e('div', { className: 'dsh-subagents__name' }, '新建子代理'),
        e('div', { className: 'dsh-subagents__route' }, '创建一个可复用的命名委托配置。'))),
    e('label', { className: 'dsh-subagents__field' },
      e('span', { className: 'dsh-subagents__label' }, '名称'),
      e('input', {
        className: 'dsh-subagents__control',
        value: name,
        placeholder: '例如 deep-research',
        onChange: event => setName(event.target.value),
      })),
    e(DraftFields, { draft, catalog, set }),
    e('div', { className: 'dsh-subagents__actions' },
      e('button', { type: 'button', className: 'dsh-subagents__button', disabled: busy, onClick: cancel }, '取消'),
      e('button', { type: 'button', className: 'dsh-subagents__button dsh-subagents__button--primary', disabled: busy || !writable || !draftValid(draft, catalog), onClick: commit }, '添加')))
}

function SubagentSettings({ useSettings, useCatalog, save, remove }) {
  const settings = useSettings(value => value)
  const catalogState = useCatalog(value => value)
  const [error, setError] = React.useState('')
  const [adding, setAdding] = React.useState(false)

  if (settings.status === 'loading') return e('div', { className: 'dsh-subagents__secondary' }, '正在加载子代理配置…')
  if (settings.status === 'unavailable') {
    return e('div', { className: 'dsh-subagents__error' }, '当前连接不提供可写的 dsh-subagent 设置。请在本机回环页面中打开设置。')
  }
  const profiles = Array.isArray(settings.value?.profiles) ? settings.value.profiles : []
  const catalog = Array.isArray(catalogState.groups) ? catalogState.groups : []
  return e('section', { className: 'dsh-subagents', 'aria-labelledby': 'dsh-subagents-title' },
    e('style', null, STYLE),
    e('div', { className: 'dsh-subagents__heading' },
      e('div', null,
        e('h2', { className: 'dsh-subagents__title', id: 'dsh-subagents-title' }, '子代理'),
        e('p', { className: 'dsh-subagents__help' },
          '为不同任务配置可复用的委托方式、模型和推理强度。')),
      e('button', {
        type: 'button',
        className: 'dsh-subagents__button dsh-subagents__button--primary',
        disabled: adding || !settings.writable,
        onClick: () => setAdding(true),
      }, '新建子代理')),
    catalogState.error ? e('div', { className: 'dsh-subagents__error' }, catalogState.error) : null,
    error ? e('div', { className: 'dsh-subagents__error' }, error) : null,
    e('div', { className: 'dsh-subagents__list' },
      adding ? e(NewProfileCard, {
        catalog,
        writable: settings.writable,
        save,
        cancel: () => setAdding(false),
        setError,
      }) : null,
      profiles.length > 0
        ? profiles.map(profile => e(ProfileCard, {
          key: profile.name,
          profile,
          catalog,
          writable: settings.writable,
          save,
          remove,
          setError,
        }))
        : e('div', { className: 'dsh-subagents__empty' }, '还没有任何子代理 Profile。')))
}

function profileList(snapshot) {
  return Array.isArray(snapshot.value?.profiles) ? snapshot.value.profiles : []
}

const name = 'dsh-subagent-client'
const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

function apply(ctx) {
  const { api } = ctx.connection
  const settings = ctx.settingsScope.bind({ namespace: NS })
  const catalog = createSnapshotStore({ status: 'idle', groups: [], error: undefined })
  let disposed = false
  let catalogRevision = 0

  async function refreshCatalog() {
    if (disposed) return
    const revision = ++catalogRevision
    catalog.set({ status: 'loading', groups: [], error: undefined })
    try {
      const response = await api.llm.models({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (disposed || revision !== catalogRevision) return
      catalog.set({ status: 'ready', groups: response.result.value.groups || [], error: undefined })
    } catch (error) {
      if (disposed || revision !== catalogRevision) return
      catalog.set({ status: 'error', groups: [], error: messageOf(error) })
    }
  }

  async function save(profile) {
    const snapshot = settings.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) throw new Error('dsh-subagent settings are read-only')
    const catalogSnapshot = catalog.getSnapshot()
    if (!draftValid(profile, Array.isArray(catalogSnapshot.groups) ? catalogSnapshot.groups : [])) {
      throw new Error('当前自定义模型或推理强度不在实时模型目录中，请重新选择后保存。')
    }
    const next = profileList(snapshot)
      .filter(item => item.name !== profile.name)
      .concat([profileCopy(profile)])
    await settings.set('profiles', next)
  }

  async function remove(nameToRemove) {
    const snapshot = settings.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) throw new Error('dsh-subagent settings are read-only')
    const current = profileList(snapshot)
    if (!current.some(item => item.name === nameToRemove)) throw new Error(`profile "${nameToRemove}" does not exist`)
    await settings.set('profiles', current.filter(item => item.name !== nameToRemove))
  }

  ctx.effect(() => {
    const refresh = () => { void refreshCatalog() }
    const disposers = [
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    void refreshCatalog()
    return () => {
      disposed = true
      catalogRevision += 1
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-subagent: model catalog')

  ctx.effect(() => ctx.locale.register('settings.subagent', {
    zh: { nav: '子代理' },
    en: { nav: 'Subagents' },
  }), 'dsh-subagent: settings locale')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'subagents',
    order: 30,
    label: () => ctx.locale.bind('settings.subagent')('nav'),
    locale: 'settings.subagent',
    inject: () => ({
      save,
      remove,
      hooks: { settings, catalog },
    }),
  }, SubagentSettings))
}
return { name, inject, apply }
} })
