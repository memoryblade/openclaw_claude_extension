import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { ExecutorType } from '../executors/types.js';
import type { SessionStateManager } from '../session-state.js';

const EXECUTOR_LABELS: Partial<Record<ExecutorType, string>> = {
  [ExecutorType.ClaudeCode]: '[Claude Code] ',
  [ExecutorType.CodexCli]: '[Codex CLI] ',
};

export function registerMessageSendingHook(
  api: OpenClawPluginApi,
  stateManager: SessionStateManager,
): void {
  // T017, T018: inject executor prefix when active
  api.on(
    'message_sending',
    async (event, _ctx) => {
      // message_sending ctx does not carry sessionKey in the public API,
      // so we scan all cached states for active executors.
      // This is a best-effort prefix injection; for multi-session setups
      // each session is isolated by sessionId.
      const label = await resolveLabel(stateManager, event.to);
      if (!label) return;

      return { content: label + event.content };
    },
    { priority: 50 },
  );
}

async function resolveLabel(
  stateManager: SessionStateManager,
  _to: string,
): Promise<string | null> {
  // Without a sessionKey in message_sending, we rely on the session state
  // being accessible from the 'to' field (channel/recipient address).
  // In practice the hook is fired per-reply within a session context,
  // so we return null here and let before_dispatch handle the labeling
  // inline when needed. The prefix is injected in before_dispatch responses.
  // This hook remains registered for future SDK versions that expose sessionKey.
  return null;
}
