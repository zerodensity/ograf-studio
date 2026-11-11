import { createId } from './id';
import { createDefaultGradient } from './paint';
import type {
  Asset,
  AudioElement,
  Composition,
  ChartElement,
  CustomActionDefinition,
  MediaCue,
  Element,
  EllipseElement,
  FieldDefinition,
  FieldSchemaInput,
  FieldOption,
  FieldType,
  ImageElement,
  ImageSequenceElement,
  LottieElement,
  ShaderElement,
  ShaderResource,
  Keyframe,
  KeyframeRole,
  Layer,
  LayerKeyframe,
  LayerPropertyKeyframe,
  LayerLoopClip,
  LayerEffects,
  LayerSemantics,
  LayerTransform,
  PathElement,
  PatternElement,
  Project,
  RectangleElement,
  TextElement,
  TickerElement,
  Transition,
  EasingPreset,
} from './types';
import { normalizeAuthoredTransform } from './authoredTransform';
import { normalizeCornerRadii } from './cornerRadii';
import { normalizeShaderElement } from './shader';
import { normalizeTextAnimation } from './textAnimation';
import { formatClockTimerValue, normalizeClockTimerSettings } from './clockTimer';
import { DEFAULT_CHART_ANIMATION, normalizeChartAnimation } from './chartAnimation';
import { normalizeTicker } from './ticker';

const BASE_TRANSFORM: LayerTransform = {
  x: 100,
  y: 100,
  width: 400,
  height: 120,
  rotation: 0,
  opacity: 1,
  transformOriginX: 0.5,
  transformOriginY: 0.5,
};

export function createDefaultTransform(overrides: Partial<LayerTransform> = {}): LayerTransform {
  return normalizeAuthoredTransform({ ...BASE_TRANSFORM, ...overrides });
}

export function createRectangleElement(
  overrides: Partial<RectangleElement> = {},
): RectangleElement {
  return {
    type: 'rectangle',
    fill: '#3b3f4a',
    strokeColor: 'transparent',
    strokeWidth: 0,
    ...overrides,
    borderRadius: normalizeCornerRadii(overrides.borderRadius),
  };
}

export function createTextElement(overrides: Partial<TextElement> = {}): TextElement {
  const fontSize = Math.max(1, overrides.fontSize ?? 48);
  return {
    type: 'text',
    content: 'Text',
    color: '#ffffff',
    strokeColor: 'transparent',
    strokeWidth: 0,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 600,
    textAlign: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    textTransform: 'none',
    verticalAlign: 'top',
    baselineShift: 0,
    minFontSize: Math.max(1, fontSize * 0.5),
    overflowPolicy: 'visible',
    autoFit: 'auto-size',
    runs: [],
    direction: 'auto',
    language: '',
    ...overrides,
    fontSize,
    textAnimation: normalizeTextAnimation(overrides.textAnimation),
  };
}

export function createLayerEffects(overrides: Partial<LayerEffects> = {}): LayerEffects {
  return {
    blur: 0,
    dropShadowEnabled: false,
    dropShadowColor: '#000000',
    dropShadowOpacity: 0.65,
    dropShadowOffsetX: 8,
    dropShadowOffsetY: 8,
    dropShadowBlur: 12,
    ...overrides,
  };
}

