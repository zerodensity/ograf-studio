import {
  chartAnimationProgress,
  parseChartData,
  chartPresentationErrors,
  chartRendererFeatureErrors,
  validatePaint,
  sampleChartMarkAnimations,
  ANIMATION_PRESET_TRACK_PROPERTIES,
  CHART_ANIMATION_EASINGS,
  type CompiledChartMarkAnimations,
  getPaintAtFrame,
  type LayerAnimationTracks,
  assertRendererPluginModule,
  normalizeChartAnimation,
  rendererPluginKey,
  validateRendererPluginSnapshot,
  type ChartElement,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { CHART_RENDERED_EVENT } from './chartPresentation';
import { drawChartPaint } from './chartPaint';
import type {
  ChartRenderer,
  ChartRendererHostAPI,
  ChartRendererProvider,
} from './chartProviderTypes';

export type RuntimeRendererPluginSnapshot = RendererPluginSnapshot & { moduleUrl?: string };
export type RendererPluginPolicy = (snapshot: RendererPluginSnapshot) => boolean;
export interface ChartRenderOptions {
  frameRate?: number;
  rendererPlugins?: readonly RuntimeRendererPluginSnapshot[] | undefined;
  chartMarkAnimations?: CompiledChartMarkAnimations | undefined;
}
declare global {
  // Studio registers its installation policy. Portable exported graphics enforce integrity only.
  var __OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__: RendererPluginPolicy | undefined;
}

interface MountedChart {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  paintCanvas?: HTMLCanvasElement;
  foreground?: HTMLCanvasElement;
  revision: number;
  element: ChartElement;
  frame: number;
  markFrame: number;
  markFrameOverride?: number | undefined;
  markAnimations?: CompiledChartMarkAnimations | undefined;
  frameRate: number;
  snapshot: RuntimeRendererPluginSnapshot;
  renderer?: ChartRenderer | undefined;
  disposed: boolean;
  readiness: Promise<void>;
  resolveReadiness(): void;
  error?: Error;
  timeout?: ReturnType<typeof setTimeout> | undefined;
}
const mountedCharts = new WeakMap<HTMLElement, MountedChart>();
function mountedChart(container: HTMLElement): MountedChart | undefined {
  return (
    mountedCharts.get(container) ??
    mountedCharts.get(
      container.querySelector?.<HTMLElement>('[data-ograf-chart-owner]') as HTMLElement,
    )
  );
}
const providerModules = new Map<string, Promise<ChartRendererProvider>>();
const PROVIDER_READY_TIMEOUT_MS = 2500;

/** Use authored layer dimensions while a prepared scene is detached or hidden. */
function initialChartSize(container: HTMLElement): { width: number; height: number } | null {
  for (let node: HTMLElement | null = container; node; node = node.parentElement) {
    const { clientWidth, clientHeight } = node;
    if (clientWidth > 0 && clientHeight > 0) return { width: clientWidth, height: clientHeight };
    const width = /^(\d+(?:\.\d+)?)px$/.exec(node.style?.width ?? '');
    const height = /^(\d+(?:\.\d+)?)px$/.exec(node.style?.height ?? '');
    const widthPx = Number(width?.[1]);
    const heightPx = Number(height?.[1]);
    if (widthPx > 0 && heightPx > 0)
      return { width: Math.max(1, Math.round(widthPx)), height: Math.max(1, Math.round(heightPx)) };
  }
  return null;
}

export function chartAnimationEndFrame(element: ChartElement): number {
  const animation = normalizeChartAnimation(element.animation);
  return animation.type === 'none'
    ? 0
    : animation.delayFrames +
        animation.durationFrames +
        (animation.type === 'grow'
          ? animation.staggerFrames * Math.max(0, element.data.labels.length - 1)
          : 0);
}

/** Check even cached/mounted providers: disabling an installation revokes its further use. */
export function assertRendererPluginPolicy(snapshots: readonly RendererPluginSnapshot[]): void {
  const policy = globalThis.__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__;
  if (!policy) return;
  for (const snapshot of snapshots) {
    if (!policy(snapshot))
      throw new Error(
        'Renderer plugin "' +
          snapshot.manifest.name +
          '" (' +
          snapshot.manifest.version +
          ') is disabled or not trusted in Studio.',
      );
  }
}

function checkSnapshot(snapshot: RuntimeRendererPluginSnapshot): void {
  const errors = validateRendererPluginSnapshot(snapshot);
  if (errors.length)
    throw new Error('Renderer plugin failed integrity validation: ' + errors.join(' '));
  assertRendererPluginPolicy([snapshot]);
}

function selectedSnapshot(
  element: ChartElement,
  options: ChartRenderOptions,
): RuntimeRendererPluginSnapshot {
  const reference = element.provider;
  if (!reference)
    throw new Error('Choose a chart renderer plugin before creating or playing a chart.');
  const snapshot = options.rendererPlugins?.find(
    (candidate) =>
      candidate.manifest.id === reference.id &&
      candidate.manifest.version === reference.version &&
      candidate.sha256 === reference.sha256,
  );
  if (!snapshot)
    throw new Error(
      'Selected renderer plugin "' +
        reference.id +
        '" (' +
        reference.version +
        ') is missing from this template.',
    );
  const pinned = structuredClone(snapshot);
  checkSnapshot(pinned);
  if (!pinned.manifest.presets.includes(element.preset))
    throw new Error(
      'Renderer plugin "' +
        pinned.manifest.name +
        '" does not support chart type "' +
        element.preset +
        '".',
    );
  const featureErrors = chartRendererFeatureErrors(element, pinned.manifest);
  if (featureErrors.length) throw new Error(featureErrors.join(' '));
  return pinned;
}

function normalizedChartElement(element: ChartElement): ChartElement {
  const errors = chartPresentationErrors(element.presentation);
  if (element.fill !== undefined) errors.push(...validatePaint(element.fill));
  if (errors.length) throw new Error(errors.join(' '));
  return { ...structuredClone(element), data: parseChartData(element.data) };
}

function assertChartMarkArtifacts(
  element: ChartElement,
  compiled: CompiledChartMarkAnimations | undefined,
): void {
  for (const side of ['in', 'out'] as const) {
    const source = element.markAnimations?.[side];
    const phase = compiled?.[side];
    if (Boolean(source) !== Boolean(phase))
      throw new Error(`Chart mark ${side} animation is missing or has stale compiled curves.`);
    if (!phase) continue;
    if (
      !Number.isInteger(phase.startFrame) ||
      phase.startFrame < 0 ||
      !Number.isInteger(phase.durationFrames) ||
      phase.durationFrames < 1 ||
      phase.durationFrames > 1500 ||
      !Number.isInteger(phase.staggerFrames) ||
      phase.staggerFrames < 0 ||
      phase.staggerFrames > 1500 ||
      !Number.isInteger(phase.staggerSlots) ||
      phase.staggerSlots < 1 ||
      phase.staggerSlots > 1200 ||
      !phase.tracks ||
      typeof phase.tracks !== 'object' ||
      Array.isArray(phase.tracks) ||
      Object.keys(phase.tracks).length < 1
    )
      throw new Error('Chart mark animation has invalid compiled timing or tracks.');
    for (const [property, keys] of Object.entries(phase.tracks)) {
      if (
        !ANIMATION_PRESET_TRACK_PROPERTIES.includes(property as never) ||
        !Array.isArray(keys) ||
        keys.length < 2 ||
        keys.length > 64
      )
        throw new Error('Chart mark animation has invalid compiled tracks.');
      let previous = -1;
      for (const key of keys) {
        if (
          !Number.isInteger(key.frame) ||
          key.frame <= previous ||
          key.frame < 0 ||
          key.frame > phase.durationFrames ||
          !Number.isFinite(key.value) ||
          !CHART_ANIMATION_EASINGS.includes(key.easing as never)
        )
          throw new Error('Chart mark animation has invalid compiled curve keys.');
        previous = key.frame;
      }
    }
  }
}

function providerShape(value: unknown): ChartRendererProvider {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as ChartRendererProvider).apiVersion !== 1 ||
    typeof (value as ChartRendererProvider).create !== 'function'
  ) {
    throw new Error('Renderer plugin must default-export an apiVersion 1 provider with create().');
  }
  return value as ChartRendererProvider;
}

