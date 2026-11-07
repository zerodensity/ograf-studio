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

export type Paint = string | GradientPaint | ShaderPaint | MediaPaint;

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

export type ChartPreset =
  | 'bar'
  | 'horizontal-bar'
  | 'stacked-bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'radar'
  | 'polar-area';

export interface ChartAnimation {
  /** Frame-sampled entrance, shared by timeline playback and OGraf seeking. */
  type: 'none' | 'grow' | 'reveal' | 'fade';
  durationFrames: number;
  delayFrames: number;
  /** Additional start delay per label or data point. */
  staggerFrames: number;
  easing: EasingPreset;
  /** Optional per-chart cubic Bézier, overriding the selected easing preset. */
  curve?: CubicBezierCurve;
  /** Replay the entrance when bound chart data changes through updateAction. */
  replayOnUpdate: boolean;
  /** Missing retains legacy entrance replay; morph starts changed marks at their displayed pose. */
  updateMode?: 'replay' | 'morph';
}

/** A data-only plugin preset applied to each bar or slice, never the chart axes or canvas. */
export interface ChartMarkAnimationPhase {
  reference: StudioPluginReference;
  presetId: string;
  parameters?: Record<string, number>;
  durationFrames: number;
  delayFrames: number;
  /** Delay per mark in dataset-major order, including separate stacked segments. */
  staggerFrames: number;
}

export type ChartMarkAnimationOptions = Omit<ChartMarkAnimationPhase, 'reference' | 'presetId'>;

export interface ChartMarkAnimations {
  in?: ChartMarkAnimationPhase;
  out?: ChartMarkAnimationPhase;
}

/** Portable numeric curves resolved against a unit mark; no installed pack is needed to play. */
export interface CompiledChartMarkAnimationPhase {
  startFrame: number;
  durationFrames: number;
  staggerFrames: number;
  /** Extra marks from runtime-bound data reuse the last authored stagger slot. */
  staggerSlots: number;
  tracks: Partial<Record<AnimationPresetTrackProperty, LayerPropertyKeyframe[]>>;
}

export interface CompiledChartMarkAnimations {
  in?: CompiledChartMarkAnimationPhase;
  out?: CompiledChartMarkAnimationPhase;
}

export type ChartMarkPose = Record<AnimationPresetTrackProperty, number>;

export interface ChartDataRow {
  id: string;
  label: string;
  value: number;
  color?: string;
}

/** Optional JSON-only presentation controls understood by Chart.js provider 1.1 and later. */
export interface ChartPresentation {
  valueAxis?: {
    min?: number;
    max?: number;
    step?: number;
    format?: 'number' | 'percent';
    decimals?: number;
  };
  fontFamily?: string;
  fontWeight?: number;
  maxBarThickness?: number;
  valueLabels?: { show: boolean; decimals?: number; suffix?: string };
  gradient?: { from: string; to: string };
}

/** Exact local renderer identity; charts without this reference need an assigned provider. */
export interface RendererPluginReference {
  id: string;
  version: string;
  sha256: string;
}

export interface RendererPluginManifest {
  schemaVersion: 1;
  apiVersion: 1;
  kind: 'chart';
  id: string;
  version: string;
  name: string;
  presets: ChartPreset[];
  /** Optional declared contracts; omitted by legacy providers. */
  chartFeatures?: Array<
    | 'presentation-v1'
    | 'canonical-data-v1'
    | 'morph-update-v1'
    | 'mark-paint-v1'
    | 'mark-animation-v1'
  >;
  /** Optional embedded PNG/WebP toolbar icon, limited to 32 KiB of decoded bytes. */
  icon?: string;
  description?: string;
  author?: string;
  /** Provider-declared library attribution; separate from the adapter/bundle license. */
  library?: {
    name: string;
    version: string;
    license?: string;
    author?: string;
    homepage?: string;
  };
  license: string;
}

/** Immutable installed bytes copied into the composition for portable preview and export. */
export interface RendererPluginSnapshot {
  manifest: RendererPluginManifest;
  source: string;
  licenseText: string;
  sha256: string;
}

export type StudioPluginReference = RendererPluginReference;

export interface AnimationPresetPluginManifest {
  schemaVersion: 1;
  apiVersion: 1;
  kind: 'animation-presets';
  id: string;
  version: string;
  name: string;
  license: string;
  author?: string;
  icon?: string;
  description?: string;
}

