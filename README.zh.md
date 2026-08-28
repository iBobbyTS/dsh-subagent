# dsh-subagent

[English](README.md) | 中文

`dsh-subagent` 是一个社区维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，用于把命名子代理 Profile 转成模型可见的委托工具。每个 Profile 固定一种后端、一条模型路由和一种推理强度策略，并向每个存活的 root Agent 暴露一个名为 `subagent_<profile>` 的工具。

本仓库独立于核心 `@deepseek-ai/dsh-subagent` 包。核心包提供 `ctx.subagents` 服务；本插件组合该服务，生成 `subagent_fast`、`subagent_reviewer` 等可配置工具，以及 `custom_subagent` 管理工具。

## 目录

1. [功能](#功能)
2. [环境要求](#环境要求)
3. [安装](#安装)
4. [状态存放位置](#状态存放位置)
5. [使用教程](#使用教程)
6. [配置格式](#配置格式)
7. [更新与卸载](#更新与卸载)
8. [故障排查](#故障排查)
9. [模型体验](#模型体验)
10. [已知限制与后续工作](#已知限制与后续工作)
11. [开发](#开发)
12. [许可证](#许可证)

## 功能

- 在 **设置 → 子代理** 中创建、编辑和删除命名 Profile。
- 使用 `spawn` 创建独立子上下文，或使用 `fork` 继承已完成的父对话。
- 跟随当前对话的 Provider 和 Model，或固定成对保存的自定义 Provider/Model 路由。
- 跟随当前对话的推理强度、使用所选模型的默认值，或固定自定义 effort。
- 从 Host 实时模型目录刷新自定义 Provider、Model 和 effort 选项。
- Profile 更新无需重启 Host 即可生效；已有的可继续子代理保留创建时解析的路由。
- 通过模型可见的 `custom_subagent` 工具管理同一份持久化 Profile。
- 将某个 Profile 标记为**默认子代理**：设置页顶部的选择器或 `custom_subagent` 的 `set-default` 动作。设置后，每个 root Agent 的系统提示词增加一段简短说明，将未指名 Profile 的委托请求引导到对应的 `subagent_<name>` 工具。

## 环境要求

| 要求 | 版本 / 详情 | 检查方式 |
|---|---|---|
| DeepSeek Harness | 与 `0.1.1-rc.2` 兼容的软件包（本插件 peerDeps 锁 `0.1.1-rc.2`） | `dsh --version` |
| DSH profile | 必须是可以加载 Web UI 的 profile（一般是 `web`）。`headless`、`tui` 等 profile 不会显示设置页。 | `dsh profile list` |
| Node.js | `^22.19.0` 或 `>=24.0.0` | `node -v` |
| pnpm | 需要在 `PATH` 上，CLI 会把安装动作委托给 pnpm | `pnpm -v` |
| 基础组合包 | 需要 profile 自带 `spawn`、`fork` 子代理 Provider 和模型目录。随附的 `web`、`headless` profile 已包含；自建 profile 需额外引入 `@deepseek-ai/dsh-subagent-spawn`、`@deepseek-ai/dsh-subagent-fork`（或等价 Provider）以及 `dsh-tool-subagent` 能力。 | `dsh plugin --profile web why`（查看 `dsh-tool-subagent`、`dsh-subagent-spawn`、`dsh-subagent-fork`） |
| 网络 | 从 GitHub 路径安装时需要能访问 `github.com` 和 `registry.npmjs.org` | `curl -fsI https://github.com` |

如果任一检查不过，请先解决再安装插件。CLI 不会自动补齐缺失的前置条件。

## 安装

### 选择安装路径

| 路径 | 适用场景 | 是否需要构建 |
|---|---|---|
| **GitHub（推荐给用户）** | 安装已发布的、可复现的版本。生产环境请固定 commit SHA。 | 否（仓库直接包含可执行 JavaScript）。 |
| **本地 checkout** | 正在开发或调试本插件，希望改动在重启后生效。 | 一次性 `pnpm install`。 |
| **npm registry** | 当未来某个版本发布到 npm 时使用。 | 否。 |

### 路径 A — 从 GitHub 安装

将插件安装到 Web profile：

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent
```

为了获得可复现的安装，建议固定 commit：

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent#09402ca21e086bed604f86818624a7435d65b572
```

（`09402ca2` 是当前 `main` 上已发布的 commit，请替换成你想固定的 SHA。）

CLI 会在 profile 目录缺失时先初始化它，然后把后续动作交给 pnpm。相对路径 spec（例如从插件 checkout 里执行 `add .`）会锚定到当前工作目录，而不是 profile。

验证安装：

```sh
dsh plugin --profile web why | grep -i dsh-subagent
```

依赖树中应该能看到插件名称、版本，以及它声明的 `cordis.patch.yml` 层。

### 路径 B — 从本地 checkout 安装

```sh
git clone https://github.com/xie-tj/dsh-subagent.git
cd dsh-subagent
pnpm install
dsh plugin --profile web add .
```

`pnpm install` 解析插件自身的 `devDependencies`（loader、include 辅助、`dsh-scope`）。然后 CLI 会把当前目录注册为 Web profile 的本地依赖。对 `dsh-subagent/` 里的修改在重启 Web profile 后生效。

### 启动或重启 Web profile

```sh
dsh --profile web
```

打开 `http://127.0.0.1:3080`（或 CLI 打印的 URL），进入 **设置 → 子代理**。初始 Profile 见下方 [使用教程](#使用教程)。

### 安装到非 `web` profile

插件的 manifest 声明 `dsh.client.platform: web`。设置 UI 和 `subagent_<name>` 工具需要 profile 加载 Web 运行时。安装到其他 profile 的命令相同：

```sh
dsh plugin --profile <name> add github:xie-tj/dsh-subagent
```

但该 profile 必须额外加载 `@deepseek-ai/dsh-client-ui-settings`（或你想用的设置 UI 消费者），**设置 → 子代理** 页面才会渲染。`custom_subagent` 管理工具始终对 Agent 可用，与 UI 无关。

## 状态存放位置

插件本身不保存任何文件状态。三处位置需要留意：

1. **DSH settings provider** — 即 Web profile 的 settings 文件。其中包含 `dsh-subagent` 命名空间，存放 `profiles` 和可选的 `defaultProfile`。设置页和 `custom_subagent` 工具都写到此处。可通过 `dsh plugin --profile web why`（查找 `settings` 条目）或 `DSH_HOME` / `$DSH_HOME` 环境变量找到该文件。
2. **Profile 依赖清单** — Web profile 的 `package.json` 把插件列在 `dependencies` 下。CLI 在每次 `add` / `remove` / `update` 时都会对账。查看方式：`dsh plugin --profile web why`。
3. **组合层** — 插件的 `cordis.patch.yml` 由 CLI 的 bundle 协调器合并进 profile 的 Cordis composition。检查它需要读取 profile 解析后的 `cordis.yml`；最简单的方式是 `dsh plugin --profile web why | grep -A2 'dsh-subagent'`。

插件**不会**读取已废弃的 `$DSH_HOME/custom-subagents.json` 文件。扁平的 `provider`、`model`、`reasoningEffort` 字段属于已废弃的预发布格式，加载时会被拒绝。

## 使用教程

### 1. 打开子代理设置页

打开 **设置 → 子代理**。插件初始提供两个 Profile：

| Profile | Backend | 模型路由 | 推理强度 | 子上下文 |
|---|---|---|---|---|
| `fast` | `spawn` | 跟随对话 | 自定义 `low` | 独立上下文 |
| `reviewer` | `fork` | 跟随对话 | 自定义 `high` | 继承已完成的父对话 |

它们是插件提供的初始用户 Profile，不是 DSH 中只读的系统 Profile，可以编辑或删除。

### 2. 配置 Profile

选择 Profile 的 **编辑**，然后设置：

1. **后端** —— `spawn` 或 `fork`。
2. **模型配置** —— 跟随当前对话，或自定义 Provider 和 Model。
3. **推理强度配置** —— 跟随对话/模型默认值，或选择自定义 effort。
4. **描述** —— 向模型说明该 Profile 适合承担的工作。

自定义路由始终同时保存 Provider 和 Model。如果已选路由从实时模型目录中消失，界面会保留并标记旧值，同时禁止保存，直到重新选择有效路由。

### 3. 创建专用 Profile

选择 **新建子代理**，输入 `deep-research` 等小写标识符，并设置 backend 和策略。Profile 名称必须符合：

```text
^[a-z][a-z0-9_-]{0,23}$
```

创建后，每个存活的 root Agent 会立即获得名为 `subagent_deep-research` 的工具。

### 4. 设置默认子代理

在页面顶部的 **默认子代理** 选择器中选择一个 Profile，或调用 `custom_subagent` 的 `set-default` 动作（省略 `name` 表示清除）。设置后，每个 root Agent 的系统提示词会增加一段简短说明：未指名 Profile 的委托请求（例如“开一个子代理”）优先使用对应的 `subagent_<name>` 工具。

指向不存在 Profile 的 `defaultProfile` 会在加载或保存时被拒绝；当前默认 Profile 不能直接删除，需要先更换默认或选择“不设置”。

### 5. 在对话中使用 Profile

可以要求 Agent 把任务委托给指定 Profile，例如：

```text
Use the reviewer subagent to inspect this change for correctness and test gaps.
```

Agent 可以调用 `subagent_reviewer`；保存的 Profile 决定模型路由，工具调用参数不会再暴露 Provider 或 Model 选择。

## 配置格式

设置页面与 `custom_subagent` 工具读写同一个 `dsh-subagent` 设置 namespace。下面是一段典型的 `settings.yaml` 配置：

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

`modelRouting` 可以是 `{ mode: 'follow-conversation' }`，也可以是成对保存的自定义 `{ mode: 'custom', provider, model }` 记录。`reasoning` 可独立跟随对话，或保存 `{ mode: 'custom', effort }`。

可选的 `defaultProfile` 指定未指名 Profile 时使用的委托工具，它必须在 `profiles` 中存在；删除当前默认 Profile 会被拒绝，直到更换默认或清除该字段。

插件不会读取已废弃的 `$DSH_HOME/custom-subagents.json` 文件。扁平的 `provider`、`model`、`reasoningEffort` 字段属于已废弃的预发布格式，读取时会被拒绝。

## 更新与卸载

### 更新到指定版本

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent#<new-commit-sha>
dsh --profile web
```

CLI 会重新对账依赖清单和 `cordis.patch.yml` 层。重启 profile 后才加载新代码；已有的可继续子代理保留创建时的路由。

### 回滚到更早的版本

同样的命令，把 SHA 换成更早的版本即可。CLI 不保存历史版本记录，请自行记录想回滚到的 SHA。

### 卸载

```sh
dsh plugin --profile web remove dsh-subagent
dsh --profile web
```

卸载会从 profile 的 `package.json` 中移除依赖项，并从解析后的 composition 中移除 `dsh-subagent` 层。**但它不会删除 settings 文件里的 `dsh-subagent` 命名空间。** 如果要彻底清掉已保存的 Profile，请编辑 settings 文件（见 [状态存放位置](#状态存放位置)），手动删掉 `dsh-subagent:` 块。之后再装回插件不会自动恢复这些 Profile。

## 故障排查

| 现象 | 可能原因 | 解决办法 |
|---|---|---|
| **设置里没有“子代理”入口** | 插件装在了不加载 Web UI 的 profile，或者装完没重启 profile。 | 确认 profile：`dsh plugin --profile web why | grep dsh-subagent`。然后重启：`dsh --profile web`。 |
| **`dsh plugin --profile web add` 报 peerDependency 错误** | DSH 核心包版本低于 `0.1.1-rc.2`。 | 升级 DSH 后重试（按你的发行版升级流程操作）。 |
| **`dsh plugin --profile web why` 里看不到 `cordis.patch.yml` 层** | CLI 的 bundle 协调器没有识别插件 manifest，通常是因为依赖是手动加进 `package.json` 而不是通过 `dsh plugin add` 安装的。 | 走 CLI 重新加：`dsh plugin --profile web remove dsh-subagent && dsh plugin --profile web add github:xie-tj/dsh-subagent#<sha>`。 |
| **无法保存自定义路由** | 所选 Provider/Model/effort 不在 Host 实时模型目录中。 | 在设置页刷新模型目录，或选择目录当前返回的路由。 |
| **出现重复的 `subagent_<name>` 或 `custom_subagent` 注册** | 另一个动态 Subagent Profile 插件也挂载着。 | 启用本插件前先停掉并移除旧插件。 |
| **删除 Profile 时提示它是默认子代理** | `defaultProfile` 仍然指向它。 | 先在“默认子代理”里选其他 Profile 或“不设置”，再删除。 |
| **没有 `spawn` / `fork` 的 Provider** | profile 缺少对应的子代理 Provider。 | 使用自带 Provider 的 profile，或在 profile 中加 `@deepseek-ai/dsh-subagent-spawn` / `@deepseek-ai/dsh-subagent-fork`（或等价 Provider）以及 `dsh-tool-subagent` 能力。 |
| **重装后设置丢失** | `dsh-subagent` 命名空间写在 settings 文件里，`dsh plugin remove` 不会删它。 | 从 settings 备份恢复，或在 **设置 → 子代理** 里重新创建 Profile。 |
| **加载时 `defaultProfile` 被拒绝** | 保存的默认指向了已不存在的 Profile。 | 编辑 settings 文件，删除 `defaultProfile` 行或改成现存 Profile 的名字，然后重启。 |

## 模型体验

- **模型可见工具：** 每个 Profile 一个限定到 Agent 的委托工具（`subagent_<name>`），另有一个限定到 Agent 的 `custom_subagent` 管理工具。
- **Prompt 与 token 影响：** 子代理接收创建时解析的模型路由与推理策略，以及配置的 persona、tool filter、深度限制和 backend 上下文策略。设置默认 Profile 且其工具已挂载时，父提示词包含一段固定短文本；未设置或不挂载时不增加内容。父请求不会获得子代理 transcript，本插件不增加缓存层。
- **持久化：** Profile 更新通过 DSH settings provider 写入，同一 Profile 中的后续 session 可以继续读取。

## 已知限制与后续工作

- GUI 中的 Provider 和 Model 选项仅限 Host 实时模型目录返回的路由。直接编辑设置可以指定其他已注册路由，但目录缺少对应项时，GUI 不提供自由输入回退。
- 设置页字段目前使用中文文案，导航标签会跟随 Host locale。
- `dsh plugin remove` 不会删除 settings 文件里的 `dsh-subagent` 命名空间。如需彻底清理，请手动删除。

## 开发

```sh
pnpm install
pnpm test
```

`pnpm test` 会运行 schema/runtime 测试、浏览器 Client 注册与渲染测试，以及真实 Cordis Loader 组合生命周期测试。

仓库直接包含可执行 JavaScript，安装时不需要构建步骤。

## 许可证

[MIT](LICENSE)
