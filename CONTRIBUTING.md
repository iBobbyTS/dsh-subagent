# Development

The current source-runtime validation target is DSH `0.2.2-rc.1` and Node.js `>=24.9.0`. Host source lives in `src/*.ts`; committed `lib/` JS/maps are generated with `pnpm build:runtime`, so plugin installation needs no compiler. Activation task inputs use the release API's `request` object.

## Local checks

```sh
pnpm install --frozen-lockfile
pnpm check
```

## Source integration

The reference checkout need not be built. Tests map its source packages and use TypeScript's standard-decorator transform. The locked development dependencies supply the third-party modules used by these fixtures. An optional `DSH_TEST_EXTERNAL_ANCHOR` supplies additional third-party dependencies; it does not substitute installed DSH modules for source packages.

```sh
DSH_TEST_SOURCE_ROOT=/absolute/path/to/deepseek-harness \
pnpm check
```

Without `DSH_TEST_SOURCE_ROOT`, source integration suites explicitly skip. Temporary fixture homes are under `.agent-work/tmp/native-shadowing/`; tests do not install into the reference checkout or a user profile. The source runner and its dependencies are development-only. Fixture homes created during candidate checks are cleaned with the temporary candidate.

Coverage includes Cordis scope inheritance, native tool registration/execution, prompt assembly, unload/re-enable, delayed fork masking, protected messaging, structured output, activation depth handling, failures and cleanup. Provider/model fixtures do not establish real paid model completion or a live Desktop deployment.

[Profile reference](docs/profiles.md) documents current behavior. The [issue drafts](docs/issues/) record proposals; repository Issues were disabled when those drafts were prepared, so they are retained locally in version control.

## Source, build and distribution

Use package.json's pinned pnpm; build tools need Node 24.11+ (the installed plugin keeps its declared Node requirement). `pnpm typecheck` uses actual DSH 0.2.2-rc.1 public Host types. `pnpm test` builds a temporary candidate before running tests; `pnpm check:dist` compares its complete generated files to working `lib/` and checks the tarball's files, maps, install and Host load. `pnpm check` runs typecheck, tests and dist against one isolated build. It never overwrites working lib to make the comparison pass. Sources accompany maps; no Client or install-time compilation is added.
