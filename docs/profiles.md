# TOML profiles and native runtime integration

## Scope and lifecycle

**No separate installer or profile editing is needed.** Installation selects one DSH application profile, not one Agent mode. The bundle only inserts a Host plugin; it never overrides `preset-standard`, `preset-ptc`, `preset-cordis`, persona, or another bundle's config. For each existing or newly created **root Agent** (a conversation's main Agent), the plugin registers its own `subagent` in that Agent's scope. Official preset definitions remain in the ancestor scope and are shadowed, not removed. Fixed TOML profiles own the replacement's model route; native model-selection preferences and model discovery are not switched off.

The root Agent's inherited `subagent_fork` is intentionally hidden until a future fork redesign. This is an Agent-local tool restriction, not global unloading of the fork tool package or backend. A fork that appears later, for example after changing a blank Agent's preset, is also hidden. Unrelated/non-Profile children are not given the root router or root fork restriction; Profile children use their own TOML tool policy. `send_message`, `list_agents`, `interrupt_agent`, workflow, providers, and lifecycle services are not replaced. `workflow` does not route through this Profile tool.

Disabling/unloading the Host plugin removes its root registrations and restrictions, revealing the native spawn and fork definitions again. Both Agent disposal and plugin unload own cleanup; already running Profile children's restrictions remain child-owned so unload does not widen their permissions. Depending on the installation's reload support, restart may be required to load updated plugin code. Test in a new session after upgrading from v0.1.0; existing Agents can retain the old preset revision. Remove any manually copied legacy preset overrides separately after reviewing their ownership—the plugin never deletes user configuration.

This works across presets with the required native services; no per-mode preset copy is needed. Presets without fork need no fork restriction. A third party registering `subagent` or `subagent_fork` in the same root Agent layer is a collision, not something this plugin silently overwrites.

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

# Nonempty Skill filters are unsupported and reject the profile.
# skill_whitelist = []
# skill_blacklist = []
```

Exactly these keys are recognized: `provider`, `model`, `reasoning_effort`, `tool_whitelist`, `tool_blacklist`, `skill_whitelist`, `skill_blacklist`, `description`, `developer_instruction`. Only the first three are required. A Profile's id is the TOML filename without `.toml`; names must match `[a-z][a-z0-9_-]{0,63}`. Each TOML file is parsed independently; corrupt files are skipped while valid files remain available. Symlinks and oversized files are not followed. Both whitelist and blacklist use exact tool names, and a provided empty tool whitelist means **only the protected inherited `send_message` tool** (plus any child-local tools injected by the native runtime). The Profile is always required by the tool; there is no implicit default/fallback Profile.

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
- Tool lists are checked against the effective Agent tools. Missing names become `TOOL_NOT_FOUND`, except `structured_output` may be named in a whitelist before it exists. `send_message` is automatically retained when applying a whitelist, without modifying the stored Profile or its fingerprint. A parent/child runtime missing native `send_message` fails closed with `REQUIRED_TOOL_UNAVAILABLE`; the plugin never installs a substitute.
- `send_message` and `structured_output` are protected: either name in `tool_blacklist` makes the Profile invalid with `PROTECTED_TOOL_BLACKLIST`, including when it also appears in the whitelist. The catalog displays the error and spawn is rejected before route preflight or backend activation.
- `structured_output` remains owned by the native runtime: it is injected only for tasks requesting structured output, not eagerly by this plugin and not merely because it appears in a whitelist. Its child-local registration is exempt from inherited-tool restrictions, whether injection happens before or after policy installation. The current Profile spawn API does not add an `outputSchema`/`output_schema` parameter.
- Parent preflight accounts for the fork tool hidden by this plugin's root-only restriction, so a child Profile may still allow or deny `subagent_fork`. This is not a promise that the child's current preset provides fork: the child strictly revalidates its actual tools before its first turn, and missing tools still fail closed.
- The native `tools.restrict({ allow, deny })` applies the restriction to the child Agent scope. It is a DSH capability restriction, not a filesystem/security sandbox; child scope-local registrations and shell capabilities require separate security review.
- `skill_whitelist` and `skill_blacklist` are accepted only when empty. Nonempty lists produce `UNSUPPORTED_SKILL_FILTER` and the Profile is **not spawned**: DSH has no equivalent scoped Skill-filter API, and hiding only the Skill catalog would be an unsafe partial implementation.
- DSH persists the profile id and a fingerprint in the built-in Subagent **descriptor label**, avoiding any custom Session events. Recovery reads only the child-owned event range after `inheritedEventCount`; an inherited ancestor descriptor is not the current child's identity. On cold resume, the plugin re-reads the TOML and verifies the fingerprint before reapplying its Persona and tool policy. A changed/deleted Profile makes resume fail closed with `PROFILE_CHANGED`/`PROFILE_NOT_FOUND`, rather than silently widening permissions. Existing live child policies stay owned by the child scope when the routing plugin unloads.
- Pre-admission and startup errors are normal DSH Tool errors (`isError`) and include diagnostic codes in text. Errors **after** a child is accepted are reported by DSH's native activation/completion flow; they are not converted into synchronous Tool errors.


## Source contract

The checked target is DSH `0.2.2-rc.1`. Activation task options are nested under `request`, including `parent`, `maxDepth`, `prompt`, `cwd` and `agentOptions`; `provider`, `childId`, `label`, `signal` and `delivery` remain activation options. Tests against a different prerelease do not establish compatibility with this contract.

See [development setup](../CONTRIBUTING.md) for integration-test configuration. The source and automated checks do not establish paid model-backed completion or live Desktop UI validation.
