import type { ProviderToolDefinition } from '@ograf-editor/agent-tools';

export interface ChatAmbientContext {
  selection?: { layerIds: string[]; primaryLayerId?: string | null };
  frame?: number;
  viewport?: { width: number; height: number; zoom?: number };
  recentEdits?: string[];
}

export type AgentMessage =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] }
  | { role: 'tool'; callId: string; name: string; content: string };

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
}

export interface ProviderCompletion {
  text: string;
  toolCalls: AgentToolCall[];
  stopReason: string;
  usage: AgentUsage;
}

export interface ProviderRequest {
  system: string;
  model?: string;
  messages: AgentMessage[];
  tools: ProviderToolDefinition[];
  signal: AbortSignal;
}

export interface ProviderAdapter {
  complete(request: ProviderRequest): Promise<ProviderCompletion>;
}

export type ChatServerEvent =
  | {
      type: 'chat.config';
      configured: boolean;
      exclusive: boolean;
      provider?: string;
      model?: string;
      message?: string;
    }
  | { type: 'chat.external'; active: boolean }
  | { type: 'chat.turn.start'; turnId: string }
  | { type: 'chat.text'; turnId: string; text: string }
  | {
      type: 'chat.tool';
      turnId: string;
      callId: string;
      name: string;
      summary: string;
      status: 'running' | 'ok' | 'error';
    }
  | { type: 'chat.proposal'; turnId: string; proposalId: string }
  | { type: 'chat.turn.end'; turnId: string; stopReason: string; usage: AgentUsage }
  | { type: 'chat.error'; turnId: string; message: string };
