import type { LogicFunctionContext, LogicFunctionResult } from '@ograf-editor/scene-model';

const CHANNEL = 'ograf-logic-function-v1';
const STARTUP_MS = 2000;
const RESULT_BYTES = 512 * 1024;
const STATE_BYTES = 256 * 1024;
const DATA_BYTES = 64 * 1024;

interface SandboxOptions {
  source: string;
  name: string;
  timeoutMs?: number;
}
export interface LogicFunctionSandbox {
  ready: Promise<void>;
  invoke(context: LogicFunctionContext): Promise<LogicFunctionResult>;
  dispose(): void;
}

/** This marker is assigned only to authenticated supervisor watchdog/elapsed-budget failures. */
export function isLogicFunctionExecutionTimeout(
  value: unknown,
): value is Error & { readonly code: 'execution-timeout' } {
  return value instanceof Error && 'code' in value && value.code === 'execution-timeout';
}

/** This self-contained function is serialized into the Worker, never invoked in the page. */
function workerKernel(config: { token: string; source: string; budget: number }) {
  'use strict';
  const scope = globalThis as unknown as {
    postMessage(value: unknown): void;
    onmessage:
      ((event: { data: { id: number; probe?: boolean; context?: string } }) => void) | null;
  };
  const post = scope.postMessage.bind(scope);
  const NativeFunction = Function;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const descriptors = Object.getOwnPropertyDescriptors;
  const prototypeOf = Object.getPrototypeOf;
  const objectPrototype = Object.prototype;
  const ownKeys = Reflect.ownKeys;
  const hasOwn = Object.hasOwn;
  const isArray = Array.isArray;
  const finite = Number.isFinite;
  const number = Number;
  const toString = String;
  const encoder = new TextEncoder();
  const encode = encoder.encode.bind(encoder);
  const now = performance.now.bind(performance);
  const NativeSet = Set;
  const setHas = Function.prototype.call.bind(Set.prototype.has) as (
    set: Set<unknown>,
    value: unknown,
  ) => boolean;
  const setAdd = Function.prototype.call.bind(Set.prototype.add) as (
    set: Set<unknown>,
    value: unknown,
  ) => void;
  const setDelete = Function.prototype.call.bind(Set.prototype.delete) as (
    set: Set<unknown>,
    value: unknown,
  ) => void;
  const join = Function.prototype.call.bind(Array.prototype.join) as (
    values: string[],
    separator: string,
  ) => string;
  const sliceString = Function.prototype.call.bind(String.prototype.slice) as (
    value: string,
    start: number,
    end: number,
  ) => string;
  const ErrorType = Error;

  // User code cannot bypass the private packet channel or launch persistent nested workers.
  // The captured native postMessage remains reachable only inside this strict kernel closure.
  for (const key of ['postMessage', 'Worker', 'SharedWorker', 'BroadcastChannel']) {
    let owner: object | null = globalThis;
    while (owner) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor?.configurable)
        Object.defineProperty(owner, key, {
          value: undefined,
          writable: false,
          configurable: false,
        });
      owner = Object.getPrototypeOf(owner);
    }
  }
  // The immutable script URL is owned by the iframe and shared only as code bytes. A consumed
  // Worker must not revoke it or create externally retained Blob URLs as hidden cross-call state.
  const workerUrl = globalThis.URL;
  if (typeof workerUrl === 'function') {
    for (const key of ['createObjectURL', 'revokeObjectURL']) {
      const descriptor = Object.getOwnPropertyDescriptor(workerUrl, key);
      if (descriptor?.configurable || descriptor?.writable)
        Object.defineProperty(workerUrl, key, {
          value: undefined,
          writable: false,
          configurable: false,
        });
    }
  }

  let requestId = 0;
  const packet = (kind: string, extra: Record<string, unknown> = {}) =>
    post({
      channel: 'ograf-logic-function-v1',
      token: config.token,
      id: requestId,
      kind,
      ...extra,
    });
  const failureMessage = (error: unknown) => {
    if (typeof error === 'string') return sliceString(error, 0, 1000);
    if (error && typeof error === 'object') {
      try {
        const description = descriptors(error).message;
        if (description && hasOwn(description, 'value') && typeof description.value === 'string')
          return sliceString(description.value, 0, 1000);
      } catch {
        /* A thrown Proxy is not allowed to execute an error formatter. */
      }
    }
    return 'Function execution failed.';
  };
  const json = (value: unknown, byteLimit: number): string => {
    const visiting = new NativeSet<unknown>();
    let nodes = 0;
    const encodeValue = (entry: unknown, depth: number): string => {
      if (++nodes > 32768 || depth > 32)
        throw new ErrorType('Function result is too deeply nested or contains too many values.');
      if (entry === null) return 'null';
      if (typeof entry === 'string' || typeof entry === 'boolean') return stringify(entry);
      if (typeof entry === 'number' && finite(entry)) return stringify(entry);
      if (!entry || typeof entry !== 'object' || setHas(visiting, entry))
        throw new ErrorType('Function results must be finite JSON without cycles.');
      const array = isArray(entry);
      const prototype = prototypeOf(entry);
      if (!array && prototype !== null && prototype !== objectPrototype)
        throw new ErrorType(
          'Function results must be plain JSON; async/Promise results are not supported.',
        );
      setAdd(visiting, entry);
      const properties = descriptors(entry);
      const keys = ownKeys(properties);
      const pieces: string[] = [];
      if (array) {
        const length = properties.length?.value;
        if (!finite(length) || length > 32768)
          throw new ErrorType('Function result array is too large.');
        for (let index = 0; index < length; index++) {
          const property = properties[toString(index)];
          if (!property || !hasOwn(property, 'value'))
            throw new ErrorType('Function results cannot contain holes or accessors.');
          pieces[index] = encodeValue(property.value, depth + 1);
        }
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index];
          if (
            key !== 'length' &&
            (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || number(key) >= length)
          )
            throw new ErrorType('Function result arrays cannot contain extra properties.');
        }
      } else {
        let count = 0;
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index];
          if (
            typeof key !== 'string' ||
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
          )
            throw new ErrorType('Function result contains a reserved property.');
          const property = properties[key]!;
          if (!hasOwn(property, 'value'))
            throw new ErrorType('Function results cannot contain accessors.');
          if (!property.enumerable) continue;
          const child = encodeValue(property.value, depth + 1);
          // The first walk already validates each subtree. Check its exact serialized bytes
          // here instead of parsing the result and traversing state/data a second time.
          const fieldLimit =
            depth === 0 ? (key === 'state' ? 256 * 1024 : key === 'data' ? 64 * 1024 : null) : null;
          if (fieldLimit !== null && encode(child).byteLength > fieldLimit)
            throw new ErrorType('Function result exceeds the JSON size limit.');
          pieces[count++] = `${stringify(key)}:${child}`;
        }
      }
      setDelete(visiting, entry);
      return array ? `[${join(pieces, ',')}]` : `{${join(pieces, ',')}}`;
    };
    const text = encodeValue(value, 0);
    if (encode(text).byteLength > byteLimit)
      throw new ErrorType('Function result exceeds the JSON size limit.');
    return text;
  };

  // Compile the wrapper before use, but do not evaluate the user's expression or invoke it.
  // This idle worker has fresh globals and no context/state. Native parsing has the separate
  // startup watchdog: performance.now measures wall time, including background descheduling,
  // so unused preparation must not consume the later user-code execution deadline.
  const compileStart = now();
  let factory: (() => unknown) | undefined;
  let compileError: unknown;
  try {
    factory = NativeFunction(`"use strict"; return (\n${config.source}\n);`) as () => unknown;
  } catch (error) {
    compileError = error;
  }
  const compileMs = now() - compileStart;
  let used = false;
  scope.onmessage = (event) => {
    if (used) {
      packet('error', { message: 'A worker can execute only one invocation.', elapsedMs: 0 });
      return;
    }
    used = true;
    // Read host-owned message bytes before compiling any user code.
    requestId = event.data.id;
    const probe = event.data.probe === true;
    const budget = probe ? 2000 : config.budget;
    const contextText = event.data.context;
    const started = now();
    packet('started');
    try {
      if (compileError !== undefined) throw compileError;
      const compiled = factory!();
      if (typeof compiled !== 'function')
        throw new ErrorType('Source must evaluate to a synchronous function.');
      if (probe) {
        if (now() - started > budget)
          throw new ErrorType('Function compilation exceeded its deadline.');
        packet('ready', { elapsedMs: now() - started });
        return;
      }
      if (typeof contextText !== 'string') throw new ErrorType('Missing function context.');
      const result: unknown = compiled(parse(contextText));
      if (!result || typeof result !== 'object' || isArray(result))
        throw new ErrorType('A function must return a result object.');
      const text = json(result, 512 * 1024);
      const elapsedMs = now() - started;
      if (elapsedMs > budget) throw new ErrorType('Function execution exceeded its deadline.');
      packet('result', { json: text, elapsedMs });
    } catch (error) {
      packet('error', { message: failureMessage(error), elapsedMs: now() - started });
    }
  };
  packet('prepared', { compileMs });
}

