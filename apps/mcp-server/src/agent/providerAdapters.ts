import type { AgentProviderConfig } from './config';
import type {
  AgentMessage,
  AgentToolCall,
  ProviderAdapter,
  ProviderCompletion,
  ProviderRequest,
} from './types';

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function readError(response: Response): Promise<never> {
  const body = (await response.text()).slice(0, 1_000);
  throw new Error(`Provider request failed (${response.status}): ${body || response.statusText}`);
}

function providerEndpoint(
  baseUrl: string,
  suffix: '/v1/messages' | '/v1/chat/completions',
): string {
  const url = new URL(baseUrl);
  if (url.search || url.pathname.endsWith(suffix) || url.pathname.includes('/chat/completions')) {
    return url.toString();
  }
  const normalizedPath = url.pathname.replace(/\/$/, '');
  url.pathname = normalizedPath.endsWith('/v1')
    ? `${normalizedPath}${suffix.slice(3)}`
    : `${normalizedPath}${suffix}`;
  return url.toString();
}

function openAiMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.callId, content: message.content };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      };
    }
    return message;
  });
}

class OpenAiCompatibleAdapter implements ProviderAdapter {
  constructor(private readonly config: AgentProviderConfig) {}

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.apiKey}`,
    };
    if (this.config.organization) headers['openai-organization'] = this.config.organization;
    if (this.config.project) headers['openai-project'] = this.config.project;
    const response = await fetch(providerEndpoint(this.config.baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers,
      signal: request.signal,
      body: JSON.stringify({
        model: request.model ?? this.config.model,
        messages: [
          { role: 'system', content: request.system },
          ...openAiMessages(request.messages),
        ],
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: 'auto',
      }),
    });
    if (!response.ok) return readError(response);
    const data = (await response.json()) as Record<string, any>;
    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const toolCalls: AgentToolCall[] = (message.tool_calls ?? []).map((call: any) => ({
      id: String(call.id),
      name: String(call.function?.name ?? ''),
      arguments: safeJsonObject(String(call.function?.arguments ?? '{}')),
    }));
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      stopReason: String(choice.finish_reason ?? 'stop'),
      usage: {
        input: Number(data.usage?.prompt_tokens ?? 0),
        output: Number(data.usage?.completion_tokens ?? 0),
        cacheRead: Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      },
    };
  }
}

function anthropicMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'system') {
      return { role: 'user', content: `[Ambient editor context]\n${message.content}` };
    }
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.callId, content: message.content }],
      };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        ],
      };
    }
    return message;
  });
}

class AnthropicAdapter implements ProviderAdapter {
  constructor(private readonly config: AgentProviderConfig) {}

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const response = await fetch(providerEndpoint(this.config.baseUrl, '/v1/messages'), {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model ?? this.config.model,
        max_tokens: 4_096,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: anthropicMessages(request.messages),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      }),
    });
    if (!response.ok) return readError(response);
    const data = (await response.json()) as Record<string, any>;
    const content = Array.isArray(data.content) ? data.content : [];
    return {
      text: content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => String(block.text ?? ''))
        .join('\n'),
      toolCalls: content
        .filter((block: any) => block.type === 'tool_use')
        .map((block: any) => ({
          id: String(block.id),
          name: String(block.name),
          arguments:
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : {},
        })),
      stopReason: String(data.stop_reason ?? 'end_turn'),
      usage: {
        input: Number(data.usage?.input_tokens ?? 0),
        output: Number(data.usage?.output_tokens ?? 0),
        cacheRead: Number(data.usage?.cache_read_input_tokens ?? 0),
      },
    };
  }
}

export function createProviderAdapter(config: AgentProviderConfig): ProviderAdapter {
  return config.provider === 'anthropic'
    ? new AnthropicAdapter(config)
    : new OpenAiCompatibleAdapter(config);
}

export function supportsAmbientSystemMessage(model: string): boolean {
  return /(?:opus[- ]?(?:5|4\.8)|fable[- ]?5|mythos[- ]?5)/i.test(model);
}
