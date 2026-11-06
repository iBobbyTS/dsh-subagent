# Development

The current source-runtime validation target is DSH `0.2.2-rc.1` and Node.js `>=24.9.0`. The Host code is plain JavaScript, so plugin installation needs no build script. Activation task inputs use the release API's `request` object.

## Local checks

```sh
npm install --ignore-scripts --legacy-peer-deps --package-lock=false
npm run check
npm pack --dry-run
```

## Source integration

The reference checkout need not be built. Tests map its source packages and use TypeScript's standard-decorator transform. An installation anchor supplies third-party dependencies when the reference has none installed; it does not substitute installed DSH modules for source packages.

```sh
DSH_TEST_SOURCE_ROOT=/absolute/path/to/deepseek-harness \
DSH_TEST_EXTERNAL_ANCHOR=/absolute/path/to/installed/dsh/lib/bin.js \
npm run check
```

Without `DSH_TEST_SOURCE_ROOT`, source integration suites explicitly skip. Temporary fixture homes are under `.agent-work/tmp/native-shadowing/`; tests do not install into the reference checkout or a user profile. TypeScript and rrule are development dependencies, not runtime requirements.

Coverage includes Cordis scope inheritance, native tool registration/execution, prompt assembly, unload/re-enable, delayed fork masking, protected messaging, structured output, activation depth handling, failures and cleanup. Provider/model fixtures do not establish real paid model completion or a live Desktop deployment.

[Profile reference](docs/profiles.md) documents current behavior. The [issue drafts](docs/issues/) record proposals; repository Issues were disabled when those drafts were prepared, so they are retained locally in version control.