export interface AnimationPluginParameter {
  id: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export type AnimationPresetTrackProperty =
  | 'x'
  | 'y'
  | 'rotation'
  | 'opacity'
  | 'scale'
  | 'clipLeft'
  | 'clipRight'
  | 'clipTop'
  | 'clipBottom'
  | 'blur';

export interface AnimationPresetKey {
  at: number;
  value: number | 'on-air' | { parameter: string; multiplier?: number; offset?: number };
  easing?: EasingPreset;
}

export interface AnimationPresetTrack {
  property: AnimationPresetTrackProperty;
  mode: 'absolute' | 'offset' | 'factor';
  keys: AnimationPresetKey[];
}

export interface AnimationPluginPreset {
  id: string;
  name: string;
  description?: string;
  targetKinds?: Element['type'][];
  parameters?: AnimationPluginParameter[];
  tracks: { in?: AnimationPresetTrack[]; out?: AnimationPresetTrack[] };
}

export interface AnimationPresetPluginSnapshot {
  manifest: AnimationPresetPluginManifest;
  presets: AnimationPluginPreset[];
  licenseText: string;
  sha256: string;
}

export interface ShaderPackPluginManifest {
  schemaVersion: 1;
  apiVersion: 1;
  kind: 'shader-pack';
  id: string;
  version: string;
  name: string;
  license: string;
  author?: string;
  description?: string;
  icon?: string;
}

export type ShaderPackPresetTarget = 'fill' | 'outline' | 'effect';

export interface ShaderPackPreset {
  id: string;
  name: string;
  description?: string;
  targets: ShaderPackPresetTarget[];
  paint: ShaderPaint;
  license?: string;
  author?: string;
}

export interface ShaderPackPluginSnapshot {
  manifest: ShaderPackPluginManifest;
  shaders: ShaderPackPreset[];
  licenseText: string;
  sha256: string;
}

export type StudioPluginSnapshot =
  RendererPluginSnapshot | AnimationPresetPluginSnapshot | ShaderPackPluginSnapshot;

/** Last copied pack attribution; this is not an execution pin and edited paints keep it. */
export interface ShaderPackProvenance {
  reference: StudioPluginReference;
  presetId: string;
  packName: string;
  license: string;
  licenseText: string;
  author?: string;
}

export interface AnimationPresetApplyOptions {
  durationFrames: number;
  offsetFrames?: number;
  parameters?: Record<string, number>;
}

export interface AnimationPresetApplication {
  reference: StudioPluginReference;
  presetId: string;
  durationFrames: number;
  offsetFrames?: number;
  parameters: Record<string, number>;
}

/** JSON-only chart input; executable renderer code belongs in a separately pinned plugin. */
export interface ChartElement {
  type: 'chart';
  /** Optional standard paint for chart marks; absent retains dataset colors. */
  fill?: Paint;
  provider?: RendererPluginReference | null;
  preset: ChartPreset;
  data: {
    /** Canonical source. Derived labels/datasets must be regenerated from these rows. */
    mode?: 'counts' | 'percentages';
    rows?: ChartDataRow[];
    seriesLabel?: string;
    color?: string;
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor: string | string[];
      borderColor: string;
    }>;
  };
  textColor: string;
  fontSize: number;
  showLegend: boolean;
  showGrid: boolean;
  presentation?: ChartPresentation;
  /** Absent preserves the static rendering of charts authored before animation support. */
  animation?: ChartAnimation;
  /** Independent plugin In/Out for bars and slices. Ordinary chart animation remains separate. */
  markAnimations?: ChartMarkAnimations;
}

export interface TextRun {
  text: string;
  color?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontFamily?: string;
}

export interface TextPropertyAnimator {
  id: string;
  enabled: boolean;
  unit: 'character' | 'word' | 'line';
  start: number;
  end: number;
  offset: number;
  offsetKeyframes: Array<{ frame: number; value: number }>;
  shape: 'square' | 'ramp' | 'triangle' | 'round';
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  order: 'forward' | 'reverse' | 'center-out' | 'random';
  seed: number;
  durationFrames: number;
  properties: {
    opacity?: number;
    x?: number;
    y?: number;
    scale?: number;
    rotation?: number;
    blur?: number;
    color?: string;
    tracking?: number;
  };
}

export interface TextAnimation {
  /** Frame-sampled segment preset, starting at the lifecycle Start frame. */
  type:
    | 'none'
    | 'typewriter'
    | 'fade'
    | 'rise'
    | 'pop'
    | 'word-reveal'
    | 'flip'
    | 'blur'
    | 'rotate'
    | 'stretch'
    | 'roll-up'
    | 'roll-down'
    | 'count-up'
    | 'count-down';
  /** Unicode grapheme clusters keep emoji/combining marks intact; word mode reveals whole tokens. */
  split: 'grapheme' | 'word';
  /** Fixed OGraf-frame duration keeps realtime playback and non-realtime seeking deterministic. */
  durationFrames: number;
  cursor: 'none' | 'bar' | 'block';
  /** Deterministic cursor blink period in OGraf frames. */
  cursorBlinkFrames: number;
  /** Replay after a content-bound data value changes through updateAction. */
  replayOnUpdate: boolean;
  /** Optional public OGraf customAction id that replays this text animation. */
  customActionId: string | null;
  /** Additional deterministic per-property segment animators. */
  animators?: TextPropertyAnimator[];
  /** Optional numeric entrance value; absent/null chooses a start in the selected direction. */
  countFrom?: number | null;
  /** Optional digit motion for numeric counters; independent of the counting direction. */
  countRoll?: 'none' | 'up' | 'down';
}

export interface ClockTimerSettings {
  mode: 'clock' | 'count-up' | 'count-down';
  /** Manual displays an authored or bound value without advancing a timer. */
  source: 'automatic' | 'manual';
  manualValue: string | number;
  /** Time tokens: hh/h, mm/m, ss/s, SSS, dd/d, A/a; [brackets] escape literals. */
  format: string;
  hourCycle: '12' | '24';
  /** local, UTC, or an IANA time zone name. */
  timeZone: string;
  padHours: boolean;
  padMinutes: boolean;
  padSeconds: boolean;
  showAmPm: boolean;
  uppercaseAmPm: boolean;
  initialValueMs: number;
  /** Optional count-up stop/loop boundary. Count-down always ends at zero. */
  limitMs: number | null;
  endBehavior: 'stop' | 'continue' | 'loop';
  autoStart: boolean;
  pauseWhenOffAir: boolean;
  /** Captured wall-clock epoch for deterministic offline frame rendering. */
  referenceTimeMs: number;
  prefix: string;
  suffix: string;
}

/** A continuously repeated text strip, sampled from the graphic clock rather than CSS time. */
export interface TextCrawl {
  speedPixelsPerSecond: number;
  /** Composition pixels between the measured end of one copy and the next copy. */
  gap: number;
  direction: 'left' | 'right';
}