function rendererShape(value: unknown): ChartRenderer {
  if (
    !value ||
    typeof value !== 'object' ||
    !['renderAtFrame', 'update', 'dispose'].every(
      (method) => typeof (value as Record<string, unknown>)[method] === 'function',
    )
  ) {
    throw new Error(
      'Renderer plugin create() must return renderAtFrame(), update(), and dispose().',
    );
  }
  return value as ChartRenderer;
}

async function loadProvider(
  snapshot: RuntimeRendererPluginSnapshot,
): Promise<ChartRendererProvider> {
  checkSnapshot(snapshot);
  const key = rendererPluginKey({
    id: snapshot.manifest.id,
    version: snapshot.manifest.version,
    sha256: snapshot.sha256,
  });
  let module = providerModules.get(key);
  if (!module) {
    module = (async () => {
      await assertRendererPluginModule(snapshot.source);
      // Import the verified pinned bytes rather than trusting a mutable external module URL.
      const moduleUrl =
        typeof window === 'undefined'
          ? 'data:text/javascript;charset=utf-8,' +
            encodeURIComponent(snapshot.source) +
            '#' +
            encodeURIComponent(key)
          : URL.createObjectURL(new Blob([snapshot.source], { type: 'text/javascript' }));
      try {
        assertRendererPluginPolicy([snapshot]);
        const imported = await import(/* @vite-ignore */ moduleUrl);
        assertRendererPluginPolicy([snapshot]);
        return providerShape(imported.default);
      } finally {
        if (moduleUrl.startsWith('blob:')) URL.revokeObjectURL(moduleUrl);
      }
    })();
    providerModules.set(key, module);
    void module.catch(() => {
      if (providerModules.get(key) === module) providerModules.delete(key);
    });
  }
  const provider = await module;
  assertRendererPluginPolicy([snapshot]);
  return provider;
}

