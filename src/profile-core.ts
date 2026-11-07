import type { ReasoningEffortId, LlmCallConfig } from '@deepseek-ai/dsh-llm';
export interface Profile {
 readonly name: string
 readonly provider: string
 readonly model: string
 readonly reasoning_effort: string
 readonly description?: string
 readonly developer_instruction?: string
 readonly tool_whitelist?: readonly string[]
 readonly tool_blacklist?: readonly string[]
}
export type ProfilePolicy = Pick<Profile, 'name' | 'developer_instruction' | 'tool_whitelist' | 'tool_blacklist'>
export interface ProfileSummary { readonly name: string; readonly description?: string }
export interface Catalog<P = Profile> { profiles: Map<string, P>; diagnostics: Map<string, ProfileError> }
export type ReadProfile = (name: string) => Profile
export function errorDetails(error: unknown): { code?: string; message: string } {
 const value = error as { code?: unknown; message?: unknown } | null | undefined
 return { ...(typeof value?.code === 'string' ? { code: value.code } : {}), message: typeof value?.message === 'string' ? value.message : String(error) }
}

export const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
export const PROFILE_FIELDS = new Set([
  'provider', 'model', 'reasoning_effort',
  'tool_whitelist', 'tool_blacklist',
  'description', 'developer_instruction',
]);
const REQUIRED = ['provider', 'model', 'reasoning_effort'] as const;
const LISTS = ['tool_whitelist', 'tool_blacklist'] as const;
const PROTECTED_TOOLS = ['send_message', 'structured_output'];

/** Only `*` is special: it matches any run of characters in a whole tool name, including none. */
function toolPattern(entry: string) {
  const source = entry.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + source + '$');
}
export function isToolPattern(entry: string) { return entry.includes('*'); }
function matchesTool(entry: string, name: string) {
  return isToolPattern(entry) ? toolPattern(entry).test(name) : entry === name;
}

function assertProtectedToolBlacklist(profile: ProfilePolicy) {
  const blocked = (profile.tool_blacklist ?? []).filter(entry => PROTECTED_TOOLS.some(tool => matchesTool(entry, tool)));
  if (blocked.length) throw new ProfileError('PROTECTED_TOOL_BLACKLIST',
    `profile "${profile.name}" cannot blacklist protected tools: ${blocked.join(', ')}`);
}
// Recognize old labels for identification only; never compare their obsolete hash.
const LABEL_RE = /^\[dsh-profile:([a-z][a-z0-9_-]{0,63})(?::[a-f0-9]{16})?\](?:\s|$)/;

export class ProfileError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(`[${code}] ${message}`, options);
    this.name = 'SubagentProfileError';
    this.code = code;
  }
}

