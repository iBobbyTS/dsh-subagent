# Contributing

This fork targets DSH 0.2.1-rc.1 or newer in the 0.2.x series and Node.js >=24.9.0. Profile configuration is TOML; the bundled Host code is plain JavaScript and must not require an install-time build.

```sh
npm install --ignore-scripts --legacy-peer-deps
npm run check
npm pack --dry-run
```

Keep both README languages updated, include regression tests for runtime or validation changes, and preserve the official DSH Subagent lifecycle and `subagent_fork` behavior. Never commit credentials, user Profiles, session data, or `node_modules/`.

The repository's GitHub Issues feature was disabled when the v0.1.0 backlog was recorded; see `docs/issues/` for pending issue drafts.
