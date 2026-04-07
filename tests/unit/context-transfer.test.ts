import { describe, it, expect } from 'vitest';
import { ContextTransfer } from '../../src/context-transfer.js';
import { ExecutorType, type Message } from '../../src/executors/types.js';
import { DEFAULT_CONFIG } from '../../src/executors/types.js';

function makeApi() {
  return {
    runtime: {
      subagent: {
        getSessionMessages: async () => ({ messages: [] }),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as Parameters<typeof ContextTransfer>[0];
}

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as Message['role'],
    content: `Message ${i}`,
    timestamp: Date.now() + i,
    executor: ExecutorType.Default,
  }));
}

describe('ContextTransfer', () => {
  it('returns no truncation when under limit', () => {
    const ct = new ContextTransfer(makeApi(), { ...DEFAULT_CONFIG, maxContextMessages: 200 });
    const messages = makeMessages(10);
    const payload = ct.buildFromLog(messages);
    expect(payload.truncated).toBe(false);
    expect(payload.totalCount).toBe(10);
    expect(payload.messages.length).toBe(10);
  });

  it('truncates when over limit', () => {
    const ct = new ContextTransfer(makeApi(), { ...DEFAULT_CONFIG, maxContextMessages: 5 });
    const messages = makeMessages(10);
    const payload = ct.buildFromLog(messages);
    expect(payload.truncated).toBe(true);
    expect(payload.truncatedCount).toBe(5);
    expect(payload.messages.length).toBe(5);
    expect(payload.totalCount).toBe(10);
  });

  it('keeps the most recent messages when truncating', () => {
    const ct = new ContextTransfer(makeApi(), { ...DEFAULT_CONFIG, maxContextMessages: 3 });
    const messages = makeMessages(6);
    const payload = ct.buildFromLog(messages);
    expect(payload.messages[0].content).toBe('Message 3');
    expect(payload.messages[2].content).toBe('Message 5');
  });

  it('serializes with truncation note when truncated', () => {
    const ct = new ContextTransfer(makeApi(), { ...DEFAULT_CONFIG, maxContextMessages: 2 });
    const messages = makeMessages(4);
    const payload = ct.buildFromLog(messages);
    const serialized = ct.serialize(payload);
    expect(serialized).toContain('2 early messages omitted');
  });

  it('serializes without truncation note when not truncated', () => {
    const ct = new ContextTransfer(makeApi(), DEFAULT_CONFIG);
    const messages = makeMessages(2);
    const payload = ct.buildFromLog(messages);
    const serialized = ct.serialize(payload);
    expect(serialized).toContain('[Previous conversation]');
    expect(serialized).not.toContain('omitted');
  });
});
