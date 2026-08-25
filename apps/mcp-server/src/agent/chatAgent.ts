import * as z from 'zod/v4';
import {
  IN_APP_SYSTEM_PROMPT,
  filterInAppToolRecords,
  providerToolDefinitions,
  withInAppToolDefaults,
  type AgentToolRecord,
} from '@ograf-editor/agent-tools';
import { loadAgentProviderConfig, redactProviderError } from './config';
import { createProviderAdapter, supportsAmbientSystemMessage } from './providerAdapters';
import type { AgentMessage, AgentUsage, ChatAmbientContext, ChatServerEvent } from './types';

export interface ChatSendMessage {
  type: 'chat.send';
  turnId: string;
  sessionId: string;
  text: string;
  ambient?: ChatAmbientContext;
}

export type ChatClientMessage =
  | ChatSendMessage
  | { type: 'chat.cancel'; turnId: string }
  | { type: 'chat.exclusive'; enabled: boolean }
  | { type: 'chat.status.request' };

function ambientText(ambient?: ChatAmbientContext): string {
  if (!ambient) return '';
  return JSON.stringify(ambient);
}

export function buildTurnMessages(
  model: string,
  text: string,
  ambient?: ChatAmbientContext,
): AgentMessage[] {
  const context = ambientText(ambient);
  if (!context) return [{ role: 'user', content: text }];
  if (supportsAmbientSystemMessage(model)) {
    return [
      { role: 'system', content: `Current OGraf Studio state: ${context}` },
      { role: 'user', content: text },
    ];
  }
  return [{ role: 'user', content: `[Current OGraf Studio state: ${context}]\n\n${text}` }];
}

function toolResultContent(result: unknown): string {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (record.structuredContent !== undefined) return JSON.stringify(record.structuredContent);
  }
  return JSON.stringify(result ?? null);
}

function proposalId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const root = result as Record<string, unknown>;
  const structured = root.structuredContent;
  if (structured && typeof structured === 'object') {
    const id = (structured as Record<string, unknown>).proposalId;
    if (typeof id === 'string') return id;
    const proposal = (structured as Record<string, unknown>).proposal;
    if (proposal && typeof proposal === 'object') {
      const nested = (proposal as Record<string, unknown>).id;
      if (typeof nested === 'string') return nested;
    }
  }
  return null;
}

function toolSummary(name: string): string {
  return name
    .replace(/^ograf_/, '')
    .replaceAll('_', ' ')
    .replace(/^./, (value) => value.toUpperCase());
}

function isTrivialAuthoringRequest(text: string): boolean {
  return /^(?:please\s+)?(?:rename|set|change|move|resize|hide|show|lock|unlock|add (?:a )?key)\b/i.test(
    text.trim(),
  );
}

export class ChatAgentController {
  readonly #tools: AgentToolRecord[];
  readonly #histories = new Map<string, AgentMessage[]>();
  readonly #turns = new Map<string, AbortController>();
  readonly #config = loadAgentProviderConfig();
  #exclusive = false;
  #externalRequests = 0;

  constructor(
    records: AgentToolRecord[],
    private readonly emit: (event: ChatServerEvent) => void,
  ) {
    this.#tools = filterInAppToolRecords(records);
  }

  async status(): Promise<void> {
    const config = await this.#config;
    this.emit(
      config
        ? {
            type: 'chat.config',
            configured: true,
            exclusive: this.#exclusive,
            provider: config.provider,
            model: config.model,
          }
        : {
            type: 'chat.config',
            configured: false,
            exclusive: this.#exclusive,
            message:
              'Configure OGRAF_AGENT_PROVIDER, OGRAF_AGENT_BASE_URL, OGRAF_AGENT_MODEL and an OS-keychain credential or OGRAF_AGENT_API_KEY, then restart the server.',
          },
    );
  }

  handle(message: ChatClientMessage): void {
    if (message.type === 'chat.status.request') {
      void this.status();
      return;
    }
    if (message.type === 'chat.cancel') {
      this.#turns.get(message.turnId)?.abort();
      return;
    }
    if (message.type === 'chat.exclusive') {
      this.#exclusive = message.enabled;
      void this.status();
      return;
    }
    void this.#run(message);
  }

  get busy(): boolean {
    return this.#turns.size > 0;
  }

