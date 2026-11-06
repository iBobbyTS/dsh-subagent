import type { Catalog, Profile, ProfileSummary } from './profile-core.js';
import { constants, readdirSync, openSync, fstatSync, closeSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import toml from '@iarna/toml';
import { PROFILE_NAME, ProfileError, errorDetails, validateProfile } from './profile-core.js';

export function ensureProfileDirectory(directory: string) {
  mkdirSync(directory, { recursive: true });
}

function readDocument(directory: string, name: string) {
  if (!PROFILE_NAME.test(name)) throw new ProfileError('INVALID_PROFILE_NAME', 'invalid profile name: ' + name);
  let fd: number | undefined;
  try {
    fd = openSync(join(directory, name + '.toml'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ProfileError('INVALID_PROFILE_FILE', name + ': expected a regular TOML file');
    if (stat.size > 256 * 1024) throw new ProfileError('PROFILE_TOO_LARGE', name + ': exceeds 256 KiB');
    const source = readFileSync(fd, 'utf8');
    try { return toml.parse(source); }
    catch (error) { throw new ProfileError('TOML_PARSE_ERROR', name + ': ' + errorDetails(error).message, { cause: error }); }
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    const code = errorDetails(error).code;
    if (code === 'ENOENT') throw new ProfileError('PROFILE_NOT_FOUND', 'unknown profile: ' + name, { cause: error });
    if (code === 'ELOOP') throw new ProfileError('INVALID_PROFILE_FILE', name + ': symlinks are not supported', { cause: error });
    throw new ProfileError('PROFILE_READ_ERROR', name + ': ' + errorDetails(error).message, { cause: error });
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Read only the selected file, afresh, for each spawn. */
export function readProfile(directory: string, name: string): Profile {
  return validateProfile(name, readDocument(directory, name));
}

function scan<P>(directory: string, read: (name: string) => P): Catalog<P> {
  const profiles = new Map<string, P>();
  const diagnostics = new Map<string, ProfileError>();
  let entries;
  try { entries = readdirSync(directory).filter(name => name.endsWith('.toml')).sort(); }
  catch (error) { throw new ProfileError('PROFILE_DIRECTORY_UNAVAILABLE', errorDetails(error).message, { cause: error }); }
  for (const entry of entries) {
    const name = entry.slice(0, -5);
    try { profiles.set(name, read(name)); }
    catch (error) { diagnostics.set(name, error instanceof ProfileError ? error
      : new ProfileError('PROFILE_READ_ERROR', errorDetails(error).message, { cause: error })); }
  }
  return { profiles, diagnostics };
}

/** Discovery parses descriptions only: route and tool errors belong to spawn. */
export function listProfiles(directory: string): Catalog<ProfileSummary> {
  return scan(directory, name => {
    const value = readDocument(directory, name);
    return { name, ...(typeof value.description === 'string' ? { description: value.description } : {}) };
  });
}

export function scanProfiles(directory: string): Catalog {
  return scan(directory, name => readProfile(directory, name));
}
