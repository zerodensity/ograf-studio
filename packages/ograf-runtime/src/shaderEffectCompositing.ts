import { toCanvas } from 'html-to-image';
import {
  effectEnabled,
  effectStackPadding,
  effectStackToCss,
  getEffectStack,
  type EffectBlendMode,
  type LayerEffect,
  type LayerEffects,
} from '@ograf-editor/scene-model';
import { createShaderRenderer, type ShaderRenderer } from './shaderRendering';
import { CHART_RENDERED_EVENT } from './chartPresentation';
import {
  applyRevealToComposite,
  revealSourceSignature,
  REVEAL_CHANGED_EVENT,
} from './revealPresentation';

interface ShaderStage {
  canvas: HTMLCanvasElement;
  /** The stage's result. Kept between frames for the same reason as the padded capture. */
  blended: HTMLCanvasElement;
  renderer: ShaderRenderer;
  source: string;
  scale: number;
  width: number;
  height: number;
  overlaysInput: boolean;
}

/** Generative shader output is an overlay; input-reading passes own their complete RGBA result. */
function shaderOutputOverlaysInput(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
  return !/\biChannel0\b|\biChannelResolution\b/.test(code);
}

/**
 * Live input invalidates the output every frame, so a readiness wait following it would never end.
 * This many revisions in, a complete frame has been committed and the input is simply running.
 */
const MAX_FOLLOWED_REVISIONS = 8;

/** Roots whose stacks hold their output because the graphic's host cannot show it right now. */
const suspendedRoots = new WeakSet<Node>();

class ShaderEffectStackController {
  readonly host: HTMLElement;
  readonly output: HTMLCanvasElement;
  readonly originals = new WeakMap<HTMLElement, string>();
  readonly hiddenOriginals = new WeakSet<HTMLElement>();
  readonly shaders = new Map<string, ShaderStage>();
  effects: LayerEffects;
  elapsedMs = 0;
  requested = 0;
  completed = 0;
  busy = false;
  disposed = false;
  /** The committed output holds the complete picture, not an overlay for the originals. */
  replacesOriginals = false;
  error: Error | null = null;
  baseCanvas: HTMLCanvasElement | null = null;
  baseSignature = '';
  baseElement: string | undefined;
  /** Counts changes to what a capture would flatten that no signature value can see. */
  domRevision = 0;
  baseDomRevision = 0;
  observer: MutationObserver | null = null;
  /** An update arrived while the host's root was suspended, so the output is behind it. */
  deferred = false;
  waiters: Array<{ revision: number; resolve: () => void }> = [];
  readonly onChartRendered = () => {
    if (!this.disposed) this.update(this.effects, this.elapsedMs);
  };
  readonly onRevealChanged = () => {
    if (this.disposed) return;
    applyRevealToComposite(this.host, this.output);
    this.update(this.effects, this.elapsedMs);
  };

