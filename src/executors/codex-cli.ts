import { spawn } from 'node:child_process';
import type { ContextPayload, ExecutorAdapter } from './types.js';
import type { PluginConfig } from './types.js';
import { ContextTransfer } from '../context-transfer.js';

interface CodexJsonLine {
  type?: string;
  session_id?: string;
  content?: string;
  text?: string;
  output?: string;
  result?: string;
  error?: string;
}

export class CodexCliAdapter implements ExecutorAdapter {
  constructor(
    private readonly config: PluginConfig,
    private readonly contextTransfer: ContextTransfer,
  ) {}

  async activate(sessionId: string, context?: ContextPayload, _resumeSessionId?: string): Promise<string> {
    // Codex CLI generates its own session-id on first exec call.
    // We run a first call to get the session-id back.
    let prompt = '';
    if (context) {
      prompt = this.contextTransfer.serialize(context) + '\n\n';
    }
    prompt += '[Session started. Ready for messages.]';

    const { sessionId: codexSessionId } = await this.runFirstCall(prompt);
    return codexSessionId;
  }

  async forward(executorSessionId: string, userMessage: string, _isFirstCall: boolean): Promise<string> {
    return this.runResumeCall(executorSessionId, userMessage);
  }

  private runFirstCall(prompt: string): Promise<{ sessionId: string; text: string }> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      let sessionId = '';
      let stderr = '';
      const timeout = 30_000;

      const proc = spawn(this.config.codexCliPath, ['exec', '--json', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Codex CLI timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (data: string) => {
        const lines = data.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as CodexJsonLine;
            if (parsed.session_id && !sessionId) {
              sessionId = parsed.session_id;
            }
            if (parsed.content) chunks.push(parsed.content);
            else if (parsed.text) chunks.push(parsed.text);
            else if (parsed.result) chunks.push(parsed.result);
          } catch {
            // skip non-JSON
          }
        }
      });

      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d: string) => { stderr += d; });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Codex CLI unavailable: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (!sessionId) {
          reject(new Error(`Codex CLI did not return a session_id (exit code ${code}): ${stderr.trim()}`));
          return;
        }
        resolve({ sessionId, text: chunks.join('') });
      });
    });
  }

  private runResumeCall(executorSessionId: string, userMessage: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      let stderr = '';
      const timeout = 30_000;

      const proc = spawn(
        this.config.codexCliPath,
        ['exec', 'resume', executorSessionId, '--json', userMessage],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Codex CLI timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (data: string) => {
        const lines = data.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as CodexJsonLine;
            if (parsed.content) chunks.push(parsed.content);
            else if (parsed.text) chunks.push(parsed.text);
            else if (parsed.result) chunks.push(parsed.result);
          } catch {
            // skip
          }
        }
      });

      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d: string) => { stderr += d; });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Codex CLI unavailable: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && chunks.length === 0) {
          reject(new Error(`Codex CLI exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        resolve(chunks.join(''));
      });
    });
  }
}
