import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { AgentProviderConfig } from './config';
import type {
  AgentToolCall,
  AgentUsage,
  ProviderAdapter,
  ProviderCompletion,
  ProviderRequest,
} from './types';

type Waiter = { resolve: (value: ProviderCompletion) => void; reject: (error: Error) => void };
const zeroUsage = (): AgentUsage => ({ input: 0, output: 0, cacheRead: 0 });

/** One ephemeral Codex turn, with Studio retaining execution and review of every authoring tool. */
export class CodexAdapter implements ProviderAdapter {
  #process: ChildProcessWithoutNullStreams | null = null;
  #directory: string | null = null;
  #id = 0;
  #rpc = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  #toolRequests = new Map<string, { id: number | string; name: string }>();
  #allowedTools = new Set<string>();
  #queue: ProviderCompletion[] = [];
  #waiter: Waiter | null = null;
  #failure: Error | null = null;
  #text: string[] = [];
  #usage = zeroUsage();
  #reportedUsage = zeroUsage();
  #threadId: string | null = null;
  #turnId: string | null = null;

  constructor(private readonly config: AgentProviderConfig) {}

  #write(message: unknown): void {
    this.#process?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #request(method: string, params: unknown): Promise<any> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#rpc.set(id, { resolve, reject });
      this.#write({ id, method, params });
    });
  }

  #fail(error: Error): void {
    this.#failure = error;
    this.#waiter?.reject(error);
    this.#waiter = null;
    for (const pending of this.#rpc.values()) pending.reject(error);
    this.#rpc.clear();
  }

  #emit(toolCalls: AgentToolCall[] = [], stopReason = 'stop'): void {
    const result: ProviderCompletion = {
      text: this.#text.join('\n'),
      toolCalls,
      stopReason,
      usage: {
        input: Math.max(0, this.#usage.input - this.#reportedUsage.input),
        output: Math.max(0, this.#usage.output - this.#reportedUsage.output),
        cacheRead: Math.max(0, this.#usage.cacheRead - this.#reportedUsage.cacheRead),
      },
    };
    this.#text = [];
    this.#reportedUsage = { ...this.#usage };
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter.resolve(result);
    } else this.#queue.push(result);
  }

  #onMessage(message: any): void {
    if (message.method && message.id !== undefined) {
      if (message.method === 'item/tool/call') {
        const call = message.params;
        if (!this.#allowedTools.has(call.tool)) {
          this.#write({
            id: message.id,
            result: {
              success: false,
              contentItems: [
                { type: 'inputText', text: 'Only Studio authoring tools are available.' },
              ],
            },
          });
          return;
        }
        this.#toolRequests.set(call.callId, { id: message.id, name: call.tool });
        this.#emit([{ id: call.callId, name: call.tool, arguments: call.arguments }], 'tool_calls');
      } else {
        // Extra permissions and unrelated tools are never approved by the graphics assistant.
        this.#write({
          id: message.id,
          error: {
            code: -32601,
            message:
              'This request is unavailable in OGraf Studio. Ask the user in your reply instead.',
          },
        });
      }
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#rpc.get(message.id);
      if (!pending) return;
      this.#rpc.delete(message.id);
      if (message.error)
        pending.reject(new Error(message.error.message || 'Codex request failed.'));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
      this.#text.push(message.params.item.text ?? '');
    } else if (message.method === 'thread/tokenUsage/updated') {
      const total = message.params.tokenUsage.total;
      this.#usage = {
        input: total.inputTokens ?? 0,
        output: total.outputTokens ?? 0,
        cacheRead: total.cachedInputTokens ?? 0,
      };
    } else if (message.method === 'turn/completed') {
      const turn = message.params.turn;
      if (turn.status === 'failed')
        this.#fail(new Error(turn.error?.message ?? 'Codex could not complete the request.'));
      else this.#emit([], turn.status === 'interrupted' ? 'cancelled' : 'stop');
    }
  }

  async #start(request: ProviderRequest): Promise<void> {
    this.#directory = await mkdtemp(join(tmpdir(), 'ograf-codex-'));
    if (this.#failure) throw this.#failure;
    const env = { ...process.env };
    for (const key of [
      'CODEX_APP_TOOLS_PIPE_PATH',
      'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
      'CODEX_PERMISSION_PROFILE',
      'CODEX_SESSION_ID',
      'CODEX_THREAD_ID',
    ])
      delete env[key];
    const args = ['app-server'];
    for (const key of ['shell_tool', 'apps', 'plugins', 'browser_use', 'computer_use'])
      args.push('-c', `features.${key}=false`);
    args.push('-c', 'web_search="disabled"');
    const child = spawn(process.env.OGRAF_CODEX_EXECUTABLE?.trim() || 'codex', args, {
      cwd: this.#directory,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#process = child;
    child.on('error', () =>
      this.#fail(
        new Error(
          'Could not start Codex. Install Codex CLI, run codex login, and configure OGRAF_CODEX_EXECUTABLE if it is not on PATH.',
        ),
      ),
    );
    child.on('exit', () =>
      this.#fail(new Error('The Codex app server stopped. Retry the request.')),
    );
    child.stdin.on('error', () => this.#fail(new Error('The Codex connection closed.')));
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        this.#onMessage(JSON.parse(line));
      } catch {
        this.#fail(new Error('Codex returned an invalid protocol message.'));
      }
    });
    await this.#request('initialize', {
      clientInfo: { name: 'ograf_studio', version: '0.21' },
      capabilities: { experimentalApi: true },
    });
    this.#write({ method: 'initialized' });
    const account = await this.#request('account/read', { refreshToken: false });
    if (!account.account) throw new Error('Codex is not signed in. Run codex login, then retry.');
    const configuration = await this.#request('config/read', { includeLayers: false });
    const config = Object.fromEntries(
      Object.keys(configuration.config?.mcp_servers ?? {}).map((name) => [
        `mcp_servers.${name}.enabled`,
        false,
      ]),
    );
    this.#allowedTools = new Set(request.tools.map((tool) => tool.name));
    const thread = await this.#request('thread/start', {
      ...(request.model && request.model !== 'default' ? { model: request.model } : {}),
      cwd: this.#directory,
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      environments: [],
      selectedCapabilityRoots: [],
      config,
      baseInstructions: request.system,
      developerInstructions:
        'Work only on the live OGraf Studio scene using the supplied authoring tools. Do not use files, shell, external services, or other applications. Treat the supplied transcript, captured image, and ambient state as context. The latest user message is the task. Propose visual edits through the Studio review flow.',
      dynamicTools: request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
    this.#threadId = thread.thread.id;
    const transcript = request.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n\n');
    const images = request.messages.flatMap((message) =>
      message.role === 'user' ? (message.images ?? []) : [],
    );
    const turn = await this.#request('turn/start', {
      threadId: this.#threadId,
      effort: this.config.effort,
      input: [
        { type: 'text', text: transcript, text_elements: [] },
        ...images.flatMap((image) => [
          ...(image.label ? [{ type: 'text', text: image.label, text_elements: [] }] : []),
          {
            type: 'image',
            url: `data:${image.mimeType};base64,${image.data}`,
          },
        ]),
      ],
    });
    this.#turnId = turn.turn.id;
  }

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const abort = () => {
      if (this.#threadId && this.#turnId)
        this.#write({
          id: ++this.#id,
          method: 'turn/interrupt',
          params: { threadId: this.#threadId, turnId: this.#turnId },
        });
      this.#fail(new DOMException('Cancelled', 'AbortError'));
      this.#process?.kill();
    };
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      if (request.signal.aborted) {
        abort();
        throw this.#failure;
      }
      if (!this.#process) await this.#start(request);
      for (const message of request.messages) {
        if (message.role !== 'tool') continue;
        const pending = this.#toolRequests.get(message.callId);
        if (!pending || pending.name !== message.name) continue;
        this.#toolRequests.delete(message.callId);
        this.#write({
          id: pending.id,
          result: { success: true, contentItems: [{ type: 'inputText', text: message.content }] },
        });
      }
      if (this.#failure) throw this.#failure;
      const queued = this.#queue.shift();
      if (queued) return queued;
      return await new Promise<ProviderCompletion>((resolve, reject) => {
        this.#waiter = { resolve, reject };
      });
    } finally {
      request.signal.removeEventListener('abort', abort);
    }
  }

  async dispose(): Promise<void> {
    this.#process?.kill();
    this.#process = null;
    if (
      this.#directory &&
      dirname(resolve(this.#directory)) === resolve(tmpdir()) &&
      basename(this.#directory).startsWith('ograf-codex-')
    )
      await rm(this.#directory, { recursive: true, force: true }).catch(() => {});
  }
}