function finishReadiness(state: MountedChart): void {
  if (state.timeout !== undefined) clearTimeout(state.timeout);
  state.timeout = undefined;
  state.resolveReadiness();
}

function fail(state: MountedChart, error: unknown): void {
  state.error ??= error instanceof Error ? error : new Error(String(error));
  const renderer = state.renderer;
  state.renderer = undefined;
  try {
    if (renderer) invokeSynchronously(() => renderer.dispose(), 'dispose()');
  } catch {
    /* Preserve the initialization/draw failure. */
  }
  finishReadiness(state);
}

function hostAPI(state: MountedChart): ChartRendererHostAPI {
  return Object.freeze({
    apiVersion: 1 as const,
    frameRate: state.frameRate,
    chartAnimationProgress,
    normalizeChartAnimation,
    chartAnimationEndFrame,
    sampleChartMarkAnimation: (index: number) =>
      state.markAnimations
        ? sampleChartMarkAnimations(state.markAnimations, state.markFrame, index)
        : null,
  });
}

function invokeSynchronously(method: () => unknown, label: string): void {
  const startedAt = performance.now();
  const result = method();
  if (
    result &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    // Consume a possible rejection while surfacing the incompatible v1 method contract.
    void Promise.resolve(result).catch(() => {});
    throw new Error('Renderer plugin ' + label + ' must be synchronous.');
  }
  if (performance.now() - startedAt > PROVIDER_READY_TIMEOUT_MS) {
    throw new Error('Renderer plugin ' + label + ' exceeded its 2500 ms deadline.');
  }
}

