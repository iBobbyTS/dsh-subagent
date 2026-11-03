/**
 * Named TOML subagent profiles layered over DSH's official Spawn/activation runtime.
 * The plugin owns only model-facing routing and child-scoped policy; it does not
 * replace the native subagent provider, history, messaging, or completion flow.
 */
import { watch } from 'node:fs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ProfileError, assertModelRoute, assertToolNames } from './profile-core.js';
import { ensureProfileDirectory, scanProfiles } from './profile-store.js';
import { installChildPolicy, resolveChildProfile, spawnProfiled } from './profile-runtime.js';

export const name = 'dsh-subagent';
export const inject = ['agents', 'subagents', 'tools', 'systemPrompt', 'llm'];

const CHILD_POLICY_MARKER = Symbol.for('dsh-subagent.profile-policy.v1');

const TOOL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true, const: 'activation' },
      subagentId: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: `started subagent ${value.subagentId}` }],
};

export function profileCatalogText(state) {
  const rows = [...state.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  const problems = [...state.diagnostics.entries()].sort(([a], [b]) => a.localeCompare(b));
  const catalog = rows.length
    ? rows.map(p => `- ${p.name}: ${p.description?.trim() || p.name}`).join('\n')
    : '(no valid profiles available)';
  const failures = problems.length ? '\nSkipped profiles (configuration/runtime errors):\n'
    + problems.map(([name, error]) => `- ${name}: ${error.message}`).join('\n') : '';
  return `Named subagent profiles for the \`subagent\` tool:\n${catalog}${failures}\n`
    + 'Call subagent with a required profile and complete standalone prompt. '
    + 'The child works independently, and its result arrives through DSH completion notification. '
    + 'The profile descriptions above describe responsibilities, not developer instructions.';
}

export function profileTool({ ctx, load, pending }) {
  return defineTool({
    name: 'subagent',
    description: 'Spawn a separate, continuable DSH subagent using a required named TOML profile. '
      + 'The profile fixes the provider, model, reasoning effort and child instructions. '
      + 'The call returns the child id immediately; DSH notifies the parent when it finishes.',
    parameters: {
      profile: { type: 'string', required: true, description: 'Required profile id, from the named profile catalog.' },
      prompt: { type: 'string', required: true, description: 'Complete self-contained task. The child has no parent conversation history.' },
      description: { type: 'string', description: 'Optional short, human-readable task label (not the profile description).' },
      cwd: { type: 'string', description: 'Optional initial child working directory.' },
    },
    output: TOOL_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new ProfileError('PARENT_REQUIRED', 'subagent must be called by a live parent Agent');
      return spawnProfiled({ ctx, agent: exec.agent, args, load, pending, signal: exec.signal });
    },
  });
}

/** A profile is eligible for this parent only if native route/tool checks pass. */
export async function validatedCatalog(ctx, agent, load, signal) {
  const { profiles: parsed, diagnostics } = load();
  const profiles = new Map();
  const toolNames = ctx.tools.schemas(agent).map(tool => tool.name);
  for (const [name, profile] of parsed) {
    try {
      assertToolNames(profile, toolNames);
      await assertModelRoute(ctx.llm, profile, signal);
      profiles.set(name, profile);
    } catch (error) {
      diagnostics.set(name, error instanceof ProfileError ? error
        : new ProfileError('PROFILE_VALIDATION_FAILED', `${name}: ${error?.message ?? String(error)}`));
    }
  }
  return { profiles, diagnostics };
}

/** Load once per DSH composition; tool registrations shadow only root Agent scopes. */
export function apply(ctx) {
  const directory = dshHomePath('agents');
  ensureProfileDirectory(directory);
  const load = () => scanProfiles(directory);
  const pending = new Map();
  const roots = new Map();
  let unloading = false;
  let watcher;
  let refreshTimer;

  const refresh = async (agent) => {
    const slot = roots.get(agent);
    if (!slot || unloading) return;
    const revision = ++slot.revision;
    try {
      const next = await validatedCatalog(ctx, agent, load);
      if (unloading || !roots.has(agent) || slot.revision !== revision) return;
      slot.state = next;
      for (const [key, diagnostic] of next.diagnostics) {
        ctx.logger.warn(`dsh-subagent: skipped ${key}: ${diagnostic.message}`);
      }
    } catch (error) {
      if (!unloading && roots.has(agent) && slot.revision === revision) {
        slot.state = { profiles: new Map(), diagnostics: new Map([
          ['<directory>', error instanceof ProfileError ? error
            : new ProfileError('PROFILE_DIRECTORY_UNAVAILABLE', error?.message ?? String(error))],
        ]) };
      }
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      for (const agent of roots.keys()) void refresh(agent);
    }, 100);
    refreshTimer.unref?.();
  };

  const attachRoot = (agent) => {
    if (roots.has(agent) || unloading) return;
    const slot = { revision: 0, state: { profiles: new Map(), diagnostics: new Map() } };
    const disposers = [];
    try {
      // Exact Agent scope shadows the native subagent tool registered by standard/PTC presets.
      disposers.push(agent.ctx.tools.register(profileTool({ ctx, load, pending })));
      disposers.push(agent.ctx.systemPrompt.section({
        name: 'dsh-subagent:profiles',
        order: (agent.ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') ?? 116) + 0.1,
        text: () => profileCatalogText(slot.state),
      }));
      slot.dispose = () => {
        for (const dispose of disposers.reverse()) dispose();
      };
      roots.set(agent, slot);
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      throw error;
    }
  };

  const detachRoot = (agent) => {
    const slot = roots.get(agent);
    if (!slot) return;
    roots.delete(agent);
    slot.dispose();
  };

  const attachChild = (agent) => {
    if (agent[CHILD_POLICY_MARKER]) return;
    const profile = resolveChildProfile(agent.session, pending, load);
    if (!profile) return;
    installChildPolicy(agent, profile);
    agent[CHILD_POLICY_MARKER] = true;
  };

  // Handler is awaited by DSH AgentLoop before a newly created child runs its first turn.
  ctx.on('agent/created', async ({ agent }) => {
    if (ctx.agents.roots().includes(agent)) {
      attachRoot(agent);
      await refresh(agent);
    } else {
      attachChild(agent);
    }
  });
  ctx.on('agent/disposed', ({ agent }) => { detachRoot(agent); });
  ctx.on('llm/adapters-updated', scheduleRefresh);
  ctx.on('llm/models-updated', scheduleRefresh);

  for (const agent of ctx.agents.list()) {
    if (ctx.agents.roots().includes(agent)) {
      attachRoot(agent);
      void refresh(agent);
    } else attachChild(agent);
  }
  try {
    watcher = watch(directory, { persistent: false }, scheduleRefresh);
    watcher.on('error', (error) => ctx.logger.warn(`dsh-subagent: profile watcher: ${error.message}`));
  } catch (error) {
    ctx.logger.warn(`dsh-subagent: unable to watch ${directory}: ${error.message}; new profile changes are still read at spawn time`);
  }

  ctx.effect(() => () => {
    unloading = true;
    watcher?.close();
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    for (const agent of [...roots.keys()]) detachRoot(agent);
    pending.clear();
    // Child-scoped policies remain owned by each child Agent until its own disposal;
    // unloading the router must never widen an already running child's permissions.
  }, 'dsh-subagent:root-scoped-router');
}
