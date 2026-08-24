# dsh-subagent

[English](README.md) | 中文

`dsh-subagent` 是一个社区维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，用于创建可复用的命名子代理 Profile。每个 Profile 都会成为一个模型可见的委托工具，并分别配置 backend、模型路由策略和推理策略。

本仓库独立于核心 `@deepseek-ai/dsh-subagent` 包。核心包提供 `ctx.subagents` 服务；本插件组合该服务，生成 `subagent_fast`、`subagent_reviewer` 等可配置工具。

## 功能

- 在 **设置 → 子代理** 中创建、编辑和删除命名 Profile。
- 使用 `spawn` 创建独立子上下文，或使用 `fork` 继承已完成的父对话。
- 跟随当前对话的 Provider 和 Model，或选择成对保存的自定义 Provider/Model 路由。
- 跟随当前对话的推理强度、使用所选模型的默认值，或选择自定义 effort。
- 从 Host 实时模型目录刷新自定义 Provider、Model 和 effort 选项。
- Profile 更新无需重启 Host 即可生效；已有的可继续子代理保留创建时解析的路由。
- 通过模型可见的 `custom_subagent` 工具管理同一份持久化 Profile。

## 环境要求

- 与 DeepSeek Harness `0.1.1-rc.2` 兼容的软件包。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 使用标准 base composition 的 DSH Profile，其中提供 `spawn`、`fork` 子代理 Provider 和模型目录。

## 从 GitHub 安装

将插件安装到 Web Profile：

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent
```

为了获得可复现的安装，建议固定 commit：

```sh
dsh plugin --profile web add github:xie-tj/dsh-subagent#<commit-sha>
```

然后启动或重启 DSH Web：

```sh
dsh --profile web
```

仓库直接包含可执行 JavaScript，因此从 GitHub 安装时不需要运行 `prepare` 构建。

### 从本地 checkout 安装

```sh
git clone https://github.com/xie-tj/dsh-subagent.git
cd dsh-subagent
pnpm install
dsh plugin --profile web add .
```

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

1. **后端**——`spawn` 或 `fork`。
2. **模型配置**——跟随当前对话，或自定义 Provider 和 Model。
3. **推理强度配置**——跟随对话/模型默认值，或选择自定义 effort。
4. **描述**——向模型说明该 Profile 适合承担的工作。

自定义路由始终同时保存 Provider 和 Model。如果已选路由从实时模型目录中消失，界面会保留并标记旧值，同时禁止保存，直到重新选择有效路由。

### 3. 创建专用 Profile

选择 **新建子代理**，输入 `deep-research` 等小写标识符，并设置 backend 和策略。Profile 名称必须符合：

```text
^[a-z][a-z0-9_-]{0,23}$
```

创建后，每个存活的 root Agent 会立即获得名为 `subagent_deep-research` 的工具。

### 4. 在对话中使用 Profile

可以要求 Agent 把任务委托给指定 Profile，例如：

```text
Use the reviewer subagent to inspect this change for correctness and test gaps.
```

Agent 可以调用 `subagent_reviewer`；保存的 Profile 决定模型路由，工具调用参数不会再暴露 Provider 或 Model 选择。

## 配置格式

设置页面与 `custom_subagent` 工具读写同一个 `dsh-subagent` 设置 namespace。下面是一段典型的 `settings.yaml` 配置：

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

`modelRouting` 可以是 `{ mode: 'follow-conversation' }`，也可以是成对保存的自定义 `{ mode: 'custom', provider, model }` 记录。`reasoning` 可独立跟随对话，或保存 `{ mode: 'custom', effort }`。

插件不会读取已废弃的 `$DSH_HOME/custom-subagents.json` 文件。扁平的 `provider`、`model` 和 `reasoningEffort` 字段属于已废弃的预发布格式，读取时会被拒绝。

## 更新与卸载

使用新的固定 GitHub commit 引用再次执行 `add`，然后重启对应 Profile，即可更新到指定版本。卸载插件：

```sh
dsh plugin --profile web remove dsh-subagent
```

卸载会移除该 Profile 中的插件依赖和组合层，不会改写无关设置。

## 故障排查

- **设置中没有“子代理”：** 确认插件安装在提供 Web UI 的 Profile 中，然后重启该 Profile。
- **无法保存自定义路由：** 重新选择 Host 模型目录当前提供的 Provider、Model 和 effort。
- **出现重复的 `subagent_<name>` 或 `custom_subagent` 注册：** 启用本插件前，停止并移除旧的动态 Subagent Profile 插件。
- **`spawn` 或 `fork` 没有 Provider：** 使用标准 DSH base composition，或安装对应的子代理 Provider。

## 开发

```sh
pnpm install
pnpm test
```

`pnpm test` 会运行 schema/runtime 测试、浏览器 Client 注册与渲染测试，以及真实 Cordis Loader 组合生命周期测试。

## 模型体验

- **模型可见工具：** 每个 Profile 一个限定到 Agent 的委托工具，另有一个限定到 Agent 的 `custom_subagent` 管理工具。
- **Prompt 与 token 影响：** 子代理接收创建时解析的模型路由与推理策略，以及配置的 persona、tool filter、深度限制和 backend 上下文策略。父请求不会获得子代理 transcript，本插件不增加缓存层。
- **持久化：** Profile 更新通过 DSH settings provider 写入，同一 Profile 中的后续 session 可以继续读取。

## 已知限制与后续工作

- GUI 中的 Provider 和 Model 选项仅限 Host 实时模型目录返回的路由。直接编辑设置可以指定其他已注册路由，但目录缺少对应项时，GUI 不提供自由输入回退。
- 设置页字段目前使用中文文案，导航标签会跟随 Host locale。

## 许可证

[MIT](LICENSE)
