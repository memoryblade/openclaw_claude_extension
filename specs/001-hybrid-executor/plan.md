# 实施计划：混合执行器路由

**分支**: `001-hybrid-executor` | **日期**: 2026-03-26 | **规格**: [spec.md](./spec.md)
**输入**: 功能规格 `/specs/001-hybrid-executor/spec.md`
**约束**: 不修改 OpenClaw 源码，作为外部插件实现

## 摘要

通过 OpenClaw 插件系统实现混合执行器路由功能。以 OpenClaw 插件形式构建一个独立的 `hybrid-executor` 插件，利用插件钩子（`before_dispatch`、`message_sending`、`session_start`、`session_end`）拦截消息流，根据会话中记录的执行器状态决定是走默认低成本路径还是将消息转发给 Claude Code / Codex CLI 高级执行器。完整消息历史在所有切换路径上传递，且始终向用户显示当前执行器标识。

## 技术上下文

**语言/版本**: TypeScript (Node.js v24 / v22.16+)
**主要依赖**: OpenClaw Plugin SDK (`openclaw/plugin-sdk/*`)，Claude Code CLI (`claude -p`)，Codex CLI (`codex exec`)
**存储**: OpenClaw 会话存储（SessionStore via `api.runtime.agent.session.*`）+ 插件本地内存缓存
**测试**: vitest（与 OpenClaw 生态一致）
**目标平台**: Node.js 服务端（跟随 OpenClaw 运行环境）
**项目类型**: OpenClaw 插件（npm 包）
**性能目标**: 执行器切换 < 3 秒（含上下文传递），默认路径零额外延迟
**约束**: 不修改 OpenClaw 源码；插件通过 `openclaw.plugin.json` + `definePluginEntry` 注册
**规模**: 单用户实例级（跟随 OpenClaw 部署模式）

## Constitution Check

*宪法文件为空模板，无具体原则定义。跳过 gate 检查。*

## 项目结构

### 文档（本功能）

```text
specs/001-hybrid-executor/
├── plan.md              # 本文件
├── research.md          # Phase 0 研究成果
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速开始指南
├── contracts/           # Phase 1 接口契约
│   └── plugin-hooks.md  # 钩子契约定义
└── tasks.md             # Phase 2 任务分解（/speckit.tasks 生成）
```

### 源码（插件项目）

```text
ai-assistant/
├── src/
│   ├── index.ts                    # 插件入口，definePluginEntry
│   ├── executor-manager.ts         # 执行器生命周期管理（激活/停用/切换/CLI 调用）
│   ├── context-transfer.ts         # 上下文传递逻辑（完整历史/降级截断）
│   ├── session-state.ts            # 会话执行器状态管理
│   ├── intent-detector.ts          # 用户意图检测（显式切换请求识别）
│   ├── executors/
│   │   ├── types.ts                # 执行器接口定义
│   │   ├── claude-code.ts          # Claude Code 执行器适配器
│   │   └── codex-cli.ts            # Codex CLI 执行器适配器
│   └── hooks/
│       ├── before-dispatch.ts      # 拦截入站消息，检测切换意图，转发给高级执行器
│       ├── session-lifecycle.ts    # 会话启动/结束时的状态初始化与清理
│       └── message-sending.ts      # 注入执行器标识到回复
├── tests/
│   ├── unit/
│   │   ├── intent-detector.test.ts
│   │   ├── context-transfer.test.ts
│   │   └── session-state.test.ts
│   └── integration/
│       ├── executor-switch.test.ts
│       └── context-handoff.test.ts
├── openclaw.plugin.json            # 插件清单
├── package.json
└── tsconfig.json
```

**结构决策**: 作为独立 OpenClaw 插件包，放置在 `ai-assistant/` 目录下。利用 OpenClaw 插件发现机制（workspace 模式或 npm 安装）加载。

## 核心设计决策

### 1. 消息拦截策略

使用 `before_dispatch` 钩子作为主要拦截点：
- 检查入站消息是否包含执行器切换意图
- 如果当前会话有活跃的高级执行器，将消息转发给该执行器而非默认路径
- 返回 `{ handled: true, text: response }` 来短路默认处理流程

### 2. 高级执行器通信

每条消息 spawn 一次 CLI 进程，通过 session-id 串联上下文，进程执行完即退出：

**Claude Code**:
```bash
# 首次激活（传入上下文作为 system prompt）
claude -p --session-id <uuid> --output-format=stream-json --system-prompt "<上下文>" "用户消息"
# 后续消息（自动恢复会话上下文）
claude -p --session-id <uuid> --output-format=stream-json "用户消息"
```

**Codex CLI**:
```bash
# 首次激活
codex exec --json "<上下文 + 用户消息>"
# 后续消息（恢复会话）
codex exec resume <session-id> --json "用户消息"
```

两者均支持：
- **会话持久性**: CLI 自身管理会话存储，通过 session-id 跨调用恢复上下文
- **流式输出**: stream-json (Claude Code) / JSONL (Codex CLI)，可逐 chunk 返回给用户
- **无需长运行进程**: 每次调用结束后进程退出，下次用相同 session-id 恢复

### 3. 上下文传递实现

- **升级（首次激活）**: 从 OpenClaw 会话存储读取完整消息历史，作为首次 CLI 调用的 system prompt / 初始 prompt 注入
- **后续消息**: CLI 自身通过 session-id 维护上下文，无需每次传递历史
- **降级（回退到默认）**: 从 SessionExecutorState.conversationLog（由 forward() 在每次转发时自动记录 user/assistant 消息）中构建 ContextPayload，写回 OpenClaw 会话存储
- **降级传递**: 当历史过大时，截断早期消息保留最近 N 条，通知用户
- **执行器间互切**: 终止旧 session，将合并后的完整历史作为新 session 的初始 prompt

### 4. 意图检测

使用关键词匹配 + 模式识别（非 LLM 推理）：
- 显式触发词：「使用 Claude Code」「切换到 Codex」「用 CC」等
- 退出词：「切换回来」「退出」「回到默认」等
- 仅在高置信度时触发，避免误切换

### 5. 执行器标识显示

通过 `message_sending` 钩子在每条回复前注入执行器标识前缀（如 `[Claude Code]` 或 `[Codex CLI]`）。

## 复杂度追踪

无宪法违规需要说明。
