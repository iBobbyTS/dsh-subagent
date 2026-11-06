# dsh-subagent development

Provide named TOML profiles through the native `subagent` entry. DSH owns providers, child execution, identity, messaging, completion and resource lifecycle. Do not add a scheduler, external transport, standalone installer or old preset-snapshot compatibility layer.

- [Profile reference](docs/profiles.md) owns routing, field semantics, errors and resume behavior. Preserve root-only routing and fork restriction; unrelated children stay untouched, and Profile policies remain child-owned after Host unload.
- The bundle inserts only the Host plugin. Do not override native persona/mode configs or write user application-profile files as part of tests.
- Keep native protected communication and on-demand structured output intact. Do not implement partial Skill filtering without a complete native scoped API.
- Retain only the Profile name in the child's own descriptor label, never an ancestor identity or configuration fingerprint. Resume its creation-time policy from native storage without consulting current TOML. Thirty-day idle cleanup owns only plugin sidecars; never delete native sessions or Profile files, and never resume without retained restrictions.
- Keep both README languages and delivered references aligned. Do not commit credentials, user profiles, session data, dependency directories or temporary fixtures.
- Follow [CONTRIBUTING](CONTRIBUTING.md) for checks. Lifecycle changes need an actual source-runtime activation check, including failure and cleanup; unit fixtures alone do not prove paid model completion or live Desktop behavior.

共同构建与交付合同见[统一规范](../docs/plugin-development.md)；`src/` 是运行逻辑编辑源，`lib/` 由构建生成。具体维护命令由本项目开发文档拥有。
