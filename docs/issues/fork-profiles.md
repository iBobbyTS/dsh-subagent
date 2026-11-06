# Issue draft: Native Fork subagents with named TOML Profile selection

> GitHub Issues was disabled in `iBobbyTS/dsh-subagent` when this draft was prepared (HTTP 410). Publish on this fork once Issues are enabled.

## Problem

The official `subagent_fork` currently inherits the parent's completed conversation and tool/Persona composition. Its backend doesn't support independently selecting an Agent Preset. The existing TOML plugin routes only the official `spawn` entry.

## Desired enhancement

Add optional named Profile selection for Fork only when official DSH supports a child-specific persona and tool/Skill policy without reimplementing Fork lifecycle. Omitted Profile must remain backward-compatible with official `subagent_fork`. Profile selection should preserve the parent's completed-turn seed and record the selected child policy for cold resume. Never silently expand permission, and document possible KV-cache reuse degradation.

## Historical v0.1.0 baseline

The original v0.1.0 baseline left `subagent_fork` untouched. The current implementation hides the root Agent's inherited fork entry while Profile-aware fork routing remains deferred; messaging and other control tools remain native. See [current scope and lifecycle](../profiles.md#scope-and-lifecycle).

Relevant DSH sources: `packages/subagent/subagent-fork-in-process/src/index.ts`, `packages/subagent/tool-subagent/src/preset-selection.ts`.
