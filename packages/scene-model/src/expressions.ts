import { scriptConsole, withScriptLogContext } from './scriptConsole';
import { easedProgress } from './layerAnimation';
import type { EasingPreset, KeyframeRole } from './types';

export type ExpressionScope = Record<string, unknown>;
export type ExpressionLayerResolver = (name: string, property: string) => number;
export const EXPRESSION_API_VERSION = 1;
export const EXPRESSION_PROPERTIES = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;
export interface ExpressionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ExpressionLayerSampling {
  valueAtTime: (property: string, seconds: number) => number;
  sourceRectAtTime: (seconds: number, includeExtents: boolean) => ExpressionRect;
}
export interface ExpressionEvaluationOptions {
  apiVersion?: number;
  currentLayer?: { id: string; name: string };
  currentProperty?: { name: string; value: number; layerId: string };
  resolveLayerMetadata?: (reference: string, byId: boolean) => { id: string; name: string };
  currentSampling?: ExpressionLayerSampling;
  resolveLayerSampling?: (reference: string, byId: boolean) => ExpressionLayerSampling;
  modules?: Record<string, object>;
  /** Stable authored expression map; compiled entries live only as long as their owner. */
  expressionSources?: object;
  writeLayer?: (name: string, property: string, value: number) => void;
  writeLayerById?: (id: string, property: string, value: number) => void;
  resolveLayerById?: ExpressionLayerResolver;
}
type CompiledExpression = (
  scope: ExpressionScope,
  resolveLayer?: ExpressionLayerResolver,
  options?: ExpressionEvaluationOptions,
) => number;

/** Authored timeline positions; playback speed and data fields do not move these boundaries. */
export function expressionTimelineScope(
  keyframes: ReadonlyArray<{ frame: number; role: KeyframeRole }>,
  frame?: number,
): ExpressionScope {
  const startFrame = keyframes.find((key) => key.role === 'start')?.frame ?? 0;
  const endFrame = keyframes.find((key) => key.role === 'end')?.frame ?? startFrame;
  const steps = keyframes.filter((key) => key.role === 'step');
  const exitStart = steps.at(-1)?.frame ?? startFrame;
  return {
    'timeline.startFrame': startFrame,
    'timeline.endFrame': endFrame,
    ...(steps.length > 0
      ? {
          'timeline.firstStepFrame': steps[0]!.frame,
          'timeline.lastStepFrame': steps[steps.length - 1]!.frame,
        }
      : {}),
    ...(frame === undefined
      ? {}
      : {
          'timeline.exitProgress':
            endFrame > exitStart
              ? Math.min(1, Math.max(0, (frame - exitStart) / (endFrame - exitStart)))
              : Number(frame >= endFrame),
        }),
  };
}

/** Detached, deeply read-only JSON data; field names remain literal, including dots. */
export function expressionDataScope(data: Record<string, unknown>): ExpressionScope {
  const copies = new WeakMap<object, object>();
  const snapshot = (value: unknown): unknown => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (!value || typeof value !== 'object') return undefined;
    const existing = copies.get(value);
    if (existing) return existing;
    const copy = Array.isArray(value) ? [] : Object.create(null);
    copies.set(value, copy);
    for (const [key, child] of Object.entries(value))
      Object.defineProperty(copy, key, { value: snapshot(child), enumerable: true });
    return Object.freeze(copy);
  };
  return { data: snapshot(data) };
}

function numeric(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Expected a number.');
  return value;
}

function helper(name: 'lerp' | 'clamp' | 'ease', ...args: unknown[]): number {
  if (args.length !== (name === 'ease' ? 4 : 3))
    throw new Error(
      name === 'ease'
        ? 'ease requires four arguments: start, end, progress and an easing preset.'
        : name + ' requires three arguments.',
    );
  const [a, b, c] = args.slice(0, 3).map(numeric) as [number, number, number];
  if (name === 'clamp') return Math.min(c, Math.max(b, a));
  if (name === 'lerp') return a + (b - a) * c;
  const preset = args[3];
  if (typeof preset !== 'string') throw new Error('Expected an easing preset name.');
  const progress = easedProgress(Math.min(1, Math.max(0, c)), preset as EasingPreset);
  if (progress === undefined) throw new Error('Unknown easing preset "' + preset + '".');
  return a + (b - a) * progress;
}

function sampleTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Sample time must be finite seconds.');
  return value;
}
function sampledProperty(
  resolve: (property: string) => number,
  property: string,
  sampling?: () => ExpressionLayerSampling,
) {
  if (!(EXPRESSION_PROPERTIES as readonly string[]).includes(property))
    throw new Error('Unknown layer property: ' + property);
  return Object.freeze({
    name: property,
    get value() {
      return resolve(property);
    },
    valueAtTime: (seconds: number) => {
      if (!sampling) throw new Error('Time sampling is unavailable.');
      return sampling().valueAtTime(property, sampleTime(seconds));
    },
  });
}
function sourceRectMethod(sampling: () => ExpressionLayerSampling, time: number) {
  return (seconds = time, includeExtents = false) => {
    if (typeof includeExtents !== 'boolean') throw new Error('includeExtents must be a boolean.');
    return Object.freeze({ ...sampling().sourceRectAtTime(sampleTime(seconds), includeExtents) });
  };
}

/** Enumerable getters support normal object operations without eagerly resolving dependencies. */
function layerReference(
  resolve: (property: string) => number,
  write?: (property: string, value: number) => void,
  metadata?: () => { id: string; name: string },
  sampling?: () => ExpressionLayerSampling,
  time = 0,
): Record<string, unknown> {
  const target = Object.create(null);
  for (const property of EXPRESSION_PROPERTIES)
    Object.defineProperty(target, property, {
      enumerable: true,
      get: () => resolve(property),
      ...(write ? { set: (value: number) => write(property, value) } : {}),
    });
  if (metadata)
    for (const key of ['id', 'name'] as const)
      Object.defineProperty(target, key, { get: () => metadata()[key] });
  Object.defineProperty(target, 'property', {
    value: (name: string) => sampledProperty(resolve, name, sampling),
  });
  if (sampling)
    Object.defineProperty(target, 'sourceRectAtTime', { value: sourceRectMethod(sampling, time) });
  return Object.preventExtensions(target);
}