/** Trusted opaque-origin supervisor; it alone owns and terminates user Workers. */
function supervisorKernel(config: {
  token: string;
  source: string;
  timeoutMs: number;
  kernel: string;
}) {
  'use strict';
  const channel = 'ograf-logic-function-v1';
  const scope = globalThis as unknown as {
    postMessage(value: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
    close(): void;
  };
  const fallbackPost = scope.postMessage.bind(scope);
  let host: MessagePort | null = null;
  let completion: { kind: string; id: number; extra: Record<string, unknown> } | null = null;
  const clock = performance.now.bind(performance);
  interface Task {
    id: number;
    probe: boolean;
    context?: string;
    sent: boolean;
    started: boolean;
    startupDeadline: number;
    retries: number;
    eventType?: string;
  }
  interface PreparedWorker {
    worker: Worker;
    timer: ReturnType<typeof setTimeout> | null;
    prepared: boolean;
    stopped: boolean;
    task: Task | null;
    createdAt: number;
  }
  // At most one active invocation and one unused prepared Worker. A Worker is never reused.
  let active: PreparedWorker | null = null;
  let idle: PreparedWorker | null = null;
  let scriptUrl: string | null = null;
  let closed = false;
  const send = (kind: string, id: number, extra: Record<string, unknown> = {}) => {
    const packet = { channel, token: config.token, id, kind, ...extra };
    if (host) host.postMessage(packet);
    else fallbackPost(packet);
  };
  const clearTimer = (state: PreparedWorker) => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  };
  const stop = (state: PreparedWorker | null) => {
    if (!state || state.stopped) return;
    state.stopped = true;
    clearTimer(state);
    state.worker.onmessage = null;
    state.worker.onerror = null;
    state.worker.onmessageerror = null;
    state.worker.terminate();
    if (active === state) active = null;
    if (idle === state) idle = null;
  };
  const clear = () => {
    if (closed) return;
    closed = true;
    stop(active);
    stop(idle);
    if (scriptUrl) URL.revokeObjectURL(scriptUrl);
    scriptUrl = null;
  };
  const fail = (id: number, message: string, code?: 'execution-timeout') => {
    const task = active?.task;
    const extra: Record<string, unknown> = {
      message,
      ...(code
        ? {
            code,
            diagnostics: {
              phase: task?.probe ? 'probe' : 'execution',
              ...(task?.eventType ? { eventType: task.eventType } : {}),
              budgetMs: task?.probe ? 2000 : config.timeoutMs,
            },
          }
        : {}),
    };
    clear();
    completion = { kind: 'error', id, extra };
    send('error', id, extra);
  };
  const shutdown = () => {
    // Native terminate happens before either disposal acknowledgment. Removing the supervisor
    // first could leave a descendant running; user code never receives this private port.
    clear();
    send('disposed', 0);
    fallbackPost({ channel, token: config.token, kind: 'disposed', id: 0 });
    host?.close();
    host = null;
    scope.close();
  };
  const taskBudget = (task: Task) => (task.probe ? 2000 : config.timeoutMs);
  const start = (state: PreparedWorker) => {
    const task = state.task;
    if (!task || task.sent || !state.prepared || state.stopped || closed) return;
    task.sent = true;
    clearTimer(state);
    state.timer = setTimeout(
      () => fail(task.id, 'Function worker did not begin.'),
      Math.max(0, task.startupDeadline - clock()),
    );
    state.worker.postMessage({ id: task.id, probe: task.probe, context: task.context });
  };
  const prepare = () => {
    if (idle || closed) return;
    try {
      if (!scriptUrl) {
        // Immutable script bytes can be cached; each Worker still gets a completely fresh realm.
        // The literal directive survives ESM minification of the serialized function body.
        const source =
          '"use strict";(' +
          config.kernel +
          ')(' +
          JSON.stringify({ token: config.token, source: config.source, budget: config.timeoutMs }) +
          ');';
        scriptUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      }
      const worker = new Worker(scriptUrl);
      const state: PreparedWorker = {
        worker,
        timer: null,
        prepared: false,
        stopped: false,
        task: null,
        createdAt: clock(),
      };
      idle = state;
      state.timer = setTimeout(
        () => expirePreparation(state, 'Function worker did not prepare.'),
        2000,
      );
      worker.onmessage = (event) => {
        if (state.stopped || closed) return;
        const packet = event.data;
        if (!packet || packet.channel !== channel || packet.token !== config.token) {
          fail(active?.task?.id ?? 0, 'Invalid function worker message.');
          return;
        }
        if (packet.kind === 'prepared') {
          if (
            state.prepared ||
            packet.id !== 0 ||
            !Number.isFinite(packet.compileMs) ||
            packet.compileMs < 0
          ) {
            fail(active?.task?.id ?? 0, 'Invalid function worker preparation.');
            return;
          }
          if (packet.compileMs > 2000) {
            expirePreparation(state, 'Function preparation exceeded its startup deadline.');
            return;
          }
          state.prepared = true;
          clearTimer(state);
          start(state);
          return;
        }
        const task = state.task;
        if (
          !task ||
          active !== state ||
          !task.sent ||
          packet.id !== task.id ||
          !['started', 'ready', 'result', 'error'].includes(packet.kind)
        ) {
          fail(active?.task?.id ?? 0, 'Invalid function worker message.');
          return;
        }
        if (packet.kind === 'started') {
          if (task.started) {
            fail(task.id, 'Invalid repeated function start.');
            return;
          }
          task.started = true;
          clearTimer(state);
          const remainingMs = taskBudget(task);
          state.timer = setTimeout(
            () => fail(task.id, 'Function execution timed out.', 'execution-timeout'),
            remainingMs,
          );
          send('started', task.id, { remainingMs });
          return;
        }
        if (!task.started || !Number.isFinite(packet.elapsedMs) || packet.elapsedMs < 0) {
          fail(task.id, 'Invalid function worker response.');
          return;
        }
        if (packet.elapsedMs > taskBudget(task)) {
          fail(task.id, 'Function execution exceeded its deadline.', 'execution-timeout');
          return;
        }
        if (packet.kind === 'error') {
          fail(
            task.id,
            typeof packet.message === 'string' ? packet.message.slice(0, 1000) : 'Function failed.',
          );
          return;
        }
        if (
          (task.probe && packet.kind !== 'ready') ||
          (!task.probe &&
            (packet.kind !== 'result' ||
              typeof packet.json !== 'string' ||
              packet.json.length > 512 * 1024))
        ) {
          fail(task.id, 'Invalid function worker result.');
          return;
        }
        stop(state);
        const extra =
          packet.kind === 'result'
            ? { json: packet.json, elapsedMs: packet.elapsedMs }
            : { elapsedMs: packet.elapsedMs };
        completion = { kind: packet.kind, id: task.id, extra };
        // The child is terminated, including queued Promise jobs/timers, before acceptance.
        send(packet.kind, task.id, extra);
      };
      worker.onerror = (error) => {
        error.preventDefault();
        if (!state.stopped && !closed) {
          if (!state.task) stop(state);
          else fail(state.task.id, error.message || 'Function worker failed.');
        }
      };
      worker.onmessageerror = () => {
        if (!state.stopped && !closed) {
          if (!state.task) stop(state);
          else fail(state.task.id, 'Function worker returned an unreadable message.');
        }
      };
    } catch (error) {
      if (active) {
        stop(idle);
        return;
      }
      fail(
        0,
        error instanceof Error ? error.message : 'Could not prepare the isolated function worker.',
      );
    }
  };
  function expirePreparation(state: PreparedWorker, message: string) {
    if (state.stopped || closed) return;
    const task = state.task;
    stop(state);
    // An unused background spare has never run user code. Do not fault healthy playback,
    // and do not spin a retry loop while the browser is suspended.
    if (!task) return;
    if (task.sent || task.retries >= 1 || clock() >= task.startupDeadline) {
      fail(task.id, message);
      return;
    }
    task.retries++;
    if (idle && !idle.prepared && clock() - idle.createdAt >= 2000) stop(idle);
    prepare();
    const replacement = idle;
    if (!replacement || closed) return;
    idle = null;
    active = replacement;
    replacement.task = task;
    clearTimer(replacement);
    replacement.timer = setTimeout(
      () => fail(task.id, message),
      Math.max(0, task.startupDeadline - clock()),
    );
    start(replacement);
    prepare();
  }
  const receive = (request: Record<string, unknown>) => {
    if (!request || request.channel !== channel) return;
    if (request.kind === 'dispose') {
      shutdown();
      return;
    }
    if (request.kind === 'check') {
      const id = request.id;
      // A delayed parent event loop can observe its timer before an already-queued result.
      // Re-send only a verified completion whose child has already been terminated.
      const activeTask = active?.task;
      if (completion && completion.id === id)
        send(completion.kind, completion.id, completion.extra);
      else if (activeTask && activeTask.id === id)
        fail(
          activeTask.id,
          activeTask.started ? 'Function execution timed out.' : 'Function worker did not start.',
          activeTask.started ? 'execution-timeout' : undefined,
        );
      else fail(typeof id === 'number' ? id : 0, 'Unknown function invocation.');
      return;
    }
    if (closed) return;
    if (
      !Number.isInteger(request.id) ||
      (request.id as number) < 1 ||
      !['probe', 'invoke'].includes(String(request.kind))
    )
      return;
    if (active) {
      fail(active.task!.id, 'A function invocation is already running.');
      return;
    }
    if (idle && !idle.prepared && clock() - idle.createdAt >= 2000) stop(idle);
    prepare();
    const state = idle;
    if (!state || closed) return;
    idle = null;
    active = state;
    state.task = {
      id: request.id as number,
      probe: request.kind === 'probe',
      ...(typeof request.context === 'string' ? { context: request.context } : {}),
      sent: false,
      started: false,
      startupDeadline: clock() + 2000,
      retries: 0,
      ...(typeof request.eventType === 'string' &&
      ['load', 'play', 'out', 'data', 'blur', 'focus', 'tick', 'custom-action'].includes(
        request.eventType,
      )
        ? { eventType: request.eventType }
        : {}),
    };
    start(state);
    // Start the next fresh realm while the current one executes, then leave it untouched until use.
    prepare();
  };
  scope.onmessage = (event) => {
    if (event.data?.channel !== channel) return;
    if (event.data.kind === 'dispose') {
      shutdown();
      return;
    }
    if (event.data.kind !== 'connect' || host || !event.ports?.[0]) return;
    host = event.ports[0];
    host.onmessage = (message) => receive(message.data);
    host.onmessageerror = () => fail(active?.task?.id ?? 0, 'Unreadable parent message.');
    host.start();
    // The parent sends its bounded probe after this transport acknowledgment.
    // Preparing the child here would consume the supervisor connection budget.
    if (!closed) send('supervisor-ready', 0);
  };
}

