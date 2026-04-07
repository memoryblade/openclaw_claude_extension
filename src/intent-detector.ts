import { ExecutorType } from './executors/types.js';
import type { PluginConfig } from './executors/types.js';

export type Intent =
  | { type: 'activate-claude-code' }
  | { type: 'activate-codex' }
  | { type: 'deactivate' }
  | { type: 'switch'; to: ExecutorType }
  | { type: 'none' };

export class IntentDetector {
  constructor(private readonly config: PluginConfig) {}

  detect(message: string): Intent {
    const lower = message.toLowerCase().trim();
    const { activationKeywords } = this.config;

    // Check deactivate first (most specific exit intent)
    for (const kw of activationKeywords.deactivate) {
      if (this.matches(lower, kw)) {
        return { type: 'deactivate' };
      }
    }

    // Check Claude Code activation
    for (const kw of activationKeywords.claudeCode) {
      if (this.matches(lower, kw)) {
        return { type: 'activate-claude-code' };
      }
    }

    // Check Codex CLI activation
    for (const kw of activationKeywords.codexCli) {
      if (this.matches(lower, kw)) {
        return { type: 'activate-codex' };
      }
    }

    return { type: 'none' };
  }

  private matches(message: string, keyword: string): boolean {
    return message.includes(keyword.toLowerCase());
  }
}