/** Preserve lazy getters: copying their values would eagerly evaluate unrelated dependencies. */
function evaluationScope(
  scope: ExpressionScope,
  resolveLayer?: ExpressionLayerResolver,
  options: ExpressionEvaluationOptions = {},
) {
  const context = Object.assign(Object.create(null), {
    data: Object.create(null),
    comp: Object.create(null),
    timeline: Object.create(null),
  });
  const thisLayer = Object.create(null);
  for (const key of Object.getOwnPropertyNames(scope)) {
    const descriptor = { ...Object.getOwnPropertyDescriptor(scope, key)!, enumerable: true };
    const dot = key.lastIndexOf('.');
    if (dot < 0) {
      Object.defineProperty(context, key, descriptor);
      if (key !== 'data') Object.defineProperty(thisLayer, key, descriptor);
    } else {
      const name = key.slice(0, dot);
      if (!Object.hasOwn(context, name)) context[name] = Object.create(null);
      Object.defineProperty(context[name], key.slice(dot + 1), descriptor);
    }
  }
  // Metadata does not introduce transform dependencies or change transform enumeration.
  if (options.currentLayer)
    for (const [key, value] of Object.entries(options.currentLayer))
      Object.defineProperty(thisLayer, key, { value });
  if (options.currentSampling) {
    const sampling = () => options.currentSampling!;
    const time = typeof scope.time === 'number' ? scope.time : 0;
    Object.defineProperty(thisLayer, 'property', {
      value: (name: string) =>
        sampledProperty((property) => numeric(scope[property]), name, sampling),
    });
    Object.defineProperty(thisLayer, 'sourceRectAtTime', {
      value: sourceRectMethod(sampling, time),
    });
    Object.defineProperty(context, 'sourceRectAtTime', { value: sourceRectMethod(sampling, time) });
  }
  Object.freeze(thisLayer);
  Object.defineProperty(context, 'data', { value: context.data, writable: false });
  if (options.currentProperty) {
    Object.defineProperty(context, 'value', { value: options.currentProperty.value });
    const valueAtTime = (seconds: number) => {
      if (!options.currentSampling) throw new Error('Time sampling is unavailable.');
      return options.currentSampling.valueAtTime(
        options.currentProperty!.name,
        sampleTime(seconds),
      );
    };
    Object.defineProperty(context, 'valueAtTime', { value: valueAtTime });
    Object.defineProperty(context, 'thisProperty', {
      value: Object.freeze({ ...options.currentProperty, valueAtTime }),
    });
  }
  Object.assign(context, {
    thisLayer,
    console: scriptConsole,
    layerById: (id: string) =>
      layerReference(
        (property) => {
          if (!options.resolveLayerById) throw new Error('Layer ID lookup is unavailable.');
          return options.resolveLayerById(id, property);
        },
        options.writeLayerById
          ? (property, value) => options.writeLayerById!(id, property, value)
          : undefined,
        options.resolveLayerMetadata ? () => options.resolveLayerMetadata!(id, true) : undefined,
        options.resolveLayerSampling ? () => options.resolveLayerSampling!(id, true) : undefined,
        typeof scope.time === 'number' ? scope.time : 0,
      ),
    layer: (name: string) =>
      layerReference(
        (property) => {
          if (resolveLayer) return resolveLayer(name, property);
          const key = name + '.' + property;
          if (!Object.hasOwn(scope, key)) throw new Error('Unknown layer property "' + key + '".');
          return numeric(scope[key]);
        },
        options.writeLayer
          ? (property, value) => options.writeLayer!(name, property, value)
          : undefined,
        options.resolveLayerMetadata ? () => options.resolveLayerMetadata!(name, false) : undefined,
        options.resolveLayerSampling ? () => options.resolveLayerSampling!(name, false) : undefined,
        typeof scope.time === 'number' ? scope.time : 0,
      ),
    lerp: (...args: unknown[]) => helper('lerp', ...args),
    clamp: (...args: unknown[]) => helper('clamp', ...args),
    ease: (...args: unknown[]) => helper('ease', ...args),
  });
  if (options.modules) {
    context.modules = options.modules;
    for (const [name, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(options.modules),
    ))
      if (!Object.hasOwn(context, name)) Object.defineProperty(context, name, descriptor);
  }
  return context;
}

/** Trusted project JavaScript, compiled by the host engine; this is not a sandbox. */
function compileExpression(source: string): CompiledExpression {
  const compile = (body: string) =>
    new Function(
      'scope',
      'with (scope) { return (function () { "use strict";\n' + body + '\n}).call(undefined); }',
    ) as (scope: object) => unknown;
  let execute: (scope: object) => unknown;
  try {
    execute = compile('return (\n' + source + '\n);');
  } catch {
    // Keep the existing single-formula syntax with an optional final semicolon/comments.
    const formula = source.replace(/;(\s*(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s)*)$/, '$1');
    try {
      execute = compile('return (\n' + formula + '\n);');
    } catch {
      execute = compile(source);
    }
  }
  return (scope, resolveLayer, options) => {
    const result = execute(evaluationScope(scope, resolveLayer, options));
    requireSynchronousResult(result, 'Expressions');
    if (result === undefined)
      throw new Error(
        'Expression result must be a number. No value was returned; use return in a statement body.',
      );
    if (typeof result !== 'number')
      throw new Error(
        'Expression result must be a number; received ' +
          (result === null ? 'null' : typeof result) +
          '.',
      );
    if (!Number.isFinite(result)) throw new Error('Expression result is not finite.');
    return result;
  };
}

