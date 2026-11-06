# dsh-subagent — TOML profiles

[中文](README.zh.md)

This fork provides one `subagent` tool with a required named TOML profile. Profiles fix the model route, role instructions and tool policy; DSH owns child execution, messaging and completion. The old per-profile tool UI is not included.

The current source and automated compatibility target is DSH `0.2.2-rc.1` with Node.js `>=24.9.0`. Paid model-backed child completion and a real Desktop UI acceptance pass are separate from those checks.

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

The root Agent's inherited `subagent_fork` is currently hidden. Nonempty Skill filters are unsupported. Tool filtering is a DSH capability restriction, not a filesystem sandbox. These limits and all profile fields, errors and cold-resume behavior are documented in the [profile reference](docs/profiles.md).

## Development and backlog

[CONTRIBUTING](CONTRIBUTING.md) describes source-based integration tests. Future [fork profiles](docs/issues/fork-profiles.md) and [Skill restrictions](docs/issues/skill-restrictions.md) are proposals, not current capabilities.

This fork retains the original MIT license and copyright attribution.
