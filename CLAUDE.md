# ai-assistant Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-27

## Active Technologies

- TypeScript (Node.js v22.16+ / v24+) (001-hybrid-executor)
- OpenClaw Plugin SDK (`openclaw/plugin-sdk/*`)
- vitest (testing)

## Project Structure

```text
src/
├── index.ts                    # 插件入口
├── executor-manager.ts         # 执行器生命周期管理
├── context-transfer.ts         # 上下文传递
├── session-state.ts            # 会话状态管理
├── intent-detector.ts          # 意图检测
├── executors/                  # 执行器适配器
└── hooks/                      # OpenClaw 钩子实现
tests/
├── unit/
└── integration/
```

## Commands

```bash
pnpm install    # 安装依赖
pnpm build      # 构建
pnpm test       # 运行测试
pnpm typecheck  # 类型检查
```

## Code Style

TypeScript: Follow standard conventions, strict mode

## Key Constraint

**不修改 OpenClaw 源码** — 所有功能通过插件系统实现。OpenClaw 源码位于 `../openclaw/`，仅供参考。

## Recent Changes

- 001-hybrid-executor: Added

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
