import { toCanvas } from 'html-to-image';
import { captureMaskedCanvas } from './maskedCapture';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  applyAnimatedPaint,
  applyCompiledClipPaths,
  applyCompiledMasks,
  disposeElementContent,
  expandRuntimeCollections,
  isRuntimeCollectionLayerActive,
  renderAnimatedElementAtTime,
  renderElementContent,
  resolveBoundElement,
  setLottieDeterministicRendering,
  sampleCompiledLayerVisualState,
  waitForElementContentReady,
  compiledLoopElapsedFrames,
  renderPatternAtElapsed,
} from '@ograf-editor/ograf-runtime';
import {
  getLayerTransformAtFrame,
  getLayerPropertyValueAtFrame,
  getTotalFrames,
  isTransformClippedBy,
  valueAtSourcePath,
  layerEffectsToCssFilter,
  type Composition,
  type Element,
  type FieldValue,
  type Project,
  type TextElement,
} from '@ograf-editor/scene-model';

export interface AgentCaptureRequest {
  target: 'composition' | 'viewport';
  project: Project;
  compositionId?: string;
  frame: number;
  maxDimension: number;
  matte: string;
  dataOverrides?: Record<string, FieldValue>;
}

export interface AgentCaptureResult {
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resolvedFonts: Array<{
    layerId: string;
    layerName: string;
    requestedFamily: string;
    resolvedFamily: string;
    resolution: 'inferred';
  }>;
  runtimeCollections?: Array<{
    id: string;
    name: string;
    receivedCount: number;
    renderedCount: number;
    capacity: number;
    truncated: boolean;
  }>;
}

export interface AgentStripRequest {
  project: Project;
  compositionId?: string;
  frames: number[];
  columns: number;
  maxDimension: number;
  labelFrames: boolean;
  matte: string;
}

export interface AgentStripResult extends AgentCaptureResult {
  frames: number[];
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  compositionWidth: number;
  compositionHeight: number;
}

export interface AgentMeasureTextRequest {
  project: Project;
  compositionId?: string;
  layerId: string;
  text?: string;
  frame: number;
}

export interface AgentMeasureTextResult {
  layerId: string;
  layerName: string;
  frame: number;
  text: string;
  width: number;
  height: number;
  boxWidth: number;
  boxHeight: number;
  lines: number;
  overflowsParent: boolean;
  /** Distinguishes text-box overflow from intentional ancestor masking. */
  clippedBy: 'parent' | 'own-box' | null;
  appliedFontSize: number;
  appliedFitRatio: number;
  appliedShrinkRatio: number;
  degenerate: boolean;
  resolvedFont: {
    requestedFamily: string;
    resolvedFamily: string;
    resolution: 'inferred';
  };
  clippedAt: number | null;
}

function compositionFor(project: Project, compositionId?: string): Composition {
  const wanted = compositionId ?? project.mainCompositionId;
  const composition = project.compositions.find((item) => item.id === wanted);
  if (!composition) throw new Error(`Composition not found: ${wanted}`);
  return composition;
}

