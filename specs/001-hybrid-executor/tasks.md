# Tasks: 混合执行器路由

**输入**: 设计文档 `/specs/001-hybrid-executor/`
**前置**: plan.md, spec.md, data-model.md, contracts/plugin-hooks.md, research.md

**组织方式**: 按用户故事分组，支持独立实现和测试。

## 格式: `[ID] [P?] [Story] 描述`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属用户故事（US1, US2, US3, US4）

---

## Phase 1: Setup（项目初始化）

**目的**: 插件项目脚手架和依赖配置

- [ ] T001 [P] 创建 package.json，配置 name、version、main、scripts（build/test/typecheck），添加依赖 openclaw（peer）和 vitest（dev）在 ai-assistant/package.json
- [ ] T002 [P] 创建 tsconfig.json，配置 strict 模式、ESM 输出、路径映射 在 ai-assistant/tsconfig.json
- [ ] T003 [P] 创建插件清单文件 ai-assistant/openclaw.plugin.json，包含 id、configSchema（claudeCodePath, codexCliPath, maxContextMessages, activationKeywords）
- [ ] T004 [P] 创建 ExecutorType 枚举和共享类型定义（SessionExecutorState, ContextPayload, Message, ExecutorAdapter 接口）在 ai-assistant/src/executors/types.ts

---

## Phase 2: Foundational（阻塞性基础设施）

**目的**: 所有用户故事共用的核心模块

**⚠️ 关键**: 此阶段完成前，任何用户故事都不能开始

- [ ] T005 实现 SessionStateManager：基于内存 Map 管理 SessionExecutorState 的 CRUD（get/set/delete/reset），状态变更时同步写入 OpenClaw SessionStore（via api.runtime.agent.session.*）持久化，启动时从 SessionStore 恢复，在 ai-assistant/src/session-state.ts
- [ ] T006 [P] 实现 IntentDetector：基于可配置关键词列表的意图检测（activate-claude-code / activate-codex / deactivate / switch / none），在 ai-assistant/src/intent-detector.ts
- [ ] T007 [P] 实现 ContextTransfer：从 OpenClaw 会话历史构建 ContextPayload，支持完整传递和降级截断（maxContextMessages），在 ai-assistant/src/context-transfer.ts
- [ ] T008 实现 Claude Code 执行器适配器：封装 `claude -p --session-id <uuid> --output-format=stream-json` 的调用和流式输出解析（仅 happy path，错误处理在 Phase 7 补充），在 ai-assistant/src/executors/claude-code.ts
- [ ] T009 [P] 实现 Codex CLI 执行器适配器：封装 `codex exec --json` 首次调用和 `codex exec resume <id> --json` 后续调用、JSONL 解析（仅 happy path，错误处理在 Phase 7 补充），在 ai-assistant/src/executors/codex-cli.ts
- [ ] T010 实现 ExecutorManager：统一管理执行器激活（含上下文注入）、停用、切换、消息转发，协调 SessionStateManager + ContextTransfer + 执行器适配器。forward() 方法在转发消息和接收响应时，将每轮 user/assistant 消息记录到 SessionExecutorState 的对话历史中（用于回退时构建 ContextPayload），在 ai-assistant/src/executor-manager.ts

**检查点**: 基础模块就绪，可开始用户故事实现

---

## Phase 3: 用户故事 1 - 默认低成本对话（P1）🎯 MVP

**目标**: 插件加载后，未激活高级执行器的消息完全透传给默认路径，零额外延迟

**独立测试**: 发送普通消息，验证 `before_dispatch` 返回 `{ handled: false }`，消息走默认路径

### 实现

- [ ] T011 [US1] 实现 session_start 钩子：在新会话时初始化 SessionExecutorState（activeExecutor='default'），在 ai-assistant/src/hooks/session-lifecycle.ts
- [ ] T012 [US1] 实现 session_end 钩子：清理 SessionExecutorState，在 ai-assistant/src/hooks/session-lifecycle.ts
- [ ] T013 [US1] 实现 before_dispatch 钩子骨架：加载会话状态，当 activeExecutor='default' 且无切换意图时返回 `{ handled: false }`，在 ai-assistant/src/hooks/before-dispatch.ts
- [ ] T014 [US1] 实现插件入口 definePluginEntry：注册 before_dispatch（优先级 100）、session_start、session_end 钩子，加载插件配置，在 ai-assistant/src/index.ts

**检查点**: 插件可加载，默认路径完全透传，无退化

---

