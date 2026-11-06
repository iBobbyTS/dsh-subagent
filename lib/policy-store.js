import { PROFILE_NAME, ProfileError } from "./profile-core.js";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
// src/policy-store.ts
const RETENTION_MS = 2592e6;
const CLEANUP_INTERVAL_MS = 864e5;
const policySchema = z.object({
	name: z.string().regex(PROFILE_NAME),
	developer_instruction: z.string().optional(),
	tool_whitelist: z.array(z.string()).optional(),
	tool_blacklist: z.array(z.string()).optional()
});
const snapshotSchema = z.object({
	policy: policySchema,
	lastUsedAt: z.number().finite().nonnegative()
});
const policyDomain = defineDomain({
	name: "dsh_subagent_policies",
	version: 1,
	layout: "per-record",
	tables: { children: domainTable(snapshotSchema) }
});
/** Only this plugin's sidecars are disposable; never touches native Session storage. */
var PolicyStore = class {
	table;
	now;
	pins = /* @__PURE__ */ new Map();
	cleaning;
	stopped = false;
	constructor(table, now = Date.now) {
		this.table = table;
		this.now = now;
	}
	pin(id) {
		this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const count = (this.pins.get(id) ?? 1) - 1;
			if (count === 0) this.pins.delete(id);
			else this.pins.set(id, count);
		};
	}
	async capture(id, policy) {
		const snapshot = snapshotSchema.parse({
			policy,
			lastUsedAt: this.now()
		});
		await this.table.put(id, snapshot);
	}
	restore(id) {
		const record = this.table.get(id);
		if (!record) throw new ProfileError("POLICY_SNAPSHOT_UNAVAILABLE", "child " + id + " has no retained policy snapshot (expired, removed, or created before snapshots were supported); start a new child");
		return record.policy;
	}
	async touch(id) {
		const now = this.now();
		await this.table.update(id, (current) => ({
			...current,
			lastUsedAt: Math.max(current.lastUsedAt, now)
		}));
	}
	forget(id) {
		return this.table.delete(id);
	}
	async stop() {
		this.stopped = true;
		await this.cleaning;
	}
	sweep(protectedSession = async () => false) {
		if (this.cleaning) return this.cleaning;
		if (this.stopped) return Promise.resolve(0);
		const run = async () => {
			let deleted = 0;
			const now = this.now();
			for (const id of [...this.table.keys()]) {
				const record = this.table.get(id);
				if (this.pins.has(id) || !record || now - record.lastUsedAt < 2592e6) continue;
				if (await protectedSession(id)) continue;
				const latest = this.table.get(id);
				if (this.stopped || this.pins.has(id) || !latest || now - latest.lastUsedAt < 2592e6) continue;
				if (await this.table.delete(id)) deleted++;
			}
			return deleted;
		};
		this.cleaning = run().finally(() => {
			this.cleaning = void 0;
		});
		return this.cleaning;
	}
};
export { CLEANUP_INTERVAL_MS, PolicyStore, RETENTION_MS, policyDomain };

//# sourceMappingURL=policy-store.js.map