// src/profile-core.ts
function errorDetails(error) {
	const value = error;
	return {
		...typeof value?.code === "string" ? { code: value.code } : {},
		message: typeof value?.message === "string" ? value.message : String(error)
	};
}
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const PROFILE_FIELDS = /* @__PURE__ */ new Set([
	"provider",
	"model",
	"reasoning_effort",
	"tool_whitelist",
	"tool_blacklist",
	"description",
	"developer_instruction"
]);
const REQUIRED = [
	"provider",
	"model",
	"reasoning_effort"
];
const LISTS = ["tool_whitelist", "tool_blacklist"];
const PROTECTED_TOOLS = ["send_message", "structured_output"];
/** Only `*` is special: it matches any run of characters in a whole tool name, including none. */
function toolPattern(entry) {
	const source = entry.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
	return new RegExp("^" + source + "$");
}
function isToolPattern(entry) {
	return entry.includes("*");
}
function matchesTool(entry, name) {
	return isToolPattern(entry) ? toolPattern(entry).test(name) : entry === name;
}
function assertProtectedToolBlacklist(profile) {
	const blocked = (profile.tool_blacklist ?? []).filter((entry) => PROTECTED_TOOLS.some((tool) => matchesTool(entry, tool)));
	if (blocked.length) throw new ProfileError("PROTECTED_TOOL_BLACKLIST", `profile "${profile.name}" cannot blacklist protected tools: ${blocked.join(", ")}`);
}
const LABEL_RE = /^\[dsh-profile:([a-z][a-z0-9_-]{0,63})(?::[a-f0-9]{16})?\](?:\s|$)/;
var ProfileError = class extends Error {
	code;
	constructor(code, message, options = {}) {
		super(`[${code}] ${message}`, options);
		this.name = "SubagentProfileError";
		this.code = code;
	}
};
function assertText(value, field, name, { required = false } = {}) {
	if (value === void 0) {
		if (required) throw new ProfileError("MISSING_REQUIRED_FIELD", `profile "${name}" is missing "${field}"`);
		return;
	}
	if (typeof value !== "string") throw new ProfileError("INVALID_FIELD_TYPE", `profile "${name}" field "${field}" must be a string`);
	if (required && value.trim().length === 0) throw new ProfileError("MISSING_REQUIRED_FIELD", `profile "${name}" field "${field}" must be nonempty`);
	return value;
}
function assertList(value, field, name) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new ProfileError("INVALID_FIELD_TYPE", `profile "${name}" field "${field}" must be an array of nonempty strings`);
	if (new Set(value).size !== value.length) throw new ProfileError("INVALID_FIELD_VALUE", `profile "${name}" field "${field}" contains duplicate entries`);
	return Object.freeze([...value]);
}
/** Validate a parsed TOML top-level table. Unknown fields are never ignored. */
function validateProfile(name, value) {
	if (!PROFILE_NAME.test(name)) throw new ProfileError("INVALID_PROFILE_NAME", `invalid profile name "${name}"`);
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ProfileError("INVALID_TOML_ROOT", `profile "${name}" must be a TOML table`);
	for (const field of Object.keys(value)) if (!PROFILE_FIELDS.has(field)) throw new ProfileError("UNSUPPORTED_FIELD", `profile "${name}" has unsupported field "${field}"`);
	const input = value;
	const profile = {
		name,
		provider: "",
		model: "",
		reasoning_effort: ""
	};
	for (const field of REQUIRED) profile[field] = assertText(input[field], field, name, { required: true });
	for (const field of ["description", "developer_instruction"]) {
		const v = assertText(input[field], field, name);
		if (v !== void 0) profile[field] = v;
	}
	for (const field of LISTS) {
		const v = assertList(input[field], field, name);
		if (v !== void 0) profile[field] = v;
	}
	assertProtectedToolBlacklist(profile);
	return Object.freeze(profile);
}
function profileLabel(profile, description) {
	const title = typeof description === "string" && description.trim() ? description.trim() : "Delegated task";
	return `[dsh-profile:${profile.name}] ${title.slice(0, 120)}`;
}
function parseProfileLabel(label) {
	if (typeof label !== "string") return void 0;
	const m = LABEL_RE.exec(label);
	return m ? { name: m[1] } : void 0;
}
function assertToolNames(profile, names) {
	assertProtectedToolBlacklist(profile);
	const known = new Set(names);
	if (!known.has("send_message")) throw new ProfileError("REQUIRED_TOOL_UNAVAILABLE", `profile "${profile.name}" requires the native send_message tool`);
	for (const key of ["tool_whitelist", "tool_blacklist"]) {
		const entries = profile[key];
		if (entries === void 0) continue;
		const candidates = key === "tool_whitelist" ? [...known, "structured_output"] : [...known];
		const missing = entries.filter((entry) => {
			if (!isToolPattern(entry)) return !candidates.includes(entry);
			if (key === "tool_blacklist") return false;
			return !candidates.some((name) => matchesTool(entry, name));
		});
		if (missing.length) throw new ProfileError("TOOL_NOT_FOUND", `profile "${profile.name}" has unknown ${key} entries: ${missing.map((x) => JSON.stringify(x)).join(", ")}`);
	}
}
/** Expand both lists into exact native names; callers validate them first. */
function resolveToolFilter(profile, names) {
	const expand = (entries) => {
		const matched = /* @__PURE__ */ new Set();
		for (const entry of entries) {
			if (!isToolPattern(entry)) {
				matched.add(entry);
				continue;
			}
			const pattern = toolPattern(entry);
			for (const name of names) if (pattern.test(name)) matched.add(name);
		}
		return [...matched].sort();
	};
	const filter = {};
	if (profile.tool_whitelist !== void 0) filter.allow = [.../* @__PURE__ */ new Set([...expand(profile.tool_whitelist).filter((name) => name !== "structured_output"), "send_message"])].sort();
	if (profile.tool_blacklist !== void 0) filter.deny = expand(profile.tool_blacklist);
	return filter;
}
/** Use the native DSH exact-model resolver, not the advisory model catalog as truth. */
async function assertModelRoute(llm, profile, signal) {
	if (llm === void 0 || typeof llm.listProviders !== "function" || typeof llm.resolveCallConfig !== "function") throw new ProfileError("LLM_UNAVAILABLE", "DSH LLM service is not available");
	let providers;
	try {
		providers = llm.listProviders();
	} catch (error) {
		throw new ProfileError("PROVIDER_UNVERIFIED", `could not list DSH providers: ${String(error)}`, { cause: error });
	}
	if (!Array.isArray(providers) || !providers.some((p) => p?.id === profile.provider)) throw new ProfileError("PROVIDER_NOT_FOUND", `profile "${profile.name}": provider "${profile.provider}" is not registered`);
	try {
		await llm.resolveCallConfig({
			provider: profile.provider,
			model: profile.model,
			reasoningEffort: profile.reasoning_effort
		}, signal);
	} catch (error) {
		if (errorDetails(error).code === "UNSUPPORTED_REASONING_EFFORT") throw new ProfileError("REASONING_EFFORT_UNAVAILABLE", `profile "${profile.name}": ${errorDetails(error).message}`, { cause: error });
		if (errorDetails(error).code === "NO_ADAPTER") throw new ProfileError("PROVIDER_NOT_FOUND", `profile "${profile.name}": provider "${profile.provider}" is no longer registered`, { cause: error });
		if ([
			"UNKNOWN_MODEL",
			"MODEL_NOT_FOUND",
			"NO_MODEL",
			"INVALID_MODEL"
		].includes(errorDetails(error).code ?? "")) throw new ProfileError("MODEL_NOT_FOUND", `profile "${profile.name}": model "${profile.model}" is unavailable from provider "${profile.provider}"`, { cause: error });
		throw new ProfileError("MODEL_UNVERIFIED", `profile "${profile.name}": could not verify model "${profile.model}" on provider "${profile.provider}": ${errorDetails(error).message}`, { cause: error });
	}
}
export { PROFILE_FIELDS, PROFILE_NAME, ProfileError, assertModelRoute, assertToolNames, errorDetails, isToolPattern, parseProfileLabel, profileLabel, resolveToolFilter, validateProfile };

//# sourceMappingURL=profile-core.js.map