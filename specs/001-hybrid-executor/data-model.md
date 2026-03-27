# 数据模型：混合执行器路由

**分支**: `001-hybrid-executor` | **日期**: 2026-03-26

## 实体

### ExecutorType（执行器类型）

枚举值，标识当前会话使用的执行器。

| 值 | 说明 |
|----|------|
| `default` | 默认低成本执行器（OpenClaw 原生路径） |
| `claude-code` | Claude Code 高级执行器 |
| `codex-cli` | Codex CLI 高级执行器 |

### SessionExecutorState（会话执行器状态）

每个 OpenClaw 会话对应一个执行器状态记录。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionId | string | 是 | OpenClaw 会话 ID |
| activeExecutor | ExecutorType | 是 | 当前活跃执行器，默认 `default` |
| executorSessionId | string \| null | 否 | 高级执行器的 CLI session-id（用于跨调用恢复会话） |
| activatedAt | number \| null | 否 | 高级执行器激活时间戳 |
| messageCount | number | 是 | 当前执行器下的消息计数 |
| conversationLog | Message[] | 是 | 高级执行器期间由 forward() 记录的对话历史（用于回退时构建 ContextPayload），默认空数组 |

**验证规则**:
- `activeExecutor` 为 `default` 时，`executorSessionId` 必须为 `null`
- `activeExecutor` 不为 `default` 时，`executorSessionId` 不得为 `null`

### ContextPayload（上下文载荷）

执行器切换时传递的上下文数据结构。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| messages | Message[] | 是 | 消息历史列表 |
| truncated | boolean | 是 | 是否经过截断 |
| truncatedCount | number | 否 | 被截断的消息数量（仅 truncated=true 时） |
| totalCount | number | 是 | 原始消息总数 |

### Message（消息）

消息历史中的单条消息。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | `user` \| `assistant` \| `system` | 是 | 消息角色 |
| content | string | 是 | 消息内容 |
| timestamp | number | 是 | 消息时间戳 |
| executor | ExecutorType | 是 | 产生该消息的执行器 |

## 实体关系

```
Session (OpenClaw) 1 ──── 1 SessionExecutorState
                                    │
                                    │ activeExecutor != 'default'
                                    │
                                    ▼
                          CLI Session (磁盘持久化)
                          由 executorSessionId 标识
```

## 状态转换

```
                    ┌─────────────────────────┐
                    │                         │
                    ▼                         │
              ┌──────────┐   激活 CC/Codex   ┌──────────────────┐
              │ default  │ ───────────────→ │ claude-code 或    │
              │          │ ←─────────────── │ codex-cli         │
              └──────────┘   显式退出       └──────────────────┘
                                                   │       ▲
                                                   │       │
                                                   └───────┘
                                                  直接互切
```

**转换触发条件**:
- `default → claude-code`: 用户显式请求「使用 Claude Code」
- `default → codex-cli`: 用户显式请求「使用 Codex CLI」
- `claude-code → default`: 用户显式请求退出
- `codex-cli → default`: 用户显式请求退出
- `claude-code → codex-cli`: 用户显式请求切换
- `codex-cli → claude-code`: 用户显式请求切换
- `任意 → default`: 会话结束时自动清理
- `任意 → default`: CLI 调用失败时自动回退
