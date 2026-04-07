import { ExecutorType } from './executors/types.js';
import type { PluginConfig } from './executors/types.js';

export type Intent =
  | { type: 'activate-claude-code'; workingDir?: string }
  | { type: 'activate-codex'; workingDir?: string }
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
        return { type: 'activate-claude-code', workingDir: this.parsePath(message) };
      }
    }

    // Check Codex CLI activation
    for (const kw of activationKeywords.codexCli) {
      if (this.matches(lower, kw)) {
        return { type: 'activate-codex', workingDir: this.parsePath(message) };
      }
    }

    return { type: 'none' };
  }

  /**
   * Extract a directory path from an activation message.
   *
   * Supported patterns (checked in order):
   *   /absolute/path  ~/home/path   → absolute path
   *   ./relative  ../parent         → relative path (kept as-is for resolveWorkingDir)
   *   "到 <name> 目录" / "到<name>目录"  → Chinese directory name
   *   "in <name>" / "in <name> dir/directory/folder" → English directory name
   */
  private parsePath(message: string): string | undefined {
    // Absolute path starting with / or ~/
    const absMatch = message.match(/(?:^|\s)((?:\/|~\/)[^\s]*)/);
    if (absMatch) return absMatch[1];

    // Explicit relative path starting with ./ or ../
    const relMatch = message.match(/(?:^|\s)(\.\.?\/[^\s]*)/);
    if (relMatch) return relMatch[1];

    // Chinese: 到 <name> 目录  (e.g. "切换到 monitor 目录")
    const zhMatch = message.match(/到\s*([^\s目,，。]+)\s*目录/);
    if (zhMatch) return zhMatch[1];

    // English: in <name> [dir|directory|folder]  (e.g. "switch in monitor dir")
    const enMatch = message.match(/\bin\s+([^\s]+?)(?:\s+(?:dir|directory|folder)\b)?$/i);
    if (enMatch) return enMatch[1];

    return undefined;
  }

  private matches(message: string, keyword: string): boolean {
    return message.includes(keyword.toLowerCase());
  }
}
