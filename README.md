# dsh-subagent

English | [中文](README.zh.md)

`dsh-subagent` is a community [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for reusable, named subagent profiles. Each profile becomes a model-visible delegation tool with its own backend, model-routing policy, and reasoning policy.

This repository is independent of the core `@deepseek-ai/dsh-subagent` package. The core package provides the `ctx.subagents` service; this plugin composes that service into configurable tools such as `subagent_fast` and `subagent_reviewer`.

## Features

- Create, edit, and delete named subagent profiles from **Settings → Subagents**.
- Use `spawn` for an independent child context or `fork` to inherit the completed parent conversation.
- Follow the current conversation's Provider and Model, or select an atomic custom Provider/Model route.
- Follow the conversation's reasoning effort, use the selected model's default, or choose a custom effort.
- Refresh custom Provider, Model, and effort choices from the live Host model catalog.
- Apply profile updates without restarting the Host; existing continuable children retain the route resolved when they were created.
- Manage the same durable profiles through the model-visible `custom_subagent` tool.

## Requirements

- DeepSeek Harness `0.1.1-rc.2` compatible packages.
- Node.js `^22.19.0` or `>=24.0.0`.
- A DSH profile using the standard base composition, which provides the `spawn` and `fork` subagent providers and the model catalog.

## Install from GitHub

Install the plugin into the Web profile:

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent
```

For reproducible installations, pin a commit:

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent#<commit-sha>
```

Then start or restart DSH Web:

```sh
dsh --profile web
```

The repository ships executable JavaScript, so GitHub installation does not need a `prepare` build.

### Install from a local checkout

```sh
git clone https://github.com/xie-tj/dsh-subagent.git
cd dsh-subagent
pnpm install
dsh plugin --profile web add .
```

## Usage tutorial

### 1. Open the Subagents settings page

Open **Settings → Subagents**. The initial profiles are:

| Profile | Backend | Model route | Reasoning | Child context |
|---|---|---|---|---|
| `fast` | `spawn` | Follow conversation | Custom `low` | Independent context |
| `reviewer` | `fork` | Follow conversation | Custom `high` | Inherits the completed parent conversation |

These are editable user profiles supplied as initial plugin settings, not read-only DSH system profiles.

### 2. Configure a profile

Select **Edit** on a profile and choose:

1. **Backend** — `spawn` or `fork`.
2. **Model configuration** — follow the current conversation or select a custom Provider and Model.
3. **Reasoning configuration** — follow the conversation/model default or select a custom effort.
4. **Description** — explains the profile's intended work to the model.

Custom routing always stores Provider and Model together. If the selected route disappears from the live model catalog, the UI shows the stale value and blocks saving until a valid route is selected.

### 3. Create a specialized profile

Select **New subagent**, enter a lower-case identifier such as `deep-research`, and configure its backend and policies. Profile names must match:

```text
^[a-z][a-z0-9_-]{0,23}$
```

The profile immediately creates a tool named `subagent_deep-research` for each live root Agent.

### 4. Use a profile in a conversation

Ask the Agent to delegate work to the named profile, for example:

```text
Use the reviewer subagent to inspect this change for correctness and test gaps.
```

The Agent can call `subagent_reviewer`; routing choices are fixed by the saved profile and are not exposed as tool-call arguments.

## Configuration format

The Settings page and `custom_subagent` tool write the same `dsh-subagent` settings namespace. A representative `settings.yaml` section is:

```yaml
dsh-subagent:
  profiles:
    - name: fast
      description: Quick lookups and lightweight checks.
      backend: spawn
      modelRouting:
        mode: follow-conversation
      reasoning:
        mode: custom
        effort: low
    - name: reviewer
      description: Review changes with a dedicated model.
      backend: fork
      modelRouting:
        mode: custom
        provider: openai-codex
        model: gpt-5.6-luna
      reasoning:
        mode: custom
        effort: high
```

`modelRouting` is either `{ mode: 'follow-conversation' }` or an atomic custom `{ mode: 'custom', provider, model }` record. `reasoning` independently follows the conversation or stores `{ mode: 'custom', effort }`.

The plugin does not read the retired `$DSH_HOME/custom-subagents.json` file. Flat `provider`, `model`, and `reasoningEffort` fields belong to an obsolete pre-release format and are rejected.

## Update and uninstall

Update to a chosen commit by running `add` again with the new pinned GitHub reference, then restart the profile. To remove the plugin:

```sh
dsh plugin --profile web remove dsh-subagent
```

Removing the plugin removes its profile dependency and composition layer. It does not rewrite unrelated settings.

## Troubleshooting

- **No Subagents section:** confirm the plugin is installed in the profile that serves the Web UI, then restart that profile.
- **A custom route cannot be saved:** select a Provider, Model, and effort currently present in the Host model catalog.
- **Duplicate `subagent_<name>` or `custom_subagent` registration:** stop and remove any older dynamic subagent-profile plugin before enabling this plugin.
- **No provider for `spawn` or `fork`:** use the standard DSH base composition or install the matching subagent provider.

## Development

```sh
pnpm install
pnpm test
```

`pnpm test` runs schema/runtime tests, browser-client registration and rendering tests, and a real Cordis Loader composition lifecycle test.

## Model Experience

- **Model-visible tools:** one Agent-scoped delegation tool per profile, plus the Agent-scoped `custom_subagent` management tool.
- **Prompt and token effects:** a child receives the route and reasoning policy resolved when it is created, plus the configured persona, tool filter, depth limit, and backend context policy. The parent request does not gain the child's transcript, and this plugin adds no cache layer.
- **Persistence:** profile updates are written through the DSH settings provider and remain available to later sessions in the same profile.

## Known Limitations and Deferred Work

- Provider and Model choices in the GUI are limited to routes returned by the live Host model catalog. Direct settings can name another registered route, but the GUI has no free-form fallback when the catalog omits it.
- The settings section currently ships Chinese field copy while its navigation label follows the Host locale.

## License

[MIT](LICENSE)
