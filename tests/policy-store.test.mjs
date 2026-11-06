import test from 'node:test';
import assert from 'node:assert/strict';
import { RETENTION_MS } from '../lib/policy-store.js';
import { memoryPolicies } from './policy-fixture.mjs';

const original = { name: 'reader', developer_instruction: 'Read only', tool_whitelist: ['read'] };
test('stored policy is detached from current Profile contents and requires no profile lookup', async () => {
  let now = 1000;
  const { store, records } = memoryPolicies(() => now);
  await store.capture('child', original);
  const edited = { ...original, developer_instruction: 'Changed', tool_whitelist: ['write'] };
  assert.deepEqual(store.restore('child'), original);
  assert.notDeepEqual(store.restore('child'), edited);
  original.tool_whitelist.push('grep');
  assert.deepEqual(store.restore('child').tool_whitelist, ['read']);
  original.tool_whitelist.pop();
  now += RETENTION_MS - 1;
  assert.equal(await store.sweep(), 0);
  now++;
  assert.deepEqual(store.restore('child'), { ...original, tool_whitelist: ['read'] }, 'only cleanup expires a retained snapshot; resume does not run a second TTL gate');
  assert.equal(await store.sweep(), 1);
  assert.equal(records.size, 0);
  assert.throws(() => store.restore('child'), error => error.code === 'POLICY_SNAPSHOT_UNAVAILABLE');
});

test('last activity, not creation time, controls expiry; live and starting children are protected', async () => {
  let now = 0;
  const { store, records } = memoryPolicies(() => now);
  await store.capture('used', original);
  await store.capture('idle', original);
  await store.capture('live', original);
  const release = store.pin('live');
  now = RETENTION_MS - 1;
  await store.touch('used');
  now = RETENTION_MS;
  assert.equal(await store.sweep(), 1);
  assert.ok(records.has('used'));
  assert.ok(records.has('live'));
  assert.equal(records.has('idle'), false);
  assert.deepEqual(store.restore('live'), original);
  release(); release();
  assert.equal(await store.sweep(), 1);
  now += RETENTION_MS - 1;
  assert.equal(await store.sweep(), 1);
});

test('clock rollback cannot shorten a recorded retention period', async () => {
  let now = 1000;
  const { store, records } = memoryPolicies(() => now);
  await store.capture('child', original);
  now = 100;
  await store.touch('child');
  assert.equal(records.get('child').lastUsedAt, 1000);
});

test('pending messages and activity racing an asynchronous cleanup observation protect the snapshot', async () => {
  let now = 0;
  const { store, records } = memoryPolicies(() => now);
  await store.capture('child', original);
  now = RETENTION_MS;
  assert.equal(await store.sweep(async () => true), 0, 'offline queued work is protected');
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const sweep = store.sweep(async () => { entered.resolve(); await gate.promise; return false; });
  await entered.promise;
  const unpin = store.pin('child');
  await store.touch('child');
  gate.resolve();
  assert.equal(await sweep, 0);
  assert.ok(records.has('child'));
  unpin();
  assert.equal(await store.sweep(), 0, 'fresh activity wins even after the pin is released');
});
