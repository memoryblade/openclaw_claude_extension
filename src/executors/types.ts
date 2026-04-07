export enum ExecutorType {
  Default = 'default',
  ClaudeCode = 'claude-code',
  CodexCli = 'codex-cli',
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  executor: ExecutorType;
}

export interface SessionExecutorState {
  sessionId: string;
  activeExecutor: ExecutorType;
  executorSessionId: string | null;
  /** Whether the executor session has been used at least once (survives plugin reloads). */
  executorSessionInitialized: boolean;
  activatedAt: number | null;
  messageCount: number;
  conversationLog: Message[];
  lastClaudeCodeSessionId: string | null;
  lastCodexCliSessionId: string | null;
  /** Resolved absolute working directory for the active executor process. */
  workingDir?: string;
}

export interface ContextPayload {
  messages: Message[];
  truncated: boolean;
  truncatedCount?: number;
  totalCount: number;
}

export interface ExecutorAdapter {
  /** Activate the executor, optionally injecting context on first call.
   *  If resumeSessionId is provided, the adapter should resume that session
   *  instead of creating a new one. */
  activate(sessionId: string, context?: ContextPayload, resumeSessionId?: string): Promise<string>;
  /** Forward a user message to the executor and return the response.
   *  isFirstCall: true on the very first forward after activate — adapter uses --session-id.
   *  false on subsequent calls — adapter uses --resume.
   *  cwd: resolved absolute working directory for the subprocess. */
  forward(executorSessionId: string, userMessage: string, isFirstCall: boolean, cwd?: string): Promise<string>;
}

export interface PluginConfig {
  claudeCodePath: string;
  codexCliPath: string;
  maxContextMessages: number;
  /** Default working directory for executor subprocesses.
   *  Absolute path → used as-is.
   *  Relative path → resolved against workingDirRoot (or process.cwd()).
   *  Omitted → process.cwd(). */
  workingDir?: string;
  /** Root directory used to resolve relative workingDir values. */
  workingDirRoot?: string;
  activationKeywords: {
    claudeCode: string[];
    codexCli: string[];
    deactivate: string[];
  };
}

export const DEFAULT_CONFIG: PluginConfig = {
  claudeCodePath: 'claude',
  codexCliPath: 'codex',
  maxContextMessages: 200,
  activationKeywords: {
    claudeCode: ['使用 Claude Code', '用 Claude Code', '切换到 Claude Code', 'use claude code', 'switch to claude code'],
    codexCli: ['使用 Codex', '用 Codex', '切换到 Codex', 'use codex', 'switch to codex'],
    deactivate: ['切换回来', '退出', '回到默认', 'switch back', 'exit', 'go back'],
  },
};
