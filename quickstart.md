  ---
  Hybrid Executor 使用手册

  概述

  本插件在 OpenClaw 中实现混合执行器路由：根据你的指令，将对话转发给 Claude Code CLI 或 Codex CLI 处理，而不经过默认的
  LLM Agent。

  ---
  启动执行器

  在对话中发送以下任意关键词即可切换执行器：

  切换到 Claude Code：
  使用 Claude Code
  用 Claude Code
  切换到 Claude Code
  use claude code
  switch to claude code

  切换到 Codex CLI：
  使用 Codex
  用 Codex
  切换到 Codex
  use codex
  switch to codex

  切换成功后，后续所有消息都会被转发给对应的执行器处理，回复前缀会标注 [Claude Code] 或 [Codex CLI]。

  ---
  退出执行器（返回默认路径）

  退出
  切换回来
  回到默认
  switch back
  exit
  go back

  ---
  查询状态与管理

  状态查询：
  /executor status

  手动切换：
  /executor switch claude-code
  /executor switch codex-cli
  /executor switch default

  切换历史：
  /executor history
  （当前功能暂未完整实现）

  ---
  自动回退

  若执行器出错（如 Claude Code 进程崩溃），插件会自动回退到默认路径并提示错误原因，不会卡死会话。

  ---
  配置（~/.openclaw/openclaw.json）

  "plugins": {
    "entries": {
      "hybrid-executor": {
        "enabled": true,
        "config": {
          "claudeCodePath": "claude",        // Claude Code 可执行路径
          "codexCliPath": "codex",           // Codex CLI 可执行路径
          "maxContextMessages": 200,         // 上下文消息数上限
          "workingDirRoot": "/Users/fish/workspace/code/openclaw_workspace", // useCC ./xxx
          "activationKeywords": {            // 自定义触发关键词
            "claudeCode": ["useCC"],
            "codexCli": ["useCX"],
            "deactivate": ["退出"]
          }
        }
      }
    }
  }

  ---
  更新插件

  修改源码后：
  cd /Users/fish/workspace/code/openclaw/openclaw_with_cc/ai-assistant
  pnpm build
  openclaw gateway restart