export function createLayerSemantics(overrides: Partial<LayerSemantics> = {}): LayerSemantics {
  return {
    role: 'none',
    description: '',
    ...overrides,
    tags: [...new Set((overrides.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
  };
}

export function createEllipseElement(overrides: Partial<EllipseElement> = {}): EllipseElement {
  return {
    type: 'ellipse',
    fill: '#3b3f4a',
    strokeColor: 'transparent',
    strokeWidth: 0,
    ...overrides,
  };
}

export function createChartElement(overrides: Partial<ChartElement> = {}): ChartElement {
  return {
    type: 'chart',
    provider: null,
    preset: 'bar',
    data: {
      labels: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      datasets: [
        {
          label: 'Series 1',
          data: [42, 35, 15, 8],
          backgroundColor: ['#2563eb', '#dc2626', '#f59e0b', '#16a34a'],
          borderColor: '#38bdf8',
        },
      ],
    },
    textColor: '#e5e7eb',
    fontSize: 28,
    showLegend: false,
    showGrid: true,
    ...overrides,
    animation: normalizeChartAnimation(overrides.animation ?? DEFAULT_CHART_ANIMATION),
  };
}

export function createImageElement(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    type: 'image',
    src: null,
    ...overrides,
  };
}

export function createPathElement(overrides: Partial<PathElement> = {}): PathElement {
  return {
    type: 'path',
    d: 'M50,0 L100,100 L0,100 Z',
    fill: '#3b3f4a',
    fillRule: 'nonzero',
    strokeColor: 'transparent',
    strokeWidth: 0,
    viewBoxWidth: 100,
    viewBoxHeight: 100,
    ...overrides,
  };
}

export function createImageSequenceElement(
  overrides: Partial<ImageSequenceElement> = {},
): ImageSequenceElement {
  return {
    type: 'image-sequence',
    frames: [],
    fps: 12,
    loop: true,
    ...overrides,
  };
}

export function createLottieElement(overrides: Partial<LottieElement> = {}): LottieElement {
  return {
    type: 'lottie',
    animationData: null,
    speed: 1,
    ...overrides,
  };
}

export function createShaderElement(overrides: Partial<ShaderElement> = {}): ShaderElement {
  return normalizeShaderElement(overrides);
}

export function createShaderResource(overrides: Partial<ShaderResource> = {}): ShaderResource {
  return {
    id: overrides.id ?? createId('shader'),
    paint: normalizeShaderElement(overrides.paint),
  };
}

function createLayer(name: string, element: Element): Layer {
  return {
    id: createId('layer'),
    name,
    isVisible: true,
    isGuide: false,
    blendMode: 'normal',
    isLocked: false,
    groupId: null,
    parentId: null,
    clipChildren: false,
    isMaskOnly: false,
    mask: null,
    constraints: { horizontal: 'left', vertical: 'top' },
    autoLayout: {
      direction: 'none',
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      align: 'start',
      hugWidth: false,
      hugHeight: false,
      minWidth: 0,
      maxWidth: 0,
      collapseHidden: true,
    },
    updateTransition: { style: 'inherit', durationFrames: 0, distance: 24 },
    motionPath: null,
    keyframes: [],
    animationTracks: {},
    loop: null,
    element,
    effects: createLayerEffects(),
    semantics: createLayerSemantics(),
    designTokenBindings: [],
    componentLink: null,
    bindings: [],
    visualRules: [],
  };
}

export type NewLayerKind =
  | 'rectangle'
  | 'ellipse'
  | 'chart'
  | 'text'
  | 'ticker'
  | 'clock'
  | 'image'
  | 'path'
  | 'pattern'
  | 'image-sequence'
  | 'lottie'
  | 'audio'
  | 'shader';

/** The starting pose for a freshly created layer of this kind — a fresh object every call. */
export function defaultTransformFor(kind: NewLayerKind): LayerTransform {
  if (kind === 'ticker') return createDefaultTransform({ width: 1600, height: 72 });
  if (kind === 'text' || kind === 'clock') return createDefaultTransform({ height: 64 });
  if (kind === 'chart') return createDefaultTransform({ width: 640, height: 360 });
  if (kind === 'rectangle' || kind === 'ellipse') {
    return createDefaultTransform({ width: 200, height: 200 });
  }
  return createDefaultTransform();
}

/** Ordinary newly created layers remain visible until the author explicitly animates alpha. */
export function defaultTransformForRole(kind: NewLayerKind, _role: KeyframeRole): LayerTransform {
  return defaultTransformFor(kind);
}

export function createRectangleLayer(): Layer {
  return createLayer('Rectangle', createRectangleElement());
}

export function createEllipseLayer(): Layer {
  return createLayer('Ellipse', createEllipseElement());
}

export function createChartLayer(): Layer {
  return createLayer('Chart', createChartElement());
}

export function createTextLayer(): Layer {
  return createLayer('Text', createTextElement());
}

export function createTickerElement(overrides: Partial<TickerElement> = {}): TickerElement {
  return normalizeTicker({
    items: [
      {
        id: createId('ticker-item'),
        width: 800,
        element: createTextElement({
          content: 'Latest headlines • Native ticker',
          fontSize: 36,
          autoFit: 'fixed',
          verticalAlign: 'middle',
          overflowPolicy: 'clip',
        }),
      },
    ],
    ...overrides,
  });
}

export function createTickerLayer(): Layer {
  return createLayer('Ticker', createTickerElement());
}

export function createClockLayer(): Layer {
  const clock = normalizeClockTimerSettings({ referenceTimeMs: Date.now() });
  return createLayer(
    'Clock / Timer',
    createTextElement({
      clock,
      content: formatClockTimerValue(clock, clock.referenceTimeMs),
      autoFit: 'fixed',
      overflowPolicy: 'clip',
    }),
  );
}

export function createImageLayer(): Layer {
  return createLayer('Image', createImageElement());
}

export function createPathLayer(): Layer {
  return createLayer('Path', createPathElement());
}

export function createImageSequenceLayer(): Layer {
  return createLayer('Image Sequence', createImageSequenceElement());
}

export function createLottieLayer(): Layer {
  return createLayer('Lottie', createLottieElement());
}

export function createAudioElement(overrides: Partial<AudioElement> = {}): AudioElement {
  return {
    type: 'audio',
    src: null,
    volume: 1,
    loop: false,
    trimStartMs: 0,
    trimEndMs: null,
    timelineStartMs: 0,
    ...overrides,
  };
}

export function createAudioLayer(): Layer {
  return createLayer('Audio', createAudioElement());
}

export function createShaderLayer(): Layer {
  return createLayer('Shader', createRectangleElement({ fill: createShaderElement() }));
}

export function createLayerOfKind(kind: NewLayerKind): Layer {
  switch (kind) {
    case 'rectangle':
      return createRectangleLayer();
    case 'ellipse':
      return createEllipseLayer();
    case 'chart':
      return createChartLayer();
    case 'text':
      return createTextLayer();
    case 'ticker':
      return createTickerLayer();
    case 'clock':
      return createClockLayer();
    case 'image':
      return createImageLayer();
    case 'path':
      return createPathLayer();
    case 'pattern':
      return createLayer('Pattern', {
        type: 'pattern',
        patternId: '',
        fill: '#252b32',
        strokeColor: 'transparent',
        strokeWidth: 0,
      } satisfies PatternElement);
    case 'image-sequence':
      return createImageSequenceLayer();
    case 'lottie':
      return createLottieLayer();
    case 'audio':
      return createAudioLayer();
    case 'shader':
      return createShaderLayer();
  }
}

export function createKeyframe(overrides: Partial<Keyframe> = {}): Keyframe {
  return {
    id: createId('keyframe'),
    name: 'Keyframe',
    role: 'step',
    ...overrides,
  };
}

export function createLayerKeyframe(
  frame: number,
  transform: LayerTransform,
  overrides: Partial<LayerKeyframe> = {},
): LayerKeyframe {
  const normalizedTransform = normalizeAuthoredTransform(overrides.transform ?? transform);
  return {
    id: createId('layer-keyframe'),
    frame,
    easing: 'linear',
    ...overrides,
    transform: normalizedTransform,
  };
}

export function createLayerPropertyKeyframe(
  frame: number,
  value: number,
  overrides: Partial<LayerPropertyKeyframe> = {},
): LayerPropertyKeyframe {
  return {
    id: createId('property-keyframe'),
    frame: Math.round(frame),
    value,
    easing: 'linear',
    ...overrides,
  };
}

export function createLayerLoopClip(overrides: Partial<LayerLoopClip> = {}): LayerLoopClip {
  return {
    id: createId('layer-loop'),
    name: 'Loop',
    activation: { type: 'lifecycle' },
    durationFrames: 30,
    phaseOffsetFrames: 0,
    repeatCount: null,
    tracks: {},
    ...overrides,
  };
}

export const DEFAULT_FRAME_RATE = 25;
const DEFAULT_TRANSITION_FRAMES = 12;
const DEFAULT_TRANSITION_EASING: EasingPreset = 'linear';

export function createTransition(
  fromKeyframeId: string,
  toKeyframeId: string,
  overrides: Partial<Transition> = {},
): Transition {
  return {
    id: createId('transition'),
    fromKeyframeId,
    toKeyframeId,
    durationFrames: DEFAULT_TRANSITION_FRAMES,
    easing: DEFAULT_TRANSITION_EASING,
    ...overrides,
  };
}

/** The starting value for a freshly created field of this type. */
export function defaultOptionsForFieldType(type: FieldType): FieldOption[] {
  return type === 'select' || type === 'select-multiple'
    ? [{ value: 'option', label: 'Option' }]
    : [];
}

export function defaultConstraintsForFieldType(type: FieldType): FieldDefinition['constraints'] {
  if (type === 'percentage') return { minimum: 0, maximum: 100, step: 1 };
  if (type === 'integer' || type === 'duration-ms') return { step: 1 };
  if (type === 'array') return { minItems: 0, maxItems: 12 };
  return {};
}

export function defaultValueForFieldType(
  type: FieldType,
  options = defaultOptionsForFieldType(type),
): FieldDefinition['defaultValue'] {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'image-url':
    case 'file-path':
      return '';
    case 'number':
    case 'integer':
    case 'duration-ms':
    case 'percentage':
      return 0;
    case 'boolean':
      return false;
    case 'color':
      return '#ffffff';
    case 'gradient':
      return createDefaultGradient();
    case 'select':
      return options[0]?.value ?? '';
    case 'select-multiple':
    case 'array':
      return [];
    case 'object':
      return {};
  }
}

export function createFieldDefinition(
  type: FieldType,
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition {
  const options = overrides.options ?? defaultOptionsForFieldType(type);
  return {
    id: createId('field'),
    key: 'field',
    label: 'Field',
    description: '',
    type,
    defaultValue: defaultValueForFieldType(type, options),
    required: false,
    options,
    constraints: defaultConstraintsForFieldType(type),
    fileExtensions: [],
    properties: [],
    items:
      type === 'array'
        ? createFieldDefinition('object', { key: 'item', label: 'Item', required: true })
        : null,
    ...overrides,
  };
}

export function createFieldDefinitionFromInput(input: FieldSchemaInput): FieldDefinition {
  const options = input.options ?? defaultOptionsForFieldType(input.fieldType);
  const properties = (input.properties ?? []).map(createFieldDefinitionFromInput);
  const items =
    input.items === undefined
      ? undefined
      : input.items === null
        ? null
        : createFieldDefinitionFromInput(input.items);
  return createFieldDefinition(input.fieldType, {
    ...(input.id ? { id: input.id } : {}),
    key: input.key,
    label: input.label ?? input.key,
    description: input.description ?? '',
    required: input.required ?? false,
    ...(input.exposeToOgraf !== undefined ? { exposeToOgraf: input.exposeToOgraf } : {}),
    ...(input.nodosType !== undefined ? { nodosType: input.nodosType } : {}),
    options,
    constraints: input.constraints ?? defaultConstraintsForFieldType(input.fieldType),
    fileExtensions: input.fileExtensions ?? [],
    properties,
    ...(items !== undefined ? { items } : {}),
    ...(input.defaultValue !== undefined
      ? { defaultValue: input.defaultValue }
      : { defaultValue: defaultValueForFieldType(input.fieldType, options) }),
  });
}

export function createCustomActionDefinition(
  overrides: Partial<CustomActionDefinition> = {},
): CustomActionDefinition {
  return {
    id: createId('action'),
    actionId: 'action',
    name: 'Custom Action',
    description: '',
    ...overrides,
  };
}

export function createMediaCue(overrides: Partial<MediaCue> = {}): MediaCue {
  return {
    id: createId('media-cue'),
    name: 'Media Cue',
    sources: [],
    activeSourceId: null,
    trigger: { type: 'timeline', startFrame: 0 },
    trimStartMs: 0,
    trimEndMs: null,
    durationFrames: null,
    loop: false,
    speed: 1,
    volume: 1,
    muted: false,
    retrigger: 'restart',
    transition: {
      type: 'cut',
      durationFrames: 0,
      audio: 'follow-picture',
      onFailure: 'keep-current',
    },
    visual: {
      targetLayerId: null,
      fit: 'cover',
      positionX: 0.5,
      positionY: 0.5,
    },
    ...overrides,
  };
}

export function createAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: createId('asset'),
    name: 'Asset',
    kind: 'image',
    dataUri: '',
    mimeType: 'application/octet-stream',
    originalFileName: overrides.name ?? 'Asset',
    byteSize: 0,
    ...overrides,
  };
}

