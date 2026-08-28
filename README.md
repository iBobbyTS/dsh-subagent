# dsh-subagent

English | [中文](README.zh.md)

`dsh-subagent` is a community [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that turns named subagent profiles into model-visible delegation tools. Each profile fixes a backend, a model route, and a reasoning policy, and exposes one tool named `subagent_<profile>` to every live root Agent.

This repository is independent of the core `@deepseek-ai/dsh-subagent` package. The core package provides the `ctx.subagents` service; this plugin composes that service into configurable tools such as `subagent_fast` and `subagent_reviewer`, plus the `custom_subagent` management tool.

## Table of contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Install](#install)
4. [Where state lives](#where-state-lives)
5. [Usage tutorial](#usage-tutorial)
6. [Configuration format](#configuration-format)
7. [Update and uninstall](#update-and-uninstall)
8. [Troubleshooting](#troubleshooting)
9. [Model experience](#model-experience)
10. [Known limitations and deferred work](#known-limitations-and-deferred-work)
11. [Development](#development)
12. [License](#license)

## Features

- Create, edit, and delete named subagent profiles from **Settings → Subagents**.
- Choose `spawn` for an independent child context or `fork` to inherit the completed parent conversation.
- Follow the current conversation's Provider and Model, or pin a custom Provider/Model route.
- Follow the conversation's reasoning effort, use the selected model's default, or pin a custom effort.
- Refresh custom Provider, Model, and effort choices from the live Host model catalog.
- Apply profile updates without restarting the Host; existing continuable children retain the route resolved when they were created.
- Manage the same durable profiles through the model-visible `custom_subagent` tool.
- Mark one profile as the **default subagent**: a selector at the top of the settings page or the `custom_subagent` `set-default` action. While set, every root Agent's system prompt gains one short section that nudges unnamed delegation requests toward the matching `subagent_<name>` tool.

## Prerequisites

| Requirement | Version / detail | How to check |
|---|---|---|
| DeepSeek Harness | `0.1.1-rc.2` compatible packages (this plugin's peerDeps pin `0.1.1-rc.2`) | `dsh --version` |
| DSH profile | The profile you want to extend must be `web` (or another profile that loads the Web UI). `headless` and `tui` profiles do not surface the settings page. | `dsh profile list` |
| Node.js | `^22.19.0` or `>=24.0.0` | `node -v` |
| pnpm | On `PATH`; the CLI delegates installs to pnpm | `pnpm -v` |
| Base composition | A profile that ships `spawn` and `fork` subagent providers and the model catalog. The shipped `web` and `headless` profiles do; custom profiles must include `@deepseek-ai/dsh-subagent-spawn` and `@deepseek-ai/dsh-subagent-fork` (or equivalent providers) plus the `dsh-tool-subagent` capability. | `dsh plugin --profile web why` (look for `dsh-tool-subagent`, `dsh-subagent-spawn`, `dsh-subagent-fork`) |
| Network | HTTPS to `github.com` and `registry.npmjs.org` for the GitHub install path | `curl -fsI https://github.com` |

If any check fails, fix it before installing the plugin. The CLI does not auto-install missing prerequisites.

## Install

### Choose an install path

| Path | When to use | Builds required? |
|---|---|---|
| **GitHub (recommended for users)** | You want a reproducible install of a published version. Pin to a commit SHA in production. | No (the repo ships executable JavaScript). |
| **Local checkout** | You are developing or debugging the plugin and want changes picked up after restart. | `pnpm install` once. |
| **npm registry** | When (and if) a future release is published to npm. | No. |

### Path A — Install from GitHub

Install the plugin into the Web profile:

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent
```

For reproducible installations, pin a commit:

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent#09402ca21e086bed604f86818624a7435d65b572
```

(`09402ca2` is the current published commit on `main`; replace it with the SHA you want to lock to.)

The CLI initializes the profile directory if it is missing, then delegates the rest to pnpm. Relative path specs (e.g. `add .` from a plugin checkout) are anchored to your current working directory, not the profile.

Verify the install:

```sh
dsh plugin --profile web why | grep -i dsh-subagent
```

You should see the plugin name, version, and its declared `cordis.patch.yml` layer in the dependency tree.

### Path B — Install from a local checkout

```sh
git clone https://github.com/xie-tj/dsh-subagent.git
cd dsh-subagent
pnpm install
dsh plugin --profile web add .
```

`pnpm install` resolves the plugin's own `devDependencies` (loader and include helpers, `dsh-scope`). The CLI then registers the directory as a local dependency in the Web profile. Edits inside `dsh-subagent/` take effect after restarting the Web profile.

### Start or restart the Web profile

```sh
dsh --profile web
```

Open `http://127.0.0.1:3080` (or the URL printed by the CLI), then go to **Settings → Subagents**. The initial profiles are listed in the [Usage tutorial](#usage-tutorial) below.

### Install into a non-`web` profile

The plugin declares `dsh.client.platform: web`. The settings UI and the `subagent_<name>` tools require a profile that loads the Web runtime. To install into a different profile, add it the same way:

```sh
dsh plugin --profile <name> add github:xie-tj/dsh-subagent
```

…but the profile must additionally load `@deepseek-ai/dsh-client-ui-settings` (or the settings UI consumer you want) for **Settings → Subagents** to render. The `custom_subagent` management tool is always available to the Agent regardless of UI.

## Where state lives

The plugin keeps no on-disk state of its own. Three locations matter:

1. **DSH settings provider** — the Web profile's settings file. It contains a `dsh-subagent` namespace with `profiles` and the optional `defaultProfile`. The Settings page and the `custom_subagent` tool both write here. Find the file with `dsh plugin --profile web why` (look for the `settings` entry) or the `DSH_HOME` / `$DSH_HOME` environment variable.
2. **Profile dependency manifest** — the Web profile's `package.json` lists the plugin under `dependencies`. The CLI reconciles this with the actual install state on every `add` / `remove` / `update`. To audit: `dsh plugin --profile web why`.
3. **Composition layer** — the plugin's `cordis.patch.yml` is merged into the profile's Cordis composition by the CLI's bundle reconciler. Inspecting it requires reading the profile's resolved `cordis.yml`; the easiest way is `dsh plugin --profile web why | grep -A2 'dsh-subagent'`.

The plugin does **not** read the retired `$DSH_HOME/custom-subagents.json` file. Flat `provider`, `model`, and `reasoningEffort` fields belong to an obsolete pre-release format and are rejected at load.

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

### 4. Set the default subagent

Pick a profile in the **Default subagent** selector at the top of the page, or call the `custom_subagent` `set-default` action (omitting `name` clears the designation). While set, each root Agent's system prompt gains one short section: delegation requests that name no profile — such as "open a subagent" — prefer the matching `subagent_<name>` tool.

A `defaultProfile` that names no existing profile is rejected at load and at save time. The current default profile cannot be deleted until another default is chosen or the designation is cleared.

### 5. Use a profile in a conversation

Ask the Agent to delegate work to the named profile, for example:

```text
Use the reviewer subagent to inspect this change for correctness and test gaps.
```

The Agent can call `subagent_reviewer`; routing choices are fixed by the saved profile and are not exposed as tool-call arguments.

## Configuration format

The Settings page and `custom_subagent` tool write the same `dsh-subagent` settings namespace. A representative `settings.yaml` section is:

```yaml
dsh-subagent:
  defaultProfile: fast
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

The optional `defaultProfile` names the delegation tool used when no profile is named; it must exist in `profiles`. Deleting the current default profile is refused until another default is chosen or the field is cleared.

The plugin does not read the retired `$DSH_HOME/custom-subagents.json` file. Flat `provider`, `model`, and `reasoningEffort` fields belong to an obsolete pre-release format and are rejected.

## Update and uninstall

### Update to a specific version

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent#<new-commit-sha>
dsh --profile web
```

The CLI reconciles the manifest and the `cordis.patch.yml` layer. Restart the profile to load the new code; existing continuable children keep the route they were created with.

### Roll back to an earlier version

Same command, with an older SHA. The CLI does not store a history of past versions, so keep your own notes of which SHA you want to roll back to.

### Uninstall

```sh
dsh plugin --profile web remove dsh-subagent
dsh --profile web
```

Removing the plugin removes the dependency from the profile's `package.json` and the `dsh-subagent` layer from the resolved composition. **It does not delete the `dsh-subagent` namespace from the settings file.** If you also want to wipe saved profiles, edit the settings file (see [Where state lives](#where-state-lives)) and remove the `dsh-subagent:` block manually. Reinstalling the plugin later will not recreate the previous profiles.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **No "Subagents" section in Settings** | Plugin is installed in a profile that does not load the Web UI, or the profile was not restarted after install. | Confirm the profile: `dsh plugin --profile web why | grep dsh-subagent`. Restart: `dsh --profile web`. |
| **`dsh plugin --profile web add` fails with peerDependency error** | DSH core packages are older than `0.1.1-rc.2`. | Upgrade DSH (see your distribution's upgrade steps), then retry. |
| **`cordis.patch.yml` not visible in `dsh plugin --profile web why`** | The plugin's manifest was not picked up by the CLI's bundle reconciler, often because the dependency was added manually rather than through `dsh plugin add`. | Re-add through the CLI: `dsh plugin --profile web remove dsh-subagent && dsh plugin --profile web add github:xie-tj/dsh-subagent#<sha>`. |
| **A custom route cannot be saved** | The selected Provider/Model/effort is not in the live Host model catalog. | Refresh the catalog from the settings page, or pick a route the catalog currently returns. |
| **Duplicate `subagent_<name>` or `custom_subagent` registration** | Another dynamic subagent-profile plugin is mounted alongside this one. | Stop and remove the older plugin before enabling this one. |
| **Deleting a profile reports it as the default subagent** | `defaultProfile` still names it. | Pick a different default (or "不设置" / unset) first, then delete. |
| **No provider for `spawn` or `fork`** | The profile is missing the subagent providers. | Use a profile that ships them, or add `@deepseek-ai/dsh-subagent-spawn` / `@deepseek-ai/dsh-subagent-fork` (or equivalent) and the `dsh-tool-subagent` capability to the profile. |
| **Settings lost after reinstall** | The `dsh-subagent` namespace lives in the settings file; `dsh plugin remove` does not delete it. | Restore from your settings backup, or re-create the profiles through **Settings → Subagents**. |
| **`defaultProfile` rejected on load** | The saved default names a profile that no longer exists. | Edit the settings file and either remove the `defaultProfile` line or set it to an existing profile name, then restart. |

## Model experience

- **Model-visible tools:** one Agent-scoped delegation tool per profile (`subagent_<name>`), plus the Agent-scoped `custom_subagent` management tool.
- **Prompt and token effects:** a child receives the route and reasoning policy resolved when it is created, plus the configured persona, tool filter, depth limit, and backend context policy. While a default profile is set and its tool is mounted, the parent prompt carries one fixed short section; otherwise nothing is added. The parent request does not gain the child's transcript, and this plugin adds no cache layer.
- **Persistence:** profile updates are written through the DSH settings provider and remain available to later sessions in the same profile.

## Known limitations and deferred work

- Provider and Model choices in the GUI are limited to routes returned by the live Host model catalog. Direct settings can name another registered route, but the GUI has no free-form fallback when the catalog omits it.
- The settings section currently ships Chinese field copy while its navigation label follows the Host locale.
- `dsh plugin remove` does not delete the `dsh-subagent` namespace from the settings file. Wipe it manually if you want a clean slate.

## Development

```sh
pnpm install
pnpm test
```

`pnpm test` runs schema/runtime tests, browser-client registration and rendering tests, and a real Cordis Loader composition lifecycle test.

The repository ships executable JavaScript and does not need a build step for installation.

## License

[MIT](LICENSE)
