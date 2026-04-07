import { describe, it, expect } from 'vitest';
import { IntentDetector } from '../../src/intent-detector.js';
import { DEFAULT_CONFIG } from '../../src/executors/types.js';

const detector = new IntentDetector(DEFAULT_CONFIG);

describe('IntentDetector', () => {
  it('detects activate-claude-code (Chinese)', () => {
    expect(detector.detect('使用 Claude Code 来帮我')).toEqual({ type: 'activate-claude-code' });
  });

  it('detects activate-claude-code (English)', () => {
    expect(detector.detect('use claude code please')).toEqual({ type: 'activate-claude-code' });
  });

  it('detects activate-codex (Chinese)', () => {
    expect(detector.detect('使用 Codex 帮我写代码')).toEqual({ type: 'activate-codex' });
  });

  it('detects activate-codex (English)', () => {
    expect(detector.detect('use codex for this')).toEqual({ type: 'activate-codex' });
  });

  it('detects deactivate (Chinese 退出)', () => {
    expect(detector.detect('退出')).toEqual({ type: 'deactivate' });
  });

  it('detects deactivate (switch back)', () => {
    expect(detector.detect('switch back to normal')).toEqual({ type: 'deactivate' });
  });

  it('detects none for regular message', () => {
    expect(detector.detect('帮我写一个函数')).toEqual({ type: 'none' });
  });

  it('detects none for empty message', () => {
    expect(detector.detect('')).toEqual({ type: 'none' });
  });

  it('is case-insensitive', () => {
    expect(detector.detect('USE CLAUDE CODE NOW')).toEqual({ type: 'activate-claude-code' });
  });

  it('deactivate takes precedence over other keywords', () => {
    // "退出" should be detected as deactivate even if other keywords appear in message
    expect(detector.detect('退出 Claude Code 模式')).toEqual({ type: 'deactivate' });
  });
});
