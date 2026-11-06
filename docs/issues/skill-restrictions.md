# Issue draft: Native agent-scoped Skill allow/deny enforcement

> GitHub Issues was disabled in `iBobbyTS/dsh-subagent` when this draft was prepared (the API returned HTTP 410). Publish this on this fork after enabling Issues. Do not publish on the upstream DSH repository without separate approval.

## Problem

Skill whitelist/blacklist fields are deferred: DSH's SkillRegistry currently has no native equivalent to `agent.ctx.tools.restrict({ allow, deny })`. Skill discovery uses `ctx.skills.snapshot/list`, content loading uses `ctx.skills.get`, and user `/skill` invocations use another code path. Filtering only a catalog string or replacing the Skill tool is insufficient and potentially unsafe.

## Desired future native support

Implement the two fields only when DSH exposes a native Agent-scoped Skill restriction across discovery, loading, and model invocation, with predictable behavior for explicitly user-invoked Skills. Enforce restrictions before a child's first step and on cold resume; validate missing names. Do not reimplement the Skill lifecycle or create a shadow Skill registry.

## Historical v0.1.0 baseline

Historically empty Skill arrays were accepted and nonempty arrays rejected. These fields and their special handling have now been removed; all Skill-filter fields are unsupported Profile keys. They will return only when DSH provides complete native enforcement. See [current configuration](../profiles.md#configuration).

Relevant DSH sources: `packages/skill/skill/src/index.ts`, `packages/skill/tool-skill/src/index.ts`.
