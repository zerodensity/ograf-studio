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
import type {
  AgentMessage,
  AgentUsage,
  ChatAmbientContext,
  ChatServerEvent,
  ProviderAdapter,
  ProviderCompletion,
  ProviderRequest,
} from './types';

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

const MAX_TOOL_RESULT_CHARS = 16_000;
const MAX_HISTORY_CHARS = 96_000;

export function toolResultContent(result: unknown): string {
  let content: string;
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (record.structuredContent !== undefined) content = JSON.stringify(record.structuredContent);
    else content = JSON.stringify(result);
  } else {
    content = JSON.stringify(result ?? null);
  }
  return content.length <= MAX_TOOL_RESULT_CHARS
    ? content
    : `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n[Tool result truncated for chat context safety]`;
}

function messageChars(message: AgentMessage): number {
  return JSON.stringify(message).length;
}

function atomicHistoryUnits(messages: AgentMessage[]): AgentMessage[][] {
  const units: AgentMessage[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const unit = [message];
    if (message.role === 'assistant' && message.toolCalls?.length) {
      while (messages[index + 1]?.role === 'tool') unit.push(messages[++index]!);
    }
    units.push(unit);
  }
  return units;
}

function historyTurns(messages: AgentMessage[]): AgentMessage[][][] {
  const turns: AgentMessage[][][] = [];
  let current: AgentMessage[][] = [];
  for (const unit of atomicHistoryUnits(messages)) {
    const role = unit[0]!.role;
    if (
      (role === 'system' || role === 'user') &&
      current.some((entry) => entry[0]!.role === 'user')
    ) {
      turns.push(current);
      current = [];
    }
    current.push(unit);
  }
  if (current.length) turns.push(current);
  return turns;
}

function unitChars(unit: AgentMessage[]): number {
  return unit.reduce((total, message) => total + messageChars(message), 0);
}

function trimLatestTurn(units: AgentMessage[][], budget: number): AgentMessage[][] {
  const required = new Set<number>();
  const userIndex = units.findIndex((unit) => unit[0]!.role === 'user');
  if (userIndex >= 0) {
    required.add(userIndex);
    if (userIndex > 0 && units[userIndex - 1]![0]!.role === 'system') required.add(userIndex - 1);
  }
  const selected = new Set(required);
  let used = [...required].reduce((total, index) => total + unitChars(units[index]!), 0);
  for (let index = units.length - 1; index >= 0; index -= 1) {
    if (selected.has(index)) continue;
    const size = unitChars(units[index]!);
    if (used + size > budget) continue;
    selected.add(index);
    used += size;
  }
  return units.filter((_unit, index) => selected.has(index));
}

export function compactChatHistory(
  messages: AgentMessage[],
  budget = MAX_HISTORY_CHARS,
): AgentMessage[] {
  const turns = historyTurns(messages);
  if (!turns.length) return [];
  const latest = trimLatestTurn(turns.at(-1)!, budget);
  const selected: AgentMessage[][][] = [latest];
  let used = latest.reduce((total, unit) => total + unitChars(unit), 0);
  for (let index = turns.length - 2; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const size = turn.reduce((total, unit) => total + unitChars(unit), 0);
    if (used + size > budget) continue;
    selected.unshift(turn);
    used += size;
  }
  return selected.flat(2);
}

function isPromptTooLongError(error: unknown): boolean {
  return /prompt is too long|maximum context|context length/i.test(
    error instanceof Error ? error.message : String(error),
  );
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

const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;

function providerTimeoutMs(): number {
  const configured = Number(process.env.OGRAF_AGENT_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.max(100, Math.min(600_000, Math.round(configured)))
    : DEFAULT_PROVIDER_TIMEOUT_MS;
}

async function completeWithTimeout(
  adapter: ProviderAdapter,
  request: ProviderRequest,
  timeoutMs: number,
): Promise<ProviderCompletion> {
  const requestController = new AbortController();
  let timedOut = false;
  const relayAbort = () => requestController.abort();
  if (request.signal.aborted) relayAbort();
  else request.signal.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);
  try {
    return await adapter.complete({ ...request, signal: requestController.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `The model provider did not respond within ${Math.round(timeoutMs / 1_000)} seconds. Check provider status/network access, then retry.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', relayAbort);
  }
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
    const turnMessages = buildTurnMessages(selectedModel, message.text.trim(), message.ambient);
    history.push(...turnMessages);
    const usage: AgentUsage = { input: 0, output: 0, cacheRead: 0 };
    const requestTimeoutMs = providerTimeoutMs();
    let stopReason = 'stop';
    try {
      const adapter = createProviderAdapter(config);
      for (let round = 0; round < 12; round += 1) {
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        this.emit({
          type: 'chat.progress',
          turnId: message.turnId,
          phase: round === 0 ? 'waiting' : 'continuing',
          message:
            round === 0
              ? `Waiting for ${config.provider} · ${selectedModel}`
              : `Waiting for ${selectedModel} to review tool results`,
          round: round + 1,
        });
        const complete = () =>
          completeWithTimeout(
            adapter,
            {
              system: IN_APP_SYSTEM_PROMPT,
              model: selectedModel,
              messages: compactChatHistory(history),
              tools: providerToolDefinitions(this.#tools),
              signal: controller.signal,
            },
            requestTimeoutMs,
          );
        let completion: ProviderCompletion;
        try {
          completion = await complete();
        } catch (error) {
          if (
            round !== 0 ||
            !isPromptTooLongError(error) ||
            history.length <= turnMessages.length
          ) {
            throw error;
          }
          history.splice(0, history.length, ...turnMessages);
          this.emit({
            type: 'chat.progress',
            turnId: message.turnId,
            phase: 'waiting',
            message: 'Conversation context was full; retrying with a fresh project conversation',
            round: 1,
          });
          completion = await complete();
        }
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
      this.#histories.delete(message.sessionId);
      this.#histories.set(message.sessionId, compactChatHistory(history));
      while (this.#histories.size > 20) {
        const oldest = this.#histories.keys().next().value;
        if (oldest === undefined) break;
        this.#histories.delete(oldest);
      }
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
