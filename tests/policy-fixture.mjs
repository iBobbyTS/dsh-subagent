import { PolicyStore } from '../lib/policy-store.js';
export function memoryPolicies(now = Date.now) {
  const records = new Map();
  const table = {
    get: id => records.get(id), keys: () => records.keys(), entries: () => records.entries(),
    put: async (id, value) => { records.set(id, value); },
    update: async (id, fn) => { if (!records.has(id)) throw new Error('missing snapshot'); const value = fn(records.get(id)); records.set(id, value); return value; },
    delete: async id => records.delete(id),
  };
  return { store: new PolicyStore(table, now), records, table };
}
