# dsh-subagent — TOML named profiles (v0.1.0)

This fork changes the original plugin's model-facing behavior to **one `subagent` tool with a required `profile` argument**. It uses DeepSeek Harness' native `ctx.subagents.startActivation({ provider: 'spawn', delivery: 'parent' })` and `agent.ctx.tools.restrict()`; there is no replacement Subagent lifecycle, scheduler, message queue, or installer.

> Compatibility target: DSH 0.2.1-rc.1 or newer within the 0.2.x family. The implementation has automated unit/mocked-integration tests; a live DSH/Desktop integration test remains to be performed. The obsolete Settings-based per-profile tool UI was removed in favor of TOML files.

## Install and uninstall (official DSH entry)

Install this GitHub fork into the selected **DSH application profile** (this is unrelated to a Subagent Profile):

```sh
dsh plugin --profile web add github:iBobbyTS/dsh-subagent
# Or choose another DSH profile, e.g. desktop.
```

For **Desktop**, quit the application first and use its own bundled CLI, not a separate npm-installed `dsh`:

```sh
/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/cli/bin/dsh plugin --profile desktop add github:iBobbyTS/dsh-subagent
```

On Windows, the Desktop CLI is `resources\\runtime\\cli\\bin\\dsh.cmd` **inside the actual installed application directory**, which may be customized. Desktop's **Manage dsh Command...** UI can also register its own CLI in PATH. First launch Desktop once so that its profile exists, and quit it before running plugin commands.

Uninstall with the same official CLI selected for installation:

```sh
dsh plugin --profile web remove dsh-subagent
```

**No separate installer is needed.** When enabled, the plugin registers an Agent-scoped `subagent` tool whose definition shadows the official same-name tool for root Agents. Disabling/uninstalling the plugin removes this shadow, restoring the official tool. It does **not** disable the underlying built-in plugin or alter `subagent_fork`, `send_message`, `list_agents`, `interrupt_agent`, `list_subagent_models`, or workflow tools.

Because the package contains plain JavaScript and its manifest has **no `prepare` or build scripts**, installation from GitHub does not require permission for a package build script. NPM installs the regular TOML parsing dependency.

## TOML configuration

Profiles live in **`<resolved DSH_HOME>/agents/<profile>.toml`**. DSH uses the explicit configured Home, then the nonblank `DSH_HOME` environment variable, then `~/.dsh`; this plugin uses the official `@deepseek-ai/dsh-home-paths` resolver, not a hard-coded `~/.dsh` path.

Example `~/.dsh/agents/explorer.toml`:

```toml
# Exact DSH LLM-provider id (NOT the Subagent transport backend "spawn")
provider = "your-llm-provider-id"
model = "your-model-id"
reasoning_effort = "xhigh"

description = "Read-only codebase exploration, symbol search, and call-flow tracing"
developer_instruction = """
You are Explorer. Investigate the assigned code only.
Do not modify files, run destructive commands, or perform unrelated reviews.
Report verified findings with repository-relative paths and line numbers.
"""

# Optional. Use actual DSH end-tool names present in your Agent preset.
tool_whitelist = ["read", "glob", "grep"]
# tool_blacklist = ["edit", "write"]

# Parsed but not available in v0.1.0: any NONEMPTY Skill filter rejects the profile.
# skill_whitelist = []
# skill_blacklist = []
```

Exactly these keys are recognized: `provider`, `model`, `reasoning_effort`, `tool_whitelist`, `tool_blacklist`, `skill_whitelist`, `skill_blacklist`, `description`, `developer_instruction`. Only the first three are required. A Profile's id is the TOML filename without `.toml`; names must match `[a-z][a-z0-9_-]{0,63}`. Each TOML file is parsed independently; corrupt files are skipped while valid files remain available. Symlinks and oversized files are not followed. Both whitelist and blacklist use exact tool names, and a provided empty tool whitelist means **no inherited tools**. The Profile is always required by the tool; there is no implicit default/fallback Profile.

`description` is shown to the **main Agent** in its Profile catalog to guide delegation; `developer_instruction` is *not* placed in that catalog, the tool schema, or its call arguments. It is applied as a **child-scoped Persona prefix** via DSH's native system-prompt registry. This is *not* a distinct protocol-level `developer` message and not a secrecy boundary against a main Agent that can directly read the user's TOML files.

## Usage

Model-facing API:

```json
{
  "profile": "explorer",
  "prompt": "Explore the login module and return the authentication model",
  "description": "Inspect login authentication",
  "cwd": "/path/to/project"
}
```

The call is made to the **official tool name `subagent`**, now scoped to use the configured Profile. It returns `{ "kind": "activation", "subagentId": "..." }` immediately. DSH's activation runtime delivers completion or failure via its normal parent notification; subsequent interactions use the official `send_message` tool.

## Validation, errors and recovery

- TOML is read at startup and on directory changes, and **again on every Spawn**. Invalid profiles are skipped in the model-facing catalog, with a distinct reason (`TOML_PARSE_ERROR`, `UNSUPPORTED_FIELD`, `MISSING_REQUIRED_FIELD`, `INVALID_FIELD_TYPE`, etc.). Attempts to Spawn one return the same error.
- `PROVIDER_NOT_FOUND` is detected using DSH's registered Provider directory. The native `llm.resolveCallConfig()` validates the exact Model and Reasoning Effort. `REASONING_EFFORT_UNAVAILABLE` and confirmed `MODEL_NOT_FOUND` are distinct. Errors the adapter cannot disambiguate (network failures, dynamic unlisted Models) become `MODEL_UNVERIFIED`, **not** an invented not-found claim.
- Tool lists are checked against the effective Agent tools. Missing names become `TOOL_NOT_FOUND`. The native `tools.restrict({ allow, deny })` applies the restriction to the child Agent scope. It is a DSH capability restriction, not a filesystem/security sandbox; child scope-local registrations and shell capabilities require separate security review.
- `skill_whitelist` and `skill_blacklist` are accepted only when empty. Nonempty lists produce `UNSUPPORTED_SKILL_FILTER` and the Profile is **not spawned**: DSH has no equivalent scoped Skill-filter API, and hiding only the Skill catalog would be an unsafe partial implementation.
- DSH persists the profile id and a fingerprint in the built-in Subagent **descriptor label**, avoiding any custom Session events. On cold resume, the plugin re-reads the TOML and verifies the fingerprint before reapplying its Persona and tool policy. A changed/deleted Profile makes resume fail closed with `PROFILE_CHANGED`/`PROFILE_NOT_FOUND`, rather than silently widening permissions. Existing live child policies stay owned by the child scope when the routing plugin unloads.
- Pre-admission and startup errors are normal DSH Tool errors (`isError`) and include diagnostic codes in text. Errors **after** a child is accepted are reported by DSH's native activation/completion flow; they are not converted into synchronous Tool errors.

## v0.1.0 exclusions / next steps

The native `subagent_fork` is not changed. No Skill-filter workaround, independent installation script, new scheduler or external ACP bridge is provided. See [tracked GitHub Issue drafts](docs/issues/) for Skill restrictions and future Fork Profile support. The repository's GitHub Issues feature was **disabled** when these were prepared, so the drafts are committed to this repository until Issues are enabled.

## Development

```sh
npm install --ignore-scripts --legacy-peer-deps
npm run check
npm pack --dry-run
```

This project retains the original MIT license and copyright attribution. The previous `dsh-subagent` UI and per-profile `subagent_<name>` tools were removed intentionally; users must migrate their profile settings to TOML.
