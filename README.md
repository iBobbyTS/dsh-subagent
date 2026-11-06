# dsh-subagent — TOML profiles

[中文](README.zh.md)

This fork provides one `subagent` tool with a required named TOML profile. Profiles fix the model route, role instructions and tool policy; DSH owns child execution, messaging and completion. The old per-profile tool UI is not included.

Requires Node.js `>=24.9.0`.

## Compatibility

Verified: DSH 0.2.2-rc.1 (source review and automated checks); Desktop testing has not been completed.

## Install

Install this fork into your DSH application profile:

```sh
dsh plugin --profile web add github:iBobbyTS/dsh-subagent
```

For Desktop, launch it once, quit it, and use its bundled CLI:

```sh
/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/cli/bin/dsh plugin --profile desktop add github:iBobbyTS/dsh-subagent
```

Windows Desktop provides `resources\runtime\cli\bin\dsh.cmd` inside the actual application directory. Desktop's **Manage dsh Command...** can register its CLI in PATH. Restart the target Host after installation or updates. Uninstall with the same CLI and profile, replacing `add ...` with `remove dsh-subagent`.

## Configure and use

Create `<DSH_HOME>/agents/explorer.toml`, using actual registered provider and model IDs:

```toml
provider = "your-provider-id"
model = "your-model-id"
reasoning_effort = "xhigh"
description = "Read-only code exploration"
developer_instruction = "Investigate the assigned code without modifying it."
```

The main Agent calls `subagent` with `profile: "explorer"` and a self-contained `prompt`. DSH returns an activation ID and delivers completion through its native lifecycle; follow-up messages use `send_message`.

The root Agent's inherited `subagent_fork` and `list_subagent_models` are hidden; use `list_subagent_profiles` for current names and descriptions. The initial catalog is read once; each spawn rereads only its selected TOML. Skill filters are planned once DSH provides a complete native scoped API. Tool filtering is a capability restriction, not a filesystem sandbox.

Labels retain only the Profile name, without fingerprints. Native Host storage retains each child's original persona/tool policy; continuation does not revalidate the current TOML. Plugin snapshots expire after 30 days without activity. Cleanup protects live/starting children and offline pending messages, and never deletes native history or Profile files. An expired snapshot prevents cold continuation rather than dropping restrictions. The Host needs `storageDomain` with a persistent backend. See the [profile reference](docs/profiles.md) for depth settings, migration limits and errors.

## Development and backlog

[CONTRIBUTING](CONTRIBUTING.md) describes source-based integration tests. Future [fork profiles](docs/issues/fork-profiles.md) and [Skill restrictions](docs/issues/skill-restrictions.md) are proposals, not current capabilities.

This fork retains the original MIT license and copyright attribution.
