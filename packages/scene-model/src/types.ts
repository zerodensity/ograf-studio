export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  transformOriginX: number;
  transformOriginY: number;
}

export interface GradientStop {
  /** Normalized position along the gradient, from 0 to 1. */
  offset: number;
  color: string;
  opacity: number;
}

export interface GradientPaint {
  type: 'linear' | 'radial' | 'conic';
  /** CSS degrees. Used by linear and conic gradients; ignored by radial gradients. */
  angle: number;
  stops: GradientStop[];
}

export type Paint = string | GradientPaint;

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface RectangleElement {
  type: 'rectangle';
  fill: Paint;
  strokeColor: string;
  strokeWidth: number;
  borderRadius: CornerRadii;
}

export interface EllipseElement {
  type: 'ellipse';
  fill: Paint;
  strokeColor: string;
  strokeWidth: number;
}

export interface TextElement {
  type: 'text';
  content: string;
  color: string;
  /** Glyph outline colour; transparent with zero width preserves legacy rendering. */
  strokeColor: string;
  /** Full CSS/SVG text-stroke width in authored composition pixels. */
  strokeWidth: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  /** Unitless line-height multiplier retained across font-size changes. */
  lineHeight: number;
  /** Additional tracking in authored composition pixels. */
  letterSpacing: number;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Positive values move the first baseline down inside the authored box. */
  baselineShift: number;
  /** Absolute legibility floor used by shrink-to-fit. */
  minFontSize: number;
  overflowPolicy: 'visible' | 'clip' | 'ellipsis';
  /** Squeeze deliberately scales glyph width and height independently to fill the authored box. */
  autoFit: 'auto-size' | 'shrink-to-fit' | 'fit-to-width' | 'squeeze' | 'fixed';
}

export interface ImageElement {
  type: 'image';
  src: string | null;
}

/**
 * Raw SVG path data authored by pasting a `d` attribute value — not an interactive pen tool (that's
 * future work). Renders as an inline `<svg viewBox="0 0 viewBoxWidth viewBoxHeight">` filling the
 * layer's full bounds, matching every other element type's 100%/100%-fill content pattern.
 */
export interface PathElement {
  type: 'path';
  d: string;
  fill: Paint;
  fillRule: 'nonzero' | 'evenodd';
  strokeColor: string;
  strokeWidth: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
}

/** Editable vector sources shared by every instance of a procedural pattern. */
export interface PatternSymbol {
  key: string;
  d: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  width: number;
  height: number;
  fillRule: 'nonzero' | 'evenodd';
}
export interface PatternEntry {
  symbolKey: string;
  gapScale: number;
}
export interface PatternRowOverride {
  row: number;
  direction?: 'left' | 'right';
  cycles?: number;
  phase?: number;
  widthScale?: number;
  blur?: number;
  opacity?: number;
}
export interface TilingPattern {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: number;
  rowHeight: number;
  fitRows: boolean;
  rowGap: number;
  gap: number;
  spacingVariation: number;
  seed: number;
  offsetX: number;
  offsetY: number;
  direction: 'left' | 'right' | 'alternate';
  cycleFrames: number;
  cyclesPerLoop: number;
  speedVariation: number;
  phase: number;
  rowPhaseStep: number;
  symbols: PatternSymbol[];
  sequence: PatternEntry[];
  rowOverrides: PatternRowOverride[];
  /** Optional shared light-loop clock and multipliers; absent preserves legacy rendering. */
  lighting?: PatternLighting | null;
}

export interface PatternLighting {
  enabled: boolean;
  cycleFrames: number;
  phase: number;
  intensity: number;
  glow: number;
  softness: number;
}
export interface PatternLightingLink {
  patternId: string;
  role: 'light' | 'glow';
  phaseOffset: number;
  gain: number;
  /** Whole sweeps per shared cycle, retaining deliberate speed differences. */
  cyclesPerLoop: number;
}
export interface PatternElement {
  type: 'pattern';
  patternId: string;
  /** Resolved by the compiler/preview; never an independent authoring copy. */
  definition?: TilingPattern;
  fill: Paint;
  strokeColor: string;
  strokeWidth: number;
}

/**
 * A self-playing looped flipbook — unlike every other element type, this one animates on its own
 * independent of the Keyframe/Transition system (the invariant that "element content is not
 * keyframe-varying" still holds; the frame-advance is a self-contained loop, analogous to an
 * embedded looping video, not a keyframe-driven property change). `frames` stores resolved
 * `data:` URIs directly (same "no asset-id indirection" pattern as `ImageElement.src`), so the
 * runtime never needs to know assets exist.
 */
