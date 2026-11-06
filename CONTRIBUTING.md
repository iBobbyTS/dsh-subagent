# Contributing

This fork targets the DSH 0.2.2-alpha.3 source contracts and Node.js >=24.9.0. Profile configuration is TOML; the shipped Host code is plain JavaScript and requires no install-time build. Do not restore the old 0.2.1 preset snapshots or weaken the minimum DSH version to make legacy installations load.

```sh
npm install --ignore-scripts --legacy-peer-deps --package-lock=false
npm run check
npm pack --dry-run
```

Keep both README languages updated. Preserve native providers, child identity, messaging, completion and resource ownership. Root Agents shadow `subagent` and hide inherited `subagent_fork`; non-Profile children remain untouched, and Profile children retain their own policy after Host unload. Do not write application-profile files or commit credentials, user Profiles, session data, `node_modules/`, or `.agent-work/`.

## Authoritative source integration

The reference checkout need not be built or have its own dependency directory. Tests use its source aliases and TypeScript's standard-decorator transform, matching the reference's Vitest approach. No installed DSH/Cordis module may substitute for an unmapped source package. An installation anchor may supply **third-party libraries only** when the reference has no dependencies installed. TypeScript and rrule are development-only dependencies; they are not shipped or needed by plugin users.

```sh
DSH_TEST_SOURCE_ROOT=/absolute/path/to/deepseek-harness \
DSH_TEST_EXTERNAL_ANCHOR=/absolute/path/to/installed/dsh/lib/bin.js \
npm run check
```

Without `DSH_TEST_SOURCE_ROOT`, the source integration suites explicitly skip; ordinary unit tests alone do not establish source-runtime compatibility. Temporary fixture homes stay under `.agent-work/tmp/native-shadowing/`, not the real DSH home. Tests never install into or edit the reference repository or a user profile.

The integration suites exercise current source Cordis, scope inheritance, native delegation-tool registration, native tool execution, real prompt assembly, plugin unload/re-enable, delayed fork masking, preserved persona and neighboring tools, protected messaging, and native on-demand structured capture. Agent/provider/model fixtures are explicit: these tests do not by themselves establish real model-backed child completion or current Desktop/Web deployment. Add a real activation test when changing lifecycle behavior; do not claim paid model or live GUI validation from fixture success.

Package tests assert the bundle contains only the Host insertion. Installation order must never change a persona or mode's config. For DSH 0.2.2-rc.1, activation task options belong in `request`; the native Host depth cap is forwarded there. Validate both default and provider-managed cap behavior, failures, and cleanup.

The repository's GitHub Issues feature was disabled when the v0.1.0 backlog was recorded; see [issue drafts](docs/issues/fork-profiles.md) for future fork work.