function captureDimensions(width: number, height: number, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function matteStyle(
  matte: string,
): Pick<CSSStyleDeclaration, 'backgroundColor' | 'backgroundImage' | 'backgroundSize'> {
  if (matte === 'transparent') {
    return { backgroundColor: 'transparent', backgroundImage: 'none', backgroundSize: 'auto' };
  }
  if (matte === 'checker') {
    return {
      backgroundColor: '#d4d7dc',
      backgroundImage: 'conic-gradient(#aeb3bb 25%, #d4d7dc 0 50%, #aeb3bb 0 75%, #d4d7dc 0)',
      backgroundSize: '32px 32px',
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(matte)) {
    return { backgroundColor: matte, backgroundImage: 'none', backgroundSize: 'auto' };
  }
  throw new Error('matte must be "transparent", "checker", or a #RRGGBB colour.');
}

function splitFontFamilies(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter(Boolean);
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

async function inferResolvedFamily(element: TextElement): Promise<string> {
  const families = splitFontFamilies(element.fontFamily);
  for (const family of families) {
    if (GENERIC_FAMILIES.has(family.toLowerCase())) return family;
    const escaped = family.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    try {
      await new FontFace('__ograf_capture_probe__', `local("${escaped}")`).load();
      return family;
    } catch {
      // Try the next family in the authored fallback stack.
    }
  }
  return families.at(-1) ?? 'sans-serif';
}

async function resolvedFonts(
  composition: Composition,
): Promise<AgentCaptureResult['resolvedFonts']> {
  const textLayers = composition.layers.filter(
    (layer) => layer.isVisible && !layer.isGuide && layer.element.type === 'text',
  );
  return Promise.all(
    textLayers.map(async (layer) => ({
      layerId: layer.id,
      layerName: layer.name,
      requestedFamily: (layer.element as TextElement).fontFamily,
      resolvedFamily: await inferResolvedFamily(layer.element as TextElement),
      resolution: 'inferred' as const,
    })),
  );
}

async function waitForRenderableDom(root: HTMLElement): Promise<void> {
  // A certified package may reference sidecar font URLs that are intentionally unavailable while
  // its module is exercised from a temporary blob URL. Do not let one such pending face block all
  // subsequent editor captures forever; the editor's imported data-URI face is already available.
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_000)),
  ]);
  const images = [...root.querySelectorAll('img')];
  await Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function fitPrefixIndex(
  content: HTMLElement,
  text: string,
  width: number,
  height: number,
  strokeExpansion = 0,
): number {
  let lower = 0;
  let upper = text.length;
  while (lower < upper) {
    const candidate = Math.ceil((lower + upper) / 2);
    content.textContent = text.slice(0, candidate);
    if (
      content.scrollWidth + strokeExpansion <= width + 0.5 &&
      content.scrollHeight + strokeExpansion <= height + 0.5
    ) {
      lower = candidate;
    } else {
      upper = candidate - 1;
    }
  }
  content.textContent = text;
  return lower;
}

function renderedTextMetrics(content: HTMLElement): {
  width: number;
  height: number;
  lines: number;
} {
  const rectangles: DOMRect[] = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    rectangles.push(...range.getClientRects());
    range.detach();
  }
  if (rectangles.length === 0) return { width: 0, height: 0, lines: 1 };
  const top = Math.min(...rectangles.map((rectangle) => rectangle.top));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.bottom));
  const lineTops = new Set(rectangles.map((rectangle) => Math.round(rectangle.top * 10) / 10));
  return {
    width: Math.max(...rectangles.map((rectangle) => rectangle.width)),
    height: bottom - top,
    lines: Math.max(1, lineTops.size),
  };
}

async function rasterize(
  root: HTMLElement,
  originalWidth: number,
  originalHeight: number,
  maxDimension: number,
  style?: Partial<CSSStyleDeclaration>,
) {
  const output = captureDimensions(originalWidth, originalHeight, maxDimension);
  const render = root.querySelector('[data-ograf-layer-mask-id], [data-ograf-pattern]')
    ? captureMaskedCanvas
    : toCanvas;
  const canvas = await render(root, {
    width: originalWidth,
    height: originalHeight,
    canvasWidth: output.width,
    canvasHeight: output.height,
    pixelRatio: 1,
    cacheBust: true,
    skipAutoScale: true,
    ...(style ? { style } : {}),
  });
  const encoded = canvas.toDataURL('image/png');
  const separator = encoded.indexOf(',');
  if (separator < 0) throw new Error('Browser PNG encoder returned invalid data.');
  return { ...output, data: encoded.slice(separator + 1) };
}

function sequenceFrame(element: Element, frame: number, frameRate: number): number {
  if (element.type !== 'image-sequence' || element.frames.length === 0) return 0;
  const raw = Math.max(0, Math.floor((frame / frameRate) * Math.max(1, element.fps)));
  return element.loop ? raw % element.frames.length : Math.min(raw, element.frames.length - 1);
}