// Bound retained source/closures while avoiding parsing unchanged formulas on every frame.
type ExpressionCompilation = { execute: CompiledExpression } | { error: unknown };
const compiledExpressions = new Map<string, ExpressionCompilation>();
const ownedExpressions = new WeakMap<
  object,
  Map<string, { source: string; compilation: ExpressionCompilation }>
>();
function compiledExpression(source: string, owner?: object, property?: string): CompiledExpression {
  // Retain the active layer's six properties independently of the bounded shared cache.
  // Compare sources as callers outside the editor may mutate an expression map in place.
  let owned: Map<string, { source: string; compilation: ExpressionCompilation }> | undefined;
  if (owner && property && EXPRESSION_PROPERTIES.some((name) => name === property)) {
    owned = ownedExpressions.get(owner);
    if (!owned) ownedExpressions.set(owner, (owned = new Map()));
  }
  const entry = property ? owned?.get(property) : undefined;
  let compilation = entry?.source === source ? entry.compilation : compiledExpressions.get(source);
  if (!compilation) {
    try {
      compilation = { execute: compileExpression(source) };
    } catch (error) {
      compilation = { error };
    }
    if (compiledExpressions.size >= 256)
      compiledExpressions.delete(compiledExpressions.keys().next().value!);
    compiledExpressions.set(source, compilation);
  }
  if (owned && property && entry?.source !== source) owned.set(property, { source, compilation });
  if ('error' in compilation) throw compilation.error;
  return compilation.execute;
}

/** Checks grammar without reading data or evaluating layer dependencies. */
export function expressionSyntaxError(source: string): string | undefined {
  if (!source.trim()) return undefined;
  try {
    compiledExpression(source);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Evaluates with fresh local constants on every call, including recursive layer references. */
export function evaluateExpression(
  source: string,
  scope: ExpressionScope,
  resolveLayer?: ExpressionLayerResolver,
  options: ExpressionEvaluationOptions = {},
): number {
  const version = options.apiVersion ?? 1;
  if (version !== EXPRESSION_API_VERSION)
    throw new Error('Unsupported expression API version: ' + version);
  const label = options.currentLayer
    ? `${options.currentLayer.name || options.currentLayer.id}.${options.currentProperty?.name ?? 'expression'}`
    : 'Expression';
  return withScriptLogContext(label, scope.frame, () =>
    compiledExpression(source, options.expressionSources, options.currentProperty?.name)(
      scope,
      resolveLayer,
      options,
    ),
  );
}

const compiledScripts = new Map<string, (scope: object) => unknown>();
function compiledScript(source: string) {
  const cached = compiledScripts.get(source);
  if (cached) return cached;
  const execute = new Function(
    'scope',
    'with (scope) { return (function () { "use strict";\n' + source + '\n}).call(undefined); }',
  ) as (scope: object) => unknown;
  if (compiledScripts.size >= 128) compiledScripts.delete(compiledScripts.keys().next().value!);
  compiledScripts.set(source, execute);
  return execute;
}

export function compositionScriptSyntaxError(source: string): string | undefined {
  try {
    compiledScript(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

export function evaluateCompositionScript(
  source: string,
  scope: ExpressionScope,
  resolveLayer: ExpressionLayerResolver,
  options: ExpressionEvaluationOptions,
): void {
  if ((options.apiVersion ?? 1) !== EXPRESSION_API_VERSION)
    throw new Error('Unsupported expression API version: ' + options.apiVersion);
  const result = withScriptLogContext('Composition', scope.frame, () =>
    compiledScript(source)(evaluationScope(scope, resolveLayer, options)),
  );
  requireSynchronousResult(result, 'Composition scripts');
}

function requireSynchronousResult(result: unknown, label: string): void {
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error(label + ' must finish synchronously.');
  }
}
