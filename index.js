import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as toolSubagent from '@deepseek-ai/dsh-tool-subagent'

export const name = 'dsh-subagent'
export const inject = ['settings', 'agents']

const NS = settingsNamespace('dsh-subagent')
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,23}$/

const DEFAULT_PROFILES = [
  {
    name: 'fast',
    description: 'Quick lookups, lightweight checks, short summaries.',
    backend: 'spawn',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'custom', effort: 'low' },
  },
  {
    name: 'reviewer',
    description: 'Conversation-aware review and continuation work at high effort.',
    backend: 'fork',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'custom', effort: 'high' },
  },
]

const modelRoutingSchema = z.union([
  z.object({
    mode: z.const('follow-conversation').required(),
  }),
  z.object({
    mode: z.const('custom').required(),
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
  }),
])

const reasoningSchema = z.union([
  z.object({
    mode: z.const('follow-conversation').required(),
  }),
  z.object({
    mode: z.const('custom').required(),
    effort: z.string().min(1).required(),
  }),
])

const profileSchema = z.object({
  name: z.string().pattern(PROFILE_NAME).required(),
  description: z.string().min(1),
  backend: z.string().min(1).default('spawn'),
  modelRouting: modelRoutingSchema.required(),
  reasoning: reasoningSchema.required(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  persona: z.string().min(1),
  maxDepth: z.union([
    z.natural().max(Number.MAX_SAFE_INTEGER),
    z.const('provider-managed'),
  ]),
  backgroundMode: z.union(['one-shot', 'continuable']),
  // Keep omission distinct from an explicit empty filter: tool-subagent rejects
  // an empty filter instead of silently hiding every child tool.
  toolFilter: z.object({
    allow: z.array(z.string().min(1)).default(undefined),
    deny: z.array(z.string().min(1)).default(undefined),
  }).default(undefined),
})

export const Config = z.object({
  profiles: z.array(profileSchema).default(DEFAULT_PROFILES),
})

const PROFILE_KEYS = new Set([
  'name', 'description', 'backend', 'modelRouting', 'reasoning', 'maxTokens',
  'persona', 'maxDepth', 'backgroundMode', 'toolFilter',
])
const MODEL_ROUTING_KEYS = new Set(['mode', 'provider', 'model'])
const REASONING_KEYS = new Set(['mode', 'effort'])

function assertKnownKeys(value, allowed, path) {
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown !== undefined) throw new Error(`dsh-subagent: ${path} has unknown field "${unknown}"`)
}

function assertProfiles(value) {
  if (!Array.isArray(value?.profiles)) throw new Error('dsh-subagent: profiles must be an array')
  const seen = new Set()
  for (const profile of value.profiles) {
    assertKnownKeys(profile, PROFILE_KEYS, `profile "${String(profile.name)}"`)
    assertKnownKeys(profile.modelRouting, MODEL_ROUTING_KEYS, `profile "${profile.name}" modelRouting`)
    assertKnownKeys(profile.reasoning, REASONING_KEYS, `profile "${profile.name}" reasoning`)
    if (seen.has(profile.name)) throw new Error(`dsh-subagent: duplicate profile name "${profile.name}"`)
    seen.add(profile.name)
    if (profile.modelRouting.mode === 'follow-conversation'
      && ('provider' in profile.modelRouting || 'model' in profile.modelRouting)) {
      throw new Error(`dsh-subagent: profile "${profile.name}" follow-conversation modelRouting cannot set provider or model`)
    }
    if (profile.reasoning.mode === 'follow-conversation' && 'effort' in profile.reasoning) {
      throw new Error(`dsh-subagent: profile "${profile.name}" follow-conversation reasoning cannot set effort`)
    }
    if (profile.toolFilter !== undefined
      && (profile.toolFilter.allow?.length ?? 0) === 0
      && (profile.toolFilter.deny?.length ?? 0) === 0) {
      throw new Error(`dsh-subagent: profile "${profile.name}" has an empty toolFilter`)
    }
  }
}

function childConfig(profile) {
  const agentOptions = {}
  if (profile.modelRouting.mode === 'custom') {
    agentOptions.provider = profile.modelRouting.provider
    agentOptions.model = profile.modelRouting.model
  }
  if (profile.reasoning.mode === 'custom') {
    agentOptions.reasoningEffort = profile.reasoning.effort
  }
  if (profile.maxTokens !== undefined) agentOptions.maxTokens = profile.maxTokens
  const config = {
    provider: profile.backend,
    toolName: `subagent_${profile.name}`,
    // Spawn is the continuable profile; fork keeps its inherited-context
    // delegation one-shot unless a profile explicitly selects another mode.
    backgroundMode: profile.backgroundMode
      ?? (profile.backend === 'spawn' ? 'continuable' : 'one-shot'),
  }
  if (Object.keys(agentOptions).length > 0) config.agentOptions = agentOptions
  for (const key of ['persona', 'toolFilter', 'maxDepth']) {
    if (profile[key] !== undefined) config[key] = profile[key]
  }
  return config
}

function publicProfile(profile) {
  const result = {
    name: profile.name,
    modelRouting: structuredClone(profile.modelRouting),
    reasoning: structuredClone(profile.reasoning),
  }
  for (const key of [
    'description', 'backend', 'maxTokens', 'persona', 'maxDepth',
    'backgroundMode', 'toolFilter',
  ]) {
    if (profile[key] !== undefined) result[key] = profile[key]
  }
  return result
}

function copyProfileFields(args) {
  const profile = { name: args.name }
  for (const key of [
    'description', 'backend', 'modelRouting', 'reasoning', 'maxTokens',
    'persona', 'maxDepth', 'backgroundMode', 'toolFilter',
  ]) {
    if (args[key] !== undefined) profile[key] = structuredClone(args[key])
  }
  return profile
}

