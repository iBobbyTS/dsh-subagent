import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProfile, profileFingerprint, profileLabel, parseProfileLabel, ProfileError, assertToolNames,
  assertModelRoute,
} from '../profile-core.js';

const valid = {
  provider: 'openai-codex', model: 'gpt-6-luna', reasoning_effort: 'xhigh',
  description: 'Read-only code investigation',
  developer_instruction: 'Only explore the assigned code. Never edit files.',
  tool_whitelist: ['read', 'glob', 'grep'],
};
const profile = () => validateProfile('explorer', valid);
function rejectsCode(fn, code) { assert.throws(fn, error => error instanceof ProfileError && error.code === code); }
async function rejectsAsyncCode(fn, code) {
  await assert.rejects(fn, error => error instanceof ProfileError && error.code === code);
}

test('requires all three LLM fields with distinct diagnostics', () => {
  for (const key of ['provider', 'model', 'reasoning_effort']) {
    const v = { ...valid }; delete v[key];
    rejectsCode(() => validateProfile('explorer', v), 'MISSING_REQUIRED_FIELD');
  }
});

test('rejects unsupported TOML fields, wrong field types and invalid names', () => {
  rejectsCode(() => validateProfile('explorer', { ...valid, legacy_persona: 'x' }), 'UNSUPPORTED_FIELD');
  rejectsCode(() => validateProfile('explorer', { ...valid, tool_whitelist: [123] }), 'INVALID_FIELD_TYPE');
  rejectsCode(() => validateProfile('../escape', valid), 'INVALID_PROFILE_NAME');
  rejectsCode(() => validateProfile('explorer', { ...valid, tool_whitelist: ['read', 'read'] }), 'INVALID_FIELD_VALUE');
});

test('nonempty skill policies fail closed; empty arrays remain parseable', () => {
  rejectsCode(() => validateProfile('explorer', { ...valid, skill_blacklist: ['dangerous'] }), 'UNSUPPORTED_SKILL_FILTER');
  const p = validateProfile('explorer', { ...valid, skill_whitelist: [], skill_blacklist: [] });
  assert.deepEqual(p.skill_blacklist, []);
});

test('tool names are validated without inventing tools', () => {
  assertToolNames(profile(), ['read', 'glob', 'grep', 'subagent', 'send_message']);
  rejectsCode(() => assertToolNames(profile(), ['read', 'send_message']), 'TOOL_NOT_FOUND');
  assertToolNames(validateProfile('explorer', { ...valid, tool_whitelist: [] }), ['read', 'send_message']);
});

test('protected tools in blacklist invalidate profiles even when absent or allowed in whitelist', () => {
  for (const tool of ['send_message', 'structured_output']) {
    for (const tool_whitelist of [undefined, [], [tool]]) {
      const input = { ...valid, tool_whitelist, tool_blacklist: [tool] };
      assert.throws(() => validateProfile('explorer', input), error =>
        error.code === 'PROTECTED_TOOL_BLACKLIST' && error.message.includes(tool));
      rejectsCode(() => assertToolNames({ name: 'raw', ...input }, []), 'PROTECTED_TOOL_BLACKLIST');
    }
  }
});

test('native messaging must be available even for profiles without filters', () => {
  const plain = validateProfile('plain', { provider: valid.provider, model: valid.model, reasoning_effort: valid.reasoning_effort });
  rejectsCode(() => assertToolNames(plain, ['read']), 'REQUIRED_TOOL_UNAVAILABLE');
  assertToolNames(plain, ['send_message']);
});

test('structured output whitelist is optional runtime-owned capability, not an unknown parent tool', () => {
  const p = validateProfile('structured', { ...valid, tool_whitelist: ['structured_output'] });
  assertToolNames(p, ['send_message']);
  assertToolNames(p, ['send_message', 'structured_output']);
  rejectsCode(() => assertToolNames(validateProfile('typo', { ...valid, tool_whitelist: ['structured_ouput'] }), ['send_message']), 'TOOL_NOT_FOUND');
});

test('profile label permits resume, is stable and does not leak developer instruction', () => {
  const p = profile();
  const label = profileLabel(p, 'Inspect login');
  assert.deepEqual(parseProfileLabel(label), { name: 'explorer', fingerprint: profileFingerprint(p) });
  assert.equal(label.includes('Only explore'), false);
  assert.equal(parseProfileLabel('Not our child'), undefined);
  assert.notEqual(profileFingerprint(p), profileFingerprint(validateProfile('explorer', {
    ...valid, developer_instruction: 'Changed',
  })));
});

test('provider not registered gets its own error code', async () => {
  await rejectsAsyncCode(() => assertModelRoute({
    listProviders: () => [{ id: 'another' }], resolveCallConfig: async () => ({}),
  }, profile()), 'PROVIDER_NOT_FOUND');
});

test('unsupported reasoning effort is distinct from model not found', async () => {
  await rejectsAsyncCode(() => assertModelRoute({
    listProviders: () => [{ id: 'openai-codex' }],
    resolveCallConfig: async () => { throw Object.assign(new Error('not available'), { code: 'UNSUPPORTED_REASONING_EFFORT' }); },
  }, profile()), 'REASONING_EFFORT_UNAVAILABLE');
  await rejectsAsyncCode(() => assertModelRoute({
    listProviders: () => [{ id: 'openai-codex' }],
    resolveCallConfig: async () => { throw Object.assign(new Error('unknown'), { code: 'MODEL_NOT_FOUND' }); },
  }, profile()), 'MODEL_NOT_FOUND');
});

test('ambiguous adapter errors produce MODEL_UNVERIFIED, never false MODEL_NOT_FOUND', async () => {
  await rejectsAsyncCode(() => assertModelRoute({
    listProviders: () => [{ id: 'openai-codex' }],
    resolveCallConfig: async () => { throw new Error('network offline'); },
  }, profile()), 'MODEL_UNVERIFIED');
});
