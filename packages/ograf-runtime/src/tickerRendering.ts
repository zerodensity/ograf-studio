import {
  getTickerLayout,
  sampleTickerItemAnimation,
  createTickerPlayback,
  updateTickerPlayback,
  sampleTickerPlayback,
  cloneTickerPlayback,
  tickerItemRevision,
  peekTickerPlaybackCandidates,
  resizeTickerPlayback,
  type TickerPlaybackState,
  type TickerPlaybackSample,
  type Element,
  type TickerElement,
  type TickerItem,
} from '@ograf-editor/scene-model';
import type { ElementContentRenderOptions } from './renderElement';
import { applyLayerEffectsFilter } from './effectCompositing';
import { renderPatternAtElapsed } from './patternRendering';

export interface NativeTickerContent {
  render(host: HTMLElement, element: Element, options: ElementContentRenderOptions): void;
  renderAtTime(
    host: HTMLElement,
    element: Element,
    time: number,
    options: { playing?: boolean },
  ): void;
  ready(host: HTMLElement): Promise<void>;
  dispose(host: HTMLElement): void;
  deterministic?(host: HTMLElement, enabled: boolean): void;
}
interface Cell {
  key: string;
  item: TickerItem;
  signature: string;
  wrapper: HTMLElement;
  content: HTMLElement;
  x: number;
  width: number;
  ready: Promise<void>;
  error?: Error;
  deterministic?: boolean;
  retiring: Map<HTMLElement, Element>;
  retiringRevisions: Map<HTMLElement, string>;
  retiringItems: Map<HTMLElement, TickerItem>;
  revision: string;
  textDirection: TickerElement['textDirection'];
  readyRevision?: string;
  lockedRevision?: string;
  displayItem?: TickerItem;
  disposed?: boolean;
}
interface TransportMirror {
  target: HTMLElement;
  animation?: Animation;
}
interface MountedTicker {
  host: HTMLElement;
  viewport: HTMLElement;
  track: HTMLElement;
  background?: HTMLElement;
  backgroundSignature?: string;
  element: TickerElement;
  options: ElementContentRenderOptions;
  native: NativeTickerContent;
  cells: Map<string, Cell>;
  width: number;
  height: number;
  period: number;
  offset: number;
  elapsed: number;
  anchorTime: number;
  anchorTravel: number;
  playing: boolean;
  animation?: Animation;
  animationKey?: string;
  mirrors: Set<TransportMirror>;
  observer?: ResizeObserver;
  images: Map<string, { image: HTMLImageElement; ready: Promise<void> }>;
  imagesNeedPrune: boolean;
  imagePruneQueued: boolean;
  playback?: TickerPlaybackState;
  playbackSample?: TickerPlaybackSample;
  spares: Cell[];
  reservations: Map<string, Cell>;
  origin: number;
  linearStart?: { offset: number; time: number };
  statusSignature?: string;
  instanceId: string;
  deterministic: boolean;
}
const mounted = new WeakMap<HTMLElement, MountedTicker>();
const tracks = new WeakMap<HTMLElement, MountedTicker>();
/** A hard resource bound, including repeated copies of very short feeds. Never silently drop items. */
export const MAX_PREPARED_TICKER_INSTANCES = 2048;
export interface TickerUpdateStatus {
  id: string;
  layerId: string | null;
  name: string;
  policy: 'next-appearance' | 'immediate';
  pendingCount: number;
  updatedCount: number;
  addedCount: number;
  removedCount: number;
  preparingCount: number;
  error?: string;
}
let tickerNumber = 0;
/** Prepared/off-air snapshots keep their queue, but do not publish operator rows. */
export function setTickerOutputActive(host: HTMLElement, active: boolean): void {
  const value = String(active);
  if (host.dataset.ografTickerOutputActive === value) return;
  host.dataset.ografTickerOutputActive = value;
  const EventClass =
    host.ownerDocument.defaultView?.CustomEvent ??
    (typeof CustomEvent === 'undefined' ? undefined : CustomEvent);
  if (EventClass && typeof host.dispatchEvent === 'function')
    host.dispatchEvent(new EventClass('ograf-ticker-status', { bubbles: true, composed: true }));
}
function nextAppearance(state: MountedTicker) {
  return state.element.updatePolicy !== 'immediate';
}
function publishStatus(state: MountedTicker, disposed = false) {
  const identity =
    state.host.closest?.<HTMLElement>(
      '[data-layer-id],[data-transition-layer-id],[data-ograf-layer-id]',
    ) ?? state.host;
  const pending = disposed ? undefined : state.playbackSample?.pending;
  const cells = [...state.cells.values()];
  const error = cells.find((cell) => cell.error)?.error?.message;
  const status: TickerUpdateStatus = {
    id: state.instanceId,
    layerId:
      identity.dataset.layerId ??
      identity.dataset.transitionLayerId ??
      identity.dataset.ografLayerId ??
      null,
    name: identity.dataset.layerName ?? identity.dataset.ografLayerName ?? 'Ticker',
    policy: nextAppearance(state) ? 'next-appearance' : 'immediate',
    pendingCount: pending?.total ?? 0,
    updatedCount: pending?.changed ?? 0,
    addedCount: pending?.inserted ?? 0,
    removedCount: pending?.removed ?? 0,
    preparingCount: disposed
      ? 0
      : cells.filter((cell) => cell.readyRevision !== cell.revision && !cell.error).length,
    ...(error && !disposed ? { error } : {}),
  };
  const serialized = JSON.stringify(status);
  if (state.statusSignature === serialized) return;
  state.statusSignature = serialized;
  state.viewport.dataset.ografTickerStatus = serialized;
  state.viewport.dataset.ografTickerPending = String(status.pendingCount);
  state.viewport.dataset.ografTickerPendingUpdates = String(status.updatedCount);
  state.viewport.dataset.ografTickerPendingInsertions = String(status.addedCount);
  state.viewport.dataset.ografTickerPendingRemovals = String(status.removedCount);
  state.viewport.dataset.ografTickerPreparing = String(status.preparingCount);
  const EventClass =
    state.host.ownerDocument.defaultView?.CustomEvent ??
    (typeof CustomEvent === 'undefined' ? undefined : CustomEvent);
  if (EventClass)
    state.viewport.dispatchEvent(
      new EventClass('ograf-ticker-status', { bubbles: true, composed: true, detail: status }),
    );
}
/** Works across separately bundled OGraf runtimes and passive editor mirrors. */
export function getTickerUpdateStatuses(root: ParentNode): TickerUpdateStatus[] {
  const statuses = new Map<string, TickerUpdateStatus>();
  const visit = (scope: ParentNode) => {
    const owner = (scope as ShadowRoot).host ?? (scope as HTMLElement);
    if (owner.closest?.('[data-ograf-ticker-output-active="false"]')) return;
    const own = (scope as HTMLElement).dataset?.ografTickerStatus;
    const read = (node: HTMLElement, value?: string) => {
      if (!value) return;
      if (node.closest?.('[data-ograf-ticker-output-active="false"]')) return;
      try {
        const status = JSON.parse(value) as TickerUpdateStatus;
        if (!status.id) return;
        const snapshot = node.closest?.<HTMLElement>('[data-ograf-transition-snapshot]');
        const key =
          snapshot && status.layerId
            ? JSON.stringify([
                snapshot.dataset.ografTransitionTemplate,
                snapshot.dataset.ografTransitionState,
                status.layerId,
              ])
            : status.id;
        // Incoming copies follow outgoing copies in the surface. During an update
        // crossfade they represent one logical ticker queue to the operator.
        statuses.set(key, status);
      } catch {
        /* Unrelated DOM does not define a ticker status. */
      }
    };
    read(scope as HTMLElement, own);
    for (const node of scope.querySelectorAll<HTMLElement>('*')) {
      if (node.closest?.('[data-ograf-ticker-output-active="false"]')) continue;
      read(node, node.dataset?.ografTickerStatus);
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  };
  visit(root);
  return [...statuses.values()];
}

function dimensions(host: HTMLElement) {
  const computed = host.ownerDocument.defaultView?.getComputedStyle(host);
  // Capture creates its layer tree before attaching it. Preserve explicit pixel geometry
  // during that cold layout so the first ticker window is populated at its authored size.
  // Percentages/calc still require actual layout and must not be interpreted as pixels.
  const inlinePixels = (value: string) =>
    /^(?:\d+\.?\d*|\.\d+)px$/.test(value) ? Number.parseFloat(value) : 0;
  return {
    width: Math.max(
      0,
      Number.parseFloat(computed?.width ?? '') ||
        host.clientWidth ||
        inlinePixels(host.style.width),
    ),
    height: Math.max(
      1,
      Number.parseFloat(computed?.height ?? '') ||
        host.clientHeight ||
        inlinePixels(host.style.height) ||
        48,
    ),
  };
}
function periodOf(element: TickerElement) {
  return element.items.reduce((sum, item) => sum + item.width + element.gap, 0);
}
function modulo(value: number, period: number) {
  return period > 0 ? ((value % period) + period) % period : 0;
}
function travelAt(state: MountedTicker, time: number) {
  return (
    state.anchorTravel + ((time - state.anchorTime) * state.element.speedPixelsPerSecond) / 1000
  );
}
function offsetFor(state: MountedTicker, travel: number) {
  const phase = modulo(travel, state.period);
  return state.element.direction === 'right' ? phase - state.period : -phase;
}
function setMask(state: MountedTicker) {
  const { element, width, viewport } = state;
  let left = element.direction === 'right' ? element.entryFade : element.exitFade;
  let right = element.direction === 'right' ? element.exitFade : element.entryFade;
  const scale = Math.min(1, width / Math.max(1, left + right));
  left *= scale;
  right *= scale;
  const softness = element.fadeSoftness;
  const ramp = (start: number, end: number, reversed: boolean) =>
    Array.from({ length: 9 }, (_, index) => {
      const t = index / 8;
      const alpha = t * (1 - softness) + t * t * (3 - 2 * t) * softness;
      return `rgba(0,0,0,${reversed ? 1 - alpha : alpha}) ${start + (end - start) * t}px`;
    });
  const stops = [
    ...(left > 0 ? ramp(0, left, false) : ['black 0px']),
    ...(right > 0 ? ramp(width - right, width, true) : [`black ${width}px`]),
  ];
  const mask = left || right ? `linear-gradient(to right,${stops.join(',')})` : 'none';
  viewport.style.maskImage = mask;
  viewport.style.webkitMaskImage = mask;
  viewport.style.maskMode = 'alpha';
}
function stopTransport(state: MountedTicker) {
  state.animation?.cancel();
  delete state.animation;
  delete state.animationKey;
  for (const mirror of state.mirrors) {
    mirror.animation?.cancel();
    delete mirror.animation;
    mirror.target.style.transform = state.track.style.transform;
  }
}
function keyframes(state: MountedTicker) {
  if (nextAppearance(state)) {
    const from = state.linearStart?.offset ?? state.offset;
    const distance = state.element.direction === 'right' ? 8192 : -8192;
    return [
      { transform: `translate3d(${from}px,0,0)` },
      { transform: `translate3d(${from + distance}px,0,0)` },
    ];
  }
  return state.element.direction === 'right'
    ? [{ transform: `translate3d(${-state.period}px,0,0)` }, { transform: 'translate3d(0px,0,0)' }]
    : [{ transform: 'translate3d(0px,0,0)' }, { transform: `translate3d(${-state.period}px,0,0)` }];
}
function transportTiming(state: MountedTicker) {
  return nextAppearance(state)
    ? {
        duration: (8192 / state.element.speedPixelsPerSecond) * 1000,
        iterations: 1,
        easing: 'linear',
        fill: 'forwards' as const,
      }
    : {
        duration: (state.period / state.element.speedPixelsPerSecond) * 1000,
        iterations: Infinity,
        easing: 'linear',
      };
}
function syncMirror(state: MountedTicker, mirror: TransportMirror) {
  mirror.animation?.cancel();
  delete mirror.animation;
  mirror.target.style.transform = state.track.style.transform;
  if (!state.animation || typeof mirror.target.animate !== 'function') return;
  mirror.animation = mirror.target.animate(keyframes(state), transportTiming(state));
  mirror.animation.currentTime = state.animation.currentTime;
  if (state.animation.playState === 'paused') mirror.animation.pause();
}
/** Mirror compositor travel without introducing another playback clock or reading pixels. */
export function mirrorTickerTransport(
  sourceTrack: HTMLElement,
  targetTrack: HTMLElement,
): () => void {
  const state = tracks.get(sourceTrack);
  if (!state) return () => {};
  const mirror: TransportMirror = { target: targetTrack };
  state.mirrors.add(mirror);
  syncMirror(state, mirror);
  return () => {
    mirror.animation?.cancel();
    state.mirrors.delete(mirror);
  };
}
function transport(state: MountedTicker, time: number, playing: boolean) {
  const travel = travelAt(state, time);
  const translation = state.playbackSample?.translation ?? 0;
  const origin = Math.floor(translation / 4096) * 4096;
  state.origin = nextAppearance(state) ? origin : 0;
  state.offset = nextAppearance(state) ? translation - origin : offsetFor(state, travel);
  const animationKey = nextAppearance(state)
    ? `queue/${state.origin}/${state.element.speedPixelsPerSecond}/${state.element.direction}`
    : `${state.period}/${state.element.speedPixelsPerSecond}/${state.element.direction}`;
  const compositor =
    playing &&
    (state.period > 0 || nextAppearance(state)) &&
    state.element.speedPixelsPerSecond > 0 &&
    typeof state.track.animate === 'function';
  // Inline transform remains the exact sampled pose for screenshots, unsupported engines and seeks.
  // The compositor owns live movement between samples; it is never re-created or rewound per frame.
  if (!compositor) {
    stopTransport(state);
    state.track.style.transform = `translate3d(${state.offset}px,0,0)`;
    for (const mirror of state.mirrors) mirror.target.style.transform = state.track.style.transform;
  } else if (!state.animation || state.animationKey !== animationKey) {
    stopTransport(state);
    state.track.style.transform = `translate3d(${state.offset}px,0,0)`;
    if (nextAppearance(state)) state.linearStart = { offset: state.offset, time };
    state.animation = state.track.animate(keyframes(state), transportTiming(state));
    state.animation.currentTime = nextAppearance(state)
      ? 0
      : (modulo(travel, state.period) / state.element.speedPixelsPerSecond) * 1000;
    state.animationKey = animationKey;
    for (const mirror of state.mirrors) syncMirror(state, mirror);
  }
  // Publish telemetry only on explicit samples. No layout measurement occurs in this path.
  state.viewport.dataset.ografTickerOffset = String(state.offset);
  state.viewport.dataset.ografTickerPeriod = String(state.period);
  state.viewport.dataset.ografTickerTime = String(time);
}
function itemSignature(item: TickerItem) {
  return JSON.stringify([item.element, item.effects, item.width, item.height]);
}
function prepareImage(state: MountedTicker, src: string): Promise<void> {
  const cached = state.images.get(src);
  if (cached) return cached.ready;
  const image = state.host.ownerDocument.createElement('img');
  image.src = src;
  const ready = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
  state.images.set(src, { image, ready });
  void ready.catch(() => undefined);
  return ready;
}
function pruneSequenceImages(state: MountedTicker) {
  if (!state.imagesNeedPrune) return;
  state.imagesNeedPrune = false;
  const retained = new Set<string>();
  const retain = (item?: TickerItem) => {
    if (item?.element.type === 'image-sequence')
      for (const source of item.element.frames) retained.add(source);
  };
  for (const item of state.element.items) retain(item);
  for (const cell of [...state.cells.values(), ...state.spares]) {
    if (cell.disposed) continue;
    retain(cell.item);
    retain(cell.displayItem);
    for (const item of cell.retiringItems.values()) retain(item);
  }
  for (const pass of state.playback?.core.passes ?? []) retain(pass.item);
  for (const source of state.images.keys()) if (!retained.has(source)) state.images.delete(source);
}
function requestImageCachePrune(state: MountedTicker) {
  state.imagesNeedPrune = true;
  if (state.imagePruneQueued) return;
  state.imagePruneQueued = true;
  queueMicrotask(() => {
    state.imagePruneQueued = false;
    if (mounted.get(state.host) === state) pruneSequenceImages(state);
  });
}
async function prepareSequence(state: MountedTicker, item: TickerItem, active: () => boolean) {
  if (item.element.type !== 'image-sequence') return;
  // Share decoded frames between repeat copies; bound concurrent decoding instead of creating
  // a burst of image decoders on Take. Strong references retain frames for the mounted feed.
  const frames = item.element.frames;
  for (let index = 0; index < frames.length; index += 4) {
    if (!active()) return;
    await Promise.all(frames.slice(index, index + 4).map((src) => prepareImage(state, src)));
  }
}
function prepareCell(
  state: MountedTicker,
  item: TickerItem,
  key: string,
  textDirection = state.element.textDirection,
): Cell {
  const owner = state.host.ownerDocument;
  const wrapper = owner.createElement('div');
  wrapper.dataset.ografTickerItem = item.id;
  Object.assign(wrapper.style, {
    position: 'absolute',
    top: '0px',
    pointerEvents: 'none',
    visibility: '',
  });
  const content = owner.createElement('div');
  Object.assign(content.style, {
    width: '100%',
    height: '100%',
    position: 'relative',
    visibility: '',
  });
  wrapper.appendChild(content);
  state.track.appendChild(wrapper);
  const cell: Cell = {
    key,
    item,
    signature: '',
    wrapper,
    content,
    x: 0,
    width: item.width,
    ready: Promise.resolve(),
    retiring: new Map(),
    retiringRevisions: new Map(),
    retiringItems: new Map(),
    revision: '',
    textDirection,
  };
  updateCell(state, cell, item, textDirection);
  return cell;
}
function clearRetiring(state: MountedTicker, cell: Cell) {
  const released = cell.retiringItems.size > 0;
  for (const host of cell.retiring.keys()) {
    state.native.dispose(host);
    host.remove();
  }
  cell.retiring.clear();
  cell.retiringRevisions.clear();
  cell.retiringItems.clear();
  if (released) requestImageCachePrune(state);
}
function disposeCell(state: MountedTicker, cell: Cell) {
  if (cell.disposed) return;
  cell.disposed = true;
  requestImageCachePrune(state);
  state.native.dispose(cell.content);
  clearRetiring(state, cell);
  cell.wrapper.remove();
}
function unlockCell(state: MountedTicker, cell: Cell) {
  delete cell.lockedRevision;
  delete cell.displayItem;
  if (cell.readyRevision === cell.revision) {
    cell.content.style.opacity = '1';
    clearRetiring(state, cell);
  }
}
function updateCell(
  state: MountedTicker,
  cell: Cell,
  item: TickerItem,
  textDirection = state.element.textDirection,
) {
  const oldRevision = cell.revision;
  const oldItem = cell.item;
  cell.item = item;
  cell.textDirection = textDirection;
  cell.width = item.width;
  const height = item.height ?? state.height;
  cell.wrapper.style.width = `${item.width}px`;
  cell.wrapper.style.height = `${height}px`;
  cell.wrapper.style.top = `${(state.height - height) / 2}px`;
  const signature = itemSignature(item) + textDirection + height;
  if (cell.signature === signature) return;
  if (cell.signature) {
    // Prepare changed content beside the old pixels. Shader masks, fonts and decoders may
    // finish asynchronously; a data update must not expose an empty item while they prepare.
    const previous = cell.content;
    const rendered = previous.dataset.ografRenderedElement;
    if (previous.style.opacity === '0') {
      // Superseded preparation is disposable; retain just the last displayed version.
      state.native.dispose(previous);
      previous.remove();
    } else {
      cell.retiring.set(previous, rendered ? (JSON.parse(rendered) as Element) : item.element);
      cell.retiringRevisions.set(previous, oldRevision);
      cell.retiringItems.set(previous, oldItem);
    }
    const replacement = state.host.ownerDocument.createElement('div');
    Object.assign(replacement.style, {
      position: 'absolute',
      inset: '0px',
      width: '100%',
      height: '100%',
      visibility: '',
    });
    replacement.dir = textDirection;
    replacement.style.unicodeBidi = 'plaintext';
    cell.wrapper.appendChild(replacement);
    cell.content = replacement;
  }
  cell.signature = signature;
  cell.content.dir = textDirection;
  cell.content.style.unicodeBidi = 'plaintext';
  cell.content.style.width = `${item.width}px`;
  cell.content.style.height = `${height}px`;
  cell.revision = tickerItemRevision(item, textDirection);
  delete cell.readyRevision;
  const options = {
    ...state.options,
    lottieBackingSize: { width: item.width, height },
    shaderBackingSize: { width: item.width, height },
  };
  const content =
    item.element.type === 'text' && textDirection !== 'auto'
      ? { ...item.element, direction: textDirection }
      : item.element;
  state.native.render(cell.content, content, options);
  delete cell.deterministic;
  if (item.effects) applyLayerEffectsFilter(cell.content, item.effects, state.elapsed);
  delete cell.error;
  // Opacity is not inherited by glyph/image masks. Inherited visibility:hidden would bake an
  // empty alpha mask while a shader paint prepares, leaving text invisible after readiness.
  cell.content.style.opacity = '0';
  const expectedContent = cell.content;
  const expectedRevision = cell.revision;
  const active = () =>
    !cell.disposed && cell.content === expectedContent && cell.revision === expectedRevision;
  const ready = Promise.all([
    state.native.ready(cell.content),
    prepareSequence(state, item, active),
  ])
    .then(async () => {
      await Promise.all(
        [...cell.content.querySelectorAll('img')].map(async (image) => {
          if (image.complete && image.naturalWidth > 0) return;
          if (typeof image.decode === 'function') await image.decode();
        }),
      );
    })
    .then(() => {
      if (cell.ready === ready && !cell.disposed) {
        cell.readyRevision = cell.revision;
        if (!cell.lockedRevision || cell.lockedRevision === cell.revision) {
          cell.content.style.opacity = '1';
          clearRetiring(state, cell);
        }
        publishStatus(state);
      }
    });
  cell.ready = ready;
  // A failure must be reported by ready(), without an unhandled rejection during realtime prefetch.
  void ready.catch((error: unknown) => {
    if (cell.ready === ready && !cell.disposed) {
      cell.error = error instanceof Error ? error : new Error(String(error));
      publishStatus(state);
    }
  });
}
function readyVariant(cell: Cell, revision: string): boolean {
  return (
    !cell.disposed &&
    (cell.readyRevision === revision || [...cell.retiringRevisions.values()].includes(revision))
  );
}
function spareCell(
  state: MountedTicker,
  key: string,
  id: string,
  revision: string,
): Cell | undefined {
  let reserved = state.reservations.get(key);
  if (reserved && readyVariant(reserved, revision)) return reserved;
  const used = new Set(state.reservations.values());
  reserved = state.spares.find(
    (cell) => !used.has(cell) && cell.item.id === id && readyVariant(cell, revision),
  );
  if (reserved) state.reservations.set(key, reserved);
  return reserved;
}
function retireUnused(state: MountedTicker, wanted: Set<string>) {
  for (const key of state.reservations.keys()) if (!wanted.has(key)) state.reservations.delete(key);
  for (const [key, cell] of state.cells)
    if (!wanted.has(key)) {
      state.cells.delete(key);
      cell.wrapper.remove();
      state.spares.push(cell);
    }
  const limit = Math.min(32, Math.max(4, state.element.items.length * 2));
  while (
    state.spares.length > limit ||
    state.spares.length + state.cells.size > MAX_PREPARED_TICKER_INSTANCES
  ) {
    const cell = state.spares.shift();
    if (!cell) break;
    for (const [key, reserved] of state.reservations)
      if (reserved === cell) state.reservations.delete(key);
    disposeCell(state, cell);
  }
}
function obtainCell(
  state: MountedTicker,
  key: string,
  item: TickerItem,
  textDirection: TickerElement['textDirection'],
) {
  let cell = state.cells.get(key);
  if (cell) return cell;
  cell = state.reservations.get(key) ?? state.spares.find((entry) => entry.item.id === item.id);
  state.reservations.delete(key);
  if (cell) {
    state.spares.splice(state.spares.indexOf(cell), 1);
    cell.key = key;
    unlockCell(state, cell);
    state.track.appendChild(cell.wrapper);
  } else cell = prepareCell(state, item, key, textDirection);
  state.cells.set(key, cell);
  return cell;
}
function prepareNextWindow(
  state: MountedTicker,
  time: number,
  playing: boolean,
  initialize = false,
) {
  state.playback ??= createTickerPlayback(state.element, state.width, 0);
  const peek = peekTickerPlaybackCandidates(state.playback, time);
  retireUnused(state, new Set(peek.map((candidate) => candidate.key)));
  for (const candidate of peek) {
    const cell = obtainCell(state, candidate.key, candidate.item, candidate.textDirection);
    if (
      !cell.lockedRevision &&
      (cell.item !== candidate.item ||
        cell.textDirection !== candidate.textDirection ||
        cell.wrapper.style.height !== `${candidate.item.height ?? state.height}px`)
    )
      updateCell(state, cell, candidate.item, candidate.textDirection);
  }
  const isReady = (item: TickerItem, revision: string, key: string) => {
    const cell = state.cells.get(key);
    return (cell && readyVariant(cell, revision)) || !!spareCell(state, key, item.id, revision);
  };
  const sample = sampleTickerPlayback(
    state.playback,
    time,
    initialize ||
      state.deterministic ||
      (state.options.tickerUpdateContext === 'authoring' && !playing)
      ? {}
      : { isReady },
  );
  state.playbackSample = sample;
  state.period = sample.period;
  state.origin = Math.floor(sample.translation / 4096) * 4096;
  state.offset = sample.translation - state.origin;
  retireUnused(state, new Set(sample.instances.map((instance) => instance.key)));
  for (const instance of sample.instances) {
    const cell = obtainCell(state, instance.key, instance.item, instance.textDirection);
    // Offline captures inspect native canvases in DOM order. Pool reuse after
    // a backward seek must not change that order; realtime never reparents here.
    if (state.deterministic) state.track.appendChild(cell.wrapper);
    if (instance.admitted) {
      cell.lockedRevision = instance.revision;
      cell.displayItem = instance.item;
      if (
        cell.revision !== instance.revision &&
        (state.deterministic || ![...cell.retiringRevisions.values()].includes(instance.revision))
      )
        updateCell(state, cell, instance.item, instance.textDirection);
      cell.content.style.opacity = cell.readyRevision === instance.revision ? '1' : '0';
      if (state.deterministic && cell.readyRevision === instance.revision)
        clearRetiring(state, cell);
      for (const [host, revision] of cell.retiringRevisions)
        host.style.opacity = revision === instance.revision ? '1' : '0';
    } else {
      unlockCell(state, cell);
      if (
        cell.revision !== instance.revision ||
        cell.wrapper.style.height !== `${instance.item.height ?? state.height}px`
      )
        updateCell(state, cell, instance.item, instance.textDirection);
    }
    const left = instance.worldX + state.origin;
    if (cell.wrapper.style.left !== `${left}px`) cell.wrapper.style.left = `${left}px`;
    cell.x = left;
    cell.width = instance.width;
    cell.wrapper.style.width = `${instance.width}px`;
    cell.wrapper.style.height = `${instance.item.height ?? state.height}px`;
    cell.wrapper.style.top = `${(state.height - (instance.item.height ?? state.height)) / 2}px`;
    cell.wrapper.dataset.ografTickerRevision = instance.revision;
    cell.wrapper.dataset.ografTickerItem = instance.item.id;
    cell.wrapper.dataset.ografTickerPass = instance.key;
    cell.wrapper.dataset.ografTickerCycle = instance.key;
    cell.wrapper.dataset.ografTickerAdmitted = String(instance.admitted);
    const deferred = !state.deterministic && sample.pending.total > 0;
    cell.wrapper.dataset.ografTickerDeferred = String(deferred && !instance.admitted);
    cell.content.dataset.ografTickerDeferred = String(
      deferred && !!cell.lockedRevision && cell.lockedRevision !== cell.revision,
    );
  }
  pruneSequenceImages(state);
  publishStatus(state);
}
function prepareWindow(state: MountedTicker) {
  const layout = getTickerLayout(state.element, state.height);
  const overscan = Math.max(state.width * 0.5, state.element.speedPixelsPerSecond * 2, 64);
  // Keep both seam windows prepared as well as the approaching content. A compositor repeat can
  // cross its seam before the main thread's next callback, and must always find decoded content.
  const windows = [
    [-state.offset - overscan, -state.offset + state.width + overscan],
    [-overscan, state.width + overscan],
    [state.period - overscan, state.period + state.width + overscan],
  ];
  const wanted = new Map<string, { item: TickerItem; x: number; cycle: number }>();
  if (state.period > 0)
    for (const [start, end] of windows) {
      const first = Math.max(0, Math.floor(start! / state.period));
      const last = Math.ceil(end! / state.period);
      for (let cycle = first; cycle <= last; cycle++)
        for (let index = 0; index < layout.length; index++) {
          const entry = layout[index]!;
          const x = cycle * state.period + entry.x;
          if (x + entry.width < start! || x > end!) continue;
          wanted.set(`${entry.id}@${cycle}`, { item: state.element.items[index]!, x, cycle });
          if (wanted.size > MAX_PREPARED_TICKER_INSTANCES)
            throw new Error(
              `Ticker needs more than ${MAX_PREPARED_TICKER_INSTANCES} prepared items. Increase item widths or the gap.`,
            );
        }
    }
  for (const [key, cell] of state.cells)
    if (!wanted.has(key)) {
      disposeCell(state, cell);
      state.cells.delete(key);
    }
  for (const [key, { item, x, cycle }] of wanted) {
    let cell = state.cells.get(key);
    if (!cell) {
      cell = prepareCell(state, item, key);
      state.cells.set(key, cell);
    } else if (
      cell.item !== item ||
      cell.wrapper.style.height !== `${item.height ?? state.height}px` ||
      cell.content.dir !== state.element.textDirection
    )
      updateCell(state, cell, item);
    if (cell.wrapper.style.left !== `${x}px`) cell.wrapper.style.left = `${x}px`;
    cell.x = x;
    if (cell.wrapper.dataset.ografTickerCycle !== String(cycle))
      cell.wrapper.dataset.ografTickerCycle = String(cycle);
  }
  pruneSequenceImages(state);
}
function refresh(state: MountedTicker) {
  const size = dimensions(state.host);
  if (state.playback && size.width !== state.width)
    resizeTickerPlayback(state.playback, size.width, state.elapsed);
  state.width = size.width;
  state.height = size.height;
  state.period = periodOf(state.element);
  setMask(state);
  if (nextAppearance(state))
    prepareNextWindow(state, state.elapsed, state.playing, !state.playbackSample);
  transport(state, state.elapsed, state.playing);
  if (!nextAppearance(state)) prepareWindow(state);
  publishStatus(state);
}
function updateBackground(state: MountedTicker) {
  const signature = JSON.stringify(state.element.background);
  if (state.backgroundSignature === signature) return;
  if (state.background) {
    state.native.dispose(state.background);
    state.background.remove();
  }
  delete state.background;
  state.backgroundSignature = signature;
  if (!state.element.background) return;
  const host = state.host.ownerDocument.createElement('div');
  host.dataset.ografTickerBackground = 'true';
  Object.assign(host.style, { position: 'absolute', inset: '0px', pointerEvents: 'none' });
  state.host.insertBefore(host, state.viewport);
  state.background = host;
  state.native.render(
    host,
    {
      type: 'rectangle',
      fill: state.element.background,
      strokeColor: '#000000',
      strokeWidth: 0,
      borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
    },
    state.options,
  );
}
export function mountTicker(
  host: HTMLElement,
  element: TickerElement,
  options: ElementContentRenderOptions,
  native: NativeTickerContent,
): void {
  disposeTicker(host);
  const viewport = host.ownerDocument.createElement('div');
  viewport.dataset.ografTicker = 'true';
  Object.assign(viewport.style, {
    position: 'absolute',
    inset: '0px',
    overflow: 'hidden',
    isolation: 'isolate',
  });
  const track = host.ownerDocument.createElement('div');
  track.dataset.ografTickerTrack = 'true';
  Object.assign(track.style, {
    position: 'absolute',
    width: '100%',
    height: '100%',
    top: '0px',
    left: '0px',
    willChange: 'transform',
    transformOrigin: '0 0',
  });
  viewport.appendChild(track);
  host.appendChild(viewport);
  const state: MountedTicker = {
    host,
    viewport,
    track,
    element,
    options,
    native,
    cells: new Map(),
    width: 0,
    height: 48,
    period: 0,
    offset: 0,
    elapsed: 0,
    anchorTime: 0,
    anchorTravel: 0,
    playing: false,
    mirrors: new Set(),
    images: new Map(),
    imagesNeedPrune: true,
    imagePruneQueued: false,
    spares: [],
    reservations: new Map(),
    origin: 0,
    instanceId: `ticker-${Date.now()}-${++tickerNumber}-${Math.random().toString(36).slice(2, 8)}`,
    deterministic: false,
  };
  mounted.set(host, state);
  tracks.set(track, state);
  updateBackground(state);
  refresh(state);
  if (typeof ResizeObserver !== 'undefined') {
    state.observer = new ResizeObserver(() => {
      if (mounted.get(host) === state) refresh(state);
    });
    state.observer.observe(host);
  }
}
export function updateTicker(
  host: HTMLElement,
  element: TickerElement,
  options: ElementContentRenderOptions,
): boolean {
  const state = mounted.get(host);
  if (!state) return false;
  const old = state.element;
  if (JSON.stringify(old) === JSON.stringify(element)) {
    state.options = options;
    refresh(state);
    return true;
  }
  state.imagesNeedPrune = true;
  const time = Math.max(0, options.timestampMs ?? state.elapsed);
  if (nextAppearance(state) || element.updatePolicy !== 'immediate') {
    const before = state.playbackSample;
    if (!state.playback) state.playback = createTickerPlayback(old, state.width, time);
    if (
      options.tickerUpdateContext === 'authoring' &&
      (!state.playing || options.tickerAuthoringPaused)
    ) {
      state.playback = createTickerPlayback(element, state.width, time);
      delete state.playbackSample;
      for (const cell of state.cells.values()) unlockCell(state, cell);
    } else updateTickerPlayback(state.playback, element, state.width, time);
    state.elapsed = time;
    state.element = element;
    state.options = options;
    updateBackground(state);
    if (
      old.speedPixelsPerSecond !== element.speedPixelsPerSecond ||
      old.direction !== element.direction ||
      old.updatePolicy !== element.updatePolicy
    )
      stopTransport(state);
    if (nextAppearance(state)) {
      refresh(state);
      return true;
    }
    // Switching to immediate publishes the current desired feed at the current travel pose.
    state.anchorTime = time;
    state.anchorTravel = before?.travel ?? 0;
    delete state.playback;
    delete state.playbackSample;
    for (const cell of state.cells.values()) disposeCell(state, cell);
    state.cells.clear();
    for (const cell of state.spares) disposeCell(state, cell);
    state.spares = [];
    state.reservations.clear();
    refresh(state);
    return true;
  }
  // Keep the visible source item anchored when feed geometry changes, and keep phase when speed
  // or data changes. Offline seeks deliberately ignore this live anchor and use absolute time.
  let travel = travelAt(state, state.elapsed);
  if (
    state.playing &&
    state.period > 0 &&
    (old.gap !== element.gap ||
      JSON.stringify(old.items.map((i) => [i.id, i.width])) !==
        JSON.stringify(element.items.map((i) => [i.id, i.width])))
  ) {
    const oldLayout = getTickerLayout(old, state.height);
    const center = modulo(-state.offset + state.width / 2, state.period);
    const entry = oldLayout.find((i) => i.x <= center && i.x + i.width + old.gap > center);
    const next = getTickerLayout(element, state.height).find((i) => i.id === entry?.id);
    if (entry && next) {
      const cycle = Math.floor((-state.offset + state.width / 2) / state.period);
      const desiredOffset = state.offset + cycle * state.period + entry.x - next.x;
      travel = element.direction === 'right' ? periodOf(element) + desiredOffset : -desiredOffset;
    }
  }
  state.anchorTime = state.elapsed;
  state.anchorTravel = travel;
  state.element = element;
  state.options = options;
  updateBackground(state);
  if (
    old.speedPixelsPerSecond !== element.speedPixelsPerSecond ||
    old.direction !== element.direction ||
    old.gap !== element.gap ||
    JSON.stringify(old.items.map((i) => [i.id, i.width])) !==
      JSON.stringify(element.items.map((i) => [i.id, i.width]))
  )
    stopTransport(state);
  refresh(state);
  return true;
}
export function renderTickerAtTime(
  host: HTMLElement,
  _element: TickerElement,
  elapsedMs: number,
  options: { playing?: boolean } = {},
): void {
  const state = mounted.get(host);
  if (!state) return;
  const time = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const playing = options.playing === true;
  // Live compositor travel survives a delayed main-thread sample. Explicit paused/backward
  // samples are seeks; a forward RAF gap must not restart an otherwise continuous animation.
  if (!playing || time < state.elapsed) stopTransport(state);
  // A changed stopped timestamp is an explicit scrub/offline seek. A pause at the current
  // timestamp retains the live data/speed anchor, so resuming cannot jump to a new phase.
  if (!playing && Math.abs(time - state.elapsed) > 0.001) {
    state.anchorTime = 0;
    state.anchorTravel = 0;
  }
  state.elapsed = time;
  state.playing = playing;
  if (nextAppearance(state)) prepareNextWindow(state, time, playing);
  transport(state, time, playing);
  if (!nextAppearance(state)) prepareWindow(state);
  const frameRate = Math.max(1, state.options.frameRate ?? 25);
  for (const cell of state.cells.values()) {
    const visible = cell.x + cell.width + state.offset >= 0 && cell.x + state.offset <= state.width;
    if (playing && !visible) continue;
    if (cell.deterministic !== !playing) {
      state.native.deterministic?.(cell.content, !playing);
      cell.deterministic = !playing;
    }
    const pose = sampleTickerItemAnimation(cell.displayItem ?? cell.item, time);
    if (cell.wrapper.style.opacity !== String(pose.opacity))
      cell.wrapper.style.opacity = String(pose.opacity);
    const transform = `translateY(${pose.translateY}px) scale(${pose.scale})`;
    if (cell.content.style.transform !== transform) cell.content.style.transform = transform;
    state.native.renderAtTime(cell.content, cell.item.element, time, { playing });
    for (const [host, element] of cell.retiring) {
      const item = cell.retiringItems.get(host);
      if (item) {
        const oldPose = sampleTickerItemAnimation(item, time);
        host.style.transform = `translateY(${oldPose.translateY}px) scale(${oldPose.scale})`;
        if (item.effects) applyLayerEffectsFilter(host, item.effects, time);
      }
      state.native.renderAtTime(host, element, time, { playing });
    }
    if (cell.item.element.type === 'pattern')
      renderPatternAtElapsed(cell.content, (time * frameRate) / 1000);
    if (cell.item.effects) applyLayerEffectsFilter(cell.content, cell.item.effects, time);
  }
  if (state.background && state.element.background)
    state.native.renderAtTime(
      state.background,
      {
        type: 'rectangle',
        fill: state.element.background,
        borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
        strokeColor: '#000000',
        strokeWidth: 0,
      },
      time,
      { playing },
    );
}
function tickersWithin(root: ParentNode): MountedTicker[] {
  const result: MountedTicker[] = [];
  const own = mounted.get(root as HTMLElement);
  if (own) result.push(own);
  for (const viewport of root.querySelectorAll<HTMLElement>('[data-ograf-ticker="true"]')) {
    const entry = mounted.get(viewport.parentElement!);
    if (entry && entry !== own) result.push(entry);
  }
  return result;
}
export async function waitForTickersReady(root: ParentNode): Promise<void> {
  for (const state of tickersWithin(root)) {
    await state.host.ownerDocument.fonts?.ready;
    // Resize and rapid feed updates can retire preparation while a caller is awaiting it.
    // Only the current generation may fail the readiness gate; await its replacement instead.
    for (;;) {
      const eligible = [...state.cells.values()].filter(
        (cell) =>
          !nextAppearance(state) ||
          state.deterministic ||
          !state.playbackSample?.pending.total ||
          cell.lockedRevision === cell.revision,
      );
      const requests = eligible.map((cell) => ({ cell, ready: cell.ready }));
      const results = await Promise.allSettled(requests.map((request) => request.ready));
      if (mounted.get(state.host) !== state) break;
      let stable = true;
      for (const [index, request] of requests.entries()) {
        const current =
          state.cells.get(request.cell.key) === request.cell &&
          request.cell.ready === request.ready;
        if (!current) {
          stable = false;
          continue;
        }
        const result = results[index]!;
        if (result.status === 'rejected') throw result.reason;
      }
      if (stable) break;
    }
    if (state.background) await state.native.ready(state.background);
  }
}
export function pauseTickerAnimations(root: ParentNode): void {
  for (const state of tickersWithin(root)) {
    state.track.style.transform = `translate3d(${state.offset}px,0,0)`;
    stopTransport(state);
    state.playing = false;
  }
}
export function disposeTicker(host: HTMLElement): void {
  const state = mounted.get(host);
  if (!state) return;
  publishStatus(state, true);
  mounted.delete(host);
  tracks.delete(state.track);
  state.observer?.disconnect();
  stopTransport(state);
  for (const cell of state.cells.values()) disposeCell(state, cell);
  for (const cell of state.spares) disposeCell(state, cell);
  if (state.background) {
    state.native.dispose(state.background);
    state.background.remove();
  }
  state.viewport.remove();
  state.mirrors.clear();
  state.images.clear();
}
export interface TickerPlaybackUpdate {
  timestamp: number;
  element: TickerElement;
}
/** Offline schedule reconstruction replays visual revisions without delaying data or Rules. */
export function renderTickerHistory(
  host: HTMLElement,
  initial: TickerElement,
  updates: readonly TickerPlaybackUpdate[],
  timestamp: number,
) {
  const state = mounted.get(host);
  if (!state || !nextAppearance(state)) return;
  state.playback = createTickerPlayback(initial, state.width, 0);
  for (const update of updates)
    if (update.timestamp <= timestamp)
      updateTickerPlayback(state.playback, update.element, state.width, update.timestamp);
  state.elapsed = timestamp;
  state.element =
    [...updates].reverse().find((update) => update.timestamp <= timestamp)?.element ?? initial;
  for (const cell of state.cells.values()) delete cell.lockedRevision;
  prepareNextWindow(state, timestamp, false);
  transport(state, timestamp, false);
  // Rebuilt/recycled native content must settle at this seek's time, too.
  renderTickerAtTime(host, state.element, timestamp, { playing: false });
}
/** Carry per-pass visual revisions into a coordinated same-instance data update. */
export function inheritTickerPlayback(
  previousHost: HTMLElement,
  nextHost: HTMLElement,
  timestampMs?: number,
): boolean {
  const previous = mounted.get(previousHost);
  const next = mounted.get(nextHost);
  if (!previous?.playback || !next || !nextAppearance(next)) return false;
  const desired = next.element;
  next.playback = cloneTickerPlayback(previous.playback);
  delete next.playback.readiness;
  const time = timestampMs ?? previous.elapsed;
  updateTickerPlayback(next.playback, desired, next.width, time);
  next.elapsed = time;
  for (const cell of next.cells.values()) delete cell.lockedRevision;
  prepareNextWindow(next, time, previous.playing);
  transport(next, time, false);
  return true;
}
export function setTickerDeterministicRendering(root: ParentNode, enabled: boolean) {
  for (const state of tickersWithin(root)) state.deterministic = enabled;
}
/** Background preparation must not become a lifecycle barrier for already-on-air passes. */
export function tickerReadinessScope(root: ParentNode): ParentNode {
  if (!root.querySelectorAll('[data-ograf-ticker="true"]').length) return root;
  const excluded = (node: globalThis.Element) =>
    !!node.closest?.('[data-ograf-ticker-deferred="true"]');
  return new Proxy(root, {
    get(target, property) {
      if (property === 'querySelectorAll')
        return (selector: string) => {
          const nodes = [...target.querySelectorAll(selector)].filter((node) => !excluded(node));
          const own = target as unknown as globalThis.Element;
          if (own.matches?.(selector) && !excluded(own)) nodes.unshift(own);
          return nodes;
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
