import { randomUUID } from 'node:crypto';
import {
  ProfileError, assertModelRoute, assertToolNames, parseProfileLabel, profileFingerprint, profileLabel,
} from './profile-core.js';

const rootsWithHiddenFork = new WeakSet();

/** Parent preflight must not mistake our root-only fork mask for a child policy.
 * The child still revalidates its actual inherited tools before its first turn.
 */
export function parentToolNames(agent) {
  const names = agent.ctx.tools.schemas(agent).map(tool => tool.name);
  if (rootsWithHiddenFork.has(agent) && !names.includes('subagent_fork')) names.push('subagent_fork');
  return names;
}

/** Replace only a root Agent's inherited spawn entry and hide its inherited fork.
 * Every effect is reversible; a failed attach must not leave a partial router.
 */
export function installRootRouting(agent, definition) {
  const disposers = [];
  let disposed = false;
  let maskingFork = false;
  let forkMasked = false;
  const maskFork = () => {
    if (disposed || maskingFork || forkMasked || !agent.ctx.tools.get('subagent_fork', agent)) return;
    maskingFork = true;
    try {
      disposers.push(agent.ctx.tools.restrict({ deny: ['subagent_fork'] }));
      forkMasked = true;
      rootsWithHiddenFork.add(agent);
    } finally { maskingFork = false; }
  };
  try {
    disposers.push(agent.ctx.tools.register(definition));
    maskFork();
    // A blank Agent can switch from a minimal preset to one providing fork.
    // Restrictions survive that switch, but cannot name a tool before it exists.
    disposers.push(agent.ctx.on('tools/change', maskFork));
  } catch (error) {
    disposed = true;
    rootsWithHiddenFork.delete(agent);
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    rootsWithHiddenFork.delete(agent);
    for (const dispose of disposers.reverse()) dispose();
  };
}

/** Read official durable descriptor; no custom session-event types or lifecycle state. */
export function profileIdentityFromSession(session) {
  if (session?.header?.origin !== 'subagent' || typeof session.snapshotEvents !== 'function') return undefined;
  const event = session.snapshotEvents().find(e => e?.type === 'subagent/descriptor');
  return parseProfileLabel(event?.data?.label);
}

export function installChildPolicy(agent, profile) {
  const child = agent.ctx;
  // Recheck the child view: inherited restrictions must not silently remove
  // the native communication tool, even when this profile sets no filters.
  const names = child.tools.schemas(agent).map(tool => tool.name);
  assertToolNames(profile, names);
  // DSH tools.restrict filters inherited tools, not child-local runtime tools.
  // Native structured_output is injected only for structured tasks and is
  // exempt whether it is attached before or after this restriction. Never
  // name that scope-local (or not-yet-created) tool in the inherited allow list.
  const hasFilters = profile.tool_whitelist !== undefined || profile.tool_blacklist !== undefined;
  if (hasFilters) {
    child.tools.restrict({
      ...(profile.tool_whitelist === undefined ? {} : { allow: [...new Set([
        ...profile.tool_whitelist.filter(name => name !== 'structured_output'), 'send_message',
      ])] }),
      ...(profile.tool_blacklist === undefined ? {} : { deny: profile.tool_blacklist }),
    });
  }
  if (profile.developer_instruction?.trim()) {
    // Native per-Agent scoped persona. DSH has no separate developer-message override for a child.
    child.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: child.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: profile.developer_instruction,
    });
  }
}

export async function spawnProfiled({ ctx, agent, args, load, pending, signal }) {
  if (typeof args.profile !== 'string' || !args.profile.trim()) {
    throw new ProfileError('PROFILE_REQUIRED', 'subagent(profile, prompt) requires a nonempty profile');
  }
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
    throw new ProfileError('PROMPT_REQUIRED', 'subagent(prompt) must be a nonempty string');
  }
  const { profiles, diagnostics } = load();
  const profile = profiles.get(args.profile);
  if (!profile) {
    if (diagnostics.has(args.profile)) throw diagnostics.get(args.profile);
    throw new ProfileError('PROFILE_NOT_FOUND', `unknown profile "${args.profile}" (available: ${[...profiles.keys()].join(', ') || 'none'})`);
  }
  assertToolNames(profile, parentToolNames(agent));
  await assertModelRoute(ctx.llm, profile, signal);
  const backend = ctx.subagents.getProvider('spawn');
  if (!backend || backend.inheritsParentContext || !backend.capabilities?.agentOptions
      || typeof backend.prepareContinuable !== 'function') {
    throw new ProfileError('SPAWN_BACKEND_UNAVAILABLE', 'official in-process continuable spawn backend is unavailable');
  }
  signal?.throwIfAborted();
  const maxDepth = ctx.subagents.resolveMaxDepth();
  const childId = randomUUID();
  const label = profileLabel(profile, args.description || args.prompt.slice(0, 75));
  pending.set(childId, profile);
  try {
    const started = await ctx.subagents.startActivation({
      provider: 'spawn',
      childId,
      label,
      request: {
        parent: agent,
        ...(maxDepth === undefined ? {} : { maxDepth }),
        prompt: [{ type: 'text', text: args.prompt }],
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        agentOptions: {
          provider: profile.provider,
          model: profile.model,
          reasoningEffort: profile.reasoning_effort,
        },
      },
      signal,
      delivery: 'parent',
    });
    return { kind: 'activation', subagentId: String(started.childId) };
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError('SPAWN_FAILED',
      `failed to spawn profile "${profile.name}": ${typeof error?.code === 'string' ? `[DSH:${error.code}] ` : ''}${error?.message ?? String(error)}`, { cause: error });
  } finally {
    pending.delete(childId);
  }
}

/** The profile fingerprint is persisted in the built-in descriptor label. */
export function resolveChildProfile(session, pending, load) {
  const identity = profileIdentityFromSession(session);
  if (!identity) return undefined;
  const current = pending.get(session.header.id);
  if (current) {
    if (current.name !== identity.name || profileFingerprint(current) !== identity.fingerprint) {
      throw new ProfileError('PROFILE_IDENTITY_MISMATCH', `child ${session.header.id} profile identity changed during creation`);
    }
    return current;
  }
  const { profiles, diagnostics } = load();
  if (diagnostics.has(identity.name)) throw diagnostics.get(identity.name);
  const profile = profiles.get(identity.name);
  if (!profile) throw new ProfileError('PROFILE_NOT_FOUND',
    `cannot resume child ${session.header.id}: profile "${identity.name}" no longer exists`);
  if (profileFingerprint(profile) !== identity.fingerprint) {
    throw new ProfileError('PROFILE_CHANGED',
      `cannot resume child ${session.header.id}: profile "${identity.name}" changed since spawning; restore its original TOML or start a new child`);
  }
  return profile;
}
