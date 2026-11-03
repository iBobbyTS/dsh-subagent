# Contributing

This fork targets DSH 0.2.1-rc.1 or newer in the 0.2.x series and Node.js >=24.9.0. Profile configuration is TOML; the bundled Host code is plain JavaScript and must not require an install-time build.

```sh
npm install --ignore-scripts --legacy-peer-deps
npm run check
npm pack --dry-run
```

Keep both README languages updated, include regression tests for runtime or validation changes, and preserve the official DSH Subagent lifecycle and `subagent_fork` behavior. Never commit credentials, user Profiles, session data, or `node_modules/`.

The bundle carries literal overrides of the shipped Web presets because Agent Preset carriers preserve child expressions and do not evaluate an entire `config: !!js ...` value. Regenerate against the supported installed DSH release (the anchor is its actual entry file, not this plugin):

```sh
DSH_TEST_RUNTIME_ANCHOR=/absolute/path/to/dsh/lib/bin.js npm run generate:presets
DSH_TEST_RUNTIME_ANCHOR=/absolute/path/to/dsh/lib/bin.js npm run check
```

The runtime-aware regression compares every emitted preset field with that release's original, allowing only native spawn's `modelSelectionSettings: false`. Do not replace fork, control, workflow or backend rows. Regeneration is a maintainer action, never an install/build script. User/profile overrides still take precedence and must apply the same native spawn setting themselves.

The repository's GitHub Issues feature was disabled when the v0.1.0 backlog was recorded; see `docs/issues/` for pending issue drafts.