function managementTool(scope) {
  return defineTool({
    name: 'custom_subagent',
    description: 'Manage named subagent profiles. Each profile exposes a separate subagent_<name> tool.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'add', 'update', 'remove', 'reload'],
      },
      name: { type: 'string' },
      description: { type: 'string' },
      backend: { type: 'string' },
      modelRouting: {
        type: 'json',
        description: 'Model policy: { mode: "follow-conversation" } or { mode: "custom", provider, model }.',
      },
      reasoning: {
        type: 'json',
        description: 'Reasoning policy: { mode: "follow-conversation" } or { mode: "custom", effort }.',
      },
      maxTokens: { type: 'number' },
      persona: { type: 'string' },
      maxDepth: {
        type: 'json',
        description: 'Non-negative integer depth limit or "provider-managed".',
      },
      backgroundMode: { type: 'string', enum: ['one-shot', 'continuable'] },
      toolFilter: { type: 'json' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const current = scope.get()
      if (args.action === 'list' || args.action === 'reload') {
        return { ok: true, profiles: current.profiles.map(publicProfile) }
      }
      if (args.action === 'remove') {
        if (typeof args.name !== 'string' || !current.profiles.some(profile => profile.name === args.name)) {
          return { ok: false, error: `profile "${String(args.name)}" does not exist` }
        }
        await scope.update({ profiles: current.profiles.filter(profile => profile.name !== args.name) })
        return { ok: true, profiles: scope.get().profiles.map(publicProfile) }
      }
      if (args.action !== 'add' && args.action !== 'update') {
        throw new Error(`unknown action "${String(args.action)}"`)
      }
      if (typeof args.name !== 'string' || !PROFILE_NAME.test(args.name)) {
        throw new Error(`profile name must match ${String(PROFILE_NAME)}`)
      }
      const existing = current.profiles.find(profile => profile.name === args.name)
      if (args.action === 'add' && existing !== undefined) {
        return { ok: false, error: `profile "${args.name}" already exists` }
      }
      const next = copyProfileFields(args)
      if (existing === undefined) {
        next.modelRouting ??= { mode: 'follow-conversation' }
        next.reasoning ??= { mode: 'follow-conversation' }
      }
      const profiles = current.profiles
        .filter(profile => profile.name !== args.name)
        .concat(existing === undefined ? next : { ...existing, ...next })
      await scope.update({ profiles })
      return { ok: true, profiles: scope.get().profiles.map(publicProfile) }
    },
  })
}

export function apply(ctx, config) {
  const settings = ctx.settings
  const scope = settings.register(NS, Config, {
    base: config,
    validate: assertProfiles,
  })
  const records = new Map()
  let stopping = false

  function attachAgent(agent) {
    if (stopping || records.has(agent) || !ctx.agents.roots().includes(agent)) return
    const fibers = new Map()
    const signatures = new Map()
    let active = true
    let tail = Promise.resolve()

    async function unmount(profileName) {
      const mounted = fibers.get(profileName)
      if (mounted === undefined) return
      fibers.delete(profileName)
      signatures.delete(profileName)
      await mounted.dispose()
    }

    async function reconcile(value) {
      if (!active) return
      const profiles = Array.isArray(value?.profiles) ? value.profiles : []
      const names = new Set(profiles.map(profile => profile.name))
      for (const profileName of [...fibers.keys()]) {
        if (!names.has(profileName)) await unmount(profileName)
      }
      for (const profile of profiles) {
        const signature = JSON.stringify(publicProfile(profile))
        if (signatures.get(profile.name) === signature) continue
        await unmount(profile.name)
        try {
          const fiber = agent.ctx.plugin(toolSubagent, childConfig(profile))
          fibers.set(profile.name, { dispose: () => fiber.dispose() })
          signatures.set(profile.name, signature)
        } catch (error) {
          ctx.logger.error(`dsh-subagent: profile "${profile.name}" failed to mount for agent ${agent.id}`)
          ctx.logger.error(error)
        }
      }
    }

    function enqueue(value) {
      const run = tail.then(() => reconcile(value))
      tail = run.catch(error => {
        ctx.logger.error(`dsh-subagent: profile synchronization failed for agent ${agent.id}`)
        ctx.logger.error(error)
      })
      return tail
    }

    const cleanup = agent.ctx.effect(() => {
      const managementFiber = agent.ctx.plugin({
        name: 'dsh-subagent-management',
        inject: ['tools'],
        apply(agentCtx) {
          agentCtx.tools.register(managementTool(scope))
        },
      })
      void enqueue(scope.get())
      return async () => {
        active = false
        await managementFiber.dispose()
        await tail
        for (const profileName of [...fibers.keys()]) await unmount(profileName)
        fibers.clear()
        signatures.clear()
        if (records.get(agent)?.cleanup === cleanup) records.delete(agent)
      }
    }, `dsh-subagent: agent ${agent.id}`)
    records.set(agent, { cleanup, sync: enqueue })
  }

  const stopSettings = scope.watch(next => {
    for (const record of records.values()) void record.sync(next)
  })

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => attachAgent(agent))
    for (const agent of ctx.agents.roots()) attachAgent(agent)
    return async () => {
      stopping = true
      stopCreated()
      stopSettings()
      const cleanups = [...records.values()].map(record => record.cleanup)
      records.clear()
      await Promise.allSettled(cleanups.map(cleanup => cleanup()))
    }
  }, 'dsh-subagent: agent-scoped profiles')
}