  constructor(host: HTMLElement, effects: LayerEffects) {
    this.host = host;
    this.effects = effects;
    host.addEventListener?.(CHART_RENDERED_EVENT, this.onChartRendered);
    host.addEventListener?.(REVEAL_CHANGED_EVENT, this.onRevealChanged);
    this.output = host.ownerDocument.createElement('canvas');
    this.output.dataset.ografShaderEffectOutput = 'true';
    this.output.setAttribute('aria-hidden', 'true');
    Object.assign(this.output.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    host.appendChild(this.output);
    applyRevealToComposite(host, this.output);
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeOldValue: true,
      });
    }
  }

  /**
   * Frame renderers write gradients, Text FX and ticker positions straight into the DOM, and rule
   * modifiers write Studio's content host, with no value a signature could read cheaply. Some run
   * after the effect stack in a frame, so they are noticed here rather than sampled there.
   */
  onMutations(records: MutationRecord[]): void {
    if (this.disposed) return;
    let changed = false;
    for (const record of records) {
      if (this.adoptAuthoredOpacity(record)) changed = true;
      else if (this.changesCapture(record)) changed = true;
    }
    if (!changed) return;
    this.domRevision += 1;
    this.update(this.effects, this.elapsedMs);
  }

  changesCapture(record: MutationRecord): boolean {
    if (record.type === 'characterData') return true;
    if (record.type === 'childList') {
      return [...record.addedNodes, ...record.removedNodes].some((node) => {
        const dataset = (node as HTMLElement).dataset;
        return (
          node !== this.output &&
          dataset?.ografEffectFilter !== 'true' &&
          dataset?.ografRuntimeAuxiliary !== 'true'
        );
      });
    }
    const target = record.target as HTMLElement;
    // A capture overrides the host's own transform and opacity, and sizes come from the signature.
    if (target === this.host || target === this.output) return false;
    const name = record.attributeName ?? '';
    return !name.startsWith('data-') && target.getAttribute(name) !== record.oldValue;
  }

  /** Someone else set a hidden original's opacity, which is now what the capture has to show. */
  adoptAuthoredOpacity(record: MutationRecord): boolean {
    const target = record.target as HTMLElement;
    if (record.type !== 'attributes' || record.attributeName !== 'style') return false;
    if (!this.originals.has(target) || !this.hiddenOriginals.has(target)) return false;
    const authored = target.style.opacity;
    if (authored === '0') return false;
    const changed = authored !== (this.originals.get(target) ?? '');
    this.originals.set(target, authored);
    this.quietly(() => {
      target.style.opacity = '0';
    });
    return changed;
  }

  /** This controller's own writes to the originals must not read as content changes. */
  quietly(write: () => void): void {
    const pending = this.observer?.takeRecords() ?? [];
    if (pending.length) queueMicrotask(() => this.onMutations(pending));
    write();
    this.observer?.takeRecords();
  }

  contentChildren(): HTMLElement[] {
    return [...this.host.children].filter(
      (child) =>
        child !== this.output &&
        (child as HTMLElement).dataset.ografRuntimeAuxiliary !== 'true' &&
        (child as HTMLElement).dataset.ografEffectFilter !== 'true',
    ) as HTMLElement[];
  }

  mediaCanvases(): HTMLCanvasElement[] {
    return [...this.host.querySelectorAll<HTMLCanvasElement>('canvas')].filter(
      (canvas) => canvas.dataset.ografMediaCanvas === 'true',
    );
  }

  showOriginals(): void {
    this.quietly(() => {
      for (const node of [...this.contentChildren(), ...this.mediaCanvases()]) {
        if (!this.originals.has(node)) this.originals.set(node, node.style.opacity);
        node.style.opacity = this.originals.get(node) ?? '';
        this.hiddenOriginals.delete(node);
      }
    });
  }

  hideOriginals(): void {
    const media = this.mediaCanvases();
    // A Media input holds only the picture. The stroke and other base content are not in the
    // output, so they stay visible and only the canvas it replaces is hidden.
    if (media.length) this.showOriginals();
    this.quietly(() => {
      for (const node of media.length ? media : this.contentChildren()) {
        if (!this.originals.has(node)) this.originals.set(node, node.style.opacity);
        node.style.opacity = '0';
        this.hiddenOriginals.add(node);
      }
    });
  }

  size(): { width: number; height: number } {
    return {
      width: Math.max(
        1,
        Math.round(Number.parseFloat(this.host.style.width) || this.host.clientWidth || 1),
      ),
      height: Math.max(
        1,
        Math.round(Number.parseFloat(this.host.style.height) || this.host.clientHeight || 1),
      ),
    };
  }

  /**
   * The element behind the captured picture. A runtime layer renders into its host, while Studio
   * renders into the `.layer-content-host` child of its `.layer-node`. Studio also inlines assets
   * as data URIs, so this can hold a whole clip: compare it as it is, because escaping it into the
   * signature would cost about 1.8 ms per MB on every frame.
   */
  renderedElement(): string | undefined {
    return (
      this.host.dataset.ografRenderedElement ??
      (this.host.firstElementChild as HTMLElement | null)?.dataset?.ografRenderedElement
    );
  }

  hasDynamicCanvas(): boolean {
    return [...this.host.querySelectorAll('canvas')].some(
      (canvas) => canvas !== this.output && canvas.dataset.ografShaderEffectStage !== 'true',
    );
  }

  sourceSignature(width: number, height: number): string {
    const images = [...this.host.querySelectorAll('img')].map(
      (image) => image.currentSrc || image.src,
    );
    const dynamicCanvas = this.hasDynamicCanvas();
    const chartRevisions = [...this.host.querySelectorAll('canvas')]
      .filter((canvas) => canvas.dataset.ografChartCanvas === 'true')
      .map((canvas) => canvas.dataset.ografChartRevision ?? '0');
    const mediaFrames = this.mediaCanvases().map((canvas) => canvas.dataset.ografMediaFrame ?? '');
    return JSON.stringify([
      width,
      height,
      images,
      dynamicCanvas ? this.elapsedMs : null,
      chartRevisions,
      mediaFrames,
      revealSourceSignature(this.host),
    ]);
  }

  async captureHost(width: number, height: number): Promise<HTMLCanvasElement> {
    // The Media renderer has already flattened crop, fit, position, shape and native alpha into
    // this canvas, so it is the whole picture for a clip or a live source, and html-to-image would
    // omit a live canvas anyway.
    const media = this.mediaCanvases()[0];
    if (media) return media;
    return toCanvas(this.host, {
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      pixelRatio: 1,
      cacheBust: false,
      style: {
        transform: 'none',
        transformOrigin: '0 0',
        opacity: '1',
        filter: 'none',
        mixBlendMode: 'normal',
      },
      filter: (node: HTMLElement) => {
        const dataset = node.dataset;
        return (
          !dataset ||
          (dataset.ografShaderEffectOutput !== 'true' && dataset.ografEffectFilter !== 'true')
        );
      },
    });
  }

  async captureBase(): Promise<HTMLCanvasElement> {
    const { width, height } = this.size();
    const padding = effectStackPadding(this.effects);
    const signature = `${this.sourceSignature(width, height)}:${padding}`;
    const element = this.renderedElement();
    const domRevision = this.domRevision;
    if (
      this.baseCanvas &&
      signature === this.baseSignature &&
      element === this.baseElement &&
      domRevision === this.baseDomRevision
    )
      return this.baseCanvas;
    // Only html-to-image reads the live DOM, and its filter already leaves the output out, so the
    // current picture stays up during the capture instead of flashing the clean one. The originals
    // show only through parts of the output that are transparent.
    const flattensDom = this.mediaCanvases().length === 0;
    if (flattensDom) this.showOriginals();
    try {
      const captured = await this.captureHost(width, height);
      // The padding is room for an effect such as a blur or shadow to paint outside the layer. The
      // Media backing follows the layer's largest animated size, so the picture is fitted to the
      // layer's current size inside it. The canvas is kept while its size holds: allocating one per
      // frame stalls a 1080p source about once a second.
      const paddedWidth = width + padding * 2;
      const paddedHeight = height + padding * 2;
      const padded =
        this.baseCanvas?.width === paddedWidth && this.baseCanvas.height === paddedHeight
          ? this.baseCanvas
          : this.canvas(paddedWidth, paddedHeight);
      const paddedContext = padded.getContext('2d');
      paddedContext?.clearRect(0, 0, paddedWidth, paddedHeight);
      paddedContext?.drawImage(captured, padding, padding, width, height);
      this.baseCanvas = padded;
      Object.assign(this.output.style, {
        left: `${-padding}px`,
        top: `${-padding}px`,
        width: `calc(100% + ${padding * 2}px)`,
        height: `calc(100% + ${padding * 2}px)`,
      });
      applyRevealToComposite(this.host, this.output);
      this.baseSignature = signature;
      this.baseElement = element;
      this.baseDomRevision = domRevision;
      return this.baseCanvas;
    } finally {
      if (flattensDom) this.hideOriginals();
    }
  }

  canvas(width: number, height: number): HTMLCanvasElement {
    const canvas = this.host.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.ografShaderEffectStage = 'true';
    return canvas;
  }

  blendMode(mode: EffectBlendMode): GlobalCompositeOperation {
    if (mode === 'add') return 'lighter';
    return mode === 'normal' ? 'source-over' : mode;
  }

  applyCanvasEffect(input: HTMLCanvasElement, effect: LayerEffect): HTMLCanvasElement {
    const processed = this.canvas(input.width, input.height);
    const processedContext = processed.getContext('2d');
    if (!processedContext) throw new Error('Effect stack requires Canvas 2D support.');
    processedContext.filter = effectStackToCss({
      ...this.effects,
      stack: [{ ...effect, blendMode: 'normal', blendOpacity: 1 }],
    });
    processedContext.drawImage(input, 0, 0);
    const opacity = effect.blendOpacity ?? 1;
    const mode = effect.blendMode ?? 'normal';
    if (mode === 'normal' && opacity === 1) return processed;
    const output = this.canvas(input.width, input.height);
    const context = output.getContext('2d');
    if (!context) throw new Error('Effect stack requires Canvas 2D support.');
    context.drawImage(input, 0, 0);
    context.globalAlpha = opacity;
    context.globalCompositeOperation = this.blendMode(mode);
    context.drawImage(processed, 0, 0);
    return output;
  }

  async applyShaderEffect(
    input: HTMLCanvasElement,
    effect: LayerEffect,
    mediaOverlay = false,
  ): Promise<HTMLCanvasElement> {
    if (!effect.shader) throw new Error(`${effect.name} has no shader source.`);
    let stage = this.shaders.get(effect.id);
    if (
      !stage ||
      stage.source !== effect.shader.fragmentSource ||
      stage.scale !== effect.shader.resolutionScale ||
      stage.width !== input.width ||
      stage.height !== input.height
    ) {
      stage?.renderer.dispose();
      const canvas = this.canvas(input.width, input.height);
      const renderer = createShaderRenderer(
        canvas,
        effect.shader,
        { width: input.width, height: input.height },
        () => {},
        false,
        { blendMode: 'normal', blendOpacity: 1 },
        this.host,
      );
      stage = {
        canvas,
        blended: this.canvas(input.width, input.height),
        renderer,
        source: effect.shader.fragmentSource,
        scale: effect.shader.resolutionScale,
        width: input.width,
        height: input.height,
        overlaysInput: shaderOutputOverlaysInput(effect.shader.fragmentSource),
      };
      this.shaders.set(effect.id, stage);
    } else {
      stage.renderer.updateParameters(effect.shader);
      stage.renderer.setEffectBlend({ blendMode: 'normal', blendOpacity: 1 });
    }
    stage.renderer.setInput(input);
    stage.renderer.render(this.elapsedMs);
    await stage.renderer.ready();
    if (mediaOverlay && stage.overlaysInput) return stage.canvas;
    const mode = effect.blendMode ?? 'normal';
    const opacity = effect.blendOpacity ?? 1;
    const blended = stage.blended;
    const context = blended.getContext('2d');
    if (!context) throw new Error('Shader effect blending requires Canvas 2D support.');
    context.clearRect(0, 0, blended.width, blended.height);
    if (mode === 'normal' && stage.overlaysInput) {
      context.drawImage(input, 0, 0);
      context.globalAlpha = opacity;
      // Alpha from a transparent procedural shader controls its contribution, not whether the
      // underlying artwork exists. Atop preserves the input's coverage without squaring alpha.
      context.globalCompositeOperation = 'source-atop';
      context.drawImage(stage.canvas, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      return blended;
    }
    if (mode === 'normal' && opacity === 1) {
      context.drawImage(stage.canvas, 0, 0);
    } else {
      context.drawImage(input, 0, 0);
      context.globalAlpha = opacity;
      context.globalCompositeOperation = this.blendMode(mode);
      context.drawImage(stage.canvas, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    }
    // A post-process may recolor pixels but must not expand a Media-painted object's native alpha.
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(input, 0, 0);
    context.globalCompositeOperation = 'source-over';
    return blended;
  }

  /** Effects that change pixels this frame, in stack order. */
  activeEffects(): LayerEffect[] {
    return getEffectStack(this.effects).filter((effect) => {
      if (!effectEnabled(effect, this.effects) || effect.blendOpacity === 0) return false;
      if (effect.type === 'shader') return true;
      const css = effectStackToCss({
        ...this.effects,
        stack: [{ ...effect, blendMode: 'normal', blendOpacity: 1 }],
      });
      return (
        css !== 'none' ||
        (effect.blendMode ?? 'normal') !== 'normal' ||
        (effect.blendOpacity ?? 1) !== 1
      );
    });
  }

  async render(): Promise<void> {
    let result = await this.captureBase();
    const active = this.activeEffects();
    // Live video can stay under the output, at its own frame rate, only when one generative shader
    // is the whole stack. A shader that reads its input may move or remove pixels, and any other
    // effect must feed the chain, so those results are composited in full and replace the picture.
    const mediaOverlay = this.mediaCanvases().length > 0 && active.length === 1;
    let overlayEffect: LayerEffect | undefined;
    const liveShaderIds = new Set<string>();
    for (const effect of active) {
      if (effect.type === 'shader') {
        liveShaderIds.add(effect.id);
        result = await this.applyShaderEffect(result, effect, mediaOverlay);
        if (mediaOverlay && this.shaders.get(effect.id)?.overlaysInput) overlayEffect = effect;
      } else result = this.applyCanvasEffect(result, effect);
    }
    for (const [id, stage] of this.shaders) {
      if (liveShaderIds.has(id)) continue;
      stage.renderer.dispose();
      this.shaders.delete(id);
    }
    // Dynamic inputs (Media, Lottie, shader paints) may request another frame while html-to-image
    // is still flattening this one. Commit the latest completed frame instead of starving the
    // output forever; run() immediately follows with the newest queued revision.
    if (this.disposed) return;
    if (this.output.width !== result.width) this.output.width = result.width;
    if (this.output.height !== result.height) this.output.height = result.height;
    const context = this.output.getContext('2d');
    if (!context) throw new Error('Shader effect output requires Canvas 2D support.');
    context.clearRect(0, 0, this.output.width, this.output.height);
    context.drawImage(result, 0, 0);
    applyRevealToComposite(this.host, this.output);
    this.output.style.display = 'block';
    // Originals stay up until this first commit, so live video remains visible while a capture or
    // shader is pending, and run() restores them if one fails.
    this.replacesOriginals = !overlayEffect;
    if (overlayEffect) {
      this.showOriginals();
      this.output.style.mixBlendMode =
        overlayEffect.blendMode === 'add' ? 'screen' : (overlayEffect.blendMode ?? 'normal');
      this.output.style.opacity = String(overlayEffect.blendOpacity ?? 1);
    } else {
      this.hideOriginals();
      this.output.style.mixBlendMode = 'normal';
      this.output.style.opacity = '1';
    }
    delete this.host.dataset.ografEffectError;
    this.error = null;
  }

  settle(): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (this.error || this.disposed || waiter.revision <= this.completed) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  }

  run(): void {
    if (this.busy || this.disposed) return;
    const revision = this.requested;
    this.busy = true;
    void this.render()
      .catch((cause: unknown) => {
        this.error = cause instanceof Error ? cause : new Error(String(cause));
        this.host.dataset.ografEffectError = this.error.message;
        this.replacesOriginals = false;
        this.showOriginals();
        this.output.style.display = 'none';
      })
      .finally(() => {
        this.completed = Math.max(this.completed, revision);
        this.busy = false;
        this.settle();
        if (this.completed < this.requested) this.run();
      });
  }

  update(effects: LayerEffects, elapsedMs: number): void {
    this.effects = effects;
    this.elapsedMs = elapsedMs;
    // A remounted Media canvas must not show through the current output until the next commit.
    if (this.replacesOriginals && this.mediaCanvases().length) this.hideOriginals();
    // Nothing waits on a skipped revision, so lifecycle and capture boundaries still resolve.
    this.deferred = suspendedRoots.has(this.host.getRootNode?.());
    if (this.deferred) return;
    this.requested += 1;
    this.run();
  }

  /** Commits what is painted now, even if an earlier capture at this same time saw an older canvas. */
  refresh(): Promise<void> {
    if (this.hasDynamicCanvas()) this.baseSignature = '';
    this.update(this.effects, this.elapsedMs);
    // A failed stack has already fallen back to its original content.
    return this.ready().catch(() => undefined);
  }

  ready(): Promise<void> {
    // A change made a moment ago must count before anyone is told the picture is current.
    const pending = this.observer?.takeRecords() ?? [];
    if (pending.length) this.onMutations(pending);
    if (this.error) return Promise.reject(this.error);
    if (this.completed >= this.requested) return Promise.resolve();
    return new Promise<void>((resolve) =>
      this.waiters.push({ revision: this.requested, resolve }),
    ).then(() => {
      if (this.error) throw this.error;
    });
  }

  async completeFrame(): Promise<void> {
    const deadline = Date.now() + 30_000;
    const timeout = new Error('Shader effect frame did not settle within 30000 ms.');
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const complete = async () => {
      let revision: number;
      let followed = 0;
      do {
        if (expired || Date.now() >= deadline) throw timeout;
        await this.ready();
        if (expired || Date.now() >= deadline) throw timeout;
        if (this.disposed)
          throw new Error('Shader effect stack was disposed before frame completion.');
        revision = this.requested;
        // Effect renderers are owned by this controller, not by mountedShaders. Keep fences out of
        // render()/run(): only explicit readiness/capture boundaries complete submitted pixels.
        await Promise.all(
          [...this.shaders.values()].map((stage) => stage.renderer.completeFrame()),
        );
        if (expired || Date.now() >= deadline) throw timeout;
        if (this.disposed)
          throw new Error('Shader effect stack was disposed before frame completion.');
        // Inputs may invalidate the output while the GPU wait yields. Follow those revisions, but
        // not for ever: continuous realtime input must not starve Take In or an exact capture.
        followed += 1;
      } while (this.requested !== revision && followed < MAX_FOLLOWED_REVISIONS);
    };
    try {
      await Promise.race([
        complete(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(timeout);
          }, 30_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.host.removeEventListener?.(CHART_RENDERED_EVENT, this.onChartRendered);
    this.host.removeEventListener?.(REVEAL_CHANGED_EVENT, this.onRevealChanged);
    for (const stage of this.shaders.values()) stage.renderer.dispose();
    this.shaders.clear();
    this.baseCanvas = null;
    this.showOriginals();
    this.output.remove();
    this.settle();
  }
}

const shaderStacks = new WeakMap<HTMLElement, ShaderEffectStackController>();

export function applyShaderEffectStack(
  host: HTMLElement,
  effects: LayerEffects,
  elapsedMs: number,
): void {
  let controller = shaderStacks.get(host);
  if (!controller) {
    controller = new ShaderEffectStackController(host, effects);
    shaderStacks.set(host, controller);
  }
  controller.update(effects, elapsedMs);
}

export function removeShaderEffectStack(host: HTMLElement): void {
  const controller = shaderStacks.get(host);
  if (!controller) return;
  controller.dispose();
  shaderStacks.delete(host);
}

function shaderStacksUnder(root: ParentNode): ShaderEffectStackController[] {
  return [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    const controller = shaderStacks.get(element as HTMLElement);
    return controller ? [controller] : [];
  });
}

export async function waitForShaderEffectStacksReady(root: ParentNode): Promise<void> {
  await Promise.all(shaderStacksUnder(root).map((controller) => controller.completeFrame()));
}

/** Stacks under a suspended root keep their latest state but stop capturing and committing. */
export function suspendShaderEffectStacks(root: Node): void {
  suspendedRoots.add(root);
}

/**
 * Lets stacks commit again. Returns what brings their output up to date, or null when it already
 * is: `framesParked` says per-frame drawing was held back, which skips updates without deferring
 * any. Run the result once the content those frames asked for has drawn, because it captures that
 * content. It waits for the commit rather than for a completed GPU frame, which realtime input
 * could postpone indefinitely.
 */
export function resumeShaderEffectStacks(
  root: ParentNode & Node,
  framesParked: boolean,
): (() => Promise<void>) | null {
  suspendedRoots.delete(root);
  const stacks = shaderStacksUnder(root);
  if (!stacks.length || (!framesParked && !stacks.some((stack) => stack.deferred))) return null;
  return async () => {
    await Promise.all(shaderStacksUnder(root).map((stack) => stack.refresh()));
  };
}
