import { spawn } from 'node:child_process';
import type { ContextPayload, ExecutorAdapter } from './types.js';
import type { PluginConfig } from './types.js';
import { ContextTransfer } from '../context-transfer.js';

interface StreamJsonChunk {
  type: string;
  content?: string;
  text?: string;
  result?: string;
  error?: string;
}

export class ClaudeCodeAdapter implements ExecutorAdapter {
  constructor(
    private readonly config: PluginConfig,
    private readonly contextTransfer: ContextTransfer,
  ) {}

  async activate(sessionId: string, _context?: ContextPayload, resumeSessionId?: string): Promise<string> {
    return resumeSessionId ?? sessionId;
  }

  async forward(executorSessionId: string, userMessage: string, isFirstCall: boolean): Promise<string> {
    const sessionFlag = isFirstCall
      ? ['--session-id', executorSessionId]
      : ['--resume', executorSessionId];
    const args = [
      '-p',
      '--verbose',
      ...sessionFlag,
      '--output-format', 'stream-json',
      userMessage,
    ];
    return this.runCli(args);
  }

  private runCli(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      let stderr = '';
      const timeout = 30_000;

      const proc = spawn(this.config.claudeCodePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Claude Code CLI timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (data: string) => {
        const lines = data.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as StreamJsonChunk;
            if (parsed.type === 'result' && parsed.result) {
              chunks.push(parsed.result);
            } else if (parsed.type === 'text' && parsed.text) {
              chunks.push(parsed.text);
            } else if (parsed.content) {
              chunks.push(parsed.content);
            }
          } catch {
            // Non-JSON line — skip
          }
        }
      });

      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (data: string) => {
        stderr += data;
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Claude Code CLI unavailable: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && chunks.length === 0) {
          reject(new Error(`Claude Code CLI exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        resolve(chunks.join(''));
      });
    });
  }
}
