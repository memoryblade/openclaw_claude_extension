import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { SessionStateManager } from '../../src/session-state.js';
import { ExecutorType } from '../../src/executors/types.js';

function makeApi(stateDir: string) {
  return {
    runtime: {
      state: {
        resolveStateDir: () => stateDir,
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as Parameters<typeof SessionStateManager>[0];
}

describe('SessionStateManager', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = join(tmpdir(), `hybrid-executor-test-${Date.now()}`);
    mkdirSync(stateDir, { recursive: true });
  });

  it('returns default state for unknown session', async () => {
    const mgr = new SessionStateManager(makeApi(stateDir));
    const state = await mgr.get('session-1');
    expect(state.sessionId).toBe('session-1');
    expect(state.activeExecutor).toBe(ExecutorType.Default);
    expect(state.executorSessionId).toBeNull();
    expect(state.conversationLog).toEqual([]);
  });

  it('persists and retrieves state', async () => {
    const mgr = new SessionStateManager(makeApi(stateDir));
    await mgr.set('session-2', {
      sessionId: 'session-2',
      activeExecutor: ExecutorType.ClaudeCode,
      executorSessionId: 'cli-abc',
      activatedAt: 1000,
      messageCount: 3,
      conversationLog: [],
    });

    // New instance should read from disk
    const mgr2 = new SessionStateManager(makeApi(stateDir));
    const state = await mgr2.get('session-2');
    expect(state.activeExecutor).toBe(ExecutorType.ClaudeCode);
    expect(state.executorSessionId).toBe('cli-abc');
  });

  it('resets state to default', async () => {
    const mgr = new SessionStateManager(makeApi(stateDir));
    await mgr.set('session-3', {
      sessionId: 'session-3',
      activeExecutor: ExecutorType.CodexCli,
      executorSessionId: 'codex-xyz',
      activatedAt: 2000,
      messageCount: 5,
      conversationLog: [],
    });
    await mgr.reset('session-3');
    const state = await mgr.get('session-3');
    expect(state.activeExecutor).toBe(ExecutorType.Default);
    expect(state.executorSessionId).toBeNull();
  });

  it('deletes state', async () => {
    const mgr = new SessionStateManager(makeApi(stateDir));
    await mgr.set('session-4', {
      sessionId: 'session-4',
      activeExecutor: ExecutorType.ClaudeCode,
      executorSessionId: 'cli-del',
      activatedAt: 3000,
      messageCount: 1,
      conversationLog: [],
    });
    mgr.delete('session-4');
    // After delete, a new get returns default
    const state = await mgr.get('session-4');
    expect(state.activeExecutor).toBe(ExecutorType.Default);
  });
});