export interface ImageSequenceElement {
  type: 'image-sequence';
  frames: string[];
  fps: number;
  loop: boolean;
}

/** A self-contained Bodymovin/Lottie document rendered from the composition's absolute clock. */
export interface LottieAnimationData extends Record<string, unknown> {
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  layers: unknown[];
  assets?: unknown[];
}

/**
 * A deterministic, continuously-looping Lottie animation. The JSON is embedded directly so the
 * exported OGraf package never depends on a CDN or a sidecar file. The first implementation uses
 * the canvas renderer and deliberately excludes expressions and external asset/font paths.
 */
export interface LottieElement {
  type: 'lottie';
  animationData: LottieAnimationData | null;
  speed: number;
}

export type Element =
  | RectangleElement
  | EllipseElement
  | TextElement
  | ImageElement
  | PathElement
  | PatternElement
  | ImageSequenceElement
  | LottieElement;
export type ElementType = Element['type'];

/** Which data Field drives a property of this layer, and which property. */
export interface LayerBinding {
  fieldId: string;
  targetProperty: string;
  /** Nested object path. Collection-prototype bindings resolve it relative to the current item. */
  sourcePath?: string[];
  /** Optional data-value mapping applied before assigning the bound element property. */
  valueMap?: Record<string, string | number | boolean | GradientPaint>;
}

export type HorizontalConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale';
export type VerticalConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';

export interface LayerConstraints {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
}

export interface LayerEffects {
  /** Ordered filters; omitted legacy documents resolve blur then shadow. IDs survive reordering. */
  stack?: LayerEffect[];
  blur: number;
  dropShadowEnabled: boolean;
  dropShadowColor: string;
  dropShadowOpacity: number;
  dropShadowOffsetX: number;
  dropShadowOffsetY: number;
  dropShadowBlur: number;
}

export type EffectType =
  'blur' | 'drop-shadow' | 'glow' | 'brightness' | 'contrast' | 'saturate' | 'hue-rotate';
export interface LayerEffect {
  id: string;
  name: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number | string>;
  /** Compatibility adapter for pre-stack property tracks and color bindings. */
  legacy?: 'blur' | 'drop-shadow';
}
export type EffectParameterProperty = `effects.${string}.${string}`;

/** Static composition-local CSS blending; never blends against the external video bed. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

/** Authoring-time meaning used by humans and agents; never required by an OGraf renderer. */
export type SemanticLayerRole =
  | 'none'
  | 'background'
  | 'container'
  | 'accent'
  | 'headline'
  | 'subheadline'
  | 'label'
  | 'value'
  | 'logo'
  | 'image'
  | 'icon'
  | 'mask'
  | 'decorative'
  | 'ticker'
  | 'score'
  | 'custom';

export interface LayerSemantics {
  role: SemanticLayerRole;
  /** Stable, model-readable labels such as "breaking-news", "team-home", or "primary". */
  tags: string[];
  /** Optional design intent that is more durable than a layer name. */
  description: string;
}

export type DesignTokenType = 'color' | 'number' | 'text' | 'font-family' | 'font-weight';
export type DesignTokenValue = string | number;
export type DesignTokenTargetProperty =
  | EffectParameterProperty
  | 'fill'
  | `fill.stops[${number}].color`
  | 'dropShadowColor'
  | 'strokeColor'
  | 'strokeWidth'
  | 'borderRadius'
  | 'borderRadiusTopLeft'
  | 'borderRadiusTopRight'
  | 'borderRadiusBottomRight'
  | 'borderRadiusBottomLeft'
  | 'color'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight';

/** Portable authoring token. Operations materialize its value into ordinary OGraf element data. */
export interface DesignToken {
  id: string;
  key: string;
  name: string;
  type: DesignTokenType;
  value: DesignTokenValue;
  description: string;
}

export interface DesignTokenBinding {
  tokenId: string;
  targetProperty: DesignTokenTargetProperty;
}

export interface DesignSystem {
  name: string;
  tokens: DesignToken[];
  /** Authoring-only values replaced by the first applied pack, retained across pack switches. */
  stylePackRestore?: StylePackRestoreState;
  /** Active pack palette links to existing color controls and their authored consumers. */
  stylePackColors?: StylePackColorLink[];
}

