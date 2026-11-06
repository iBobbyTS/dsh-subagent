import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { ProfilePolicy } from './profile-core.js';
import { PROFILE_NAME, ProfileError } from './profile-core.js';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const policySchema = z.object({
  name: z.string().regex(PROFILE_NAME),
  developer_instruction: z.string().optional(),
  tool_whitelist: z.array(z.string()).optional(),
  tool_blacklist: z.array(z.string()).optional(),
});
const snapshotSchema = z.object({ policy: policySchema, lastUsedAt: z.number().finite().nonnegative() });
export type PolicySnapshot = z.infer<typeof snapshotSchema>;
export const policyDomain = defineDomain({
  name: 'dsh_subagent_policies', version: 1, layout: 'per-record',
  tables: { children: domainTable(snapshotSchema) },
});

/** Only this plugin's sidecars are disposable; never touches native Session storage. */
export class PolicyStore {
  private readonly pins = new Map<string, number>();
  private cleaning?: Promise<number>;
  private stopped = false;
  constructor(private readonly table: KvTable<string, PolicySnapshot>, private readonly now = Date.now) {}

  pin(id: string) {
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

  async capture(id: string, policy: ProfilePolicy) {
    // Detach the immutable launch policy. No route, description, fingerprint or TOML path.
    const snapshot = snapshotSchema.parse({ policy, lastUsedAt: this.now() });
    await this.table.put(id, snapshot);
  }

  restore(id: string): ProfilePolicy {
    const record = this.table.get(id);
    if (!record) throw new ProfileError('POLICY_SNAPSHOT_UNAVAILABLE',
      'child ' + id + ' has no retained policy snapshot (expired, removed, or created before snapshots were supported); start a new child');
    return record.policy;
  }

  async touch(id: string) {
    const now = this.now();
    await this.table.update(id, current => ({ ...current, lastUsedAt: Math.max(current.lastUsedAt, now) }));
  }

  forget(id: string) { return this.table.delete(id); }

  async stop() { this.stopped = true; await this.cleaning; }

  sweep(protectedSession: (id: string) => Promise<boolean> = async () => false): Promise<number> {
    if (this.cleaning) return this.cleaning;
    if (this.stopped) return Promise.resolve(0);
    const run = async () => {
      let deleted = 0;
      const now = this.now();
      for (const id of [...this.table.keys()]) {
        const record = this.table.get(id);
        if (this.pins.has(id) || !record || now - record.lastUsedAt < RETENTION_MS) continue;
        if (await protectedSession(id)) continue;
        const latest = this.table.get(id);
        if (this.stopped || this.pins.has(id) || !latest || now - latest.lastUsedAt < RETENTION_MS) continue;
        // Recheck after asynchronous observation: activity admitted during it must win.
        if (await this.table.delete(id)) deleted++;
      }
      return deleted;
    };
    this.cleaning = run().finally(() => { this.cleaning = undefined; });
    return this.cleaning;
  }
}
