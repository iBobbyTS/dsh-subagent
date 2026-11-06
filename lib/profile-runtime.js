import { ProfileError, assertModelRoute, assertToolNames, errorDetails, parseProfileLabel, profileFingerprint, profileLabel } from "./profile-core.js";
import { randomUUID } from "node:crypto";
// src/profile-runtime.ts
const rootsWithHiddenFork = /* @__PURE__ */ new WeakSet();
/** Parent preflight must not mistake our root-only fork mask for a child policy.
* The child still revalidates its actual inherited tools before its first turn.
*/
function parentToolNames(agent) {
	const names = agent.ctx.tools.schemas(agent).map((tool) => tool.name);
	if (rootsWithHiddenFork.has(agent) && !names.includes("subagent_fork")) names.push("subagent_fork");
	return names;
}
/** Replace only a root Agent's inherited spawn entry and hide its inherited fork.
* Every effect is reversible; a failed attach must not leave a partial router.
*/
function installRootRouting(agent, definition) {
	const disposers = [];
	let disposed = false;
	let maskingFork = false;
	let forkMasked = false;
	const maskFork = () => {
		if (disposed || maskingFork || forkMasked || !agent.ctx.tools.get("subagent_fork", agent)) return;
		maskingFork = true;
		try {
			disposers.push(agent.ctx.tools.restrict({ deny: ["subagent_fork"] }));
			forkMasked = true;
			rootsWithHiddenFork.add(agent);
		} finally {
			maskingFork = false;
		}
	};
	try {
		disposers.push(agent.ctx.tools.register(definition));
		maskFork();
		disposers.push(agent.ctx.on("tools/change", maskFork));
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
function profileIdentityFromSession(session) {
	if (session?.header?.origin !== "subagent" || typeof session.snapshotEvents !== "function") return void 0;
	const event = session.snapshotEvents(session.inheritedEventCount ?? 0).find((e) => e?.type === "subagent/descriptor");
	return parseProfileLabel((event?.data)?.label);
}
function installChildPolicy(agent, profile) {
	const child = agent.ctx;
	const names = child.tools.schemas(agent).map((tool) => tool.name);
	assertToolNames(profile, names);
	if (profile.tool_whitelist !== void 0 || profile.tool_blacklist !== void 0) child.tools.restrict({
		...profile.tool_whitelist === void 0 ? {} : { allow: [.../* @__PURE__ */ new Set([...profile.tool_whitelist.filter((name) => name !== "structured_output"), "send_message"])] },
		...profile.tool_blacklist === void 0 ? {} : { deny: [...profile.tool_blacklist] }
	});
	if (profile.developer_instruction?.trim()) child.systemPrompt.section({
		name: "deployment:persona-prefix",
		order: child.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
		text: profile.developer_instruction
	});
}
async function spawnProfiled({ ctx, agent, args, load, pending, signal }) {
	if (typeof args.profile !== "string" || !args.profile.trim()) throw new ProfileError("PROFILE_REQUIRED", "subagent(profile, prompt) requires a nonempty profile");
	if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new ProfileError("PROMPT_REQUIRED", "subagent(prompt) must be a nonempty string");
	const { profiles, diagnostics } = load();
	const profile = profiles.get(args.profile);
	if (!profile) {
		if (diagnostics.has(args.profile)) throw diagnostics.get(args.profile);
		throw new ProfileError("PROFILE_NOT_FOUND", `unknown profile "${args.profile}" (available: ${[...profiles.keys()].join(", ") || "none"})`);
	}
	assertToolNames(profile, parentToolNames(agent));
	await assertModelRoute(ctx.llm, profile, signal);
	const backend = ctx.subagents.getProvider("spawn");
	if (!backend || backend.inheritsParentContext || !backend.capabilities?.agentOptions || typeof backend.prepareContinuable !== "function") throw new ProfileError("SPAWN_BACKEND_UNAVAILABLE", "official in-process continuable spawn backend is unavailable");
	signal?.throwIfAborted();
	const maxDepth = ctx.subagents.resolveMaxDepth();
	const childId = randomUUID();
	const label = profileLabel(profile, args.description || args.prompt.slice(0, 75));
	pending.set(childId, profile);
	try {
		const started = await ctx.subagents.startActivation({
			provider: "spawn",
			childId,
			label,
			request: {
				parent: agent,
				...maxDepth === void 0 ? {} : { maxDepth },
				prompt: [{
					type: "text",
					text: args.prompt
				}],
				...args.cwd === void 0 ? {} : { cwd: args.cwd },
				agentOptions: {
					provider: profile.provider,
					model: profile.model,
					reasoningEffort: profile.reasoning_effort
				}
			},
			signal,
			delivery: "parent"
		});
		return {
			kind: "activation",
			subagentId: String(started.childId)
		};
	} catch (error) {
		if (error instanceof ProfileError) throw error;
		throw new ProfileError("SPAWN_FAILED", `failed to spawn profile "${profile.name}": ${typeof errorDetails(error).code === "string" ? `[DSH:${errorDetails(error).code}] ` : ""}${errorDetails(error).message}`, { cause: error });
	} finally {
		pending.delete(childId);
	}
}
/** The profile fingerprint is persisted in the built-in descriptor label. */
function resolveChildProfile(session, pending, load) {
	const identity = profileIdentityFromSession(session);
	if (!identity) return void 0;
	const current = pending.get(session.header.id);
	if (current) {
		if (current.name !== identity.name || profileFingerprint(current) !== identity.fingerprint) throw new ProfileError("PROFILE_IDENTITY_MISMATCH", `child ${session.header.id} profile identity changed during creation`);
		return current;
	}
	const { profiles, diagnostics } = load();
	if (diagnostics.has(identity.name)) throw diagnostics.get(identity.name);
	const profile = profiles.get(identity.name);
	if (!profile) throw new ProfileError("PROFILE_NOT_FOUND", `cannot resume child ${session.header.id}: profile "${identity.name}" no longer exists`);
	if (profileFingerprint(profile) !== identity.fingerprint) throw new ProfileError("PROFILE_CHANGED", `cannot resume child ${session.header.id}: profile "${identity.name}" changed since spawning; restore its original TOML or start a new child`);
	return profile;
}
export { installChildPolicy, installRootRouting, parentToolNames, profileIdentityFromSession, resolveChildProfile, spawnProfiled };

//# sourceMappingURL=profile-runtime.js.map