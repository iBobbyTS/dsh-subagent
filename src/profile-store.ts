import type { Catalog, Profile } from './profile-core.js';
import { errorDetails } from './profile-core.js';
import { readdirSync, lstatSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import toml from '@iarna/toml';
import { PROFILE_NAME, ProfileError, validateProfile } from './profile-core.js';

export function ensureProfileDirectory(directory: string) {
  mkdirSync(directory, { recursive: true });
}

/** Read each file in isolation. One corrupt TOML never hides the other profiles. */
export function scanProfiles(directory: string): Catalog {
  const profiles = new Map<string, Profile>();
  const diagnostics = new Map<string, ProfileError>();
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new ProfileError('PROFILE_DIRECTORY_UNAVAILABLE', `cannot read profile directory ${directory}: ${errorDetails(error).message}`, { cause: error });
  }
  for (const entry of entries) {
    if (!entry.name.endsWith('.toml')) continue;
    const name = entry.name.slice(0, -5);
    const path = join(directory, entry.name);
    try {
      if (!PROFILE_NAME.test(name)) throw new ProfileError('INVALID_PROFILE_NAME', `invalid profile filename "${entry.name}"`);
      // Do not follow links to unrelated data when scanning a user-owned configuration directory.
      if (!entry.isFile() || lstatSync(path).isSymbolicLink()) {
        throw new ProfileError('INVALID_PROFILE_FILE', `profile "${entry.name}" must be a regular file (not a symlink)`);
      }
      if (lstatSync(path).size > 256 * 1024) {
        throw new ProfileError('PROFILE_TOO_LARGE', `profile "${entry.name}" exceeds 256 KiB`);
      }
      const source = readFileSync(path, 'utf8');
      let parsed;
      try { parsed = toml.parse(source); }
      catch (error) { throw new ProfileError('TOML_PARSE_ERROR', `profile "${entry.name}": ${errorDetails(error).message}`, { cause: error }); }
      profiles.set(name, validateProfile(name, parsed));
    } catch (error) {
      diagnostics.set(name, error instanceof ProfileError
        ? error : new ProfileError('PROFILE_READ_ERROR', `profile "${entry.name}": ${errorDetails(error).message}`, { cause: error }));
    }
  }
  return { profiles, diagnostics };
}
