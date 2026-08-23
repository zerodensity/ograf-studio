// The runtime-facing "compiled" contract between packages/codegen (producer: Project ->
// CompiledGraphicDescriptor) and packages/ograf-runtime (consumer: GraphicElement interprets
// one). Lives here, not in either of those packages, specifically to avoid a dependency cycle —
// codegen depends on ograf-runtime (to bundle its built output into an exported main.js), so
// ograf-runtime can't depend back on codegen just to import this type.
//
// Element/LayerTransform/EasingPreset are the editor's own authoring types (from scene-model) —
// reused here as-is rather than duplicated, since a compiled layer's element/pose shape is
// identical to an authored one, just flattened out of the Project/Composition tree.
import type {
  AnimatableLayerProperty,
  EasingPreset,
  CubicBezierCurve,
  Element,
  KeyframeRole,
  LayerEffects,
  LayerTransform,
  LayerLoopClip,
  GradientPaint,
} from '@ograf-editor/scene-model';

export interface CompiledLayerBinding {
  dataKey: string;
  targetProperty: string;
  valueMap?: Record<string, string | number | boolean | GradientPaint>;
}

export interface CompiledFontResource {
  family: string;
  source: string;
  mimeType: string;
  weight?: string;
  style?: 'normal' | 'italic' | 'oblique';
}

export interface CompiledLayer {
  id: string;
  isVisible: boolean;
  element: Element;
  effects: LayerEffects;
  /** Independently timed transform keys on the shared composition frame ruler. */
  keyframes: CompiledLayerKeyframe[];
  animationTracks: Partial<Record<AnimatableLayerProperty, CompiledLayerPropertyKeyframe[]>>;
  /** Deterministic local property clip; authoring IDs are retained only for source correlation. */
  loop?: LayerLoopClip | null;
  /** Ordered bindings; each target property may appear at most once. */
  bindings: CompiledLayerBinding[];
  /** Legacy editor-generated descriptors before document v11. */
  binding?: CompiledLayerBinding | null;
  /** Runtime-only clipping relation; general authoring parent metadata remains compiled away. */
  clipParentId?: string | null;
}

export interface CompiledLayerPropertyKeyframe {
  id: string;
  frame: number;
  value: number;
  easing: EasingPreset;
  curve?: CubicBezierCurve;
}

export interface CompiledLayerKeyframe {
  id: string;
  frame: number;
  transform: LayerTransform;
  easing: EasingPreset;
}

export interface CompiledKeyframe {
  id: string;
  /** Precomputed cumulative frame position — the runtime never re-derives this. */
  frame: number;
  role: KeyframeRole;
}

export interface CompiledTransition {
  fromKeyframeId: string;
  toKeyframeId: string;
  durationFrames: number;
  easing: EasingPreset;
}

export interface CompiledCustomActionRef {
  /** The OGraf customAction id (FieldDefinition/CustomActionDefinition's `actionId`, resolved). */
  id: string;
  name: string;
}

/** A flattened, runtime-ready representation of a Composition — what `GraphicElement` interprets. */
export interface CompiledGraphicDescriptor {
  width: number;
  height: number;
  backgroundColor: string;
  frameRate: number;
  updateTransitionFrames?: number;
  fonts?: CompiledFontResource[];
  layers: CompiledLayer[];
  keyframes: CompiledKeyframe[];
  transitions: CompiledTransition[];
  /** The pausable states `playAction` navigates, in order. */
  stepKeyframeIds: string[];
  /** `stepKeyframeIds.length` — mirrored here because it is what the manifest publishes. */
  stepCount: number;
  startKeyframeId: string;
  endKeyframeId: string;
  /** Valid `customAction(id)` targets — GraphicElement rejects anything not in this list. */
  customActions: CompiledCustomActionRef[];
}
