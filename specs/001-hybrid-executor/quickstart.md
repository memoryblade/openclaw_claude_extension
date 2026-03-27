# 快速开始：混合执行器路由插件

**分支**: `001-hybrid-executor` | **日期**: 2026-03-26

## 前置条件

- OpenClaw 已安装并运行
- Node.js v22.16+ 或 v24+
- Claude Code CLI 已安装并登录（`claude --version`，可选）
- Codex CLI 已安装并登录（`codex --version`，可选）

## 工作原理

插件通过 CLI 的非交互模式与高级执行器通信：
- **Claude Code**: `claude -p --session-id <uuid> --output-format=stream-json "消息"` — 每条消息 spawn 一次进程，CLI 自身通过 session-id 维护上下文
- **Codex CLI**: `codex exec resume <session-id> --json "消息"` — 同理，通过 session-id 恢复会话
- 两者均支持流式 JSONL 输出，响应逐 chunk 返回给用户

## 安装

```bash
# 在 ai-assistant 目录下
pnpm install
pnpm build
```

## 配置

在 OpenClaw 配置文件（`~/.openclaw/config.json5`）中添加插件：

```json5
{
  plugins: {
    "hybrid-executor": {
      enabled: true,
      claudeCodePath: "claude",      // Claude Code CLI 路径
      codexCliPath: "codex",          // Codex CLI 路径
      maxContextMessages: 200         // 降级传递时保留的最大消息数
    }
  }
}
```

## 使用方式

### 激活高级执行器

在对话中直接说：

- 「使用 Claude Code」或 「use claude code」— 激活 Claude Code
- 「使用 Codex」或 「use codex」— 激活 Codex CLI

### 查看状态

所有高级执行器的回复会带有前缀标识，如 `[Claude Code]`。

也可使用命令：`/executor status`

### 切换执行器

- 「切换到 Codex」— 从当前执行器切换到 Codex CLI
- 「切换回来」或 「退出」— 回到默认低成本路径

### 命令参考

| 命令 | 说明 |
|------|------|
| `/executor status` | 显示当前执行器状态 |
| `/executor switch claude-code` | 切换到 Claude Code |
| `/executor switch codex-cli` | 切换到 Codex CLI |
| `/executor switch default` | 回到默认路径 |

## 开发

```bash
# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 构建
pnpm build
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 高级执行器无响应 | 检查 CLI 路径配置是否正确，确认 CLI 工具已安装 |
| 上下文传递不完整 | 正常行为（历史过大时会降级截断），会有通知提示 |
| 切换命令未生效 | 确认使用了完整的触发词，非随意提及 |