function renderMounted(state: MountedChart): void {
  if (state.error) throw state.error;
  if (state.disposed || !state.renderer) return;
  assertRendererPluginPolicy([state.snapshot]);
  const renderer = state.renderer;
  invokeSynchronously(() => renderer.renderAtFrame(state.frame), 'renderAtFrame()');
  if (state.mask && state.foreground && state.paintCanvas && state.element.fill !== undefined) {
    if (!renderer.renderMarkLayers)
      throw new Error('Chart renderer must implement renderMarkLayers() for mark-paint-v1.');
    invokeSynchronously(
      () => renderer.renderMarkLayers!(state.mask!, state.foreground!),
      'renderMarkLayers()',
    );
    drawChartPaint(state.paintCanvas, state.mask, state.element.fill);
    state.mask.dataset.ografChartRevision = String(state.revision + 1);
  }
  state.canvas.dataset.ografChartRevision = String(++state.revision);
  if (typeof state.container.dispatchEvent === 'function') {
    const EventConstructor = state.container.ownerDocument.defaultView?.Event ?? Event;
    state.container.dispatchEvent(new EventConstructor(CHART_RENDERED_EVENT, { bubbles: true }));
  }
}

export function applyChartPaintTracks(
  container: HTMLElement,
  tracks: LayerAnimationTracks,
  frame: number,
): boolean {
  // The caller already selected the native paint base. Never capture a nested child layer's chart.
  const state = mountedCharts.get(container);
  if (!state?.mask || !state.paintCanvas || state.element.fill === undefined) return false;
  drawChartPaint(state.paintCanvas, state.mask, getPaintAtFrame(state.element.fill, tracks, frame));
  return true;
}

/** Every chart uses an explicitly selected, pinned external renderer. */
export function mountChart(
  container: HTMLElement,
  element: ChartElement,
  options: ChartRenderOptions = {},
): void {
  element = normalizedChartElement(element);
  const snapshot = selectedSnapshot(element, options);
  assertChartMarkArtifacts(element, options.chartMarkAnimations);
  const host = container.ownerDocument.createElement('div');
  host.style.cssText =
    'position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none';
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.dataset.ografChartCanvas = 'true';
  canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;z-index:0';
  const initialSize = initialChartSize(container);
  if (initialSize) {
    canvas.width = initialSize.width;
    canvas.height = initialSize.height;
  }
  host.appendChild(canvas);
  let markLayers: Pick<MountedChart, 'mask' | 'paintCanvas' | 'foreground'> = {};
  if (element.fill !== undefined) {
    const mask = container.ownerDocument.createElement('canvas');
    // This hidden surface is read by the paint compositors on every animated chart frame.
    // Select the readable backing before the provider first obtains its 2D context.
    mask.getContext('2d', { willReadFrequently: true });
    mask.dataset.ografChartFillMask = 'true';
    mask.style.display = 'none';
    const paintCanvas = container.ownerDocument.createElement('canvas');
    paintCanvas.dataset.ografChartPaint = 'true';
    paintCanvas.style.cssText =
      'display:block;position:absolute;inset:0;width:100%;height:100%;z-index:1';
    const foreground = container.ownerDocument.createElement('canvas');
    foreground.dataset.ografChartForeground = 'true';
    foreground.style.cssText =
      'display:block;position:absolute;inset:0;width:100%;height:100%;z-index:2';
    host.appendChild(mask);
    host.appendChild(paintCanvas);
    host.appendChild(foreground);
    markLayers = { mask, paintCanvas, foreground };
  }
  container.appendChild(host);
  let resolveReadiness = () => {};
  const readiness = new Promise<void>((resolve) => {
    resolveReadiness = resolve;
  });
  const state: MountedChart = {
    container,
    canvas,
    ...markLayers,
    revision: 0,
    element: structuredClone(element),
    frame: 0,
    markFrame: 0,
    markAnimations: options.chartMarkAnimations
      ? structuredClone(options.chartMarkAnimations)
      : undefined,
    frameRate: Math.max(1, options.frameRate ?? 25),
    snapshot,
    disposed: false,
    readiness,
    resolveReadiness,
  };
  mountedCharts.set(container, state);
  container.dataset.ografChartOwner = 'true';
  // Scene construction can synchronously create hundreds of other layers after this chart.
  // Module loading cannot progress until that host task yields, so its work must not consume
  // the provider's readiness budget. The queued initializer still has the same bounded deadline.
  queueMicrotask(() => {
    if (state.disposed || state.error) return;
    state.timeout = setTimeout(
      () => fail(state, new Error('Renderer plugin did not become ready within 2500 ms.')),
      PROVIDER_READY_TIMEOUT_MS,
    );
    const startedAt = performance.now();
    void loadProvider(snapshot)
      .then(async (provider) => {
        if (state.disposed || state.error) return;
        assertRendererPluginPolicy([snapshot]);
        const initialElement = state.element;
        const renderer = rendererShape(
          await provider.create(canvas, structuredClone(initialElement), hostAPI(state)),
        );
        if (state.disposed || state.error) {
          invokeSynchronously(() => renderer.dispose(), 'dispose()');
          return;
        }
        state.renderer = renderer;
        if (performance.now() - startedAt > PROVIDER_READY_TIMEOUT_MS) {
          throw new Error('Renderer plugin did not become ready within 2500 ms.');
        }
        assertRendererPluginPolicy([snapshot]);
        if (initialElement !== state.element)
          invokeSynchronously(() => renderer.update(structuredClone(state.element)), 'update()');
        renderMounted(state);
        finishReadiness(state);
      })
      .catch((error) => fail(state, error));
  });
}

