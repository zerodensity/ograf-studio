import {
  editablePathBounds,
  getElementShaderPaint,
  getElementShaderPaints,
  type Element,
  type ShaderPaint,
  type ShaderPaintSlot,
} from '@ograf-editor/scene-model';
import { createShaderPaintMask } from './shaderPaintMask';
import {
  mountShader,
  disposeShader,
  renderShaderAtTime,
  setShaderCoverage,
  updateShaderParameters,
} from './shaderRendering';

interface RenderOptions {
  shaderBackingSize?: { width: number; height: number };
  shaderStrokePadding?: number;
  lottieBackingSize?: { width: number; height: number };
  requiresImageAlpha?: boolean;
}
interface NativeContent {
  render(host: HTMLElement, element: Element, options: RenderOptions): void;
  renderAtTime(host: HTMLElement, element: Element, elapsedMs: number): void;
  ready(host: HTMLElement): Promise<void>;
  refreshLayout(host: HTMLElement): void;
  dispose(host: HTMLElement): void;
}
interface MountedSlot {
  slot: ShaderPaintSlot;
  host: HTMLElement;
  paint: ShaderPaint;
  mask?: ReturnType<typeof createShaderPaintMask>;
  size: { width: number; height: number };
}
interface MountedPaint {
  container: HTMLElement;
  visualHost: HTMLElement;
  baseHost: HTMLElement;
  baseElement: Element;
  baseIdentity: string;
  slots: Map<ShaderPaintSlot, MountedSlot>;
  padding: number;
  configuration: number;
  options: RenderOptions;
  native: NativeContent;
  time: number;
  requested: number;
  completed: number;
  busy: boolean;
  disposed: boolean;
  error?: Error;
  waiters: Array<{ revision: number; resolve: () => void }>;
}
const mountedPaints = new WeakMap<HTMLElement, MountedPaint>();

export function shaderPaintBaseElement(element: Element): Element {
  if (element.type === 'image' || element.type === 'image-sequence' || element.type === 'lottie') {
    const { fill: _fill, ...base } = element;
    return base;
  }
  if (element.type === 'text') {
    const { strokePaint: _strokePaint, ...base } = element;
    return {
      ...base,
      ...(getElementShaderPaint(element) ? { fill: 'transparent', color: 'transparent' } : {}),
      ...(getElementShaderPaint(element, 'stroke') ? { strokeColor: 'transparent' } : {}),
    };
  }
  if ('fill' in element && getElementShaderPaint(element))
    return { ...element, fill: 'transparent' };
  return element;
}

export function shaderStrokePaddingForLayer(layer: {
  element: Element;
  animationTracks: { strokeWidth?: ReadonlyArray<{ value: number }> };
  loop?: { tracks: { strokeWidth?: ReadonlyArray<{ value: number }> } } | null;
}): number {
  if (layer.element.type !== 'text') return 0;
  const width = Math.max(
    0,
    layer.element.strokeWidth,
    ...(layer.animationTracks.strokeWidth ?? []).map((key) => key.value),
    ...(layer.loop?.tracks.strokeWidth ?? []).map((key) => key.value),
  );
  return width > 0 ? Math.ceil(width * 2) + 2 : 0;
}

function strokePadding(element: Element, options: RenderOptions): number {
  if (element.type !== 'text') return 0;
  return Math.max(
    0,
    options.shaderStrokePadding ??
      (element.strokeWidth > 0 ? Math.ceil(element.strokeWidth * 2) + 2 : 0),
  );
}

