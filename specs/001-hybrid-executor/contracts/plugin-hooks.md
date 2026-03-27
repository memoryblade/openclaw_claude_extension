# 插件钩子契约：混合执行器路由

**分支**: `001-hybrid-executor` | **日期**: 2026-03-26

## 注册的钩子

### 1. `before_dispatch` — 消息拦截与路由

**优先级**: 100（高优先级，确保在其他插件之前执行）

**输入事件**:
```typescript
{
  content: string;        // 用户消息内容
  sessionKey?: string;    // 会话标识
  channel?: string;       // 来源渠道
  senderId?: string;      // 发送者
}
```

**处理逻辑**:
1. 加载 `SessionExecutorState`
2. 检测是否为执行器切换意图（调用 IntentDetector）
3. 如果是切换意图 → 执行切换，返回确认消息
4. 如果当前有活跃高级执行器 → 转发消息给执行器，返回执行器响应
5. 否则 → 返回 `{ handled: false }`，放行给默认路径

**返回**:
```typescript
{
  handled: boolean;       // true = 已处理，短路默认路径
  text?: string;          // 响应文本（handled=true 时）
}
```

---

### 2. `message_sending` — 执行器标识注入

**优先级**: 50

**处理逻辑**:
- 检查当前会话是否有活跃高级执行器
- 如有，在消息前注入标识前缀：`[Claude Code] ` 或 `[Codex CLI] `

---

### 3. `session_start` — 会话初始化

**优先级**: 默认

**处理逻辑**:
- 为新会话创建 `SessionExecutorState`，默认 `activeExecutor = 'default'`

---

### 4. `session_end` — 会话清理

**优先级**: 默认

**处理逻辑**:
- 清理 `SessionExecutorState`（重置为 default）
- 高级执行器的 CLI session 文件保留在磁盘上（由 CLI 自身管理生命周期），不主动删除

---

## 注册的自定义命令

### `/executor` — 执行器控制命令

**用法**:
- `/executor status` — 显示当前执行器状态
- `/executor switch <type>` — 切换执行器（claude-code / codex-cli / default）
- `/executor history` — 显示本会话的执行器切换历史

---

## 插件配置 Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": {
      "type": "boolean",
      "default": true
    },
    "claudeCodePath": {
      "type": "string",
      "description": "Claude Code CLI 可执行文件路径"
    },
    "codexCliPath": {
      "type": "string",
      "description": "Codex CLI 可执行文件路径"
    },
    "maxContextMessages": {
      "type": "number",
      "default": 200,
      "description": "上下文传递降级时保留的最大消息数"
    },
    "activationKeywords": {
      "type": "object",
      "properties": {
        "claudeCode": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["使用 Claude Code", "用 Claude Code", "切换到 Claude Code", "use claude code", "switch to claude code"]
        },
        "codexCli": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["使用 Codex", "用 Codex", "切换到 Codex", "use codex", "switch to codex"]
        },
        "deactivate": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["切换回来", "退出", "回到默认", "switch back", "exit", "go back"]
        }
      }
    }
  }
}
```