export interface StylePackColorLink {
  sourceTokenId: string;
  targetTokenId?: string;
  targetFieldId?: string;
  targets: Array<{ layerId: string; property: DesignTokenTargetProperty }>;
  factor: number;
  alpha: number;
}

export interface StylePackPropertyRestore {
  property: DesignTokenTargetProperty;
  value: Paint | CornerRadii | number;
  minFontSize?: number;
  bindings: DesignTokenBinding[];
  constantKey?: { id: string; value: number };
}
export interface StylePackRestoreState {
  name: string;
  updateTransitionFrames: number;
  tokens: Array<{ index: number; token: DesignToken }>;
  layers: Array<{
    layerId: string;
    elementType: Element['type'];
    properties: StylePackPropertyRestore[];
    bindingOrder?: DesignTokenTargetProperty[];
  }>;
  fields: Array<{ fieldId: string; defaultValue: FieldValue; defaultTokenId?: string }>;
  colorFieldIds?: string[];
}

/** Optional authoring link back to a reusable component snapshot. */
export interface ComponentLink {
  componentId: string;
  instanceId: string;
  sourceLayerId: string;
}

/** A normalized gradient-stop offset track, where N is the zero-based stop index. */
export type GradientStopOffsetProperty = `fill.stops[${number}].offset`;

/** Numeric properties that can own keys independently on a layer's shared frame ruler. */
export type AnimatableLayerProperty =
  | EffectParameterProperty
  | keyof LayerTransform
  | 'strokeWidth'
  | 'blur'
  | 'dropShadowOpacity'
  | 'dropShadowOffsetX'
  | 'dropShadowOffsetY'
  | 'dropShadowBlur'
  | GradientStopOffsetProperty;

export type EasingPreset =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'quad-in'
  | 'quad-out'
  | 'quad-in-out'
  | 'cubic-in'
  | 'cubic-out'
  | 'cubic-in-out'
  | 'quart-in'
  | 'quart-out'
  | 'quart-in-out'
  | 'quint-in'
  | 'quint-out'
  | 'quint-in-out'
  | 'sine-in'
  | 'sine-out'
  | 'sine-in-out'
  | 'expo-in'
  | 'expo-out'
  | 'expo-in-out'
  | 'circ-in'
  | 'circ-out'
  | 'circ-in-out'
  | 'back-in'
  | 'back-out'
  | 'back-in-out'
  | 'bounce-in'
  | 'bounce-out'
  | 'bounce-in-out'
  | 'elastic-in'
  | 'elastic-out'
  | 'elastic-in-out';

