import { createHash } from 'node:crypto';

export const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
export const PROFILE_FIELDS = new Set([
  'provider', 'model', 'reasoning_effort',
  'tool_whitelist', 'tool_blacklist', 'skill_whitelist', 'skill_blacklist',
  'description', 'developer_instruction',
]);
const REQUIRED = ['provider', 'model', 'reasoning_effort'];
const LISTS = ['tool_whitelist', 'tool_blacklist', 'skill_whitelist', 'skill_blacklist'];
const LABEL_RE = /^\[dsh-profile:([a-z][a-z0-9_-]{0,63}):([a-f0-9]{16})\](?:\s|$)/;

export class ProfileError extends Error {
  constructor(code, message, options = {}) {
    super(`[${code}] ${message}`, options);
    this.name = 'SubagentProfileError';
    this.code = code;
  }
}

function assertText(value, field, name, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new ProfileError('MISSING_REQUIRED_FIELD', `profile "${name}" is missing "${field}"`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ProfileError('INVALID_FIELD_TYPE', `profile "${name}" field "${field}" must be a string`);
  if (required && value.trim().length === 0) {
    throw new ProfileError('MISSING_REQUIRED_FIELD', `profile "${name}" field "${field}" must be nonempty`);
  }
  return value;
}

function assertList(value, field, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ProfileError('INVALID_FIELD_TYPE', `profile "${name}" field "${field}" must be an array of nonempty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new ProfileError('INVALID_FIELD_VALUE', `profile "${name}" field "${field}" contains duplicate entries`);
  }
  return Object.freeze([...value]);
}

/** Validate a parsed TOML top-level table. Unknown fields are never ignored. */
export function validateProfile(name, value) {
  if (!PROFILE_NAME.test(name)) throw new ProfileError('INVALID_PROFILE_NAME', `invalid profile name "${name}"`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileError('INVALID_TOML_ROOT', `profile "${name}" must be a TOML table`);
  }
  for (const field of Object.keys(value)) {
    if (!PROFILE_FIELDS.has(field)) throw new ProfileError('UNSUPPORTED_FIELD', `profile "${name}" has unsupported field "${field}"`);
  }
  const profile = { name };
  for (const field of REQUIRED) profile[field] = assertText(value[field], field, name, { required: true });
  for (const field of ['description', 'developer_instruction']) {
    const v = assertText(value[field], field, name);
    if (v !== undefined) profile[field] = v;
  }
  for (const field of LISTS) {
    const v = assertList(value[field], field, name);
    if (v !== undefined) profile[field] = v;
  }
  // No partial enforcement: the Skill registry currently has no agent-scoped allow/deny API.
  for (const field of ['skill_whitelist', 'skill_blacklist']) {
    if (profile[field]?.length) throw new ProfileError('UNSUPPORTED_SKILL_FILTER',
      `profile "${name}" sets "${field}", which cannot be enforced by the current DSH Skill API`);
  }
  return Object.freeze(profile);
}

export function profileFingerprint(profile) {
  const object = {};
  for (const key of ['name', ...PROFILE_FIELDS]) {
    if (Object.hasOwn(profile, key)) object[key] = profile[key];
  }
  return createHash('sha256').update(JSON.stringify(object)).digest('hex').slice(0, 16);
}

export function profileLabel(profile, description) {
  const title = typeof description === 'string' && description.trim() ? description.trim() : 'Delegated task';
  return `[dsh-profile:${profile.name}:${profileFingerprint(profile)}] ${title.slice(0, 120)}`;
}

export function parseProfileLabel(label) {
  if (typeof label !== 'string') return undefined;
  const m = LABEL_RE.exec(label);
  return m ? { name: m[1], fingerprint: m[2] } : undefined;
}

export function assertToolNames(profile, names) {
  const known = new Set(names);
  for (const key of ['tool_whitelist', 'tool_blacklist']) {
    if (profile[key] === undefined) continue;
    const missing = profile[key].filter(name => !known.has(name));
    if (missing.length) throw new ProfileError('TOOL_NOT_FOUND',
      `profile "${profile.name}" has unknown ${key} entries: ${missing.map(x => JSON.stringify(x)).join(', ')}`);
  }
}

/** Use the native DSH exact-model resolver, not the advisory model catalog as truth. */
export async function assertModelRoute(llm, profile, signal) {
  if (llm === undefined || typeof llm.listProviders !== 'function' || typeof llm.resolveCallConfig !== 'function') {
    throw new ProfileError('LLM_UNAVAILABLE', 'DSH LLM service is not available');
  }
  let providers;
  try { providers = llm.listProviders(); }
  catch (error) { throw new ProfileError('PROVIDER_UNVERIFIED', `could not list DSH providers: ${String(error)}`, { cause: error }); }
  if (!Array.isArray(providers) || !providers.some(p => p?.id === profile.provider)) {
    throw new ProfileError('PROVIDER_NOT_FOUND', `profile "${profile.name}": provider "${profile.provider}" is not registered`);
  }
  try {
    await llm.resolveCallConfig({
      provider: profile.provider,
      model: profile.model,
      reasoningEffort: profile.reasoning_effort,
    }, signal);
  } catch (error) {
    if (error?.code === 'UNSUPPORTED_REASONING_EFFORT') {
      throw new ProfileError('REASONING_EFFORT_UNAVAILABLE',
        `profile "${profile.name}": ${error.message}`, { cause: error });
    }
    if (error?.code === 'NO_ADAPTER') {
      throw new ProfileError('PROVIDER_NOT_FOUND',
        `profile "${profile.name}": provider "${profile.provider}" is no longer registered`, { cause: error });
    }
    if (['UNKNOWN_MODEL', 'MODEL_NOT_FOUND', 'NO_MODEL', 'INVALID_MODEL'].includes(error?.code)) {
      throw new ProfileError('MODEL_NOT_FOUND',
        `profile "${profile.name}": model "${profile.model}" is unavailable from provider "${profile.provider}"`, { cause: error });
    }
    throw new ProfileError('MODEL_UNVERIFIED',
      `profile "${profile.name}": could not verify model "${profile.model}" on provider "${profile.provider}": ${error?.message ?? String(error)}`,
      { cause: error });
  }
}