function placement(element: Element, size: { width: number; height: number }, padding = 0) {
  let box = { left: 0, top: 0, width: 1, height: 1 };
  if (element.type === 'path' && element.overflow === 'visible') {
    const bounds = editablePathBounds(element);
    box = {
      left: bounds.x / element.viewBoxWidth,
      top: bounds.y / element.viewBoxHeight,
      width: bounds.width / element.viewBoxWidth,
      height: bounds.height / element.viewBoxHeight,
    };
  }
  return {
    style:
      element.type === 'text' && padding > 0
        ? {
            left: `${-padding}px`,
            top: `${-padding}px`,
            width: `calc(100% + ${padding * 2}px)`,
            height: `calc(100% + ${padding * 2}px)`,
          }
        : {
            left: `${box.left * 100}%`,
            top: `${box.top * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
          },
    size: {
      width: Math.max(1, Math.ceil(size.width * box.width + padding * 2)),
      height: Math.max(1, Math.ceil(size.height * box.height + padding * 2)),
    },
  };
}

function requestedSize(container: HTMLElement, options: RenderOptions) {
  return (
    options.shaderBackingSize ?? {
      width: container.clientWidth || Number.parseFloat(container.style.width) || 1,
      height: container.clientHeight || Number.parseFloat(container.style.height) || 1,
    }
  );
}

function reportFailure(mounted: MountedPaint, cause: unknown): void {
  mounted.error = cause instanceof Error ? cause : new Error(String(cause));
  mounted.container.dataset.ografShaderError = mounted.error.message;
  mounted.container.querySelector('[data-ograf-shader-fill-error]')?.remove();
  const message = mounted.container.ownerDocument.createElement('div');
  message.dataset.ografShaderFillError = 'true';
  message.setAttribute('role', 'alert');
  message.textContent = mounted.error.message;
  Object.assign(message.style, {
    position: 'absolute',
    inset: '0',
    padding: '8px',
    background: '#321b26',
    color: '#ffbed2',
    font: '12px monospace',
    overflow: 'auto',
  });
  mounted.container.appendChild(message);
}

function settleWaiters(mounted: MountedPaint): void {
  mounted.waiters = mounted.waiters.filter((waiter) => {
    if (mounted.disposed || mounted.error || waiter.revision <= mounted.completed) {
      waiter.resolve();
      return false;
    }
    return true;
  });
}

function drawRequestedFrame(mounted: MountedPaint): void {
  const slots = [...mounted.slots.values()];
  if (
    mounted.busy ||
    mounted.disposed ||
    mounted.error ||
    slots.length === 0 ||
    slots.some((entry) => !entry.mask)
  )
    return;
  const revision = mounted.requested;
  const elapsedMs = mounted.time;
  const configuration = mounted.configuration;
  mounted.busy = true;
  void (async () => {
    mounted.native.renderAtTime(mounted.baseHost, mounted.baseElement, elapsedMs);
    await mounted.native.ready(mounted.baseHost);
    for (const entry of slots) {
      if (mounted.disposed || mounted.configuration !== configuration) return;
      await entry.mask!.ready;
      const coverage = await entry.mask!.update(elapsedMs);
      if (mounted.disposed || mounted.configuration !== configuration) return;
      if (coverage) setShaderCoverage(entry.host, coverage as TexImageSource);
      renderShaderAtTime(entry.host, elapsedMs);
    }
  })()
    .catch((error: unknown) => {
      if (
        !mounted.disposed &&
        mounted.configuration === configuration &&
        !(error instanceof Error && error.name === 'ShaderContextLostError')
      )
        reportFailure(mounted, error);
    })
    .finally(() => {
      mounted.busy = false;
      mounted.completed = Math.max(mounted.completed, revision);
      settleWaiters(mounted);
      if (mounted.completed < mounted.requested) drawRequestedFrame(mounted);
    });
}

function requestFrame(mounted: MountedPaint, elapsedMs: number): void {
  if (mounted.error) throw mounted.error;
  mounted.time = elapsedMs;
  mounted.requested += 1;
  drawRequestedFrame(mounted);
}

function refreshMasks(mounted: MountedPaint, element: Element): void {
  mounted.configuration += 1;
  for (const entry of mounted.slots.values()) {
    entry.mask?.dispose();
    entry.mask = createShaderPaintMask(mounted.baseHost, element, entry.size, {
      slot: entry.slot,
      padding: mounted.padding,
      refreshTextLayout: () => mounted.native.refreshLayout(mounted.baseHost),
    });
  }
}

function configureBase(mounted: MountedPaint, element: Element): void {
  mounted.baseElement = shaderPaintBaseElement(element);
  mounted.baseIdentity = JSON.stringify(mounted.baseElement);
  mounted.baseHost.style.opacity = ['image', 'image-sequence', 'lottie'].includes(element.type)
    ? '0'
    : '';
  mounted.baseHost.style.zIndex = '1';
  mounted.native.render(mounted.baseHost, mounted.baseElement, {
    ...mounted.options,
    requiresImageAlpha: true,
  });
  refreshMasks(mounted, element);
}

function removeSlot(entry: MountedSlot): void {
  entry.mask?.dispose();
  disposeShader(entry.host);
  entry.host.remove();
}

function reconcileSlots(mounted: MountedPaint, element: Element): boolean {
  const desired = getElementShaderPaints(element);
  const layout = placement(
    element,
    requestedSize(mounted.container, mounted.options),
    mounted.padding,
  );
  let changed = false;
  for (const [slot, entry] of mounted.slots) {
    if (desired.some((candidate) => candidate.slot === slot)) continue;
    removeSlot(entry);
    mounted.slots.delete(slot);
    changed = true;
  }
  for (const { slot, paint } of desired) {
    let entry = mounted.slots.get(slot);
    if (entry && !updateShaderParameters(entry.host, paint, layout.size)) {
      removeSlot(entry);
      mounted.slots.delete(slot);
      entry = undefined;
    }
    if (!entry) {
      const host = mounted.container.ownerDocument.createElement('div');
      host.dataset.ografShaderSlotHost = slot;
      Object.assign(host.style, { position: 'absolute', pointerEvents: 'none' });
      mounted.visualHost.appendChild(host);
      mountShader(host, paint, layout.size, true);
      const canvas = host.querySelector<HTMLCanvasElement>('[data-ograf-shader-canvas]');
      if (!canvas) throw new Error(`Shader ${slot} canvas was not created.`);
      canvas.dataset.ografShaderSlot = slot;
      Object.assign(canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
      });
      entry = { slot, host, paint, size: { width: canvas.width, height: canvas.height } };
      mounted.slots.set(slot, entry);
      changed = true;
    }
    entry.paint = paint;
    Object.assign(entry.host.style, layout.style, {
      zIndex: slot === 'fill' && element.type === 'text' ? '2' : '0',
    });
    mounted.visualHost.appendChild(entry.host);
  }
  if (changed) mounted.configuration += 1;
  return changed;
}

export function mountShaderPaintContent(
  container: HTMLElement,
  element: Element,
  options: RenderOptions,
  native: NativeContent,
): void {
  if (getElementShaderPaints(element).length === 0)
    throw new Error('The element has no shader paint.');
  const visualHost = container.ownerDocument.createElement('div');
  visualHost.dataset.ografShaderPaint = 'true';
  Object.assign(visualHost.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });
  container.appendChild(visualHost);
  const baseHost = container.ownerDocument.createElement('div');
  baseHost.dataset.ografShaderBase = 'true';
  Object.assign(baseHost.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });
  baseHost.style.zIndex = '1';
  visualHost.appendChild(baseHost);
  const mounted: MountedPaint = {
    container,
    visualHost,
    baseHost,
    baseElement: element,
    baseIdentity: '',
    slots: new Map(),
    padding: strokePadding(element, options),
    configuration: 0,
    options,
    native,
    time: 0,
    requested: 0,
    completed: -1,
    busy: false,
    disposed: false,
    waiters: [],
  };
  mountedPaints.set(container, mounted);
  try {
    reconcileSlots(mounted, element);
    configureBase(mounted, element);
    requestFrame(mounted, 0);
  } catch (error) {
    reportFailure(mounted, error);
  }
}

export function updateShaderPaintContent(
  container: HTMLElement,
  element: Element,
  options: RenderOptions,
): boolean {
  const mounted = mountedPaints.get(container);
  if (!mounted || getElementShaderPaints(element).length === 0) return false;
  const padding = strokePadding(element, options);
  const paddingChanged = padding !== mounted.padding;
  mounted.padding = padding;
  mounted.options = options;
  const slotsChanged = reconcileSlots(mounted, element);
  const baseIdentity = JSON.stringify(shaderPaintBaseElement(element));
  if (baseIdentity !== mounted.baseIdentity || slotsChanged || paddingChanged) {
    delete mounted.error;
    delete mounted.container.dataset.ografShaderError;
    mounted.container.querySelector('[data-ograf-shader-fill-error]')?.remove();
    try {
      if (baseIdentity !== mounted.baseIdentity) configureBase(mounted, element);
      else refreshMasks(mounted, element);
    } catch (error) {
      reportFailure(mounted, error);
      throw error;
    }
  }
  requestFrame(mounted, mounted.time);
  return true;
}

export function renderShaderPaintAtTime(container: HTMLElement, elapsedMs: number): boolean {
  const mounted = mountedPaints.get(container);
  if (!mounted) return false;
  requestFrame(mounted, elapsedMs);
  return true;
}

export async function waitForShaderPaintContentReady(root: ParentNode): Promise<void> {
  const entries = [root, ...root.querySelectorAll<HTMLElement>('*')]
    .map((element) => mountedPaints.get(element as HTMLElement))
    .filter((entry): entry is MountedPaint => !!entry);
  await Promise.all(
    entries.map((entry) => {
      if (entry.error || entry.disposed || entry.completed >= entry.requested)
        return Promise.resolve();
      return new Promise<void>((resolve) =>
        entry.waiters.push({ revision: entry.requested, resolve }),
      );
    }),
  );
  const failed = entries.find((entry) => entry.error || entry.disposed);
  if (failed)
    throw (
      failed.error ?? new Error('Shader fill was disposed before its requested frame was ready.')
    );
}

export function shaderPaintBaseHost(container: HTMLElement): HTMLElement | undefined {
  return mountedPaints.get(container)?.baseHost;
}

export function disposeShaderPaintContent(container: HTMLElement): void {
  const mounted = mountedPaints.get(container);
  if (!mounted) return;
  mounted.disposed = true;
  for (const entry of mounted.slots.values()) removeSlot(entry);
  mounted.slots.clear();
  mounted.native.dispose(mounted.baseHost);
  settleWaiters(mounted);
  mountedPaints.delete(container);
}
