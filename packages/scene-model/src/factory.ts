import { createId } from './id';
import { createDefaultGradient } from './paint';
import type {
  Asset,
  Composition,
  CustomActionDefinition,
  Element,
  EllipseElement,
  FieldDefinition,
  FieldSchemaInput,
  FieldOption,
  FieldType,
  ImageElement,
  ImageSequenceElement,
  LottieElement,
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
  Project,
  RectangleElement,
  TextElement,
  Transition,
  EasingPreset,
} from './types';
import { normalizeAuthoredTransform } from './authoredTransform';

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
    borderRadius: 0,
    ...overrides,
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
    ...overrides,
    fontSize,
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
    constraints: { horizontal: 'left', vertical: 'top' },
    keyframes: [],
    animationTracks: {},
    loop: null,
    element,
    effects: createLayerEffects(),
    semantics: createLayerSemantics(),
    designTokenBindings: [],
    componentLink: null,
    bindings: [],
  };
}

export type NewLayerKind =
  'rectangle' | 'ellipse' | 'text' | 'image' | 'path' | 'image-sequence' | 'lottie';

/** The starting pose for a freshly created layer of this kind — a fresh object every call. */
export function defaultTransformFor(kind: NewLayerKind): LayerTransform {
  if (kind === 'text') return createDefaultTransform({ height: 64 });
  return createDefaultTransform();
}

/** New layers default to off-air in lifecycle boundary states and visible in pausable steps. */
export function defaultTransformForRole(kind: NewLayerKind, role: KeyframeRole): LayerTransform {
  const transform = defaultTransformFor(kind);
  if (role !== 'step') transform.opacity = 0;
  return transform;
}

export function createRectangleLayer(): Layer {
  return createLayer('Rectangle', createRectangleElement());
}

export function createEllipseLayer(): Layer {
  return createLayer('Ellipse', createEllipseElement());
}

export function createTextLayer(): Layer {
  return createLayer('Text', createTextElement());
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

export function createLayerOfKind(kind: NewLayerKind): Layer {
  switch (kind) {
    case 'rectangle':
      return createRectangleLayer();
    case 'ellipse':
      return createEllipseLayer();
    case 'text':
      return createTextLayer();
    case 'image':
      return createImageLayer();
    case 'path':
      return createPathLayer();
    case 'image-sequence':
      return createImageSequenceLayer();
    case 'lottie':
      return createLottieLayer();
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
    layout: {
      showRulers: true,
      showActionSafe: false,
      showTitleSafe: false,
      showCenterMarker: false,
      dimOutsideCanvas: false,
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
    customActions: [],
    assets: [],
    designSystem: { name: 'Brand Kit', tokens: [] },
    components: [],
    ...overrides,
    keyframes,
    transitions,
  };
}

export const PROJECT_DOCUMENT_VERSION = 22;

export function createProject(overrides: Partial<Project> = {}): Project {
  const mainComposition = createComposition({ name: 'Main' });
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
    ...overrides,
  };
}