function buildCompositionDom(
  composition: Composition,
  frame: number,
  matte: string,
  dataOverrides?: Record<string, FieldValue>,
): HTMLDivElement {
  const data = {
    ...Object.fromEntries(composition.dataFields.map((field) => [field.key, field.defaultValue])),
    ...dataOverrides,
  };
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: '-2147483647',
    width: `${composition.width}px`,
    height: `${composition.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    ...matteStyle(matte),
  });

  const compositionRoot = document.createElement('div');
  Object.assign(compositionRoot.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    backgroundColor: composition.backgroundColor,
    isolation: 'isolate',
  });
  root.appendChild(compositionRoot);

  const descriptor = expandRuntimeCollections(compileDescriptor(composition));
  const rendered = new Map<string, HTMLElement>();
  const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
  for (const layer of descriptor.layers) {
    if (!layer.isVisible || !isRuntimeCollectionLayerActive(layer, data)) {
      continue;
    }
    const state = sampleCompiledLayerVisualState(
      layer,
      frame,
      compiledLoopElapsedFrames(descriptor, layer, frame),
      data,
    );
    const transform = state.transform;
    const layerRoot = document.createElement('div');
    layerRoot.dataset.agentCaptureLayer = 'true';
    Object.assign(layerRoot.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      boxSizing: 'border-box',
      width: `${transform.width}px`,
      height: `${transform.height}px`,
      opacity: String(transform.opacity),
      mixBlendMode: layer.blendMode === 'normal' ? '' : layer.blendMode,
      transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
      transformOrigin: `${transform.transformOriginX * 100}% ${transform.transformOriginY * 100}%`,
      filter: layerEffectsToCssFilter(state.effects),
    });
    const element = resolveBoundElement(layer, data);
    compositionRoot.appendChild(layerRoot);
    renderElementContent(layerRoot, element, sequenceFrame(element, frame, composition.frameRate));
    setLottieDeterministicRendering(layerRoot, true);
    if (state.patternFrame !== undefined) renderPatternAtElapsed(layerRoot, state.patternFrame);
    renderAnimatedElementAtTime(layerRoot, element, (frame / composition.frameRate) * 1000);
    applyAnimatedPaint(layerRoot, state.paintTracks, state.paintFrame);
    rendered.set(layer.id, layerRoot);
    states.set(layer.id, state);
  }
  applyCompiledClipPaths(descriptor, rendered, states);
  applyCompiledMasks(descriptor, rendered, states, data);
  return root;
}

async function captureComposition(request: AgentCaptureRequest): Promise<AgentCaptureResult> {
  const composition = compositionFor(request.project, request.compositionId);
  const totalFrames = getTotalFrames(composition);
  if (request.frame > totalFrames) {
    throw new Error(
      `Frame ${request.frame} is beyond the composition's final animated frame ${totalFrames}.`,
    );
  }

  let wrapper = buildCompositionDom(
    composition,
    request.frame,
    request.matte,
    request.dataOverrides,
  );
  document.body.appendChild(wrapper);

  try {
    await waitForElementContentReady(wrapper);
    await waitForRenderableDom(wrapper);
    let raster = await rasterize(
      wrapper,
      composition.width,
      composition.height,
      request.maxDimension,
      { zIndex: 'auto' },
    );
    // html-to-image can populate its internal transparent foreignObject/style caches during the
    // first snapshot after an expanded collection's item count changes. Rebuild the immutable DOM
    // once after that warm-up so the returned PNG never contains a partially flattened first pass.
    if (composition.runtimeCollections.length > 0 && request.matte === 'transparent') {
      for (const layer of wrapper.querySelectorAll<HTMLElement>('[data-agent-capture-layer]')) {
        disposeElementContent(layer);
      }
      wrapper.remove();
      wrapper = buildCompositionDom(
        composition,
        request.frame,
        request.matte,
        request.dataOverrides,
      );
      document.body.appendChild(wrapper);
      await waitForElementContentReady(wrapper);
      await waitForRenderableDom(wrapper);
      raster = await rasterize(
        wrapper,
        composition.width,
        composition.height,
        request.maxDimension,
        { zIndex: 'auto' },
      );
    }
    return {
      mimeType: 'image/png',
      ...raster,
      originalWidth: composition.width,
      originalHeight: composition.height,
      resolvedFonts: await resolvedFonts(composition),
      runtimeCollections: composition.runtimeCollections.map((collection) => {
        const field = composition.dataFields.find(
          (candidate) => candidate.id === collection.fieldId,
        );
        const value = field ? (request.dataOverrides?.[field.key] ?? field.defaultValue) : [];
        const receivedCount = Array.isArray(value) ? value.length : 0;
        return {
          id: collection.id,
          name: collection.name,
          receivedCount,
          renderedCount: Math.min(receivedCount, collection.capacity),
          capacity: collection.capacity,
          truncated: receivedCount > collection.capacity,
        };
      }),
    };
  } finally {
    for (const layer of wrapper.querySelectorAll<HTMLElement>('[data-agent-capture-layer]')) {
      disposeElementContent(layer);
    }
    wrapper.remove();
  }
}

