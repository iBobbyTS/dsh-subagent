import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Catalog, ProfileSummary, ReadProfile } from './profile-core.js';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ProfileError, errorDetails } from './profile-core.js';
import { ensureProfileDirectory, listProfiles, readProfile } from './profile-store.js';
import { PolicyStore, policyDomain, CLEANUP_INTERVAL_MS } from './policy-store.js';
import { ensureChildPolicy, installRootRouting, liveChildPolicy, profileIdentityFromSession, spawnProfiled } from './profile-runtime.js';

export const name = 'dsh-subagent';
export const inject = ['agents', 'subagents', 'tools', 'systemPrompt', 'llm', 'storageDomain'];
export interface Config { maxDepth?: number | 'provider-managed' }
export const Config: z<Config> = z.object({
  maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed' as const)]),
});

export function profileCatalogText(state: Catalog<ProfileSummary>) {
  const rows = [...state.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  const descriptions = rows.length ? rows.map(p => '- ' + p.name + ': ' + (p.description?.trim() || p.name)).join('\n') : '(no profiles available)';
  const diagnostics = [...state.diagnostics].sort(([a], [b]) => a.localeCompare(b));
  return 'Named subagent profiles:\n' + descriptions
    + (diagnostics.length ? '\nUnreadable profiles:\n' + diagnostics.map(([id, error]) => '- ' + id + ': ' + error.message).join('\n') : '');
}

export function profileTool({ ctx, read, store, maxDepth }: { ctx: Context; read: ReadProfile; store: PolicyStore; maxDepth?: Config['maxDepth'] }) {
  return defineTool({
    name: 'subagent',
    description: 'Delegate a standalone task to a continuable child using a named Profile. Returns its ID immediately; DSH delivers completion notifications.',
    parameters: {
      profile: { type: 'string', required: true, description: 'Profile name from the catalog; fixes the model, role and tool policy.' },
      prompt: { type: 'string', required: true, description: 'Complete self-contained task; the child has no parent conversation history.' },
      description: { type: 'string', description: 'Short, human-readable task label.' },
      cwd: { type: 'string', description: 'Initial child working directory; defaults to the parent directory.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'activation' }, subagentId: { type: 'string', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: 'started subagent ' + value.subagentId }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new ProfileError('PARENT_REQUIRED', 'subagent requires a live parent Agent');
      return spawnProfiled({ ctx, agent: exec.agent, args, read, store, signal: exec.signal, maxDepth });
    },
  });
}

export function listProfilesTool(list: () => Catalog<ProfileSummary>) {
  return defineTool({
    name: 'list_subagent_profiles', description: 'List current subagent Profile names and responsibilities from disk.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => true,
    execute: async () => profileCatalogText(list()),
  });
}

export async function apply(ctx: Context, config: Config = {}) {
  const directory = dshHomePath('agents');
  ensureProfileDirectory(directory);
  const domain = await ctx.storageDomain.open(policyDomain);
  const store = new PolicyStore(domain.table('children'));
  const roots = new Map<Agent, () => void>();
  const children = new Map<Agent, () => void>();
  let stopping = false;
  const cleanupAbort = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  // Register cleanup before attaching any scopes. Live child restrictions intentionally remain child-owned.
  ctx.effect(() => async () => {
    stopping = true;
    cleanupAbort.abort();
    if (timer) clearInterval(timer);
    for (const dispose of roots.values()) dispose();
    roots.clear();
    for (const release of children.values()) release();
    children.clear();
    try { await store.stop(); }
    finally { await domain.close(); }
  }, 'dsh-subagent:profile-routing');

  const list = () => listProfiles(directory);
  const attachRoot = (agent: Agent) => {
    if (roots.has(agent)) return;
    let catalog: Catalog<ProfileSummary>;
    try { catalog = list(); }
    catch (error) { catalog = { profiles: new Map(), diagnostics: new Map([['<directory>',
      error instanceof ProfileError ? error : new ProfileError('PROFILE_DIRECTORY_UNAVAILABLE', errorDetails(error).message)]]) }; }
    const disposeRouting = installRootRouting(agent,
      profileTool({ ctx, read: name => readProfile(directory, name), store, maxDepth: config.maxDepth }), listProfilesTool(list));
    const disposers = [disposeRouting];
    try {
      const text = profileCatalogText(catalog) + '\nIssue independent delegations together when useful. Results arrive asynchronously; if only waiting for them, end your turn instead of sleeping or polling.';
      disposers.push(agent.ctx.systemPrompt.section({ name: 'dsh-subagent:profiles',
        order: agent.ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 0.1, text }));
      disposers.push(agent.ctx.systemPrompt.context({ name: 'dsh-subagent:depth',
        order: agent.ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'), text: () => {
          const cap = ctx.subagents.resolveMaxDepth(config.maxDepth);
          return cap === undefined ? '' : 'Delegation depth: ' + delegationDepthOf(agent) + '; maximum child depth: ' + cap + '.';
        } }));
      roots.set(agent, () => { for (const dispose of disposers.reverse()) dispose(); });
    } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error; }
  };
  const attachChild = async (agent: Agent) => {
    if (children.has(agent) || !profileIdentityFromSession(agent.session)) return;
    const live = liveChildPolicy(agent);
    const policy = live ?? store.restore(agent.id);
    const release = store.pin(agent.id);
    children.set(agent, release);
    try {
      // A previously live child already owns its policy; reload never consults a changed TOML.
      if (live) await store.capture(agent.id, live);
      else await store.touch(agent.id);
      ensureChildPolicy(agent, policy);
    } catch (error) { children.delete(agent); release(); throw error; }
  };
  const touch = (agent: Agent) => {
    if (stopping || !children.has(agent)) return;
    void store.touch(agent.id).catch(error => ctx.logger.warn('dsh-subagent: activity timestamp write failed: ' + errorDetails(error).message));
  };
  ctx.on('agent/created', async ({ agent }) => {
    if (ctx.agents.roots().includes(agent)) attachRoot(agent);
    else await attachChild(agent);
  });
  ctx.on('agent/status', ({ agent }) => { touch(agent); });
  ctx.on('agent/inbox/inserted', ({ agent }) => { touch(agent); });
  ctx.on('agent/disposed', ({ agent }) => {
    roots.get(agent)?.(); roots.delete(agent);
    const release = children.get(agent);
    if (!release) return;
    children.delete(agent);
    void store.touch(agent.id).catch(error => ctx.logger.warn('dsh-subagent: final activity write failed: ' + errorDetails(error).message)).finally(release);
  });
  for (const agent of ctx.agents.list()) {
    if (ctx.agents.roots().includes(agent)) attachRoot(agent);
    else await attachChild(agent);
  }
  const sweep = () => store.sweep(async id => {
    if (ctx.agents.get(id as Agent['id'])) return true;
    const query = ctx.get('sessionQuery');
    if (!query) return true; // Cannot prove an offline inbox is empty.
    try {
      const observation = await query.observeSession(id as Agent['id'], { signal: cleanupAbort.signal });
      try {
        const inbox = observation.projections?.values.inbox;
        return !inbox || inbox['next-turn'].length > 0 || inbox['next-step'].length > 0;
      } finally { observation[Symbol.dispose](); }
    } catch (error) {
      if (errorDetails(error).code === 'SESSION_QUERY_SESSION_NOT_FOUND') return false;
      ctx.logger.warn('dsh-subagent: skipped policy cleanup for ' + id + ': ' + errorDetails(error).message);
      return true;
    }
  }).catch(error => { ctx.logger.warn('dsh-subagent: policy cleanup failed: ' + errorDetails(error).message); });
  await sweep();
  if (stopping) return;
  timer = setInterval(() => { void sweep(); }, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