export function createComposition(overrides: Partial<Composition> = {}): Composition {
  const start = createKeyframe({ name: 'Start', role: 'start' });
  const step = createKeyframe({ name: 'Step 1', role: 'step' });
  const end = createKeyframe({ name: 'End', role: 'end' });
  const keyframes = overrides.keyframes ?? [start, step, end];
  const transitions =
    overrides.transitions ??
    keyframes
      .slice(1)
      .map((keyframe, index) => createTransition(keyframes[index]!.id, keyframe.id));
  return {
    id: createId('comp'),
    name: 'Main',
    width: 1920,
    height: 1080,
    backgroundColor: 'transparent',
    frameRate: DEFAULT_FRAME_RATE,
    updateTransitionFrames: 0,
    updateInterruption: 'queue',
    layout: {
      showRulers: true,
      showActionSafe: false,
      showTitleSafe: false,
      showCenterMarker: false,
      dimOutsideCanvas: true,
      presentationBackground: 'none',
      presentationBackgroundImageSource: '',
      presentationBackgroundImageName: '',
      snappingEnabled: true,
      snapToGrid: false,
      snapToGuides: true,
      snapToLayers: true,
      gridSize: 10,
      snapThreshold: 6,
      boundsMode: 'allow',
      overflowPreview: 'visible',
      guides: [],
      timelineFolders: [],
    },
    layers: [],
    dataFields: [],
    runtimeCollections: [],
    dataConnections: [],
    mediaCues: [],
    frameCues: [],
    patterns: [],
    rendererPlugins: [],
    customActions: [],
    assets: [],
    designSystem: { name: 'Brand Kit', tokens: [] },
    components: [],
    ...overrides,
    keyframes,
    transitions,
  };
}

export const PROJECT_DOCUMENT_VERSION = 37;

export function createProject(overrides: Partial<Project> = {}): Project {
  const mainComposition = createComposition({ name: 'Main', nodosInputFieldIds: [] });
  return {
    documentVersion: PROJECT_DOCUMENT_VERSION,
    id: createId('project'),
    name: 'Untitled Template',
    description: '',
    version: '0.1.0',
    author: { name: '' },
    supportsRealTime: true,
    supportsNonRealTime: true,
    mainCompositionId: mainComposition.id,
    compositions: [mainComposition],
    shaders: [],
    ...overrides,
  };
}