## Phase 4: 用户故事 2 - 激活高级执行器（P1）🎯 MVP

**目标**: 用户显式请求后激活 Claude Code 或 Codex CLI，首次激活时传递完整上下文，后续消息由高级执行器处理

**独立测试**: 发送「使用 Claude Code」，验证后续消息由 Claude Code session 处理并流式返回

### 实现

- [ ] T015 [US2] 扩展 before_dispatch 钩子：集成 IntentDetector，检测到 activate 意图时调用 ExecutorManager.activate()，返回激活确认消息，在 ai-assistant/src/hooks/before-dispatch.ts
- [ ] T016 [US2] 扩展 before_dispatch 钩子：当 activeExecutor 不为 default 时，调用 ExecutorManager.forward() 将消息转发给高级执行器，解析流式响应后返回 `{ handled: true, text: response }`，在 ai-assistant/src/hooks/before-dispatch.ts
- [ ] T017 [US2] 实现 message_sending 钩子：当活跃执行器不为 default 时，在响应前注入 `[Claude Code]` 或 `[Codex CLI]` 前缀标识，在 ai-assistant/src/hooks/message-sending.ts
- [ ] T018 [US2] 在插件入口注册 message_sending 钩子（优先级 50），在 ai-assistant/src/index.ts

**检查点**: 可激活高级执行器，消息被正确转发和返回，带有执行器标识

---

## Phase 5: 用户故事 3 - 停用高级执行器（P2）

**目标**: 用户显式请求后回退到默认路径，高级执行器对话内容带回默认执行器；支持直接互切

**独立测试**: 激活 Claude Code → 对话几轮 → 说「退出」→ 验证后续消息走默认路径

### 实现

- [ ] T019 [US3] 扩展 before_dispatch 钩子：检测到 deactivate 意图时调用 ExecutorManager.deactivate()，将高级执行器对话内容写回 OpenClaw 会话存储，返回退出确认消息，在 ai-assistant/src/hooks/before-dispatch.ts
- [ ] T020 [US3] 扩展 before_dispatch 钩子：检测到 switch 意图时调用 ExecutorManager.switchExecutor()，合并完整历史后传递给新执行器，在 ai-assistant/src/hooks/before-dispatch.ts
- [ ] T021 [US3] 在 ExecutorManager 中实现 deactivate()：从 SessionExecutorState 中已记录的对话历史（由 forward() 积累）构建 ContextPayload，写回 OpenClaw 会话存储，重置 SessionExecutorState，在 ai-assistant/src/executor-manager.ts
- [ ] T022 [US3] 在 ExecutorManager 中实现 switchExecutor()：停用当前执行器 + 合并历史 + 激活新执行器（复用 activate 逻辑），在 ai-assistant/src/executor-manager.ts

**检查点**: 可完整退出和互切，对话内容不丢失

---

## Phase 6: 用户故事 4 - 跨消息的会话持久性（P2）

**目标**: 高级执行器 session 跨多条消息保持上下文连续性；OpenClaw 会话结束时自动清理

**独立测试**: 激活 Claude Code → 连续发送 5 条消息 → 验证第 5 条消息的响应引用了前面的对话内容

### 实现

- [ ] T023 [US4] 在 Claude Code 适配器中区分首次调用（传入上下文 + 新 session-id）和后续调用（复用 SessionExecutorState.executorSessionId），确保 `--session-id` 参数正确传递，在 ai-assistant/src/executors/claude-code.ts
- [ ] T024 [P] [US4] 在 Codex CLI 适配器中区分首次调用（`codex exec --json`）和后续调用（`codex exec resume <session-id> --json`），从首次调用输出中提取 session-id 存入 SessionExecutorState，在 ai-assistant/src/executors/codex-cli.ts
- [ ] T025 [US4] 扩展 session_end 钩子：当会话结束时且有活跃高级执行器，执行 deactivate 清理流程，在 ai-assistant/src/hooks/session-lifecycle.ts

**检查点**: 高级执行器会话跨消息保持上下文，会话结束时自动清理

---

## Phase 7: 边界情况与容错

**目的**: 处理规格中定义的边界情况和错误场景