async function captureViewport(request: AgentCaptureRequest): Promise<AgentCaptureResult> {
  const root = document.getElementById('root');
  if (!root) throw new Error('Editor root element is unavailable.');
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  await waitForElementContentReady(root);
  await waitForRenderableDom(root);
  const raster = await rasterize(root, originalWidth, originalHeight, request.maxDimension);
  return {
    mimeType: 'image/png',
    ...raster,
    originalWidth,
    originalHeight,
    resolvedFonts: await resolvedFonts(compositionFor(request.project, request.compositionId)),
  };
}

function imageFromPngBase64(data: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener(
      'error',
      () => reject(new Error('Could not decode captured PNG tile.')),
      {
        once: true,
      },
    );
    image.src = `data:image/png;base64,${data}`;
  });
}

/** Renders representative frames with the same capture path and composites one labeled PNG. */
export async function renderAgentStripPng(request: AgentStripRequest): Promise<AgentStripResult> {
  const composition = compositionFor(request.project, request.compositionId);
  const totalFrames = getTotalFrames(composition);
  const frames = [...new Set(request.frames)].sort((a, b) => a - b);
  if (frames.length === 0) throw new Error('At least one strip frame is required.');
  if (frames.length > 12) throw new Error('A frame strip supports at most 12 frames.');
  const invalidFrame = frames.find((frame) => frame < 0 || frame > totalFrames);
  if (invalidFrame !== undefined) {
    throw new Error(`Frame ${invalidFrame} is outside the composition range 0–${totalFrames}.`);
  }

  const tiles = [] as AgentCaptureResult[];
  for (const frame of frames) {
    tiles.push(
      await captureComposition({
        target: 'composition',
        project: request.project,
        compositionId: composition.id,
        frame,
        maxDimension: request.maxDimension,
        matte: request.matte,
      }),
    );
  }

  const tileWidth = tiles[0]!.width;
  const tileHeight = tiles[0]!.height;
  const columns = Math.max(1, Math.min(request.columns, frames.length));
  const rows = Math.ceil(frames.length / columns);
  const gutter = 8;
  const width = columns * tileWidth + (columns - 1) * gutter;
  const height = rows * tileHeight + (rows - 1) * gutter;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browser canvas 2D context is unavailable.');
  context.fillStyle = '#15161a';
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < tiles.length; index++) {
    const image = await imageFromPngBase64(tiles[index]!.data);
    const x = (index % columns) * (tileWidth + gutter);
    const y = Math.floor(index / columns) * (tileHeight + gutter);
    context.drawImage(image, x, y, tileWidth, tileHeight);
    if (request.labelFrames) {
      const label = `Frame ${frames[index]}`;
      context.font = '600 13px system-ui, sans-serif';
      const labelWidth = Math.ceil(context.measureText(label).width) + 14;
      context.fillStyle = 'rgba(0, 0, 0, 0.72)';
      context.fillRect(x + 6, y + 6, labelWidth, 24);
      context.fillStyle = '#ffffff';
      context.textBaseline = 'middle';
      context.fillText(label, x + 13, y + 18);
    }
  }

  const encoded = canvas.toDataURL('image/png');
  const separator = encoded.indexOf(',');
  if (separator < 0) throw new Error('Browser PNG encoder returned invalid strip data.');
  return {
    mimeType: 'image/png',
    data: encoded.slice(separator + 1),
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    resolvedFonts: tiles[0]!.resolvedFonts,
    runtimeCollections: tiles[0]!.runtimeCollections,
    frames,
    columns,
    rows,
    tileWidth,
    tileHeight,
    compositionWidth: composition.width,
    compositionHeight: composition.height,
  };
}