/** Reuse the provider and canvas on data edits, but never cross an identity or clock change. */
export function updateMountedChart(
  container: HTMLElement,
  element: ChartElement,
  options: ChartRenderOptions = {},
): boolean {
  const state = mountedCharts.get(container);
  if (!state || state.disposed) return false;
  if ((state.element.fill !== undefined) !== (element.fill !== undefined)) return false;
  // Reject invalid operator data before changing or disposing the current on-air renderer.
  element = normalizedChartElement(element);
  // A mounted instance cannot substitute for a missing or modified project snapshot.
  const selected = selectedSnapshot(element, options);
  assertChartMarkArtifacts(element, options.chartMarkAnimations);
  const previous = state.snapshot;
  if (
    rendererPluginKey({
      id: selected.manifest.id,
      version: selected.manifest.version,
      sha256: selected.sha256,
    }) !==
      rendererPluginKey({
        id: previous.manifest.id,
        version: previous.manifest.version,
        sha256: previous.sha256,
      }) ||
    state.frameRate !== Math.max(1, options.frameRate ?? 25)
  )
    return false;
  assertRendererPluginPolicy([selected]);
  state.element = structuredClone(element);
  state.markAnimations = options.chartMarkAnimations
    ? structuredClone(options.chartMarkAnimations)
    : undefined;
  try {
    const renderer = state.renderer;
    if (renderer)
      invokeSynchronously(() => renderer.update(structuredClone(state.element)), 'update()');
    renderMounted(state);
  } catch (error) {
    fail(state, error);
    throw state.error;
  }
  return true;
}

export function renderChartAnimationAtFrame(
  container: HTMLElement,
  _element: ChartElement,
  frame: number,
  markFrame?: number,
): void {
  const state = mountedChart(container);
  if (!state) return;
  if (markFrame !== undefined) state.markFrameOverride = markFrame;
  state.markFrame = state.markFrameOverride ?? frame;
  const override = container.dataset.ografChartAnimationFrame;
  state.frame = override === undefined ? frame : Number(override);
  try {
    renderMounted(state);
  } catch (error) {
    fail(state, error);
    throw state.error;
  }
}

/** Paint wrappers may advance shader/media time without advancing the layer lifecycle. */
export function setChartMarkAnimationFrame(container: HTMLElement, frame: number): void {
  const state = mountedChart(container);
  if (!state) return;
  state.markFrameOverride = frame;
  state.markFrame = frame;
}

/** A new Take replays the entrance; an operator data update may instead morph in place. */
export function resetChartAnimation(container: HTMLElement): void {
  const state = mountedChart(container);
  if (!state || state.disposed || !state.renderer) return;
  const reset = state.renderer.resetAnimation;
  if (reset) invokeSynchronously(() => reset.call(state.renderer), 'resetAnimation()');
}

export interface ChartAnimationHistoryEntry {
  frame: number;
  element: ChartElement;
  reset?: boolean;
  skip?: boolean;
}

