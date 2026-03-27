# 研究成果：混合执行器路由

**分支**: `001-hybrid-executor` | **日期**: 2026-03-26

## 研究项 1：OpenClaw 插件系统可行性

**决策**: 使用 OpenClaw 原生插件系统（`definePluginEntry` + 钩子注册）实现全部功能

**理由**:
- OpenClaw 提供 25 个生命周期钩子，覆盖消息接收到发送的完整链路
- `before_dispatch` 钩子可返回 `{ handled: true }` 短路默认处理，这是消息转发的关键
- `registerGatewayMethod` 允许注册自定义 RPC 方法，可用于执行器控制 API
- 插件可通过 `api.runtime.agent.session.*` 访问会话存储，实现状态持久化
- 无需修改 OpenClaw 源码

**备选方案**:
- 代理层方案（在 OpenClaw 前放置反向代理）：侵入性更大，无法访问会话内部状态，已拒绝
- Fork OpenClaw 修改源码：违反约束条件，已拒绝

## 研究项 2：高级执行器调用方式

**决策**: 每条消息 spawn 一次 CLI 进程，通过 session-id 串联上下文，支持流式 JSONL 输出

**理由**:
- Claude Code CLI (`claude -p --session-id <uuid> --output-format=stream-json`) 原生支持：
  - 会话持久化：CLI 自身将会话存储到磁盘，通过 `--session-id` 跨调用恢复
  - 流式输出：`--output-format=stream-json --include-partial-messages` 逐 chunk 返回
  - 非交互模式：`-p/--print` 单次请求→响应→退出
- Codex CLI (`codex exec --json`) 具备对等能力：
  - 会话持久化：自动生成 session-id，通过 `codex exec resume <id>` 恢复
  - 流式输出：`--json` 以 JSONL 格式逐事件输出
  - 非交互模式：`exec` 子命令单次执行
- 无需维持长运行子进程，每次调用完成后进程退出，避免资源泄漏和进程管理复杂度
- 子进程隔离性好，崩溃不影响 OpenClaw 主进程

**备选方案**:
- 长运行子进程（stdin/stdout 交互）：不必要，两个 CLI 都原生支持 session-id 恢复，已拒绝
- Anthropic/OpenAI SDK 直接调用：失去 Claude Code / Codex CLI 的 agent 能力（工具调用、文件操作等），已拒绝
- OpenClaw subagent API：设计用于内部 agent 通信，不适合外部 CLI 工具，已拒绝

## 研究项 3：消息拦截点选择

**决策**: 以 `before_dispatch` 为主拦截点，`message_sending` 为辅助注入点

**理由**:
- `before_dispatch` 在消息分发到 agent 之前触发，事件包含 `content`、`sessionKey`、`channel` 等完整信息
- 返回 `{ handled: true, text: response }` 可直接短路默认路由，将响应发回用户
- 这是最早的拦截点，避免默认执行器产生任何开销
- `message_sending` 用于在响应中注入执行器标识前缀

**备选方案**:
- `before_agent_start`：太晚，默认 agent 已经开始初始化，已拒绝
- `llm_input`：仅影响 LLM 调用参数，无法完全替代执行路径，已拒绝
- `inbound_claim`：用于渠道认领，语义不符，已拒绝

## 研究项 4：会话状态持久化

**决策**: 使用 OpenClaw SessionStore（通过 `api.runtime.agent.session.loadSessionStore/saveSessionStore`）存储执行器状态

**理由**:
- SessionEntry 支持自定义字段（`providerOverride`、`modelOverride` 等）
- 与 OpenClaw 会话生命周期天然绑定
- 会话结束时自动可检测（`session_end` 钩子），便于清理高级执行器进程

**备选方案**:
- 插件内存 Map：进程重启后丢失，不够持久，仅作为运行时缓存使用
- 独立文件存储：与 OpenClaw 会话管理脱节，已拒绝

## 研究项 5：意图检测方案

**决策**: 基于关键词模式匹配，不使用 LLM 推理

**理由**:
- 规格要求「仅在明确、无歧义的请求下才切换」，关键词匹配完全满足
- 零额外成本、零延迟
- 可配置的关键词列表，用户可自定义触发词
- LLM 推理会引入延迟和成本，且可能在模棱两可场景下误触发

**备选方案**:
- LLM 意图分类：延迟高、成本高、对显式请求场景过度设计，已拒绝
- 命令前缀（如 `/cc`）：用户体验不够自然，但可作为补充手段保留

## 研究项 6：上下文传递降级策略

**决策**: 当完整历史超过目标执行器上下文窗口限制时，保留最近消息，截断早期历史

**理由**:
- 最近消息对上下文连续性最重要
- 截断策略简单可靠，不依赖额外的摘要生成
- 用户收到明确通知，知晓传递不完整

**备选方案**:
- 生成摘要替代截断：增加延迟和成本，摘要质量不可控，已拒绝
- 阻止切换：违反规格要求（降级传递后继续切换），已拒绝