export interface TextElement {
  type: 'text';
  content: string;
  color: string;
  /** Absent retains the legacy solid text color. */
  fill?: Paint;
  /** Glyph outline colour; transparent with zero width preserves legacy rendering. */
  strokeColor: string;
  /** Independent procedural glyph outline; absent uses strokeColor. */
  strokePaint?: ShaderPaint;
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
  runs: TextRun[];
  direction: 'auto' | 'ltr' | 'rtl';
  language: string;
  textAnimation: TextAnimation;
  /** Optional seamless, data-responsive crawl inside the authored text box. */
  crawl?: TextCrawl;
  /** Dynamic time replaces content while retaining normal text paints, layout and effects. */
  clock?: ClockTimerSettings;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Source-space fractions; optional aspect ratio assists static authoring previews. */
export interface SourceCrop extends CropRect {
  sourceAspectRatio?: number;
}

export interface ImageElement {
  type: 'image';
  src: string | null;
  fit?: MediaPaintFit;
  crop?: SourceCrop;
  /** Procedural paint clipped by the source image alpha; absent retains source pixels. */
  fill?: ShaderPaint | MediaPaint;
}

/**
 * SVG path data authored through canvas point editing or pasted commands.
 * Renders as an inline `<svg viewBox="0 0 viewBoxWidth viewBoxHeight">` filling the
 * layer's full bounds, matching every other element type's 100%/100%-fill content pattern.
 */
export interface PathElement {
  type: 'path';
  /** Point-edited paths may extend beyond their original viewBox. Older paths stay clipped. */
  overflow?: 'visible';
  d: string;
  fill: Paint;
  fillRule: 'nonzero' | 'evenodd';
  strokeColor: string;
  strokeWidth: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** Optional nine-slice source insets; destination edge bands retain these pixel sizes. */
  stretchInsets?: { left: number; right: number; top: number; bottom: number };
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
  fit?: MediaPaintFit;
  crop?: SourceCrop;
  fill?: ShaderPaint | MediaPaint;
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
  fill?: ShaderPaint | MediaPaint;
}

/** Self-contained single-pass GLSL mainImage, driven by the composition clock in WebGL2. */
export type ShaderParameterValue = number | boolean | number[];

export interface ShaderParameterDefinition {
  name: string;
  glslType: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4';
  control: 'slider' | 'color' | 'toggle' | 'vector2';
  defaultValue: ShaderParameterValue;
  min?: number;
  max?: number;
  step?: number;
}

export type ShaderPaintSlot = 'fill' | 'stroke';

/** One portable static texture exposed to Image-pass GLSL as iChannel0. */
export interface ShaderImageInput {
  source: string;
  name?: string;
  wrap: 'clamp' | 'repeat';
  filter: 'linear' | 'nearest';
}

export interface ShaderPaint {
  type: 'shader';
  /** Optional author-facing resource name; absent uses the object and paint slot. */
  name?: string;
  fragmentSource: string;
  speed: number;
  resolutionScale: number;
  parameters: Record<string, ShaderParameterValue>;
  inputImage?: ShaderImageInput;
  packProvenance?: ShaderPackProvenance;
}

export type MediaPaintFit = 'cover' | 'contain' | 'fill';

export type MediaPaintSource =
  { kind: 'clip'; src: string } | { kind: 'live'; tag: string; fallback?: string };

/** Moving-image paint clipped by the object's native geometry or alpha. Audio is never emitted. */
export interface MediaPaint {
  type: 'media';
  source: MediaPaintSource;
  fit: MediaPaintFit;
  crop?: SourceCrop;
  /** Normalized focal point used by cover/contain placement. */
  positionX: number;
  positionY: number;
  loop: boolean;
  speed: number;
  offsetMs: number;
  trimEndMs: number | null;
  timelineStartMs: number;
  muted: true;
}

export interface AudioElement {
  type: 'audio';
  src: string | null;
  volume: number;
  loop: boolean;
  trimStartMs: number;
  trimEndMs: number | null;
  timelineStartMs: number;
}

/** @deprecated Import compatibility only; current scenes use a rectangle with ShaderPaint. */
export type ShaderElement = ShaderPaint;

/** A prepared visual segment. Explicit widths keep feed updates from moving visible content. */
export interface TickerItem {
  id: string;
  name?: string;
  width: number;
  height?: number;
  element: TickerContentElement;
  effects?: LayerEffects;
  animation?: {
    type: 'none' | 'fade' | 'rise' | 'scale';
    durationMs: number;
    delayMs: number;
  };
}

export type TickerContentElement =
  | RectangleElement
  | EllipseElement
  | TextElement
  | ImageElement
  | PathElement
  | PatternElement
  | ImageSequenceElement
  | LottieElement
  | ShaderElement;

/** Native mixed-content crawl, sampled in pixels per second independently of output FPS. */
export interface TickerElement {
  type: 'ticker';
  items: TickerItem[];
  speedPixelsPerSecond: number;
  gap: number;
  direction: 'left' | 'right';
  textDirection: 'auto' | 'ltr' | 'rtl';
  /** Visible passes retain their snapshots until they leave; missing values use next-appearance. */
  updatePolicy?: 'next-appearance' | 'immediate';
  /** Stationary viewport mask widths in composition pixels; background remains independent. */
  entryFade: number;
  exitFade: number;
  fadeSoftness: number;
  background?: Paint;
}

/** An authoring-only reusable shader; applying it creates an independent inline paint copy. */
export interface ShaderResource {
  id: string;
  paint: ShaderPaint;
}

export type Element =
  | RectangleElement
  | EllipseElement
  | ChartElement
  | TextElement
  | ImageElement
  | PathElement
  | PatternElement
  | ImageSequenceElement
  | LottieElement
  | TickerElement
  | AudioElement
  | ShaderElement;
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

export type VisualRuleOperator =
  | 'equals'
  | 'not-equals'
  | 'empty'
  | 'not-empty'
  | 'greater-than'
  | 'less-than'
  | 'greater-or-equal'
  | 'less-or-equal'
  /** Inclusive numeric range; `value` is a `[min, max]` pair. */
  | 'between'
  | 'contains'
  | 'not-contains'
  | 'starts-with'
  | 'ends-with'
  /** `value` is a list, or a comma-separated string. */
  | 'one-of'
  | 'not-one-of'
  | 'changed'
  | 'increased'
  | 'decreased';

/**
 * `data` and `hover` are states: their actions apply while the condition holds and revert when it
 * stops. Every other trigger is an event whose actions persist until a later rule replaces them.
 */
export type VisualRuleTrigger =
  | 'data'
  | 'hover'
  | 'click'
  | 'double-click'
  | 'pointer-enter'
  | 'pointer-leave'
  /** The primary mouse button (or a touch) went down on the layer. */
  | 'pointer-down'
  /** It was released after pressing on the layer, even if the pointer moved off it. */
  | 'pointer-up'
  /** A semantic keyboard key was pressed in interactive realtime playback. */
  | 'key-down'
  /** A semantic keyboard key was released in interactive realtime playback. */
  | 'key-up'
  /** The graphic reached its first step from the Start state. */
  | 'play'
  /** A step was reached; `eventId` names the step keyframe, empty means any step. */
  | 'step'
  /** The graphic started leaving towards its End state. */
  | 'stop'
  /** A custom action ran; `eventId` names the public custom action id. */
  | 'custom-action'
  /** A linked count-up/down timer crossed this rule's threshold once during its current run. */
  | 'timer-alarm';

/** A timer alarm is stored on its ordinary Rule, independently from the rule's action owner. */
export interface TimerAlarmTrigger {
  sourceLayerId: string;
  /** Threshold in milliseconds, inclusive from zero through MAX_TIMER_VALUE_MS. */
  thresholdMs: number;
  direction: 'up' | 'down';
}

/** DOM event.key semantics, with exact modifier matching and opt-in key-down repeats. */
export interface VisualRuleKeyboardTrigger {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  repeat?: boolean;
}

export interface VisualRuleKeyboardInput {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export type VisualRuleMatch = 'all' | 'any';

/** One comparison against runtime data. */
export interface VisualRuleCondition {
  fieldId: string;
  sourcePath: string[];
  operator: VisualRuleOperator;
  /** Literal comparison value; `[min, max]` for `between`, a list for `one-of`. */
  value?: unknown;
  /** Compare against another data field instead of the literal `value`. */
  compareFieldId?: string;
  compareSourcePath?: string[];
  /** Text comparisons ignore letter case. */
  ignoreCase?: boolean;
}

/** Sends a command through the template set's coordinated playout runtime. */
export interface VisualRulePlayoutAction {
  type: 'playout';
  operation: 'take' | 'update' | 'out' | 'clear';
  /** Stable Transition Logic lane ID; required for every rule command. */
  slotId: string;
  /** Required for Take; on Update this guards the current state without switching templates. */
  stateId?: string;
  /**
   * Literal data using runtime field keys. Take without data keeps the target's retained/default
   * values. Update without data uses the triggering rule's current template data; an explicit {}
   * applies no data patch. Out/Clear accept neither a state nor data.
   */
  data?: Record<string, FieldValue>;
}

/**
 * Absent `targetLayerId` means the layer that owns the rule. `targetGroupId` instead targets every
 * layer of an editor group (Edit > Group); exported packages list the members as separate actions.
 */
export type VisualRuleAction =
  | {
      type: 'visibility';
      visible: boolean;
      targetLayerId?: string;
      targetGroupId?: string;
      transitionFrames?: number;
    }
  /** Event triggers only: flips the target's current visibility. */
  | {
      type: 'toggle-visibility';
      targetLayerId?: string;
      targetGroupId?: string;
      transitionFrames?: number;
    }
  | {
      type: 'property';
      targetProperty: string;
      value: unknown;
      targetLayerId?: string;
      targetGroupId?: string;
      /** Numeric and colour values animate over this many frames; other values switch. */
      transitionFrames?: number;
    }
  | { type: 'custom-action'; actionId: string }
  | { type: 'play-sound'; cueId: string }
  | { type: 'take-media'; cueId: string; sourceId?: string }
  | { type: 'shader-animation'; actionId: string }
  | VisualRulePlayoutAction
  /**
   * Changes a data field inside the graphic as if it had been updated, so bindings and data rules
   * react. `value` is the new value for `set` and the step for `increase`/`decrease` (default 1).
   * A later update from the controller replaces it.
   */
  | {
      type: 'set-data';
      fieldId: string;
      mode: VisualRuleSetDataMode;
      value?: unknown;
      /** Compiled packages only: the runtime data key of `fieldId`. */
      dataKey?: string;
    };

export type VisualRuleSetDataMode = 'set' | 'toggle' | 'increase' | 'decrease';

/**
 * The inherited condition is the primary data condition of a `data` rule. `conditions` add more
 * data conditions, combined with the primary one by `match`; on every other trigger they act as a
 * guard that must also hold when the event fires.
 */
export interface LayerVisualRule extends VisualRuleCondition {
  id: string;
  name: string;
  enabled: boolean;
  /** Group owning this rule; stored once on one of its members. Missing means this object. */
  hostGroupId?: string;
  /** Missing in older projects means a data condition. */
  trigger?: VisualRuleTrigger;
  /** Required for timer-alarm; its source remains stable when the rule owner changes. */
  timerAlarm?: TimerAlarmTrigger;
  /** Required for key-down/key-up. Browser input is realtime only. */
  keyboard?: VisualRuleKeyboardTrigger;
  conditions?: VisualRuleCondition[];
  /** How the conditions combine; absent means `all`. */
  match?: VisualRuleMatch;
  /** Step keyframe id for `step`, public custom action id for `custom-action`. */
  eventId?: string;
  /** Event triggers only: wait this many frames before running the actions. */
  delayFrames?: number;
  actions: VisualRuleAction[];
}

export type HorizontalConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale';
export type VerticalConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';

export interface LayerConstraints {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
}

export type AutoLayoutDirection = 'none' | 'horizontal' | 'vertical';
export type AutoLayoutAlignment = 'start' | 'center' | 'end' | 'stretch';

/** Flow layout applied to this layer's direct children in paint order. */
export interface LayerAutoLayout {
  direction: AutoLayoutDirection;
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  align: AutoLayoutAlignment;
  hugWidth: boolean;
  hugHeight: boolean;
  /** Zero disables the corresponding authored clamp. */
  minWidth: number;
  maxWidth: number;
  collapseHidden: boolean;
}

export type LayerUpdateTransitionStyle =
  'inherit' | 'none' | 'crossfade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';

export interface LayerUpdateTransition {
  style: LayerUpdateTransitionStyle;
  /** Zero inherits the composition update duration. */
  durationFrames: number;
  distance: number;
}

export interface LayerMotionPath {
  sourceLayerId: string;
  progress: number;
  orientToPath: boolean;
  offsetX: number;
  offsetY: number;
  /** Base orientation in degrees added to the path tangent when orienting. Absent = 0. */
  rotationOffset?: number;
}

/** Composition-space reference. Groups use the union of their members' final visual bounds. */
export type GeometryReference =
  { kind: 'layer'; layerId: string } | { kind: 'group'; groupId: string };

export type ModifierValueSource =
  | { kind: 'layer'; layerId: string; property: 'content' | 'src' }
  | { kind: 'field'; fieldId: string; sourcePath: string[] };

export interface ModifierParamsByType {
  'max-text-width': {
    maxWidth: number;
    mode: 'squeeze' | 'shrink';
    minFontSize: number;
  };
  'auto-size': {
    source: GeometryReference;
    width: boolean;
    height: boolean;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    /** Zero disables a size clamp. */
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    /** The point of the owner's authored box retained as its dimensions change. */
    anchorX: number;
    anchorY: number;
  };
  'auto-follow': {
    source: GeometryReference;
    axisX: boolean;
    axisY: boolean;
    sourceAnchorX: number;
    sourceAnchorY: number;
    targetAnchorX: number;
    targetAnchorY: number;
    offsetX: number;
    offsetY: number;
  };
  'hide-empty': {
    source: ModifierValueSource;
    /** Absent targets the owner. Hiding is independent of animated alpha. */
    target?: GeometryReference;
    trimWhitespace: boolean;
    invert: boolean;
  };
  /** Arranges the owner's visible direct children (parentId) in a grid; descendants follow. */
  'grid-arrange': {
    /** Items per row (horizontal fill) or columns available (vertical fill). */
    columns: number;
    /** Zero grows rows as needed. Children beyond columns x rows are hidden. */
    rows: number;
    /** Composition-pixel pitch between neighbouring cells' top-left corners. */
    spreadX: number;
    spreadY: number;
    startCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    direction: 'horizontal' | 'vertical';
  };
  /** Places the owner's visible direct children around the owner's center on rings/arcs. */
  'radial-arrange': {
    /** Zero arranges every visible child; later children are hidden. */
    count: number;
    rings: number;
    innerRadius: number;
    outerRadius: number;
    /** Degrees; 0 = right, positive = clockwise on screen. */
    startAngle: number;
    endAngle: number;
    arrangement: 'equal' | 'radiate';
    startFromOuter: boolean;
    /** Rotate each child to point away from the center. */
    orient: boolean;
    baseRotation: number;
  };
  /** Aligns the union bounds of the owner's visible direct children to the owner's box. */
  justify: {
    horizontal: 'none' | 'left' | 'center' | 'right';
    vertical: 'none' | 'top' | 'center' | 'bottom';
    offsetX: number;
    offsetY: number;
  };
  /** Rotates the owner around its transform origin so one local axis faces a reference. */
  'look-at': {
    source: GeometryReference;
    axis: 'x' | 'y';
    flip: boolean;
    rotationOffset: number;
  };
}

export type LayerModifierType = keyof ModifierParamsByType;
export type LayerModifier = {
  [Type in LayerModifierType]: {
    id: string;
    type: Type;
    name: string;
    enabled: boolean;
    params: ModifierParamsByType[Type];
  };
}[LayerModifierType];

/** Stable modifier IDs keep property tracks attached when the pane is reordered. */
export type ModifierParameterProperty = `modifiers.${string}.${string}`;

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
  | 'blur'
  | 'backdrop-blur'
  | 'drop-shadow'
  | 'glow'
  | 'brightness'
  | 'contrast'
  | 'saturate'
  | 'hue-rotate'
  | 'shader';
export interface LayerEffect {
  id: string;
  name: string;
  type: EffectType;
  enabled: boolean;
  /** Omitted on existing documents: normal compositing at full strength. */
  blendMode?: EffectBlendMode;
  blendOpacity?: number;
  params: Record<string, number | string>;
  /** Present only for a true post-process shader effect; iChannel0 is the incoming stack image. */
  shader?: ShaderPaint;
  /** Compatibility adapter for pre-stack property tracks and color bindings. */
  legacy?: 'blur' | 'drop-shadow';
}
export type EffectBlendMode =
  'normal' | 'screen' | 'add' | 'multiply' | 'overlay' | 'darken' | 'lighten';
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
  | ShaderAnimationProperty
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
  /** Preserve a designer's local value while retaining the link for Reset to inherited. */
  overridden?: boolean;
}

export type TypographyProperty =
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textAlign'
  | 'textTransform';

/** Combined authoring styles; resolved into ordinary text values before export. */
export interface TypographyPreset {
  id: string;
  name: string;
  properties: Pick<TextElement, TypographyProperty>;
}

export interface TypographyBinding {
  presetId: string;
  overrides?: TypographyProperty[];
}

export interface BackgroundStyle {
  id: string;
  name: string;
  paint: Paint;
}

export interface DesignSystem {
  name: string;
  tokens: DesignToken[];
  typography?: TypographyPreset[];
  backgrounds?: BackgroundStyle[];
  /** The default output background for inheriting main compositions; null restores legacy color. */
  defaultBackgroundStyleId?: string | null;
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

/** Persistent source identity and inheritance state for a materialized component child. */
export interface ComponentLink {
  componentId: string;
  instanceId: string;
  sourceLayerId: string;
  /** Last inherited resolved defaults, excluding this link to keep the snapshot finite. */
  baseline?: Omit<Layer, 'componentLink'>;
  /** Explicit JSON Pointer paths; effect entries use their stable @ID selector. */
  overridePaths?: string[];
  /** Canonical field/schema node ID to persistent instance field/schema node ID. */
  fieldIds?: Record<string, string>;
  /** Canonical animation/key/loop ID to persistent instance ID. */
  keyIds?: Record<string, string>;
  fieldBaselines?: Record<string, FieldDefinition>;
  fieldOverridePaths?: Record<string, string[]>;
  /** Instance placement, independent of canonical child positions and animation defaults. */
  offset?: { x: number; y: number };
}

/** Track-only display properties: uniform scale (1 = authored size) and edge insets (0..1). */
export type LayerRevealProperty = 'scale' | 'clipLeft' | 'clipRight' | 'clipTop' | 'clipBottom';

/** A normalized gradient-stop offset track, where N is the zero-based stop index. */
export type GradientStopOffsetProperty = `fill.stops[${number}].offset`;
export type ShaderAnimationProperty =
  `fill.parameters.${string}` | `strokePaint.parameters.${string}`;

/** Numeric properties that can own keys independently on a layer's shared frame ruler. */
export type AnimatableLayerProperty =
  | EffectParameterProperty
  | ModifierParameterProperty
  | keyof LayerTransform
  | 'strokeWidth'
  | 'blur'
  | 'dropShadowOpacity'
  | 'dropShadowOffsetX'
  | 'dropShadowOffsetY'
  | 'dropShadowBlur'
  | 'motionPathProgress'
  | LayerRevealProperty
  | GradientStopOffsetProperty
  | ShaderAnimationProperty;

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

/** When a local property clip is active relative to the OGraf lifecycle or a custom action. */
export type LayerLoopActivation =
  | { type: 'step'; stepKeyframeId: string }
  | { type: 'lifecycle' }
  | { type: 'customAction'; customActionId: string };

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
  /** Optional shared transport. Only the listed holds follow the numeric seconds field. */
  timing?: {
    groupId: string;
    holdFieldId: string;
    holdRanges: Array<{ startFrame: number; endFrame: number }>;
  };
  tracks: LayerAnimationTracks;
}

/** A same-composition matte. Path mode uses geometry; alpha mode uses painted transparency. */
/**
 * Fade; Slide moves a short distance while fading; Fly enters from off-canvas; Focus un-blurs;
 * Wipe reveals from an edge or the centre; Scale grows from half size while fading; Pop springs
 * from nothing; Grow opens width/height from an edge; Spin turns in while fading; Drop falls in.
 */
export type LayerMotionStyle =
  'fade' | 'slide' | 'fly' | 'focus' | 'wipe' | 'scale' | 'pop' | 'grow' | 'spin' | 'drop';
/** Where an entrance comes from, or where an exit goes. `center` is Wipe and Grow only. */
export type LayerMotionDirection = 'left' | 'right' | 'up' | 'down' | 'center';

export interface LayerMotionSpec {
  style: LayerMotionStyle;
  /** Slide, Fly, Wipe, Grow and Spin (left = counter-clockwise, right = clockwise). */
  direction?: LayerMotionDirection;
  /** Frames of motion, finishing at the first Step (in) or End (out), minus offsetFrames. */
  durationFrames: number;
  /** Slide only: travel in composition pixels. */
  distance?: number;
  easing?: EasingPreset;
  /** Stagger: finish this many frames before the first Step (in) or End (out). */
  offsetFrames?: number;
}

export interface LayerMotion {
  in: LayerMotionSpec | null;
  out: LayerMotionSpec | null;
}

export interface LayerMask {
  sourceLayerId: string;
  mode: 'alpha' | 'path';
  inverted: boolean;
}

export interface LayerTextPath {
  sourceLayerId: string;
  startOffset: number;
  alignment: 'start' | 'center' | 'end';
}

export interface LayerCrop {
  /** Clockwise corners of the retained rectangle, expressed relative to the layer's full box. */
  points: Array<{ x: number; y: number }>;
}

export interface Layer {
  typographyBinding?: TypographyBinding;
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
  /** Non-destructive crop in normalized layer coordinates; group crops may cross its bounds. */
  crop?: LayerCrop;
  /** A mask-only layer remains available to matte consumers without painting on air. */
  isMaskOnly: boolean;
  mask: LayerMask | null;
  /** Rules applied when the composition dimensions change; results are baked into layer tracks. */
  constraints: LayerConstraints;
  /** Optional runtime flow for direct children; ordinary parent constraints remain independent. */
  autoLayout: LayerAutoLayout;
  updateTransition: LayerUpdateTransition;
  motionPath: LayerMotionPath | null;
  /** Optional experimental velocity-based blur for authored X/Y keyframes. */
  motionBlur?: { enabled: boolean; shutterAngle: number };
  /** Optional same-composition path used as a text baseline. */
  textPath?: LayerTextPath | null;
  /** Declarative frame-sampled geometry/visibility. Authored transform tracks are never rewritten. */
  modifiers?: LayerModifier[];
  /**
   * Authoring-only Animate In/Out choice. Its keys are baked into ordinary tracks, so exports and
   * other tools see plain animation; this only lets Studio show and re-apply the choice.
   */
  motion?: LayerMotion | null;
  /** Authoring provenance only; compiled graphics use the baked ordinary property tracks. */
  animationPresets?: { in?: AnimationPresetApplication; out?: AnimationPresetApplication };
  /** Independent animation keys on the composition frame ruler, sorted by frame. */
  keyframes: LayerKeyframe[];
  /** Canonical per-property animation tracks. Legacy full-pose keys remain as an aggregate view. */
  animationTracks: LayerAnimationTracks;
  /** New authoring layers opt into each property track; absent tracks hold the base pose/value. */
  animationTrackMode?: 'independent';
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
  /** Live authoring inheritance; compiled output still contains only this resolved normal layer. */
  componentLink: ComponentLink | null;
  /** Ordered data bindings applied to independent element properties at runtime. */
  bindings: LayerBinding[];
  /** Ordered no-code conditions evaluated after ordinary bindings. */
  visualRules: LayerVisualRule[];
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
  /** Identifies fields generated from explicitly annotated shader parameters. */
  generatedShaderParameter?: {
    layerId: string;
    name: string;
    glslType: ShaderParameterDefinition['glslType'];
    control: ShaderParameterDefinition['control'];
    value?: ShaderParameterValue;
    paintSlot?: ShaderPaintSlot;
  };
  required: boolean;
  /** False keeps this field internal to Studio/Rules; omitted means exposed for older sources. */
  exposeToOgraf?: boolean;
  /**
   * A Nodos engine type, such as nos.fb.vec4, that this field's Nodos pin has and that set the field's structure;
   * omitted means the pin's type follows the field's.
   */
  nodosType?: string;
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
  /** Final playout exposure switch; omitted retains the backwards-compatible exposed behavior. */
  exposeToOgraf?: boolean;
  /** Saved Nodos struct/enum name; its explicit field structure remains portable OGraf data. */
  nodosType?: string;
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
  /** Stable object key used to identify items across reordered snapshots. */
  itemKeyPath?: string[];
  sortPath?: string[];
  sortDirection?: 'none' | 'ascending' | 'descending';
  /** Zero uses capacity. */
  pageSize?: number;
  page?: number;
}

export interface DataConnectionMapping {
  fieldId: string;
  /** Dot-separated JSON path or CSV column name. */
  sourcePath: string;
}

/** Studio preview connector; exported OGraf still receives ordinary GDD data. */
export interface DataConnectionDefinition {
  id: string;
  name: string;
  format: 'json' | 'csv';
  source: 'url' | 'embedded' | 'public-markets';
  /** Omission retains legacy editor-only routing. */
  target?: 'editor-preview' | 'coordinated-preview' | 'both';
  publicMarkets?: { symbols: string[] };
  url: string;
  embeddedText: string;
  refreshMs: number;
  missing: 'default' | 'empty' | 'keep-last';
  enabled: boolean;
  mappings: DataConnectionMapping[];
}

export type MediaCueClipType = 'audio' | 'video';

export type MediaCueSource =
  | {
      id: string;
      name: string;
      kind: 'clip';
      mediaType: MediaCueClipType;
      /** URL, data URI, or asset:<id> reference. */
      src: string;
    }
  | {
      id: string;
      name: string;
      kind: 'live';
      tag: string;
      /** Optional image or video fallback URL/data URI/asset reference. */
      fallback?: string;
    };

export type MediaCueTrigger =
  | { type: 'timeline'; startFrame: number }
  | { type: 'lifecycle'; keyframeId: string }
  | { type: 'customAction'; actionId: string }
  | { type: 'manual' };

export interface MediaCueTransition {
  type: 'cut' | 'crossfade';
  durationFrames: number;
  audio: 'follow-picture' | 'cut' | 'crossfade';
  onFailure: 'keep-current' | 'fallback' | 'transparent';
}

/** Shared nonvisual transport for playable audio/video and renderer-provided live sources. */
export interface MediaCue {
  id: string;
  name: string;
  sources: MediaCueSource[];
  activeSourceId: string | null;
  trigger: MediaCueTrigger;
  trimStartMs: number;
  trimEndMs: number | null;
  /** Authored Timeline block length; null derives it from trim/source duration. */
  durationFrames: number | null;
  loop: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  retrigger: 'restart' | 'resume' | 'ignore';
  transition: MediaCueTransition;
  visual: {
    targetLayerId: string | null;
    fit: MediaPaintFit;
    crop?: SourceCrop;
    positionX: number;
    positionY: number;
  };
}

/** An author-defined `customAction` the Composition responds to — compiles into `manifest.customActions[]`. */
export interface CustomActionDefinition {
  id: string;
  /** Unique slug — the OGraf `customAction` id. */
  actionId: string;
  name: string;
  description: string;
}

export type LogicJsonValue =
  null | boolean | number | string | LogicJsonValue[] | { [key: string]: LogicJsonValue };

export interface LogicFunctionEvent {
  type: 'load' | 'play' | 'out' | 'data' | 'blur' | 'focus' | 'tick' | 'custom-action';
  actionId?: string;
  payload?: LogicJsonValue;
  changed?: Record<string, LogicJsonValue>;
}
export interface LogicFunctionContext {
  state: LogicJsonValue;
  data: Record<string, LogicJsonValue>;
  event: LogicFunctionEvent;
  nowMs: number;
  /** Latest authored composition pixels, present only when the function opts into mouse input. */
  pointer?: { x: number; y: number } | null;
}
export interface LogicFunctionResult {
  state?: LogicJsonValue;
  data?: Record<string, LogicJsonValue>;
  actions?: Array<{ name: string; payload?: LogicJsonValue }>;
  media?: Array<{
    name: string;
    command: 'play' | 'restart' | 'pause' | 'resume' | 'stop' | 'controls';
    gain?: number;
    muted?: boolean;
  }>;
  /** Absolute function clock milliseconds; null cancels, omission preserves the current timer. */
  wakeAt?: number | null;
}

/** Versioned logic runs in an isolated Worker; visible output stays ordinary bound layers. */
export interface LogicFunctionDefinition {
  type: 'javascript';
  version: 1;
  id: string;
  name: string;
  enabled: boolean;
  /** Opt into a sampled mouse snapshot and focus-gain events; movement alone never invokes it. */
  pointer?: boolean;
  /** A function expression (or an expression returning one), never privileged main-thread code. */
  source: string;
  /** Safe aliases mapped to authored field IDs. */
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  /** Public custom-action IDs delivered to this function. */
  actions: string[];
  /** Only these registered actions and media cues may be requested by result alias. */
  emits?: Record<string, string>;
  media?: Record<string, string>;
  initialState?: LogicJsonValue;
  /** Worker execution deadline, 16..1000 ms; defaults to 250. */
  timeoutMs?: number;
}

/**
 * An imported binary image stored once as a data URI. Elements and image-url field defaults may
 * refer to it as `asset:<id>`; editor rendering resolves that reference and package export writes
 * the asset once as a relative resource.
 */
export interface Asset {
  id: string;
  name: string;
  kind: 'image' | 'media' | 'audio' | 'font' | 'source';
  dataUri: string;
  mimeType: string;
  /** Original local filename retained for traceability after package-path normalization. */
  originalFileName?: string;
  /** Imported byte count, used for resource reporting without decoding the data URI. */
  byteSize?: number;
  /** Decoded duration for playable audio/video, captured at import time. */
  durationMs?: number;
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
 * An authoring-only reusable asset. Live instances remain materialized as ordinary layers and
 * data fields, so exported OGraf packages never depend on a proprietary component runtime.
 */
export interface ComponentDefinition {
  id: string;
  name: string;
  scope?: 'local' | 'set';
  layers: Layer[];
  dataFields: FieldDefinition[];
  resources?: Asset[];
  patterns?: TilingPattern[];
  /** Source clock and catalogs keep unused shared assets independent of their host template. */
  context?: ComponentSourceContext;
}

export interface ComponentSourceContext {
  frameRate: number;
  keyframes: Keyframe[];
  transitions: Transition[];
  customActions: CustomActionDefinition[];
  mediaCues?: MediaCue[];
  rendererPlugins?: RendererPluginSnapshot[];
  animationPresetPlugins?: AnimationPresetPluginSnapshot[];
  designSystem?: DesignSystem;
}

export type CanvasPresentationBackground = 'none' | 'big-buck-bunny' | 'still-image' | 'webcam';

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

/** Designer-only rows, keyed by field ID. Never compiled into OGraf data or schemas. */
export interface TestDataRundownRow {
  id: string;
  values: Record<string, FieldValue>;
}
export interface TestDataRundown {
  id: string;
  name: string;
  rows: TestDataRundownRow[];
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Output viewport in canvas pixels; authored positions and canvas dimensions remain unchanged. */
  crop?: CropRect;
  backgroundColor: string;
  /** Optional output paint. It replaces the legacy solid background and uses normal layer rendering. */
  backgroundPaint?: Paint;
  /** Authoring-only link; the resolved backgroundPaint remains self-contained. */
  backgroundStyleId?: string;
  backgroundPaintOverridden?: boolean;
  /** Frames per second the timeline is authored/scrubbed against (transition durations are in frames at this rate). */
  frameRate: number;
  /** Crossfade duration for updateAction, authored in composition frames. */
  updateTransitionFrames: number;
  /** New UI documents may request a short Out only when static-hold preflight proves it safe. */
  shortOutFrames?: number;
  updateInterruption: 'queue' | 'replace';
  /** Persistent authoring layout controls; excluded from compiled OGraf output. */
  layout: CompositionLayout;
  layers: Layer[];
  keyframes: Keyframe[];
  transitions: Transition[];
  dataFields: FieldDefinition[];
  /** Named authoring-only preview rows; omitted from all OGraf exports. */
  testRundowns?: TestDataRundown[];
  /** Runtime-expanded GDD array prototypes. */
  runtimeCollections: RuntimeCollectionDefinition[];
  dataConnections: DataConnectionDefinition[];
  /** Composition-level audio/video/live transports. They are timeline tracks, not canvas layers. */
  mediaCues: MediaCue[];
  patterns: TilingPattern[];
  rendererPlugins?: RendererPluginSnapshot[];
  animationPresetPlugins?: AnimationPresetPluginSnapshot[];
  customActions: CustomActionDefinition[];
  assets: Asset[];
  /** Portable, bounded functions/state logic with explicit data and action mappings. */
  functions?: LogicFunctionDefinition[];
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

/** Local editorial review; never used by the OGraf runtime or its GDD. */
export interface ProjectReviewComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  resolved: boolean;
  compositionId: string;
  layerId: string | null;
  frame: number;
  x: number;
  y: number;
}

export interface ProjectReviewVersion {
  id: string;
  name: string;
  createdAt: string;
  snapshot: Omit<Project, 'review'>;
}

export interface ProjectReview {
  comments: ProjectReviewComment[];
  versions: ProjectReviewVersion[];
  approval?: { author: string; at: string; fingerprint?: string };
}

export interface Project {
  /** Editor-only review, omitted when generating OGraf output. */
  review?: ProjectReview;
  /** Optional presentation sequence and notes; absent documents use their natural order. */
  presenter?: import('./presenter').PresenterDefinition;
  /** Authoring thumbnail frame; absent/null follows the first OGraf step. */
  thumbnailFrame?: number | null;
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
  shaders: ShaderResource[];
}