/** Native resources/paint/configuration must still prepare while hidden; only quote data may wait. */
export function chartUpdateChangesDataOnly(previous: ChartElement, next: ChartElement): boolean {
  const { data: _previousData, ...previousConfiguration } = previous;
  const { data: _nextData, ...nextConfiguration } = next;
  return JSON.stringify(previousConfiguration) === JSON.stringify(nextConfiguration);
}

/** Realtime only: once a data pose fully settled before the next update, earlier interrupted
 * morphs cannot affect later pixels. Keep that checkpoint and every following event intact. */
export function compactSettledChartAnimationHistory(history: ChartAnimationHistoryEntry[]): void {
  for (let index = history.length - 2; index > 0; index--) {
    const previous = history[index]!;
    const next = history[index + 1]!;
    const animation = normalizeChartAnimation(previous.element.animation);
    // Morph updates stagger each point for fade/reveal as well as grow. A nominal duration
    // alone does not prove that the final point has reached its new value.
    const settledFrame =
      animation.type !== 'none' && animation.updateMode === 'morph'
        ? animation.delayFrames +
          animation.durationFrames +
          animation.staggerFrames * Math.max(0, previous.element.data.labels.length - 1)
        : chartAnimationEndFrame(previous.element);
    // Use the frame the history renderer really samples for skip entries. Conservatively retain
    // origins if a legacy non-grow skip endpoint precedes the last staggered morph point.
    const sampledFrame = previous.skip
      ? chartAnimationEndFrame(previous.element)
      : next.frame - previous.frame;
    if (sampledFrame >= settledFrame) {
      history.splice(0, index);
      history[0] = { ...history[0]!, reset: true };
      return;
    }
  }
}

/** Reconstruct interrupted morph origins from scheduled events, independent of the last seek. */
export function renderChartAnimationHistoryAtFrame(
  container: HTMLElement,
  history: readonly ChartAnimationHistoryEntry[],
  frame: number,
  markFrame?: number,
): boolean {
  const state = mountedChart(container);
  const renderer = state?.renderer;
  if (!state || state.disposed || !renderer || !history.length) return false;
  if (markFrame !== undefined) state.markFrameOverride = markFrame;
  state.markFrame = state.markFrameOverride ?? frame;
  let previous = history[0]!;
  for (const [index, entry] of history.entries()) {
    if (entry.frame > frame) break;
    const element = normalizedChartElement(entry.element);
    if (index) {
      const localFrame = previous.skip
        ? chartAnimationEndFrame(previous.element)
        : Math.max(0, entry.frame - previous.frame);
      invokeSynchronously(() => renderer.renderAtFrame(localFrame), 'renderAtFrame()');
    }
    invokeSynchronously(() => renderer.update(element), 'update()');
    if ((index === 0 || entry.reset) && renderer.resetAnimation)
      invokeSynchronously(() => renderer.resetAnimation!(), 'resetAnimation()');
    previous = entry;
    state.element = element;
  }
  state.frame = previous.skip
    ? chartAnimationEndFrame(previous.element)
    : Math.max(0, frame - previous.frame);
  renderMounted(state);
  return true;
}

export async function waitForChartsReady(root: ParentNode): Promise<void> {
  const entries = [
    mountedCharts.get(root as HTMLElement),
    ...Array.from(root.querySelectorAll?.<HTMLElement>('*') ?? [], (host) =>
      mountedCharts.get(host),
    ),
  ].filter((entry): entry is MountedChart => !!entry);
  await Promise.all(entries.map((entry) => entry.readiness));
  for (const entry of entries) {
    if (entry.error) throw entry.error;
    assertRendererPluginPolicy([entry.snapshot]);
  }
}

export function disposeChart(container: HTMLElement): void {
  const state = mountedCharts.get(container);
  if (!state) return;
  state.disposed = true;
  finishReadiness(state);
  try {
    const renderer = state.renderer;
    if (renderer) invokeSynchronously(() => renderer.dispose(), 'dispose()');
  } finally {
    mountedCharts.delete(container);
    delete container.dataset.ografChartOwner;
    state.renderer = undefined;
  }
}
