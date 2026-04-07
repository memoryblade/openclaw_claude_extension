import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { DEFAULT_CONFIG, ExecutorType, type PluginConfig } from './executors/types.js';
import { SessionStateManager } from './session-state.js';
import { ContextTransfer } from './context-transfer.js';
import { IntentDetector } from './intent-detector.js';
import { ClaudeCodeAdapter } from './executors/claude-code.js';
import { CodexCliAdapter } from './executors/codex-cli.js';
import { ExecutorManager } from './executor-manager.js';
import { registerSessionLifecycleHooks } from './hooks/session-lifecycle.js';
import { registerBeforeDispatchHook } from './hooks/before-dispatch.js';
import { registerMessageSendingHook } from './hooks/message-sending.js';

function buildConfig(pluginConfig: Record<string, unknown> | undefined): PluginConfig {
  const cfg = pluginConfig ?? {};
  return {
    claudeCodePath: typeof cfg['claudeCodePath'] === 'string' ? cfg['claudeCodePath'] : DEFAULT_CONFIG.claudeCodePath,
    codexCliPath: typeof cfg['codexCliPath'] === 'string' ? cfg['codexCliPath'] : DEFAULT_CONFIG.codexCliPath,
    maxContextMessages:
      typeof cfg['maxContextMessages'] === 'number'
        ? cfg['maxContextMessages']
        : DEFAULT_CONFIG.maxContextMessages,
    activationKeywords: {
      claudeCode:
        Array.isArray((cfg['activationKeywords'] as Record<string, unknown>)?.['claudeCode'])
          ? ((cfg['activationKeywords'] as Record<string, string[]>)['claudeCode'] as string[])
          : DEFAULT_CONFIG.activationKeywords.claudeCode,
      codexCli:
        Array.isArray((cfg['activationKeywords'] as Record<string, unknown>)?.['codexCli'])
          ? ((cfg['activationKeywords'] as Record<string, string[]>)['codexCli'] as string[])
          : DEFAULT_CONFIG.activationKeywords.codexCli,
      deactivate:
        Array.isArray((cfg['activationKeywords'] as Record<string, unknown>)?.['deactivate'])
          ? ((cfg['activationKeywords'] as Record<string, string[]>)['deactivate'] as string[])
          : DEFAULT_CONFIG.activationKeywords.deactivate,
    },
  };
}

export default definePluginEntry({
  id: 'hybrid-executor',
  name: 'Hybrid Executor',
  description: 'Routes messages to Claude Code or Codex CLI based on user intent',

  register(api: OpenClawPluginApi) {
    const config = buildConfig(api.pluginConfig);
    const stateManager = new SessionStateManager(api);
    const contextTransfer = new ContextTransfer(api, config);
    const claudeCode = new ClaudeCodeAdapter(config, contextTransfer);
    const codexCli = new CodexCliAdapter(config, contextTransfer);
    const executorManager = new ExecutorManager(api, stateManager, contextTransfer, claudeCode, codexCli);
    const intentDetector = new IntentDetector(config);

    // T014: register before_dispatch (priority 100), session_start, session_end
    registerBeforeDispatchHook(api, stateManager, executorManager, intentDetector);

    // T011, T012, T025
    registerSessionLifecycleHooks(api, stateManager, executorManager);

    // T018: register message_sending (priority 50)
    registerMessageSendingHook(api, stateManager);

    // T033: /executor command
    api.registerCommand({
      name: 'executor',
      description: 'Manage the active executor (status / switch / history)',
      handler: async (ctx) => {
        const args = (ctx.args ?? '').trim().split(/\s+/);
        const sub = args[0] ?? 'status';

        // Resolve session id — commands run outside of before_dispatch so we
        // use conversationId as proxy if available.
        const sessionId = ctx.commandBody; // fallback; real impl would use sessionKey

        if (sub === 'status') {
          // Best-effort status across all cached sessions
          return {
            text: 'ℹ️ /executor status: 当前无法直接读取会话状态（命令上下文中无 sessionKey）。请在对话中发送「使用 Claude Code」或「退出」来切换执行器。',
          };
        }

        if (sub === 'switch') {
          const target = args[1];
          if (target === 'claude-code') {
            return { text: '请在对话中发送「使用 Claude Code」来切换。' };
          }
          if (target === 'codex-cli') {
            return { text: '请在对话中发送「使用 Codex」来切换。' };
          }
          if (target === 'default') {
            return { text: '请在对话中发送「退出」来回到默认路径。' };
          }
          return { text: '用法：/executor switch <claude-code|codex-cli|default>' };
        }

        if (sub === 'history') {
          return { text: '切换历史功能暂未实现。' };
        }

        return { text: '用法：/executor <status|switch|history>' };
      },
    });

    api.logger.info('hybrid-executor: plugin registered');
  },
});
