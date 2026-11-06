import { PROFILE_NAME, ProfileError, errorDetails, validateProfile } from "./profile-core.js";
import { lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import toml from "@iarna/toml";
// src/profile-store.ts
function ensureProfileDirectory(directory) {
	mkdirSync(directory, { recursive: true });
}
/** Read each file in isolation. One corrupt TOML never hides the other profiles. */
function scanProfiles(directory) {
	const profiles = /* @__PURE__ */ new Map();
	const diagnostics = /* @__PURE__ */ new Map();
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		throw new ProfileError("PROFILE_DIRECTORY_UNAVAILABLE", `cannot read profile directory ${directory}: ${errorDetails(error).message}`, { cause: error });
	}
	for (const entry of entries) {
		if (!entry.name.endsWith(".toml")) continue;
		const name = entry.name.slice(0, -5);
		const path = join(directory, entry.name);
		try {
			if (!PROFILE_NAME.test(name)) throw new ProfileError("INVALID_PROFILE_NAME", `invalid profile filename "${entry.name}"`);
			if (!entry.isFile() || lstatSync(path).isSymbolicLink()) throw new ProfileError("INVALID_PROFILE_FILE", `profile "${entry.name}" must be a regular file (not a symlink)`);
			if (lstatSync(path).size > 262144) throw new ProfileError("PROFILE_TOO_LARGE", `profile "${entry.name}" exceeds 256 KiB`);
			const source = readFileSync(path, "utf8");
			let parsed;
			try {
				parsed = toml.parse(source);
			} catch (error) {
				throw new ProfileError("TOML_PARSE_ERROR", `profile "${entry.name}": ${errorDetails(error).message}`, { cause: error });
			}
			profiles.set(name, validateProfile(name, parsed));
		} catch (error) {
			diagnostics.set(name, error instanceof ProfileError ? error : new ProfileError("PROFILE_READ_ERROR", `profile "${entry.name}": ${errorDetails(error).message}`, { cause: error }));
		}
	}
	return {
		profiles,
		diagnostics
	};
}
export { ensureProfileDirectory, scanProfiles };

//# sourceMappingURL=profile-store.js.map