export interface CubicBezierCurve {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One independently timed transform key on a layer's own animation track. */
export interface LayerKeyframe {
  id: string;
  frame: number;
  transform: LayerTransform;
  /** Interpolation used while approaching this key from the preceding key. */
  easing: EasingPreset;
}

/** One value key on one property track. Interpolation uses this key's incoming easing. */
export interface LayerPropertyKeyframe {
  id: string;
  frame: number;
  value: number;
  easing: EasingPreset;
  /** When present, this editable curve overrides the named easing preset. */
  curve?: CubicBezierCurve;
}

export type LayerAnimationTracks = Partial<
  Record<AnimatableLayerProperty, LayerPropertyKeyframe[]>
>;

/** When a local loop is active relative to the OGraf lifecycle. */
export type LayerLoopActivation = { type: 'step'; stepKeyframeId: string } | { type: 'lifecycle' };

/**
 * A layer-local animation clip. Its keys use a local 0..durationFrames ruler and never become
 * composition keys or OGraf lifecycle markers. All properties share the clip duration while
 * retaining independent keys, easing, and curves.
 */
export interface LayerLoopClip {
  id: string;
  name: string;
  activation: LayerLoopActivation;
  durationFrames: number;
  phaseOffsetFrames: number;
  /** null repeats indefinitely; a positive integer plays that many cycles and holds the end. */
  repeatCount: number | null;
  tracks: LayerAnimationTracks;
}

/** A same-composition matte. Path mode uses geometry; alpha mode uses painted transparency. */
export interface LayerMask {
  sourceLayerId: string;
  mode: 'alpha' | 'path';
  inverted: boolean;
}

export interface Layer {
  id: string;
  name: string;
  isVisible: boolean;
  isGuide: boolean;
  /** Static blend against earlier layers inside the isolated OGraf composition only. */
  blendMode: BlendMode;
  /** Prevents direct authoring edits while retaining normal render/export behavior. */
  isLocked: boolean;
  /** Persistent editor grouping; grouped layers remain independent OGraf layers. */
  groupId: string | null;
  /** Authoring-time transform parent. Parent translation edits cascade into descendants. */
  parentId: string | null;
  /** Clip direct children to this layer's animated, rotation-aware bounds and rectangle radius. */
  clipChildren: boolean;
  /** A mask-only layer remains available to matte consumers without painting on air. */
  isMaskOnly: boolean;
  mask: LayerMask | null;
  /** Rules applied when the composition dimensions change; results are baked into layer tracks. */
  constraints: LayerConstraints;
  /** Independent animation keys on the composition frame ruler, sorted by frame. */
  keyframes: LayerKeyframe[];
  /** Canonical per-property animation tracks. Legacy full-pose keys remain as an aggregate view. */
  animationTracks: LayerAnimationTracks;
  /** Optional deterministic local clip sampled while its OGraf lifecycle activation is current. */
  loop: LayerLoopClip | null;
  /** Shares light-loop timing and strength without rewriting authored keys or paint. */
  lighting?: PatternLightingLink | null;
  element: Element;
  /** Static CSS effects shared by editor preview and the exported runtime. */
  effects: LayerEffects;
  /** Authoring-only semantic meaning for design recipes, querying, QA, and agent collaboration. */
  semantics: LayerSemantics;
  /** Authoring-only links whose current values are materialized into standard element properties. */
  designTokenBindings: DesignTokenBinding[];
  /** Explicitly refreshable authoring link; compiled output still contains only this normal layer. */
  componentLink: ComponentLink | null;
  /** Ordered data bindings applied to independent element properties at runtime. */
  bindings: LayerBinding[];
}

export type KeyframeRole = 'start' | 'step' | 'end';

/**
 * A named pose of the whole Composition. Only `step` keyframes are pausable OGraf steps; `start`
 * and `end` are explicit lifecycle states that make first-play, stop, and play-past-last behavior
 * unambiguous.
 */
export interface Keyframe {
  id: string;
  name: string;
  role: KeyframeRole;
}

/** How the Composition animates from one Keyframe's poses to another's. */
export interface Transition {
  id: string;
  fromKeyframeId: string;
  toKeyframeId: string;
  durationFrames: number;
  easing: EasingPreset;
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'duration-ms'
  | 'percentage'
  | 'boolean'
  | 'color'
  | 'gradient'
  | 'image-url'
  | 'file-path'
  | 'select'
  | 'select-multiple'
  | 'object'
  | 'array';
export type FieldObjectValue = { [key: string]: FieldValue };
export type FieldValue =
  string | number | boolean | null | FieldValue[] | FieldObjectValue | GradientPaint;

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldConstraints {
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  step?: number;
  minItems?: number;
  maxItems?: number;
}

/** One dynamic input the Composition accepts at runtime — compiles into the OGraf manifest's `schema`. */
export interface FieldDefinition {
  id: string;
  /** Unique property name — used as the JSON Schema key and the runtime data payload key. */
  key: string;
  label: string;
  /** Operator-facing help text emitted as JSON Schema description. */
  description: string;
  type: FieldType;
  defaultValue: FieldValue;
  /** Authoring-only link: a color Brand Kit token materializes this field's default. */
  defaultTokenId?: string | null;
  required: boolean;
  /** Ordered values/labels for select and select-multiple controls. */
  options: FieldOption[];
  /** JSON Schema validation communicated to playout/operator form builders. */
  constraints: FieldConstraints;
  /** Optional extension allowlist for file-path and image-path controls. */
  fileExtensions: string[];
  /** Ordered nested properties when type is object. */
  properties: FieldDefinition[];
  /** One recursive item schema when type is array. */
  items: FieldDefinition | null;
}

/** ID-optional recursive input used by editor/MCP authoring operations. */
export interface FieldSchemaInput {
  id?: string;
  key: string;
  label?: string;
  description?: string;
  fieldType: FieldType;
  defaultValue?: FieldValue;
  required?: boolean;
  options?: FieldOption[];
  constraints?: FieldConstraints;
  fileExtensions?: string[];
  properties?: FieldSchemaInput[];
  items?: FieldSchemaInput | null;
}

export interface RuntimeCollectionDefinition {
  id: string;
  name: string;
  /** Array field whose object items populate the prototype. */
  fieldId: string;
  /** Contiguous paint-ordered layers authored as one grouped item prototype. */
  prototypeLayerIds: string[];
  /** Deterministic translation added for each subsequent item index. */
  offsetPerItem: { x: number; y: number };
  /** Hard authored/rendered item limit; W12b.1 supports 1..100. */
  capacity: number;
  overflow: 'truncate';
}

/** An author-defined `customAction` the Composition responds to — compiles into `manifest.customActions[]`. */
export interface CustomActionDefinition {
  id: string;
  /** Unique slug — the OGraf `customAction` id. */
  actionId: string;
  name: string;
  description: string;
}

/**
 * An imported binary image stored once as a data URI. Elements and image-url field defaults may
 * refer to it as `asset:<id>`; editor rendering resolves that reference and package export writes
 * the asset once as a relative resource.
 */
export interface Asset {
  id: string;
  name: string;
  kind: 'image' | 'font' | 'source';
  dataUri: string;
  mimeType: string;
  /** Original local filename retained for traceability after package-path normalization. */
  originalFileName?: string;
  /** Imported byte count, used for resource reporting without decoding the data URI. */
  byteSize?: number;
  /** Optional validated relative package path. Defaults to assets/<asset-id>.<extension>. */
  packagePath?: string;
  /** CSS family name registered by the exported runtime when kind is font. */
  fontFamily?: string;
  /** CSS FontFace descriptors for a packaged font. */
  fontWeight?: string;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  /** Optional licensing metadata distributed with the editable project. */
  licenseName?: string;
  licenseUrl?: string;
  licenseText?: string;
}

export interface CanvasGuide {
  id: string;
  axis: 'vertical' | 'horizontal';
  position: number;
}

/** Editor-only timeline organization. Members remain independent layers in paint and runtime order. */
export interface TimelineFolder {
  id: string;
  name: string;
  color: string;
  layerIds: string[];
}

/**
 * An authoring-only reusable snapshot. Instantiation materializes ordinary independent layers and
 * data fields, so exported OGraf packages never depend on a proprietary component runtime.
 */
export interface ComponentDefinition {
  id: string;
  name: string;
  layers: Layer[];
  dataFields: FieldDefinition[];
}

export type CanvasPresentationBackground = 'none' | 'big-buck-bunny' | 'still-image';

export interface CompositionLayout {
  showRulers: boolean;
  showActionSafe: boolean;
  showTitleSafe: boolean;
  showCenterMarker: boolean;
  dimOutsideCanvas: boolean;
  presentationBackground: CanvasPresentationBackground;
  /** Editor-only remote URL or embedded image data URL. Never compiled into playout output. */
  presentationBackgroundImageSource: string;
  /** Display name retained for an embedded local image. */
  presentationBackgroundImageName: string;
  snappingEnabled: boolean;
  snapToGrid: boolean;
  snapToGuides: boolean;
  snapToLayers: boolean;
  gridSize: number;
  snapThreshold: number;
  boundsMode: 'allow' | 'contain';
  overflowPreview: 'visible' | 'clip';
  guides: CanvasGuide[];
  timelineFolders: TimelineFolder[];
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  /** Frames per second the timeline is authored/scrubbed against (transition durations are in frames at this rate). */
  frameRate: number;
  /** Crossfade duration for updateAction, authored in composition frames. */
  updateTransitionFrames: number;
  /** Persistent authoring layout controls; excluded from compiled OGraf output. */
  layout: CompositionLayout;
  layers: Layer[];
  keyframes: Keyframe[];
  transitions: Transition[];
  dataFields: FieldDefinition[];
  /** Runtime-expanded GDD array prototypes. */
  runtimeCollections: RuntimeCollectionDefinition[];
  patterns: TilingPattern[];
  customActions: CustomActionDefinition[];
  assets: Asset[];
  /** Brand kit and reusable style decisions; omitted from compiled OGraf output. */
  designSystem: DesignSystem;
  /** Reusable authoring snapshots; omitted from compiled OGraf output. */
  components: ComponentDefinition[];
}

export interface ProjectAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface Project {
  /** Version of the editor document shape, independent from the exported Graphic version. */
  documentVersion: number;
  id: string;
  name: string;
  description: string;
  version: string;
  author: ProjectAuthor;
  supportsRealTime: boolean;
  supportsNonRealTime: boolean;
  mainCompositionId: string;
  compositions: Composition[];
}