function assertText(value: unknown, field: string, name: string, { required = false }: { required?: boolean } = {}) {
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

function assertList(value: unknown, field: string, name: string) {
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
export function validateProfile(name: string, value: unknown) {
  if (!PROFILE_NAME.test(name)) throw new ProfileError('INVALID_PROFILE_NAME', `invalid profile name "${name}"`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileError('INVALID_TOML_ROOT', `profile "${name}" must be a TOML table`);
  }
  for (const field of Object.keys(value)) {
    if (!PROFILE_FIELDS.has(field)) throw new ProfileError('UNSUPPORTED_FIELD', `profile "${name}" has unsupported field "${field}"`);
  }
  const input = value as Record<string, unknown>;
  const profile: { -readonly [K in keyof Profile]: Profile[K] } = { name, provider: '', model: '', reasoning_effort: '' };
  for (const field of REQUIRED) profile[field] = assertText(input[field], field, name, { required: true })!;
  for (const field of ['description', 'developer_instruction'] as const) {
    const v = assertText(input[field], field, name);
    if (v !== undefined) profile[field] = v;
  }
  for (const field of LISTS) {
    const v = assertList(input[field], field, name);
    if (v !== undefined) profile[field] = v;
  }
  assertProtectedToolBlacklist(profile);
  return Object.freeze(profile);
}

export function profileLabel(profile: Profile, description: unknown) {
  const title = typeof description === 'string' && description.trim() ? description.trim() : 'Delegated task';
  return `[dsh-profile:${profile.name}] ${title.slice(0, 120)}`;
}

export function parseProfileLabel(label: unknown) {
  if (typeof label !== 'string') return undefined;
  const m = LABEL_RE.exec(label);
  return m ? { name: m[1] } : undefined;
}

export function assertToolNames(profile: ProfilePolicy, names: readonly string[]) {
  assertProtectedToolBlacklist(profile);
  const known = new Set(names);
  if (!known.has('send_message')) throw new ProfileError('REQUIRED_TOOL_UNAVAILABLE',
    `profile "${profile.name}" requires the native send_message tool`);
  for (const key of ['tool_whitelist', 'tool_blacklist'] as const) {
    const entries = profile[key];
    if (entries === undefined) continue;
    // Native structured_output is child-local and only exists for structured
    // tasks. Naming or matching it in a whitelist neither requires nor injects it.
    const candidates = key === 'tool_whitelist' ? [...known, 'structured_output'] : [...known];
    const missing = entries.filter(entry => {
      if (!isToolPattern(entry)) return !candidates.includes(entry);
      // A blacklist pattern guards a whole namespace, which may currently hold no tool.
      if (key === 'tool_blacklist') return false;
      return !candidates.some(name => matchesTool(entry, name));
    });
    if (missing.length) throw new ProfileError('TOOL_NOT_FOUND',
      `profile "${profile.name}" has unknown ${key} entries: ${missing.map(x => JSON.stringify(x)).join(', ')}`);
  }
}

export interface ToolFilter { allow?: string[]; deny?: string[] }

/** Expand both lists into exact native names; callers validate them first. */
export function resolveToolFilter(profile: ProfilePolicy, names: readonly string[]): ToolFilter {
  const expand = (entries: readonly string[]) => {
    const matched = new Set<string>();
    for (const entry of entries) {
      if (!isToolPattern(entry)) { matched.add(entry); continue; }
      const pattern = toolPattern(entry);
      for (const name of names) if (pattern.test(name)) matched.add(name);
    }
    return [...matched].sort();
  };
  const filter: ToolFilter = {};
  if (profile.tool_whitelist !== undefined) {
    // Scope-local structured output never enters an inherited-tool restriction.
    filter.allow = [...new Set([...expand(profile.tool_whitelist).filter(name => name !== 'structured_output'), 'send_message'])].sort();
  }
  if (profile.tool_blacklist !== undefined) filter.deny = expand(profile.tool_blacklist);
  return filter;
}

/** Use the native DSH exact-model resolver, not the advisory model catalog as truth. */
export async function assertModelRoute(llm: ModelResolver | undefined, profile: Profile, signal?: AbortSignal) {
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
      reasoningEffort: profile.reasoning_effort as ReasoningEffortId,
    }, signal);
  } catch (error) {
    if (errorDetails(error).code === 'UNSUPPORTED_REASONING_EFFORT') {
      throw new ProfileError('REASONING_EFFORT_UNAVAILABLE',
        `profile "${profile.name}": ${errorDetails(error).message}`, { cause: error });
    }
    if (errorDetails(error).code === 'NO_ADAPTER') {
      throw new ProfileError('PROVIDER_NOT_FOUND',
        `profile "${profile.name}": provider "${profile.provider}" is no longer registered`, { cause: error });
    }
    if (['UNKNOWN_MODEL', 'MODEL_NOT_FOUND', 'NO_MODEL', 'INVALID_MODEL'].includes(errorDetails(error).code ?? '')) {
      throw new ProfileError('MODEL_NOT_FOUND',
        `profile "${profile.name}": model "${profile.model}" is unavailable from provider "${profile.provider}"`, { cause: error });
    }
    throw new ProfileError('MODEL_UNVERIFIED',
      `profile "${profile.name}": could not verify model "${profile.model}" on provider "${profile.provider}": ${errorDetails(error).message}`,
      { cause: error });
  }
}

export interface ModelResolver {
 listProviders(): { id: string }[]
 resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<unknown>
}
