import { ProfileError, assertModelRoute, assertToolNames, errorDetails, parseProfileLabel, profileLabel, resolveToolFilter } from "./profile-core.js";
import { randomUUID } from "node:crypto";
// src/profile-runtime.ts
const hiddenTools = /* @__PURE__ */ new WeakMap();
const POLICY_MARKER = Symbol.for("dsh-subagent.retained-policy.v1");
const liveChildPolicy = (agent) => agent[POLICY_MARKER];
function parentToolNames(agent) {
	return [.../* @__PURE__ */ new Set([...agent.ctx.tools.schemas(agent).map((tool) => tool.name), ...hiddenTools.get(agent) ?? []])];
}
/** Root-only entry replacement; children retain native delegation and its recursion policy. */
function installRootRouting(agent, definition, listDefinition) {
	const disposers = [];
	const masked = /* @__PURE__ */ new Set();
	let disposed = false;
	let masking = false;
	const mask = () => {
		if (disposed || masking) return;
		masking = true;
		try {
			for (const name of ["subagent_fork", "list_subagent_models"]) {
				if (masked.has(name) || !agent.ctx.tools.get(name, agent)) continue;
				disposers.push(agent.ctx.tools.restrict({ deny: [name] }));
				masked.add(name);
			}
		} finally {
			masking = false;
		}
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
		disposers.push(agent.ctx.on("tools/change", mask));
	} catch (error) {
		dispose();
		throw error;
	}
	return dispose;
}
function profileIdentityFromSession(session) {
	if (session?.header?.origin !== "subagent") return void 0;
	const event = session.snapshotEvents(session.inheritedEventCount ?? 0).find((e) => e.type === "subagent/descriptor");
	return parseProfileLabel((event?.data)?.label);
}
function profilePolicy(profile) {
	return {
		name: profile.name,
		...profile.developer_instruction === void 0 ? {} : { developer_instruction: profile.developer_instruction },
		...profile.tool_whitelist === void 0 ? {} : { tool_whitelist: [...profile.tool_whitelist] },
		...profile.tool_blacklist === void 0 ? {} : { tool_blacklist: [...profile.tool_blacklist] }
	};
}
function installChildPolicy(agent, profile) {
	const child = agent.ctx;
	const names = child.tools.schemas(agent).map((tool) => tool.name);
	assertToolNames(profile, names);
	if (profile.tool_whitelist !== void 0 || profile.tool_blacklist !== void 0) child.tools.restrict(resolveToolFilter(profile, names));
	if (profile.developer_instruction?.trim()) child.systemPrompt.section({
		name: "deployment:persona-prefix",
		order: child.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
		text: profile.developer_instruction
	});
}
function ensureChildPolicy(agent, policy) {
	if (liveChildPolicy(agent)) return;
	installChildPolicy(agent, policy);
	agent[POLICY_MARKER] = policy;
}
async function spawnProfiled({ ctx, agent, args, read, store, signal, maxDepth }) {
	if (typeof args.profile !== "string" || !args.profile.trim()) throw new ProfileError("PROFILE_REQUIRED", "subagent requires a nonempty profile");
	if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new ProfileError("PROMPT_REQUIRED", "subagent requires a nonempty prompt");
	const profile = read(args.profile);
	assertToolNames(profile, parentToolNames(agent));
	await assertModelRoute(ctx.llm, profile, signal);
	const backend = ctx.subagents.getProvider("spawn");
	if (!backend || backend.inheritsParentContext || !backend.capabilities?.agentOptions || !backend.prepareContinuable) throw new ProfileError("SPAWN_BACKEND_UNAVAILABLE", "official continuable spawn backend is unavailable");
	signal.throwIfAborted();
	const cap = ctx.subagents.resolveMaxDepth(maxDepth);
	const childId = randomUUID();
	const policy = profilePolicy(profile);
	const unpin = store.pin(childId);
	const releaseInitializer = ctx.root.on("agent/created", ({ agent: child }) => {
		if (child.id === childId) ensureChildPolicy(child, policy);
	});
	try {
		await store.capture(childId, policy);
		signal.throwIfAborted();
		const started = await ctx.subagents.startActivation({
			provider: "spawn",
			childId,
			label: profileLabel(profile, args.description || args.prompt.slice(0, 75)),
			request: {
				parent: agent,
				...cap === void 0 ? {} : { maxDepth: cap },
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
		try {
			await store.forget(childId);
		} catch (cleanupError) {
			ctx.logger.warn("dsh-subagent: failed startup snapshot cleanup: " + errorDetails(cleanupError).message);
		}
		if (error instanceof ProfileError) throw error;
		throw new ProfileError("SPAWN_FAILED", "failed to spawn profile \"" + profile.name + "\": " + (errorDetails(error).code ? "[DSH:" + errorDetails(error).code + "] " : "") + errorDetails(error).message, { cause: error });
	} finally {
		releaseInitializer();
		unpin();
	}
}
export { ensureChildPolicy, installChildPolicy, installRootRouting, liveChildPolicy, parentToolNames, profileIdentityFromSession, profilePolicy, spawnProfiled };

//# sourceMappingURL=profile-runtime.js.map