/** Measures text with the real browser font and runtime text renderer without touching project state. */
export async function measureAgentText(
  request: AgentMeasureTextRequest,
): Promise<AgentMeasureTextResult> {
  const composition = compositionFor(request.project, request.compositionId);
  const layer = composition.layers.find((candidate) => candidate.id === request.layerId);
  if (!layer) throw new Error(`Layer not found: ${request.layerId}`);
  if (layer.element.type !== 'text')
    throw new Error(`Layer ${request.layerId} is not a text layer.`);
  const frame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(request.frame)));
  const transform = getLayerTransformAtFrame(layer, frame);
  const contentBinding = layer.bindings.find((binding) => binding.targetProperty === 'content');
  const boundField = contentBinding
    ? composition.dataFields.find((field) => field.id === contentBinding.fieldId)
    : undefined;
  const rootDefault =
    boundField?.type === 'array' && Array.isArray(boundField.defaultValue)
      ? boundField.defaultValue[0]
      : boundField?.defaultValue;
  const defaultValue = valueAtSourcePath(rootDefault, contentBinding?.sourcePath);
  const text = request.text ?? String(defaultValue ?? layer.element.content);
  const element: TextElement = {
    ...layer.element,
    content: text,
    strokeWidth: getLayerPropertyValueAtFrame(layer, 'strokeWidth', frame),
  };
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${transform.width}px`,
    height: `${transform.height}px`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  });
  renderElementContent(host, element);
  document.body.appendChild(host);
  try {
    await waitForRenderableDom(host);
    const content = host.firstElementChild as HTMLElement | null;
    if (!content) throw new Error('Browser text renderer produced no measurable content.');
    const layout = renderedTextMetrics(content);
    const strokeExpansion = Math.max(0, element.strokeWidth);
    const overflowsParent =
      element.autoFit === 'squeeze'
        ? false
        : content.scrollWidth + strokeExpansion > host.clientWidth + 0.5 ||
          content.scrollHeight + strokeExpansion > host.clientHeight + 0.5;
    const appliedFontSize = Number(content.dataset.ografAppliedFontSize ?? element.fontSize);
    const appliedFitRatio = Number(content.dataset.ografFitRatio ?? 1);
    const appliedShrinkRatio =
      element.autoFit === 'shrink-to-fit' ? Number(content.dataset.ografShrinkRatio ?? 1) : 1;
    const degenerate =
      element.autoFit === 'fit-to-width' || element.autoFit === 'squeeze'
        ? content.dataset.ografFitDegenerate === 'true'
        : content.dataset.ografShrinkDegenerate === 'true';
    const clippingParent = layer.parentId
      ? composition.layers.find(
          (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
        )
      : undefined;
    const clippedByParent = clippingParent
      ? isTransformClippedBy(transform, getLayerTransformAtFrame(clippingParent, frame))
      : false;
    return {
      layerId: layer.id,
      layerName: layer.name,
      frame,
      text,
      width: layout.width + strokeExpansion,
      height: layout.height + strokeExpansion,
      boxWidth: host.clientWidth,
      boxHeight: host.clientHeight,
      lines: layout.lines,
      overflowsParent,
      clippedBy: overflowsParent ? 'own-box' : clippedByParent ? 'parent' : null,
      appliedFontSize,
      appliedFitRatio,
      appliedShrinkRatio,
      degenerate,
      resolvedFont: {
        requestedFamily: element.fontFamily,
        resolvedFamily: await inferResolvedFamily(element),
        resolution: 'inferred',
      },
      clippedAt: overflowsParent
        ? fitPrefixIndex(content, text, host.clientWidth, host.clientHeight, strokeExpansion)
        : null,
    };
  } finally {
    disposeElementContent(host);
    host.remove();
  }
}

/** Rasterizes the real browser renderer without changing editor state or the authoring revision. */
export function captureAgentPng(request: AgentCaptureRequest): Promise<AgentCaptureResult> {
  return request.target === 'viewport' ? captureViewport(request) : captureComposition(request);
}