  beginExternalRequest(): (() => void) | null {
    if (this.#exclusive && this.busy) return null;
    this.#externalRequests += 1;
    this.emit({ type: 'chat.external', active: true });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#externalRequests = Math.max(0, this.#externalRequests - 1);
      if (this.#externalRequests === 0) this.emit({ type: 'chat.external', active: false });
    };
  }

  async #run(message: ChatSendMessage): Promise<void> {
    if (!message.turnId || !message.text.trim() || this.#turns.has(message.turnId)) return;
    if (this.#exclusive && this.#externalRequests > 0) {
      this.emit({
        type: 'chat.error',
        turnId: message.turnId,
        message:
          'An external MCP agent is active. Retry when it finishes or disable exclusive mode.',
      });
      return;
    }
    const config = await this.#config;
    if (!config) {
      this.emit({
        type: 'chat.error',
        turnId: message.turnId,
        message: 'The in-app agent is not configured on this local server.',
      });
      await this.status();
      return;
    }
    const controller = new AbortController();
    this.#turns.set(message.turnId, controller);
    this.emit({ type: 'chat.turn.start', turnId: message.turnId });
    const history = this.#histories.get(message.sessionId) ?? [];
    const selectedModel =
      config.cheapModel && isTrivialAuthoringRequest(message.text)
        ? config.cheapModel
        : config.model;
    history.push(...buildTurnMessages(selectedModel, message.text.trim(), message.ambient));
    const usage: AgentUsage = { input: 0, output: 0, cacheRead: 0 };
    let stopReason = 'stop';
    try {
      const adapter = createProviderAdapter(config);
      for (let round = 0; round < 12; round += 1) {
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const completion = await adapter.complete({
          system: IN_APP_SYSTEM_PROMPT,
          model: selectedModel,
          messages: history,
          tools: providerToolDefinitions(this.#tools),
          signal: controller.signal,
        });
        usage.input += completion.usage.input;
        usage.output += completion.usage.output;
        usage.cacheRead += completion.usage.cacheRead;
        stopReason = completion.stopReason;
        history.push({
          role: 'assistant',
          content: completion.text,
          ...(completion.toolCalls.length ? { toolCalls: completion.toolCalls } : {}),
        });
        if (completion.text) {
          this.emit({ type: 'chat.text', turnId: message.turnId, text: completion.text });
        }
        if (completion.toolCalls.length === 0) break;
        for (const call of completion.toolCalls) {
          if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const tool = this.#tools.find((candidate) => candidate.name === call.name);
          if (!tool) throw new Error(`The model requested unavailable tool ${call.name}.`);
          const summary = toolSummary(tool.name);
          this.emit({
            type: 'chat.tool',
            turnId: message.turnId,
            callId: call.id,
            name: tool.name,
            summary,
            status: 'running',
          });
          try {
            const input = z
              .object(tool.config.inputSchema)
              .parse(withInAppToolDefaults(tool.name, call.arguments));
            const result = await tool.handler(input);
            history.push({
              role: 'tool',
              callId: call.id,
              name: tool.name,
              content: toolResultContent(result),
            });
            this.emit({
              type: 'chat.tool',
              turnId: message.turnId,
              callId: call.id,
              name: tool.name,
              summary,
              status: 'ok',
            });
            const proposal = proposalId(result);
            if (proposal) {
              this.emit({ type: 'chat.proposal', turnId: message.turnId, proposalId: proposal });
            }
          } catch (error) {
            const detail = redactProviderError(error, [config.apiKey]);
            history.push({
              role: 'tool',
              callId: call.id,
              name: tool.name,
              content: JSON.stringify({ error: detail }),
            });
            this.emit({
              type: 'chat.tool',
              turnId: message.turnId,
              callId: call.id,
              name: tool.name,
              summary,
              status: 'error',
            });
          }
        }
      }
      this.#histories.set(message.sessionId, history.slice(-80));
      this.emit({ type: 'chat.turn.end', turnId: message.turnId, stopReason, usage });
    } catch (error) {
      const cancelled =
        controller.signal.aborted || (error as { name?: string }).name === 'AbortError';
      if (cancelled) {
        this.emit({
          type: 'chat.turn.end',
          turnId: message.turnId,
          stopReason: 'cancelled',
          usage,
        });
      } else {
        this.emit({
          type: 'chat.error',
          turnId: message.turnId,
          message: redactProviderError(error, [config.apiKey]),
        });
      }
    } finally {
      this.#turns.delete(message.turnId);
    }
  }
}
