# dsh-subagent — TOML Subagent Profiles（v0.1.0）

本 fork 将旧版「每个 Profile 一个 `subagent_<name>` 工具」改为 **一个名为 `subagent` 的工具，调用时必须填写 `profile`**。启动、完成通知、继续会话、深度限制、生命周期都使用 DSH 官方 `ctx.subagents.startActivation()`，工具访问限制使用官方 `agent.ctx.tools.restrict()`。

> 适配目标：DSH 0.2.1-rc.1 及更新的 0.2.x。已完成单元测试与模拟集成测试，但尚未在真实 DSH Desktop 上验证。原 Settings 图形 Profile 编辑器不再提供，配置改为 TOML。

## 安装／卸载：只使用官方入口

```bash
dsh plugin --profile web add github:iBobbyTS/dsh-subagent
# 卸载
dsh plugin --profile web remove dsh-subagent
```

其中 `web` 是 DSH 应用 Profile，与子智能体 Profile 不是同一概念。更换为自己使用的 DSH Profile 即可。

Desktop 必须先启动过一次以建立 `desktop` Profile，再完全退出 Desktop，使用随应用附带的 CLI：

```bash
/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/cli/bin/dsh plugin --profile desktop add github:iBobbyTS/dsh-subagent
# 对应卸载：同一个 dsh 路径，改成 plugin --profile desktop remove dsh-subagent
```

Windows Desktop 的相对路径是 `resources\\runtime\\cli\\bin\\dsh.cmd`，位于**实际应用安装目录内**（安装目录可自定义）。桌面应用也有 **Manage dsh Command...** 功能，可将自己的 CLI 加入 PATH。不能用另外安装的 npm `dsh` 修改 Desktop 专属 Profile。

启用插件时，只在根 Agent 作用域中注册同名 `subagent` 来遮蔽官方工具；卸载后自动回退官方 `subagent`。**不修改**官方的 `subagent_fork`、`send_message`、`list_agents`、`interrupt_agent`、模型发现及 workflow 工具。没有独立安装器、编译步骤或自定义生命周期服务。

## TOML 配置

配置文件：`<DSH_HOME>/agents/<profile>.toml`。使用官方 `@deepseek-ai/dsh-home-paths` 的 `dshHomePath('agents')`：显式配置路径优先，其次为 `DSH_HOME`，最后才是 `~/.dsh`。

例如 `~/.dsh/agents/explorer.toml`：

```toml
provider = "your-llm-provider-id"
model = "your-model-id"
reasoning_effort = "xhigh"

description = "只读搜索代码、梳理调用链、收集准确证据"
developer_instruction = """
You are Explorer. Only investigate the assigned code.
Do not modify files. Return verified findings with file paths and line numbers.
"""

tool_whitelist = ["read", "glob", "grep"]
# tool_blacklist = ["edit", "write"]

# 0.1.0 尚不支持非空的 Skill 黑白名单
# skill_whitelist = []
# skill_blacklist = []
```

支持字段：`provider`、`model`、`reasoning_effort`、`tool_whitelist`、`tool_blacklist`、`skill_whitelist`、`skill_blacklist`、`description`、`developer_instruction`。其中仅前三个必填。`provider` 是 LLM Provider ID，**不是** Subagent 执行后端 `spawn`。文件名（去掉 `.toml`）即 Profile ID，允许小写字母开头及后续小写字母、数字、下划线与连字符。

`description` 只会出现在主 Agent 的 Profile 列表中，便于主 Agent 选择角色；`developer_instruction` 作为子 Agent 的 Persona 前缀注入，不在工具入参、主 Agent 的角色列表中展示。需要说明：这不是 API 意义上的独立 `developer` 消息，而且如果主 Agent 有直接读取 TOML 文件的系统权限，该配置并不构成保密边界。

## 调用

```ts
subagent({
  profile: "explorer",
  prompt: "Explore the login module and return the authentication model",
  description: "Inspect login authentication"
})
```

`profile`、`prompt` 必填，`description`、`cwd` 可选。始终固定使用 Profile 指定的 Provider、Model、Reasoning Effort，主 Agent 无法通过本次 Tool 调用覆盖。子 Agent 拥有独立上下文，官方工具立即返回子会话 ID，完成后由官方生命周期服务通知主 Agent。

## 错误处理与恢复

每份 TOML 独立解析，非法文件跳过而不影响其他 Profile；模型可见目录列出有效 Profile 与跳过原因。遇到无效 Profile 调用时，Tool 返回明确错误，例如：

- `TOML_PARSE_ERROR`：文件不是合法 TOML。
- `UNSUPPORTED_FIELD`：出现未支持字段。
- `MISSING_REQUIRED_FIELD`：缺少必填的 Provider、Model、Reasoning Effort。
- `PROVIDER_NOT_FOUND`：DSH 未注册指定 Provider。
- `MODEL_NOT_FOUND`：模型适配器明确报告不存在；其他不确定错误归为 `MODEL_UNVERIFIED`，不误判。
- `REASONING_EFFORT_UNAVAILABLE`：模型不支持指定推理档位。
- `TOOL_NOT_FOUND`：工具白名单或黑名单中存在不可用名称。
- `UNSUPPORTED_SKILL_FILTER`：非空 Skill 黑白名单无法通过官方 API 完整执行，因此拒绝该 Profile。
- `PROFILE_CHANGED`：冷恢复时 TOML 与启动时持久化的 Profile 指纹不一致，拒绝不安全恢复。

工具限制由 DSH 官方 `tools.restrict` 实施，不是文件系统沙箱。模型运行期间的后续错误仍由官方完成通知报告，而不是伪造同步 Tool Result。Profile ID 和指纹放在 DSH 已有的 Subagent descriptor label 中，不创建新的 Session Event 类型。

## 暂不做

`subagent_fork` 保留官方原样。Skill 黑白名单没有可确保目录、加载与调用一致的原生接口，v0.1.0 不自行重写。后续需求记录在 [`docs/issues/`](docs/issues/)；提交时仓库关闭了 GitHub Issues（API 返回 410），因此先把草稿纳入版本控制。

源码预构建为 JavaScript，GitHub 安装不需要允许构建脚本。运行测试：`npm install --ignore-scripts --legacy-peer-deps && npm run check`。
