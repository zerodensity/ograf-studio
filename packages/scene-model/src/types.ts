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

export interface RectangleElement {
  type: 'rectangle';
  fill: Paint;
  strokeColor: string;
  strokeWidth: number;
  borderRadius: number;
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
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  /** Auto size grows the authored box; shrink-to-fit reduces text inside a fixed authored box. */
  autoFit: 'auto-size' | 'shrink-to-fit' | 'fixed';
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
  fill: string;
  strokeColor: string;
  strokeWidth: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
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
  | ImageSequenceElement
  | LottieElement;
export type ElementType = Element['type'];

/** Which data Field drives a property of this layer, and which property. */
export interface LayerBinding {
  fieldId: string;
  targetProperty: string;
}

export type HorizontalConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale';
export type VerticalConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';

export interface LayerConstraints {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
}

export interface LayerEffects {
  blur: number;
  dropShadowEnabled: boolean;
  dropShadowColor: string;
  dropShadowOpacity: number;
  dropShadowOffsetX: number;
  dropShadowOffsetY: number;
  dropShadowBlur: number;
}

/** A normalized gradient-stop offset track, where N is the zero-based stop index. */
export type GradientStopOffsetProperty = `fill.stops[${number}].offset`;

/** Numeric properties that can own keys independently on a layer's shared frame ruler. */
export type AnimatableLayerProperty =
  | keyof LayerTransform
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

export interface Layer {
  id: string;
  name: string;
  isVisible: boolean;
  isGuide: boolean;
  /** Prevents direct authoring edits while retaining normal render/export behavior. */
  isLocked: boolean;
  /** Persistent editor grouping; grouped layers remain independent OGraf layers. */
  groupId: string | null;
  /** Authoring-time transform parent. Parent translation edits cascade into descendants. */
  parentId: string | null;
  /** Clip direct children to this layer's animated, rotation-aware bounds and rectangle radius. */
  clipChildren: boolean;
  /** Rules applied when the composition dimensions change; results are baked into layer tracks. */
  constraints: LayerConstraints;
  /** Independent animation keys on the composition frame ruler, sorted by frame. */
  keyframes: LayerKeyframe[];
  /** Canonical per-property animation tracks. Legacy full-pose keys remain as an aggregate view. */
  animationTracks: LayerAnimationTracks;
  /** Optional deterministic local clip sampled while its OGraf lifecycle activation is current. */
  loop: LayerLoopClip | null;
  element: Element;
  /** Static CSS effects shared by editor preview and the exported runtime. */
  effects: LayerEffects;
  /** When set, `targetProperty` on `element` is driven by data at runtime instead of its authored value. */
  binding: LayerBinding | null;
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
  'text' | 'textarea' | 'number' | 'boolean' | 'color' | 'gradient' | 'image-url';
export type FieldValue = string | number | boolean | GradientPaint;

/** One dynamic input the Composition accepts at runtime — compiles into the OGraf manifest's `schema`. */
export interface FieldDefinition {
  id: string;
  /** Unique property name — used as the JSON Schema key and the runtime data payload key. */
  key: string;
  label: string;
  type: FieldType;
  defaultValue: FieldValue;
  required: boolean;
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
  kind: 'image';
  dataUri: string;
  mimeType: string;
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

export interface CompositionLayout {
  showRulers: boolean;
  showActionSafe: boolean;
  showTitleSafe: boolean;
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
  /** Persistent authoring layout controls; excluded from compiled OGraf output. */
  layout: CompositionLayout;
  layers: Layer[];
  keyframes: Keyframe[];
  transitions: Transition[];
  dataFields: FieldDefinition[];
  customActions: CustomActionDefinition[];
  assets: Asset[];
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
  mainCompositionId: string;
  compositions: Composition[];
}
