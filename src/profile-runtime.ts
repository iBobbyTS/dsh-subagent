import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Profile, ProfilePolicy, ReadProfile } from './profile-core.js';
import type { PolicyStore } from './policy-store.js';
import type {} from '@deepseek-ai/dsh-subagent';
import { randomUUID } from 'node:crypto';
import { ProfileError, assertModelRoute, assertToolNames, errorDetails, parseProfileLabel, profileLabel } from './profile-core.js';

const hiddenTools = new WeakMap<Agent, Set<string>>();
const POLICY_MARKER = Symbol.for('dsh-subagent.retained-policy.v1');
type PolicyAgent = Agent & { [POLICY_MARKER]?: ProfilePolicy };
export const liveChildPolicy = (agent: Agent) => (agent as PolicyAgent)[POLICY_MARKER];

export function parentToolNames(agent: Agent) {
  return [...new Set([...agent.ctx.tools.schemas(agent).map(tool => tool.name), ...(hiddenTools.get(agent) ?? [])])];
}

/** Root-only entry replacement; children retain native delegation and its recursion policy. */
export function installRootRouting(agent: Agent, definition: ToolDefinition, listDefinition?: ToolDefinition) {
  const disposers: (() => void)[] = [];
  const masked = new Set<string>();
  let disposed = false;
  let masking = false;
  const mask = () => {
    if (disposed || masking) return;
    masking = true;
    try {
      for (const name of ['subagent_fork', 'list_subagent_models']) {
        if (masked.has(name) || !agent.ctx.tools.get(name, agent)) continue;
        disposers.push(agent.ctx.tools.restrict({ deny: [name] }));
        masked.add(name);
      }
    } finally { masking = false; }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    hiddenTools.delete(agent);
    for (const release of disposers.reverse()) release();
  };
  try {
    hiddenTools.set(agent, masked);
    disposers.push(agent.ctx.tools.register(definition));
    if (listDefinition) disposers.push(agent.ctx.tools.register(listDefinition));
    mask();
    disposers.push(agent.ctx.on('tools/change', mask));
  } catch (error) { dispose(); throw error; }
  return dispose;
}

export function profileIdentityFromSession(session: Session) {
  if (session?.header?.origin !== 'subagent') return undefined;
  const event = session.snapshotEvents(session.inheritedEventCount ?? 0).find(e => e.type === 'subagent/descriptor');
  return parseProfileLabel((event?.data as { label?: unknown } | undefined)?.label);
}

export function profilePolicy(profile: Profile): ProfilePolicy {
  return { name: profile.name,
    ...(profile.developer_instruction === undefined ? {} : { developer_instruction: profile.developer_instruction }),
    ...(profile.tool_whitelist === undefined ? {} : { tool_whitelist: [...profile.tool_whitelist] }),
    ...(profile.tool_blacklist === undefined ? {} : { tool_blacklist: [...profile.tool_blacklist] }),
  };
}

export function installChildPolicy(agent: Agent, profile: ProfilePolicy) {
  const child = agent.ctx;
  assertToolNames(profile, child.tools.schemas(agent).map(tool => tool.name));
  if (profile.tool_whitelist !== undefined || profile.tool_blacklist !== undefined) {
    child.tools.restrict({
      ...(profile.tool_whitelist === undefined ? {} : { allow: [...new Set([
        ...profile.tool_whitelist.filter(name => name !== 'structured_output'), 'send_message',
      ])] }),
      ...(profile.tool_blacklist === undefined ? {} : { deny: [...profile.tool_blacklist] }),
    });
  }
  if (profile.developer_instruction?.trim()) child.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: child.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: profile.developer_instruction,
  });
}

export function ensureChildPolicy(agent: Agent, policy: ProfilePolicy) {
  if (liveChildPolicy(agent)) return;
  installChildPolicy(agent, policy);
  (agent as PolicyAgent)[POLICY_MARKER] = policy;
}

export async function spawnProfiled({ ctx, agent, args, read, store, signal, maxDepth }: {
  ctx: Context; agent: Agent; args: { profile: string; prompt: string; description?: string; cwd?: string };
  read: ReadProfile; store: PolicyStore; signal: AbortSignal; maxDepth?: number | 'provider-managed';
}) {
  if (typeof args.profile !== 'string' || !args.profile.trim()) throw new ProfileError('PROFILE_REQUIRED', 'subagent requires a nonempty profile');
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new ProfileError('PROMPT_REQUIRED', 'subagent requires a nonempty prompt');
  const profile = read(args.profile);
  assertToolNames(profile, parentToolNames(agent));
  await assertModelRoute(ctx.llm, profile, signal);
  const backend = ctx.subagents.getProvider('spawn');
  if (!backend || backend.inheritsParentContext || !backend.capabilities?.agentOptions || !backend.prepareContinuable) {
    throw new ProfileError('SPAWN_BACKEND_UNAVAILABLE', 'official continuable spawn backend is unavailable');
  }
  signal.throwIfAborted();
  const cap = ctx.subagents.resolveMaxDepth(maxDepth);
  const childId = randomUUID() as SessionId;
  const policy = profilePolicy(profile);
  const unpin = store.pin(childId);
  // The accepted call owns initialization until start settles, even if the routing plugin unloads.
  const releaseInitializer = ctx.root.on('agent/created', ({ agent: child }) => {
    if (child.id === childId) ensureChildPolicy(child, policy);
    return undefined;
  });
  try {
    await store.capture(childId, policy);
    signal.throwIfAborted();
    const started = await ctx.subagents.startActivation({
      provider: 'spawn', childId, label: profileLabel(profile, args.description || args.prompt.slice(0, 75)),
      request: {
        parent: agent, ...(cap === undefined ? {} : { maxDepth: cap }),
        prompt: [{ type: 'text', text: args.prompt }], ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        agentOptions: { provider: profile.provider, model: profile.model, reasoningEffort: profile.reasoning_effort as ReasoningEffortId },
      }, signal, delivery: 'parent',
    });
    return { kind: 'activation' as const, subagentId: String(started.childId) };
  } catch (error) {
    try { await store.forget(childId); }
    catch (cleanupError) { ctx.logger.warn('dsh-subagent: failed startup snapshot cleanup: ' + errorDetails(cleanupError).message); }
    if (error instanceof ProfileError) throw error;
    throw new ProfileError('SPAWN_FAILED', 'failed to spawn profile "' + profile.name + '": '
      + (errorDetails(error).code ? '[DSH:' + errorDetails(error).code + '] ' : '') + errorDetails(error).message, { cause: error });
  } finally { releaseInitializer(); unpin(); }
}