- [ ] T026 [P] 在 Claude Code 适配器中添加 CLI 不可用检测（spawn 失败）和超时处理，返回错误信息给 ExecutorManager，在 ai-assistant/src/executors/claude-code.ts
- [ ] T027 [P] 在 Codex CLI 适配器中添加同样的不可用检测和超时处理，在 ai-assistant/src/executors/codex-cli.ts
- [ ] T028 在 ExecutorManager.activate() 中处理激活失败：通知用户，保持默认路径（FR-007），在 ai-assistant/src/executor-manager.ts
- [ ] T029 在 ExecutorManager.forward() 中处理转发失败：通知用户，自动回退到默认路径并清理状态，在 ai-assistant/src/executor-manager.ts
- [ ] T030 在 ContextTransfer 中实现降级传递逻辑：当序列化后的上下文超过限制时截断早期历史，设置 truncated=true 并记录 truncatedCount，在 ai-assistant/src/context-transfer.ts
- [ ] T031 在 before_dispatch 钩子中添加降级传递通知：当 ContextPayload.truncated=true 时在响应中附加提示「上下文传递不完整，部分早期历史已截断」，在 ai-assistant/src/hooks/before-dispatch.ts
- [ ] T032_edge 验证多渠道场景：确认当用户从不同渠道（如 Slack、Web）发送消息时，高级执行器状态以 session 为单位生效而非按渠道隔离，在 ai-assistant/src/hooks/before-dispatch.ts

---

## Phase 8: Polish & 自定义命令

**目的**: 补充用户体验和可运维性

- [ ] T033 [P] 实现 `/executor` 自定义命令：status（显示 activeExecutor + sessionId + messageCount）、switch（显式切换）、history（切换历史），通过 api.registerCommand 注册，在 ai-assistant/src/index.ts
- [ ] T034 [P] 验证 quickstart.md 中的安装和使用流程可正确执行
- [ ] T035 代码审查：确认无硬编码路径，所有 CLI 路径从 pluginConfig 读取；确认所有钩子优先级正确

---

## 依赖与执行顺序

### 阶段依赖

- **Phase 1 (Setup)**: 无依赖，立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 完成 — **阻塞所有用户故事**
- **Phase 3 (US1)**: 依赖 Phase 2
- **Phase 4 (US2)**: 依赖 Phase 3（扩展 before_dispatch 钩子）
- **Phase 5 (US3)**: 依赖 Phase 4（需要激活功能才能测试停用）
- **Phase 6 (US4)**: 依赖 Phase 4（需要激活功能才能测试持久性）
- **Phase 7 (边界情况)**: 依赖 Phase 5 + Phase 6
- **Phase 8 (Polish)**: 依赖 Phase 7

### 用户故事依赖

- **US1 (默认路径)**: Phase 2 完成后可开始，无其他故事依赖
- **US2 (激活)**: 依赖 US1（在 before_dispatch 骨架上扩展）
- **US3 (停用/互切)**: 依赖 US2（需要先能激活才能停用）
- **US4 (持久性)**: 依赖 US2（需要先能激活才能验证持久性），可与 US3 并行

### 阶段内并行机会

- Phase 1: T001-T004 均可并行
- Phase 2: T006 + T007 可并行；T008 + T009 可并行
- Phase 6: T023 + T024 可并行
- Phase 7: T026 + T027 可并行
- Phase 8: T033 + T034 可并行

---

## 并行示例: Phase 2 (Foundational)

```bash
# 第一批（无依赖）:
Task T005: SessionStateManager in src/session-state.ts
Task T006: IntentDetector in src/intent-detector.ts        # [P]
Task T007: ContextTransfer in src/context-transfer.ts       # [P]

# 第二批（依赖 T005 + types）:
Task T008: Claude Code 适配器 in src/executors/claude-code.ts
Task T009: Codex CLI 适配器 in src/executors/codex-cli.ts  # [P]

# 第三批（依赖 T005-T009）:
Task T010: ExecutorManager in src/executor-manager.ts
```

---

## 实施策略

### MVP 优先（US1 + US2）

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational
3. 完成 Phase 3: US1（默认路径透传）
4. 完成 Phase 4: US2（激活高级执行器）
5. **停下来验证**: 能激活 Claude Code / Codex CLI 并收到响应
6. 可部署/演示

### 增量交付

1. Setup + Foundational → 基础就绪
2. + US1 → 插件可加载，默认路径无退化
3. + US2 → 可激活高级执行器（MVP!）
4. + US3 → 可停用和互切
5. + US4 → 会话持久性保障
6. + 边界情况 → 生产就绪
7. + Polish → 完整交付

---

## 备注

- [P] 任务 = 不同文件、无依赖，可并行
- [Story] 标签映射到规格中的用户故事
- 每个用户故事完成后应独立可测试
- 每个任务或逻辑组完成后 commit
- 在任何检查点可停下来独立验证
