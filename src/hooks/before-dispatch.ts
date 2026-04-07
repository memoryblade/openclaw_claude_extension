import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { ExecutorType } from '../executors/types.js';
import type { SessionStateManager } from '../session-state.js';
import type { ExecutorManager } from '../executor-manager.js';
import type { IntentDetector } from '../intent-detector.js';

export function registerBeforeDispatchHook(
  api: OpenClawPluginApi,
  stateManager: SessionStateManager,
  executorManager: ExecutorManager,
  intentDetector: IntentDetector,
): void {
  // T013, T015, T016, T019, T020, T031, T032_edge
  api.on(
    'before_dispatch',
    async (event, ctx) => {
      const sessionId = ctx.sessionKey ?? event.sessionKey ?? '';
      if (!sessionId) {
        api.logger.warn('hybrid-executor: before_dispatch — sessionId empty, skipping');
        return { handled: false };
      }

      const state = await stateManager.get(sessionId);
      const message = event.content;
      const intent = intentDetector.detect(message);
      const sessionKey = ctx.sessionKey ?? event.sessionKey ?? sessionId;

      api.logger.info(
        `hybrid-executor: before_dispatch — intent=${intent.type} activeExecutor=${state.activeExecutor} sessionId=${sessionId.slice(0, 8)} msg=${JSON.stringify(message.slice(0, 60))}`,
      );

      // --- Intent: deactivate ---
      if (intent.type === 'deactivate') {
        if (state.activeExecutor === ExecutorType.Default) {
          return { handled: true, text: '当前已在默认路径，无需退出。' };
        }
        try {
          const confirmMsg = await executorManager.deactivate(sessionId, sessionKey);
          return { handled: true, text: confirmMsg };
        } catch (err) {
          api.logger.error(`hybrid-executor: deactivate failed: ${String(err)}`);
          return { handled: true, text: `退出失败：${String(err)}` };
        }
      }

      // --- Intent: activate Claude Code ---
      if (intent.type === 'activate-claude-code') {
        const claudeCodeLive =
          state.activeExecutor === ExecutorType.ClaudeCode &&
          state.executorSessionId != null &&
          state.executorSessionInitialized;
        if (claudeCodeLive) {
          return { handled: true, text: 'Claude Code 已处于激活状态。' };
        }
        try {
          let confirmMsg: string;
          if (state.activeExecutor !== ExecutorType.Default) {
            confirmMsg = await executorManager.switchExecutor(sessionId, sessionKey, ExecutorType.ClaudeCode);
          } else {
            confirmMsg = await executorManager.activate(sessionId, sessionKey, ExecutorType.ClaudeCode);
          }
          return { handled: true, text: confirmMsg };
        } catch (err) {
          api.logger.error(`hybrid-executor: activate claude-code failed: ${String(err)}`);
          return { handled: true, text: `激活 Claude Code 失败，保持默认路径。错误：${String(err)}` };
        }
      }

      // --- Intent: activate Codex CLI ---
      if (intent.type === 'activate-codex') {
        const codexLive =
          state.activeExecutor === ExecutorType.CodexCli &&
          state.executorSessionId != null &&
          state.executorSessionInitialized;
        if (codexLive) {
          return { handled: true, text: 'Codex CLI 已处于激活状态。' };
        }
        try {
          let confirmMsg: string;
          if (state.activeExecutor !== ExecutorType.Default) {
            confirmMsg = await executorManager.switchExecutor(sessionId, sessionKey, ExecutorType.CodexCli);
          } else {
            confirmMsg = await executorManager.activate(sessionId, sessionKey, ExecutorType.CodexCli);
          }
          return { handled: true, text: confirmMsg };
        } catch (err) {
          api.logger.error(`hybrid-executor: activate codex-cli failed: ${String(err)}`);
          return { handled: true, text: `激活 Codex CLI 失败，保持默认路径。错误：${String(err)}` };
        }
      }

      // --- Forward to active executor ---
      if (state.activeExecutor !== ExecutorType.Default) {
        const prefix =
          state.activeExecutor === ExecutorType.ClaudeCode ? '[Claude Code] ' : '[Codex CLI] ';

        try {
          const { text } = await executorManager.forward(sessionId, message);
          return { handled: true, text: prefix + text };
        } catch (err) {
          api.logger.error(`hybrid-executor: forward failed: ${String(err)}`);
          // T029: auto-fallback to default on forward failure
          try {
            await stateManager.reset(sessionId);
          } catch {
            // ignore reset errors
          }
          return {
            handled: true,
            text: `执行器出错，已自动回退到默认路径。错误：${String(err)}`,
          };
        }
      }

      // --- Default path: no active executor, no intent ---
      return { handled: false };
    },
    { priority: 100 },
  );
}
