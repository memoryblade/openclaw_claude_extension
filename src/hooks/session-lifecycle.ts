import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { SessionStateManager } from '../session-state.js';
import type { ExecutorManager } from '../executor-manager.js';

export function registerSessionLifecycleHooks(
  api: OpenClawPluginApi,
  stateManager: SessionStateManager,
  executorManager: ExecutorManager,
): void {
  // T011: session_start — initialize SessionExecutorState
  api.on('session_start', async (event) => {
    await stateManager.get(event.sessionId);
    // get() already initializes to default if missing
  });

  // T012 + T025: session_end — cleanup, deactivate if active executor
  api.on('session_end', async (event) => {
    try {
      const state = await stateManager.get(event.sessionId);
      if (state.activeExecutor !== 'default') {
        const sessionKey = event.sessionKey ?? event.sessionId;
        await executorManager.deactivate(event.sessionId, sessionKey);
      }
    } catch (err) {
      api.logger.warn(`hybrid-executor: error during session_end cleanup: ${String(err)}`);
    } finally {
      stateManager.delete(event.sessionId);
    }
  });
}
