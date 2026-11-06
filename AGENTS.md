# dsh-subagent development

Provide named TOML profiles through the native `subagent` entry. DSH owns providers, child execution, identity, messaging, completion and resource lifecycle. Do not add a scheduler, external transport, standalone installer or old preset-snapshot compatibility layer.

- [Profile reference](docs/profiles.md) owns routing, field semantics, errors and resume behavior. Preserve root-only routing and fork restriction; unrelated children stay untouched, and Profile policies remain child-owned after Host unload.
- The bundle inserts only the Host plugin. Do not override native persona/mode configs or write user application-profile files as part of tests.
- Keep native protected communication and on-demand structured output intact. Do not implement partial Skill filtering without a complete native scoped API.
- Recover a child's own profile identity rather than an inherited ancestor descriptor. Preserve the stored profile policy when resuming.
- Keep both README languages and delivered references aligned. Do not commit credentials, user profiles, session data, dependency directories or temporary fixtures.
- Follow [CONTRIBUTING](CONTRIBUTING.md) for checks. Lifecycle changes need an actual source-runtime activation check, including failure and cleanup; unit fixtures alone do not prove paid model completion or live Desktop behavior.
