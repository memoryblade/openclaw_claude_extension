import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { ExecutorType, type ContextPayload, type Message, type PluginConfig } from './executors/types.js';

export class ContextTransfer {
  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly config: PluginConfig,
  ) {}

  /**
   * Build a ContextPayload from OpenClaw session message history.
   */
  async buildFromSession(sessionKey: string): Promise<ContextPayload> {
    let rawMessages: unknown[] = [];
    try {
      const result = await this.api.runtime.subagent.getSessionMessages({ sessionKey });
      rawMessages = result.messages;
    } catch {
      // No session history yet
    }

    const messages: Message[] = rawMessages
      .filter((m): m is { role: string; content: string; timestamp?: number } =>
        typeof m === 'object' && m !== null && 'role' in m && 'content' in m,
      )
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map((m) => ({
        role: m.role as Message['role'],
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: m.timestamp ?? Date.now(),
        executor: ExecutorType.Default,
      }));

    return this.applyTruncation(messages);
  }

  /**
   * Build a ContextPayload from an in-memory conversation log.
   */
  buildFromLog(log: Message[]): ContextPayload {
    return this.applyTruncation(log);
  }

  /**
   * Serialize a ContextPayload to a string suitable for injection as a system prompt.
   */
  serialize(payload: ContextPayload): string {
    const header = payload.truncated
      ? `[Previous conversation — ${payload.truncatedCount} early messages omitted, showing last ${payload.messages.length}]\n\n`
      : '[Previous conversation]\n\n';

    const body = payload.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    return header + body;
  }

  private applyTruncation(messages: Message[]): ContextPayload {
    const max = this.config.maxContextMessages;
    const totalCount = messages.length;

    if (totalCount <= max) {
      return { messages, truncated: false, totalCount };
    }

    const truncatedCount = totalCount - max;
    return {
      messages: messages.slice(truncatedCount),
      truncated: true,
      truncatedCount,
      totalCount,
    };
  }
}