/** Fixed bootstrap only. All active execution supervision uses a direct private Worker port. */
function frameBootstrap(config: {
  token: string;
  source: string;
  timeoutMs: number;
  kernel: string;
  supervisor: string;
}) {
  'use strict';
  const channel = 'ograf-logic-function-v1';
  const host = parent;
  let worker: Worker | null = null;
  let url: string | null = null;
  let control: MessageChannel | null = null;
  let cleanup: MessageChannel | null = null;
  const send = (kind: string, message?: string, ports: MessagePort[] = []) =>
    host.postMessage(
      {
        channel,
        token: config.token,
        kind,
        id: 0,
        ...(message ? { message } : {}),
      },
      '*',
      ports,
    );
  const release = () => {
    worker?.terminate();
    worker = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    control?.port1.close();
    control?.port2.close();
    if (cleanup) {
      cleanup.port2.onmessage = null;
      cleanup.port2.close();
      cleanup.port1.close();
    }
    control = null;
    cleanup = null;
  };
  const dispose = () => {
    if (!worker) return;
    // The supervisor explicitly terminates its children before the acknowledgment/release.
    worker.postMessage({ channel, kind: 'dispose' });
  };
  addEventListener('pagehide', dispose);
  try {
    const source =
      '"use strict";(' +
      config.supervisor +
      ')(' +
      JSON.stringify({
        token: config.token,
        source: config.source,
        timeoutMs: config.timeoutMs,
        kernel: config.kernel,
      }) +
      ');';
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (event) => {
      const packet = event.data;
      if (packet?.channel !== channel || packet.token !== config.token) {
        send('error', 'Invalid supervisor bootstrap message.');
        dispose();
        return;
      }
      if (packet.kind === 'disposed') {
        release();
        send('disposed');
      } else if (packet.kind === 'error')
        send(
          'error',
          typeof packet.message === 'string' ? packet.message.slice(0, 1000) : 'Supervisor failed.',
        );
    };
    worker.onerror = (event) => {
      event.preventDefault();
      send('error', event.message || 'Supervisor failed.');
      dispose();
    };
    worker.onmessageerror = () => {
      send('error', 'Unreadable supervisor message.');
      dispose();
    };
    // The owner document can be a detached preview even when the runtime code was created
    // in Studio's main window. A caller-originated Window.postMessage would then have the
    // main window as event.source, not this frame's parent. Originate both capabilities
    // here instead; the parent authenticates the frame/token before accepting either port.
    control = new MessageChannel();
    cleanup = new MessageChannel();
    cleanup.port2.onmessage = (event) => {
      if (event.data?.channel === channel && event.data.kind === 'dispose') dispose();
    };
    cleanup.port2.start();
    worker.postMessage({ channel, kind: 'connect' }, [control.port2]);
    send('frame-ready', undefined, [control.port1, cleanup.port1]);
  } catch (error) {
    release();
    send('error', error instanceof Error ? error.message : 'Could not start isolated supervisor.');
  }
}
function jsonBytes(value: unknown, limit: number): string {
  const visiting = new Set<object>();
  let count = 0;
  const check = (entry: unknown, depth: number) => {
    if (++count > 32768 || depth > 32) throw new Error('JSON value is too complex.');
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'string') return;
    if (typeof entry === 'number' && Number.isFinite(entry)) return;
    if (!entry || typeof entry !== 'object' || visiting.has(entry))
      throw new Error('Expected finite JSON without cycles.');
    const array = Array.isArray(entry),
      prototype = Object.getPrototypeOf(entry);
    if (!array && prototype !== null && prototype !== Object.prototype)
      throw new Error('Expected plain JSON.');
    const length = array ? (entry as unknown[]).length : 0;
    if (array) {
      if (length > 32768) throw new Error('JSON array is too large.');
      for (let index = 0; index < length; index++)
        if (!Object.hasOwn(entry, index)) throw new Error('JSON arrays cannot contain holes.');
    }
    visiting.add(entry);
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('Reserved JSON property.');
      const property = Object.getOwnPropertyDescriptor(entry, key)!;
      if (!Object.hasOwn(property, 'value')) throw new Error('JSON accessors are not allowed.');
      if (array && key === 'length') continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))
        throw new Error('JSON arrays cannot contain extra properties.');
      if (property.enumerable) check(property.value, depth + 1);
    }
    visiting.delete(entry);
  };
  check(value, 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > limit)
    throw new Error('JSON value exceeds its size limit.');
  return text;
}

