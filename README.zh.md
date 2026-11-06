# dsh-subagent — TOML Profiles

[English](README.md)

本 fork 提供一个必须指定 TOML Profile 的 `subagent` 工具。Profile 固定模型路由、角色指令与工具策略；执行、通信和完成通知沿用 DSH 原生生命周期。旧版每个 Profile 一个工具的图形编辑器不再提供。

需要 Node.js `>=24.9.0`。

## 兼容性

已验证：DSH 0.2.2-rc.1（源码与自动化检查）；尚未完成 Desktop 实测。

## 安装

将本 fork 安装到实际使用的 DSH 应用 Profile：

```sh
dsh plugin --profile web add github:iBobbyTS/dsh-subagent
```

Desktop 应先启动一次、完全退出后使用应用自带 CLI：

```sh
/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/cli/bin/dsh plugin --profile desktop add github:iBobbyTS/dsh-subagent
```

Windows CLI 位于实际应用目录的 `resources\runtime\cli\bin\dsh.cmd`；Desktop 的 **Manage dsh Command...** 可将它加入 PATH。安装或更新后重启目标 Host。卸载时使用相同 CLI 和 Profile，将 `add ...` 改为 `remove dsh-subagent`。

## 配置与使用

创建 `<DSH_HOME>/agents/explorer.toml`，填写实际注册的 Provider 和 Model ID：

```toml
provider = "your-provider-id"
model = "your-model-id"
reasoning_effort = "xhigh"
description = "只读探索代码"
developer_instruction = "调查分配的代码，不修改文件。"
```

Main 调用 `subagent` 时提供 `profile: "explorer"` 和自包含的 `prompt`。DSH 返回 activation ID，并以原生机制通知完成；后续通过 `send_message` 通信。

当前根 Agent 的继承 `subagent_fork` 被隐藏，非空 Skill 黑白名单不受支持。工具过滤不是文件系统沙箱。完整配置、错误、恢复与限制见 [Profile 参考](docs/profiles.md)。

## 开发与后续提案

[开发指南](CONTRIBUTING.md)说明如何对指定版本源码执行集成测试。[Fork Profiles](docs/issues/fork-profiles.md) 与 [Skill 限制](docs/issues/skill-restrictions.md) 是待实现提案，不是当前能力。

本 fork 保留原项目 MIT 许可和版权署名。
