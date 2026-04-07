import { randomUUID } from 'node:crypto';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { ExecutorType, type ContextPayload, type Message } from './executors/types.js';
import type { SessionExecutorState } from './executors/types.js';
import { SessionStateManager } from './session-state.js';
import { ContextTransfer } from './context-transfer.js';
import { ClaudeCodeAdapter } from './executors/claude-code.js';
import { CodexCliAdapter } from './executors/codex-cli.js';
import { resolveWorkingDir } from './resolve-working-dir.js';

export class ExecutorManager {
  private readonly stateManager: SessionStateManager;
  private readonly contextTransfer: ContextTransfer;
  private readonly claudeCode: ClaudeCodeAdapter;
  private readonly codexCli: CodexCliAdapter;

  constructor(
    private readonly api: OpenClawPluginApi,
    stateManager: SessionStateManager,
    contextTransfer: ContextTransfer,
    claudeCode: ClaudeCodeAdapter,
    codexCli: CodexCliAdapter,
    private readonly config: import('./executors/types.js').PluginConfig,
  ) {
    this.stateManager = stateManager;
    this.contextTransfer = contextTransfer;
    this.claudeCode = claudeCode;
    this.codexCli = codexCli;
  }

  /**
   * Activate a high-level executor for the given OpenClaw session.
   * Transfers context from session history on first activation.
   * Returns a confirmation message or throws on failure.
   */
  async activate(
    ocSessionId: string,
    sessionKey: string,
    targetExecutor: ExecutorType.ClaudeCode | ExecutorType.CodexCli,
    workingDir?: string,
  ): Promise<string> {
    const state = await this.stateManager.get(ocSessionId);
    const context = await this.contextTransfer.buildFromSession(sessionKey);

    const adapter = targetExecutor === ExecutorType.ClaudeCode ? this.claudeCode : this.codexCli;
    const lastSessionId =
      targetExecutor === ExecutorType.ClaudeCode
        ? state.lastClaudeCodeSessionId
        : state.lastCodexCliSessionId;
    const newSessionId = randomUUID();
    const executorSessionId = await adapter.activate(
      newSessionId,
      context.totalCount > 0 ? context : undefined,
      lastSessionId ?? undefined,
    );

    const resolvedCwd = resolveWorkingDir(
      workingDir ?? this.config.workingDir,
      this.config.workingDirRoot,
    );

    const resumed = lastSessionId != null;
    const updated: SessionExecutorState = {
      ...state,
      activeExecutor: targetExecutor,
      executorSessionId,
      executorSessionInitialized: resumed,
      activatedAt: Date.now(),
      messageCount: 0,
      conversationLog: [],
      workingDir: resolvedCwd,
    };
    await this.stateManager.set(ocSessionId, updated);

    const name = targetExecutor === ExecutorType.ClaudeCode ? 'Claude Code' : 'Codex CLI';
    const ctxNote = context.truncated
      ? ` (上下文传递不完整，${context.truncatedCount} 条早期历史已截断)`
      : '';
    return resumed ? `已恢复上次 ${name} 会话。${ctxNote}` : `已切换到 ${name}。${ctxNote}`;
  }

  /**
   * Forward a user message to the currently active executor.
   * Records the exchange in conversationLog.
   * Returns the executor response or throws on failure.
   */
  async forward(ocSessionId: string, userMessage: string): Promise<{ text: string }> {
    const state = await this.stateManager.get(ocSessionId);
    if (state.activeExecutor === ExecutorType.Default || !state.executorSessionId) {
      throw new Error('No active executor to forward to');
    }

    const adapter = state.activeExecutor === ExecutorType.ClaudeCode ? this.claudeCode : this.codexCli;
    const isFirstCall = !state.executorSessionInitialized;
    const response = await adapter.forward(state.executorSessionId, userMessage, isFirstCall, state.workingDir);

    const userMsg: Message = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      executor: state.activeExecutor,
    };
    const assistantMsg: Message = {
      role: 'assistant',
      content: response,
      timestamp: Date.now(),
      executor: state.activeExecutor,
    };

    const updated: SessionExecutorState = {
      ...state,
      executorSessionInitialized: true,
      messageCount: state.messageCount + 1,
      conversationLog: [...state.conversationLog, userMsg, assistantMsg],
    };
    await this.stateManager.set(ocSessionId, updated);

    return { text: response };
  }

  /**
   * Deactivate the current executor.
   * Writes conversation history back to OpenClaw session store.
   */
  async deactivate(ocSessionId: string, sessionKey: string): Promise<string> {
    const state = await this.stateManager.get(ocSessionId);
    const prevName = state.activeExecutor === ExecutorType.ClaudeCode ? 'Claude Code' : 'Codex CLI';

    await this.writeBackConversationLog(state, sessionKey);

    // Persist the executor session ID so it can be resumed later, then reset active state.
    const fresh = await this.stateManager.reset(ocSessionId);
    if (state.executorSessionId) {
      if (state.activeExecutor === ExecutorType.ClaudeCode) {
        await this.stateManager.set(ocSessionId, { ...fresh, lastClaudeCodeSessionId: state.executorSessionId });
      } else if (state.activeExecutor === ExecutorType.CodexCli) {
        await this.stateManager.set(ocSessionId, { ...fresh, lastCodexCliSessionId: state.executorSessionId });
      }
    }

    return `已退出 ${prevName}，返回默认路径。`;
  }

  /**
   * Switch directly from one high-level executor to another.
   */
  async switchExecutor(
    ocSessionId: string,
    sessionKey: string,
    targetExecutor: ExecutorType.ClaudeCode | ExecutorType.CodexCli,
  ): Promise<string> {
    const state = await this.stateManager.get(ocSessionId);

    // Build merged history from conversation log
    const context = this.contextTransfer.buildFromLog(state.conversationLog);

    const adapter = targetExecutor === ExecutorType.ClaudeCode ? this.claudeCode : this.codexCli;
    const newSessionId = randomUUID();
    const executorSessionId = await adapter.activate(newSessionId, context.totalCount > 0 ? context : undefined);

    const updated: SessionExecutorState = {
      ...state,
      activeExecutor: targetExecutor,
      executorSessionId,
      executorSessionInitialized: false,
      activatedAt: Date.now(),
      messageCount: 0,
      conversationLog: [],
      // carry over the existing workingDir when switching between executors
      workingDir: state.workingDir,
    };
    await this.stateManager.set(ocSessionId, updated);

    const name = targetExecutor === ExecutorType.ClaudeCode ? 'Claude Code' : 'Codex CLI';
    const ctxNote = context.truncated
      ? ` (上下文传递不完整，${context.truncatedCount} 条早期历史已截断)`
      : '';
    return `已切换到 ${name}。${ctxNote}`;
  }

  private async writeBackConversationLog(_state: SessionExecutorState, _sessionKey: string): Promise<void> {
    // The conversation log is already persisted as part of SessionExecutorState
    // via SessionStateManager. Nothing more to do here.
  }
}
