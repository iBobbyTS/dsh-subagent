import { ProfileError, assertModelRoute, assertToolNames, errorDetails } from "./profile-core.js";
import { watch } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { ensureProfileDirectory, scanProfiles } from "./profile-store.js";
import { installChildPolicy, installRootRouting, parentToolNames, resolveChildProfile, spawnProfiled } from "./profile-runtime.js";
// src/index.ts
/**
* Named TOML subagent profiles layered over DSH's official Spawn/activation runtime.
* The plugin owns only model-facing routing and child-scoped policy; it does not
* replace the native subagent provider, history, messaging, or completion flow.
*/
const name = "dsh-subagent";
const inject = [
	"agents",
	"subagents",
	"tools",
	"systemPrompt",
	"llm"
];
const CHILD_POLICY_MARKER = Symbol.for("dsh-subagent.profile-policy.v1");
const TOOL_OUTPUT = {
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			kind: {
				type: "string",
				required: true,
				const: "activation"
			},
			subagentId: {
				type: "string",
				required: true
			}
		}
	},
	render: (_args, value) => [{
		type: "text",
		text: `started subagent ${value.subagentId}`
	}]
};
function profileCatalogText(state) {
	const rows = [...state.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
	const problems = [...state.diagnostics.entries()].sort(([a], [b]) => a.localeCompare(b));
	return `Named subagent profiles for the \`subagent\` tool:\n${rows.length ? rows.map((p) => `- ${p.name}: ${p.description?.trim() || p.name}`).join("\n") : "(no valid profiles available)"}${problems.length ? "\nSkipped profiles (configuration/runtime errors):\n" + problems.map(([name, error]) => `- ${name}: ${errorDetails(error).message}`).join("\n") : ""}\nCall subagent with a required profile and complete standalone prompt. The child works independently, and its result arrives through DSH completion notification. The profile descriptions above describe responsibilities, not developer instructions.`;
}
function profileTool({ ctx, load, pending }) {
	return defineTool({
		name: "subagent",
		description: "Spawn a separate, continuable DSH subagent using a required named TOML profile. The profile fixes the provider, model, reasoning effort and child instructions. The call returns the child id immediately; DSH notifies the parent when it finishes.",
		parameters: {
			profile: {
				type: "string",
				required: true,
				description: "Required profile id, from the named profile catalog."
			},
			prompt: {
				type: "string",
				required: true,
				description: "Complete self-contained task. The child has no parent conversation history."
			},
			description: {
				type: "string",
				description: "Optional short, human-readable task label (not the profile description)."
			},
			cwd: {
				type: "string",
				description: "Optional initial child working directory."
			}
		},
		output: TOOL_OUTPUT,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			if (!exec.agent) throw new ProfileError("PARENT_REQUIRED", "subagent must be called by a live parent Agent");
			return spawnProfiled({
				ctx,
				agent: exec.agent,
				args,
				load,
				pending,
				signal: exec.signal
			});
		}
	});
}
/** A profile is eligible for this parent only if native route/tool checks pass. */
async function validatedCatalog(ctx, agent, load, signal) {
	const { profiles: parsed, diagnostics } = load();
	const profiles = /* @__PURE__ */ new Map();
	const toolNames = parentToolNames(agent);
	for (const [name, profile] of parsed) try {
		assertToolNames(profile, toolNames);
		await assertModelRoute(ctx.llm, profile, signal);
		profiles.set(name, profile);
	} catch (error) {
		diagnostics.set(name, error instanceof ProfileError ? error : new ProfileError("PROFILE_VALIDATION_FAILED", `${name}: ${errorDetails(error).message}`));
	}
	return {
		profiles,
		diagnostics
	};
}
/** Load once per DSH composition; tool registrations shadow only root Agent scopes. */
function apply(ctx) {
	const directory = dshHomePath("agents");
	ensureProfileDirectory(directory);
	const load = () => scanProfiles(directory);
	const pending = /* @__PURE__ */ new Map();
	const roots = /* @__PURE__ */ new Map();
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
			for (const [key, diagnostic] of next.diagnostics) ctx.logger.warn(`dsh-subagent: skipped ${key}: ${diagnostic.message}`);
		} catch (error) {
			if (!unloading && roots.has(agent) && slot.revision === revision) slot.state = {
				profiles: /* @__PURE__ */ new Map(),
				diagnostics: /* @__PURE__ */ new Map([["<directory>", error instanceof ProfileError ? error : new ProfileError("PROFILE_DIRECTORY_UNAVAILABLE", errorDetails(error).message)]])
			};
		}
	};
	const scheduleRefresh = () => {
		if (refreshTimer !== void 0) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = void 0;
			for (const agent of roots.keys()) refresh(agent);
		}, 100);
		refreshTimer.unref?.();
	};
	const attachRoot = (agent) => {
		if (roots.has(agent) || unloading) return;
		const slot = {
			revision: 0,
			state: {
				profiles: /* @__PURE__ */ new Map(),
				diagnostics: /* @__PURE__ */ new Map()
			},
			dispose() {}
		};
		const disposers = [];
		try {
			disposers.push(installRootRouting(agent, profileTool({
				ctx,
				load,
				pending
			})));
			disposers.push(agent.ctx.systemPrompt.section({
				name: "dsh-subagent:profiles",
				order: (agent.ctx.systemPrompt.getSectionOrder("TOOL_SUBAGENT") ?? 116) + .1,
				text: () => profileCatalogText(slot.state)
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
	ctx.effect(() => () => {
		unloading = true;
		watcher?.close();
		if (refreshTimer !== void 0) clearTimeout(refreshTimer);
		for (const agent of [...roots.keys()]) detachRoot(agent);
		pending.clear();
	}, "dsh-subagent:root-scoped-router");
	const attachChild = (agent) => {
		if (agent[CHILD_POLICY_MARKER]) return;
		const profile = resolveChildProfile(agent.session, pending, load);
		if (!profile) return;
		installChildPolicy(agent, profile);
		agent[CHILD_POLICY_MARKER] = true;
	};
	ctx.on("agent/created", async ({ agent }) => {
		if (ctx.agents.roots().includes(agent)) {
			attachRoot(agent);
			await refresh(agent);
		} else attachChild(agent);
	});
	ctx.on("agent/disposed", ({ agent }) => {
		detachRoot(agent);
	});
	ctx.on("tools/change", scheduleRefresh);
	ctx.on("llm/adapters-updated", scheduleRefresh);
	ctx.on("llm/models-updated", scheduleRefresh);
	for (const agent of ctx.agents.list()) if (ctx.agents.roots().includes(agent)) {
		attachRoot(agent);
		refresh(agent);
	} else attachChild(agent);
	try {
		watcher = watch(directory, { persistent: false }, scheduleRefresh);
		watcher.on("error", (error) => ctx.logger.warn(`dsh-subagent: profile watcher: ${errorDetails(error).message}`));
	} catch (error) {
		ctx.logger.warn(`dsh-subagent: unable to watch ${directory}: ${errorDetails(error).message}; new profile changes are still read at spawn time`);
	}
}
export { apply, inject, name, profileCatalogText, profileTool, validatedCatalog };

//# sourceMappingURL=index.js.map