import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { ExecutorType, type SessionExecutorState } from './executors/types.js';

/** In-memory cache: sessionId → state */
const cache = new Map<string, SessionExecutorState>();

/** In-memory: sessionKey → current sessionId */
const keyToId = new Map<string, string>();

function makeDefault(sessionId: string): SessionExecutorState {
  return {
    sessionId,
    activeExecutor: ExecutorType.Default,
    executorSessionId: null,
    executorSessionInitialized: false,
    activatedAt: null,
    messageCount: 0,
    conversationLog: [],
    lastClaudeCodeSessionId: null,
    lastCodexCliSessionId: null,
  };
}

export class SessionStateManager {
  private readonly stateDir: string;
  private readonly storeFile: string;
  private readonly keyMapFile: string;

  constructor(private readonly api: OpenClawPluginApi) {
    this.stateDir = api.runtime.state.resolveStateDir();
    this.storeFile = join(this.stateDir, 'hybrid-executor-sessions.json');
    this.keyMapFile = join(this.stateDir, 'hybrid-executor-key-map.json');
    this.loadKeyMap();
  }

  /**
   * Register a sessionKey → sessionId mapping when a session starts.
   * Called from session_start hook.
   */
  registerSessionKey(sessionKey: string, sessionId: string): void {
    keyToId.set(sessionKey, sessionId);
    this.saveKeyMap();
  }

  /**
   * Remove a sessionKey → sessionId mapping when a session ends.
   * Only clears if the mapping still points to the given sessionId.
   */
  unregisterSessionKey(sessionKey: string, sessionId: string): void {
    if (keyToId.get(sessionKey) === sessionId) {
      keyToId.delete(sessionKey);
      this.saveKeyMap();
    }
  }

  /**
   * Resolve a sessionKey to its current sessionId.
   * Falls back to the sessionKey itself if no mapping exists
   * (backward compat / plugin restart with no prior session_start).
   */
  resolveId(sessionKey: string): string {
    return keyToId.get(sessionKey) ?? sessionKey;
  }

  async get(sessionId: string): Promise<SessionExecutorState> {
    const cached = cache.get(sessionId);
    if (cached) return cached;

    const stored = this.loadStore();
    const entry = stored[sessionId];
    if (entry) {
      cache.set(sessionId, entry);
      return entry;
    }

    const fresh = makeDefault(sessionId);
    cache.set(sessionId, fresh);
    return fresh;
  }

  async set(sessionId: string, state: SessionExecutorState): Promise<void> {
    cache.set(sessionId, state);
    try {
      const stored = this.loadStore();
      stored[sessionId] = state;
      this.saveStore(stored);
    } catch (err) {
      this.api.logger.warn(`hybrid-executor: failed to persist state: ${String(err)}`);
    }
  }

  async reset(sessionId: string): Promise<SessionExecutorState> {
    const fresh = makeDefault(sessionId);
    await this.set(sessionId, fresh);
    return fresh;
  }

  delete(sessionId: string): void {
    cache.delete(sessionId);
    try {
      const stored = this.loadStore();
      delete stored[sessionId];
      this.saveStore(stored);
    } catch {
      // best-effort
    }
  }

  private loadKeyMap(): void {
    try {
      const raw = readFileSync(this.keyMapFile, 'utf8');
      const map = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(map)) {
        keyToId.set(k, v);
      }
    } catch {
      // File may not exist yet — start empty
    }
  }

  private saveKeyMap(): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      const map: Record<string, string> = {};
      for (const [k, v] of keyToId.entries()) {
        map[k] = v;
      }
      writeFileSync(this.keyMapFile, JSON.stringify(map, null, 2), 'utf8');
    } catch {
      // best-effort
    }
  }

  private loadStore(): Record<string, SessionExecutorState> {
    try {
      const raw = readFileSync(this.storeFile, 'utf8');
      return JSON.parse(raw) as Record<string, SessionExecutorState>;
    } catch {
      return {};
    }
  }

  private saveStore(store: Record<string, SessionExecutorState>): void {
    mkdirSync(this.stateDir, { recursive: true });
    writeFileSync(this.storeFile, JSON.stringify(store, null, 2), 'utf8');
  }
}
