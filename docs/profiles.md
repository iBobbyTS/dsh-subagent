# TOML profiles and native runtime integration

## Scope

The bundle inserts one Host plugin. It replaces the root Agent's inherited `subagent` entry in that Agent's own scope; no preset, persona config, provider or user application-profile file is rewritten. The root requires a named TOML Profile instead of model-selection arguments. Its inherited `subagent_fork` and `list_subagent_models` are hidden, including definitions mounted later. `list_subagent_profiles` lists current Profile names and descriptions.

Routing remains root-only. Children keep the native delegation entry and native recursion policy, subject to their Profile's tool filters. The root fork restriction is not a global removal of the fork backend or other Agents' tools. Unrelated children are untouched. Native `send_message`, `list_agents`, `interrupt_agent` and workflow remain native; workflow does not route through Profile spawn.

Disabling/unloading removes the root replacement, list tool, prompt contributions and masks, revealing native tools again. Existing live child policies remain child-owned; unload must not widen their permissions. Cold continuation of Profile children requires this plugin to be enabled because rc.1 does not automatically persist its extra scoped registrations.

## Configuration

Profiles live at `<resolved DSH_HOME>/agents/<name>.toml`, using the official Home resolver. The filename without its extension is the Profile name and must match `[a-z][a-z0-9_-]{0,63}`.

~~~toml
provider = "your-llm-provider-id"
model = "your-model-id"
reasoning_effort = "high"
description = "Read-only code exploration"
developer_instruction = "Investigate the assigned code without modifying it."
tool_whitelist = ["read", "glob", "grep"]
# tool_blacklist = ["edit", "write"]
~~~

Only `provider`, `model` and `reasoning_effort` are required. Optional fields are `description`, `developer_instruction`, `tool_whitelist` and `tool_blacklist`. Unknown fields are rejected at spawn. Skill whitelist/blacklist fields are not currently implemented; support is planned once DSH provides a complete native Agent-scoped Skill policy API.

`provider` is the LLM provider ID, not the transport backend `spawn`. `description` describes responsibilities to the main Agent. `developer_instruction` is applied only to the child as a persona prefix, not a distinct protocol-level developer message. It is not a secrecy boundary against an Agent that can read the TOML files.

Both tool lists use exact native tool names. An empty whitelist retains protected inherited `send_message` and child-local runtime tools. `send_message` is always retained; blacklisting it or `structured_output` is rejected. Native structured output remains runtime-owned and injected only when a task requests it; naming it in a whitelist neither requires nor eagerly installs it. It is excluded from inherited-tool restrictions because native child-local tools are exempt. Profile spawn does not add an output-schema argument.

Tool restrictions are not filesystem/shell sandbox policies and cannot add tools absent from the native composition.

## Discovery and fresh reads

- When a root Agent is attached (including a newly created conversation), its Profile names and descriptions are read once and injected as a fixed catalog. Discovery parses TOML but does not preflight model routes, reasoning support or tool filters. Unreadable files are reported independently, not allowed to hide other profiles.
- There is no directory watcher, polling, automatic catalog refresh, fingerprint or configuration-drift check. Re-enabling the plugin attaches a new catalog to each live root.
- `list_subagent_profiles()` explicitly reads current names/descriptions from disk; it does not rewrite the originally injected catalog or expose developer instructions.
- Each `subagent(profile, prompt, description?, cwd?)` reads and validates only the selected file afresh, then performs route/tool checks and native activation. Other broken profiles do not block it. Configuration edits affect the next spawn, not existing children.
- Missing/unreadable files, malformed TOML, missing fields, protected-tool blacklists, unavailable tools, models, providers and reasoning efforts return ordinary tool errors with diagnostic codes. There is no fallback Profile. Symlinks and files over 256 KiB are rejected.

The result is `{kind: "activation", subagentId: "..."}`. DSH owns asynchronous completion/failure notification. Follow-ups use `send_message(agent_id, message)`; no Profile argument is needed.

## Recursion