export function createLogicFunctionSandbox(
  ownerDocument: Document,
  options: SandboxOptions,
): LogicFunctionSandbox {
  const candidateOwner = ownerDocument.defaultView;
  const name =
    typeof options.name === 'string' && options.name.trim()
      ? options.name.slice(0, 256)
      : 'Function';
  const timeoutMs = options.timeoutMs ?? 250;
  const error = (message: string) =>
    new Error(message.startsWith(name + ': ') ? message : name + ': ' + message);
  const supervisorError = (packet: Record<string, unknown>): Error => {
    const cause = error(
      typeof packet.message === 'string' ? packet.message.slice(0, 1000) : 'Execution failed.',
    );
    if (packet.code === 'execution-timeout') {
      Object.defineProperty(cause, 'code', { value: 'execution-timeout' });
      if (packet.diagnostics && typeof packet.diagnostics === 'object') {
        const value = packet.diagnostics as Record<string, unknown>;
        const diagnostics = {
          phase: value.phase === 'probe' ? 'probe' : 'execution',
          ...(typeof value.eventType === 'string' &&
          ['load', 'play', 'out', 'data', 'blur', 'focus', 'tick', 'custom-action'].includes(
            value.eventType,
          )
            ? { eventType: value.eventType }
            : {}),
          ...(typeof value.budgetMs === 'number' &&
          Number.isFinite(value.budgetMs) &&
          value.budgetMs >= 16 &&
          value.budgetMs <= 2000
            ? { budgetMs: value.budgetMs }
            : {}),
        };
        Object.defineProperty(cause, 'diagnostics', { value: Object.freeze(diagnostics) });
      }
    }
    return cause;
  };
  if (!candidateOwner) throw error('A browser document is required.');
  const owner = candidateOwner;
  if (
    typeof options.source !== 'string' ||
    !options.source.trim() ||
    new TextEncoder().encode(options.source).byteLength > 128 * 1024
  )
    throw error('Source must contain a function expression of at most 128 KiB.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 16 || timeoutMs > 1000)
    throw error('Execution timeout must be 16–1000 ms.');
  // Plain LAN HTTP still has getRandomValues even when randomUUID is unavailable.
  const token =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
  let control: MessagePort | null = null;
  let cleanupControl: MessagePort | null = null;
  const iframe = ownerDocument.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute(
    'allow',
    "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'",
  );
  iframe.hidden = true;
  iframe.tabIndex = -1;
  iframe.referrerPolicy = 'no-referrer';
  iframe.title = 'Isolated function runtime';
  const config = JSON.stringify({
    token,
    source: options.source,
    timeoutMs,
    kernel: workerKernel.toString(),
    supervisor: supervisorKernel.toString(),
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  iframe.srcdoc =
    "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';\"><script>\"use strict\";(" +
    frameBootstrap.toString() +
    ')(/*ograf-config*/' +
    config +
    ');</script>';

  let settled = false,
    transferred = false,
    supervisorReady = false,
    busy = false,
    nextId = 0;
  let released = false,
    cleaning = false,
    acceptedId = 0;
  let failure: Error | null = null;
  interface Pending {
    id: number;
    probe: boolean;
    started: boolean;
    checking: boolean;
    resolve(value?: LogicFunctionResult): void;
    reject(error: Error): void;
  }
  let pending: Pending | null = null;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  let timer: number | undefined, cleanupTimer: number | undefined;
  const release = () => {
    if (released) return;
    released = true;
    owner.clearTimeout(timer);
    owner.clearTimeout(cleanupTimer);
    owner.removeEventListener('message', receiveWindow);
    owner.removeEventListener('pagehide', dispose);
    if (control) {
      control.onmessage = null;
      control.onmessageerror = null;
      control.close();
    }
    cleanupControl?.close();
    control = null;
    cleanupControl = null;
    iframe.remove();
  };
  const cleanup = () => {
    if (cleaning) return;
    cleaning = true;
    owner.clearTimeout(timer);
    owner.removeEventListener('pagehide', dispose);
    if (!transferred) {
      // No probe or user invocation can start before the authenticated port transfer.
      // Removing this fixed scaffold invokes its own pagehide cleanup.
      release();
      return;
    }
    // Normal cleanup waits for the trusted supervisor to terminate BOTH children first.
    // Document destruction is a final transport-failure fallback, never the success path.
    cleanupTimer = owner.setTimeout(release, STARTUP_MS);
    try {
      control?.postMessage({ channel: CHANNEL, kind: 'dispose' });
    } catch {
      /* Try the fixed bootstrap too. */
    }
    if (!released) {
      try {
        cleanupControl?.postMessage({ channel: CHANNEL, kind: 'dispose' });
      } catch {
        /* Already closing. */
      }
    }
  };
  const fail = (cause: Error) => {
    if (failure) return;
    failure = cause;
    const task = pending;
    pending = null;
    task?.reject(cause);
    if (!settled) {
      settled = true;
      rejectReady(cause);
    }
    cleanup();
  };
  const arm = (duration: number, callback: () => void) => {
    owner.clearTimeout(timer);
    timer = owner.setTimeout(callback, duration);
  };
  const confirmDeadline = (task: Pending, message: string) => {
    if (failure || pending !== task) return;
    if (task.checking) {
      fail(error('Supervisor completion delivery timed out.'));
      return;
    }
    task.checking = true;
    // The supervisor owns the real execution deadline. It either terminates a still-running
    // child now, or replays a completion that was verified AFTER terminating that child.
    arm(STARTUP_MS, () => fail(error('Supervisor completion delivery timed out.')));
    try {
      control!.postMessage({ channel: CHANNEL, kind: 'check', id: task.id, message });
    } catch {
      fail(error('Could not verify function completion.'));
    }
  };
  const request = (
    probe: boolean,
    context?: string,
    eventType?: string,
  ): Promise<LogicFunctionResult | undefined> =>
    new Promise((resolve, reject) => {
      const task: Pending = {
        id: ++nextId,
        probe,
        started: false,
        checking: false,
        resolve,
        reject,
      };
      pending = task;
      arm(STARTUP_MS, () => confirmDeadline(task, 'Isolated worker did not start.'));
      try {
        control!.postMessage({
          channel: CHANNEL,
          kind: probe ? 'probe' : 'invoke',
          id: task.id,
          context,
          ...(eventType ? { eventType } : {}),
        });
      } catch {
        fail(error('Could not contact the isolated function supervisor.'));
      }
    });
  function packetFromSupervisor(packet: Record<string, unknown>) {
    if (!packet || packet.channel !== CHANNEL || packet.token !== token) {
      fail(error('Invalid supervisor message.'));
      return;
    }
    if (packet.kind === 'disposed' && packet.id === 0) {
      if (!failure) fail(error('Runtime disposed.'));
      release();
      return;
    }
    if (failure) return;
    if (packet.kind === 'supervisor-ready' && packet.id === 0 && !supervisorReady) {
      supervisorReady = true;
      void request(true).then(() => {
        if (!failure) {
          settled = true;
          resolveReady();
        }
      }, fail);
      return;
    }
    if (packet.kind === 'error' && packet.id === 0) {
      fail(
        error(
          typeof packet.message === 'string' ? packet.message.slice(0, 1000) : 'Supervisor failed.',
        ),
      );
      return;
    }
    const task = pending;
    if (
      (!task || packet.id !== task.id) &&
      packet.id === acceptedId &&
      ['ready', 'result', 'error'].includes(String(packet.kind))
    )
      return;
    if (!task || packet.id !== task.id) {
      fail(error('Unexpected supervisor response.'));
      return;
    }
    if (packet.kind === 'started') {
      if (task.started) {
        fail(error('Repeated worker start.'));
        return;
      }
      task.started = true;
      const budget = task.probe ? STARTUP_MS : timeoutMs;
      const remainingMs = packet.remainingMs ?? budget;
      if (
        typeof remainingMs !== 'number' ||
        !Number.isFinite(remainingMs) ||
        remainingMs < 0 ||
        remainingMs > budget
      ) {
        fail(error('Invalid worker execution budget.'));
        return;
      }
      if (!task.checking) arm(remainingMs, () => confirmDeadline(task, 'Execution timed out.'));
      return;
    }
    if (packet.kind === 'error') {
      fail(supervisorError(packet));
      return;
    }
    if (
      !task.started ||
      typeof packet.elapsedMs !== 'number' ||
      !Number.isFinite(packet.elapsedMs) ||
      packet.elapsedMs < 0
    ) {
      fail(error('Worker exceeded its execution deadline or returned an invalid duration.'));
      return;
    }
    if (packet.elapsedMs > (task.probe ? STARTUP_MS : timeoutMs)) {
      fail(
        supervisorError({
          message: 'Worker exceeded its execution deadline.',
          code: 'execution-timeout',
          diagnostics: {
            phase: task.probe ? 'probe' : 'execution',
            budgetMs: task.probe ? STARTUP_MS : timeoutMs,
          },
        }),
      );
      return;
    }
    if ((task.probe && packet.kind !== 'ready') || (!task.probe && packet.kind !== 'result')) {
      fail(error('Invalid supervisor result.'));
      return;
    }
    try {
      let result: LogicFunctionResult | undefined;
      if (!task.probe) {
        if (
          typeof packet.json !== 'string' ||
          new TextEncoder().encode(packet.json).byteLength > RESULT_BYTES
        )
          throw error('Result exceeds 512 KiB.');
        const value: unknown = JSON.parse(packet.json);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw error('Expected a result object.');
        jsonBytes(value, RESULT_BYTES);
        result = value as LogicFunctionResult;
        if (Object.hasOwn(result, 'state')) jsonBytes(result.state, STATE_BYTES);
        if (Object.hasOwn(result, 'data')) jsonBytes(result.data, DATA_BYTES);
      }
      owner.clearTimeout(timer);
      pending = null;
      acceptedId = task.id;
      task.resolve(result);
    } catch (cause) {
      fail(error(cause instanceof Error ? cause.message : 'Invalid JSON result.'));
    }
  }
  function receiveWindow(event: MessageEvent) {
    const closeTransferredPorts = () => {
      for (const port of event.ports ?? []) port.close();
    };
    // Other Function frames share this owner listener. Their capabilities are not ours
    // to close, even though every listener receives the same Window message event.
    if (event.source !== iframe.contentWindow) return;
    const packet = event.data;
    if (!packet || packet.channel !== CHANNEL || packet.token !== token) {
      closeTransferredPorts();
      fail(error('Invalid sandbox bootstrap message.'));
      return;
    }
    if (packet.kind === 'disposed') {
      if (!failure) fail(error('Runtime disposed.'));
      release();
      return;
    }
    if (failure) {
      closeTransferredPorts();
      return;
    }
    if (packet.kind === 'error') {
      fail(
        error(
          typeof packet.message === 'string'
            ? packet.message.slice(0, 1000)
            : 'Supervisor startup failed.',
        ),
      );
      return;
    }
    if (packet.kind === 'frame-ready' && packet.id === 0 && !transferred) {
      if (event.ports?.length !== 2 || event.ports[0] === event.ports[1]) {
        closeTransferredPorts();
        fail(error('Invalid isolated supervisor connection.'));
        return;
      }
      control = event.ports[0]!;
      cleanupControl = event.ports[1]!;
      transferred = true;
      arm(STARTUP_MS, () => fail(error('Isolated supervisor did not connect.')));
      try {
        control.onmessage = (message) => packetFromSupervisor(message.data);
        control.onmessageerror = () => fail(error('Unreadable supervisor message.'));
        control.start();
      } catch {
        fail(error('Could not connect the isolated supervisor.'));
      }
      return;
    }
    closeTransferredPorts();
    fail(error('Unexpected sandbox bootstrap message.'));
  }
  function dispose() {
    fail(error('Runtime disposed.'));
  }
  owner.addEventListener('message', receiveWindow);
  owner.addEventListener('pagehide', dispose);
  arm(STARTUP_MS, () => fail(error('Isolated frame did not start.')));
  try {
    (ownerDocument.body ?? ownerDocument.documentElement).appendChild(iframe);
  } catch {
    fail(error('Could not mount the isolated function frame.'));
  }
  return {
    ready,
    async invoke(context) {
      if (failure) throw failure;
      if (busy) throw error('An invocation is already running.');
      busy = true;
      try {
        await ready;
        if (failure) throw failure;
        jsonBytes(context.state, STATE_BYTES);
        jsonBytes(context.data, DATA_BYTES);
        const payload = jsonBytes(context, RESULT_BYTES);
        return (await request(false, payload, context.event.type))!;
      } catch (cause) {
        const message =
          failure ?? error(cause instanceof Error ? cause.message : 'Invocation failed.');
        fail(message);
        throw message;
      } finally {
        busy = false;
      }
    },
    dispose,
  };
}