Depth enforcement remains native. The plugin calls `ctx.subagents.resolveMaxDepth()` by default, so it follows the current Host subagent depth setting at each spawn and passes that cap into native activation. Child depth and persisted ancestry remain DSH-owned.

The Host plugin accepts the same explicit `maxDepth` policy shape as the native tool: a non-negative safe integer (`0` prohibits delegation), or `provider-managed` to send no explicit cap. Numeric caps do not get recomputed by plugin counters. Non-Profile descendant delegation keeps its original native tool configuration. The replacement does not introspect another preset tool's private configuration: if that tool had an explicit per-instance cap, configure this plugin's `maxDepth` explicitly too; the shared Host default is inherited automatically.

## Retained policy and continuation

The native descriptor's visible label retains only the Profile name:

~~~text
[dsh-profile:reader] Inspect login
~~~

There is no fingerprint. The label is an attribution hint, not an authorization grant. The plugin identifies only the child's own descriptor after `inheritedEventCount`, never an ancestor descriptor.

At spawn, before native activation, the plugin durably stores the selected persona/tool policy in the native `storageDomain` domain `dsh_subagent_policies`, table `children`, keyed by the reserved child Session ID. Records contain the Profile name, persona, optional tool lists and last-activity timestamp. Model routing is persisted by DSH itself. The native storage configuration chooses the backend and location; the plugin does not maintain a second filesystem store or append custom Session events.

Native `send_message` continues resident children or cold-resumes absent children. Before a resumed child can run, the plugin reapplies its retained policy. It never reads the current TOML or compares configuration fingerprints during continuation. Changing/deleting a Profile therefore does not change a retained child's model or policy. A live child keeps its own immutable policy even across router reload.

Old hash-bearing labels are recognized only for attribution, without hash verification. Historical children created before retained snapshots have no reconstructable original plugin policy: missing snapshots cause `POLICY_SNAPSHOT_UNAVAILABLE`, not a silently substituted current TOML. Start a new child instead. This does not delete or rewrite their native history.

## Thirty-day automatic cleanup

Only plugin policy sidecars are disposable. Native Session history, parent catalogs, user TOML files and unrelated storage domains are never deleted.

- Retention is 30 × 24 hours since the last observed child activity, not since creation. Creation, accepted inbox activity and status changes update the timestamp; disposal records final activity.
- All live/initializing Profile children are conservatively pinned, even if currently idle. A long-running turn cannot expire its own sidecar. On disposal the pin is released after its final timestamp write settles.
- Cleanup runs on plugin startup and every 24 hours while enabled. It uses a lifecycle-owned timer, not a model prompt or a scheduled task. Host downtime has no background process; the next startup catches up.
- Before deleting an expired cold record, the plugin reads the native session projection without activating the Agent. Pending inbox messages protect it. Missing query services, unreadable sessions or unknown inbox state cause cleanup to skip that record rather than assume it is safe. A confirmed missing native Session permits deletion of its orphaned plugin sidecar. Eligibility is rechecked after observation so concurrent activity wins.
- A cold record becomes cleanup-eligible at the exact 30-day boundary. Physical removal happens at the next successful scan, subject to activity and pending-message protection. Continuation does not add a second TTL validation: if its snapshot is still retained, it can resume and record fresh activity. After cleanup, `POLICY_SNAPSHOT_UNAVAILABLE` requires starting a new child. Native history remains readable; continuing it without its tool restrictions is intentionally refused.
- The timer stops on unload and the native domain is closed after pending cleanup. Storage errors are reported; failed timestamp writes cannot be claimed as durable activity.

## Source contract and verification

The target is DSH `0.2.2-rc.1`: activation task inputs are nested under `request`. The standard Host must provide `storageDomain` with a persistent backend in addition to the native Agent/subagent/tool/prompt/LLM services. The bundle does not install or configure a separate backend.

See [development](../CONTRIBUTING.md) for source-runtime checks. Scripted adapters validate protocol/lifecycle behavior, not paid-model performance or live Desktop deployment.
