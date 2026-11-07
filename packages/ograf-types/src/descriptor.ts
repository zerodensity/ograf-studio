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
  BlendMode,
  LayerTransform,
  LayerLoopClip,
  GradientPaint,
  MediaCue,
  RendererPluginSnapshot,
  FieldDefinition,
} from '@ograf-editor/scene-model';

export interface CompiledLayerBinding {
  dataKey: string;
  targetProperty: string;
  sourcePath?: string[];
  /** Runtime-expanded collection item index; absent for ordinary/object bindings. */
  itemIndex?: number;
  valueMap?: Record<string, string | number | boolean | GradientPaint>;
}

/** A data comparison with field ids resolved to the runtime data keys. */
export interface CompiledVisualRuleCondition {
  dataKey: string;
  sourcePath: string[];
  operator: import('@ograf-editor/scene-model').VisualRuleOperator;
  value?: unknown;
  compareDataKey?: string;
  compareSourcePath?: string[];
  ignoreCase?: boolean;
}

export interface CompiledLayerVisualRule extends CompiledVisualRuleCondition {
  id: string;
  name: string;
  enabled: boolean;
  /** Exported members of the owning group. The rule remains stored once on its owner. */
  scopeLayerIds?: string[];
  trigger?: import('@ograf-editor/scene-model').VisualRuleTrigger;
  timerAlarm?: import('@ograf-editor/scene-model').TimerAlarmTrigger;
  keyboard?: import('@ograf-editor/scene-model').VisualRuleKeyboardTrigger;
  conditions?: CompiledVisualRuleCondition[];
  match?: import('@ograf-editor/scene-model').VisualRuleMatch;
  eventId?: string;
  delayFrames?: number;
  /** Action targets are compiled layer ids; guide and other omitted targets are dropped. */
  actions: import('@ograf-editor/scene-model').VisualRuleAction[];
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
  /** Optional operator-facing label for runtime ticker queue feedback. */
  name?: string;
  /** Persistent membership retained only for deterministic modifier references. */
  groupId?: string | null;
  modifiers?: import('@ograf-editor/scene-model').LayerModifier[];
  isVisible: boolean;
  blendMode?: BlendMode;
  element: Element;
  /** Baked per-bar/per-slice plugin motion, independent of layer and data-replay animation. */
  chartMarkAnimations?: import('@ograf-editor/scene-model').CompiledChartMarkAnimations;
  effects: LayerEffects;
  /** Independently timed transform keys on the shared composition frame ruler. */
  keyframes: CompiledLayerKeyframe[];
  animationTracks: Partial<Record<AnimatableLayerProperty, CompiledLayerPropertyKeyframe[]>>;
  /** Deterministic local property clip; authoring IDs are retained only for source correlation. */
  loop?: (LayerLoopClip & { holdDataKey?: string; frameRate?: number }) | null;
  /** Resolved shared controller; source curves and paint remain independent. */
  lighting?:
    | (import('@ograf-editor/scene-model').PatternLightingLink & {
        definition: import('@ograf-editor/scene-model').TilingPattern;
      })
    | null;
  /** Ordered bindings; each target property may appear at most once. */
  bindings: CompiledLayerBinding[];
  /** Legacy editor-generated descriptors before document v11. */
  binding?: CompiledLayerBinding | null;
  visualRules?: CompiledLayerVisualRule[];
  /** Runtime-only clipping relation; general authoring parent metadata remains compiled away. */
  clipParentId?: string | null;
  crop?: import('@ograf-editor/scene-model').LayerCrop;
  /** Runtime flow relation retained only when the parent owns Auto layout. */
  layoutParentId?: string | null;
  /** Authoring parent retained only when a Grid/Radial Arrange or Justify modifier needs it. */
  modifierParentId?: string | null;
  autoLayout?: import('@ograf-editor/scene-model').LayerAutoLayout;
  updateTransition?: import('@ograf-editor/scene-model').LayerUpdateTransition;
  motionPath?: import('@ograf-editor/scene-model').LayerMotionPath | null;
  textPath?: import('@ograf-editor/scene-model').LayerTextPath | null;
  motionBlur?: { enabled: boolean; shutterAngle: number };
  isMaskOnly?: boolean;
  mask?: import('@ograf-editor/scene-model').LayerMask | null;
  /** Runtime-only visibility/data identity for one bounded collection slot. */
  collectionItem?: {
    collectionId: string;
    dataKey: string;
    slot: number;
    capacity: number;
    itemKeyPath: string[];
    sortPath: string[];
    sortDirection: 'none' | 'ascending' | 'descending';
    pageSize: number;
    page: number;
    offsetPerItem: { x: number; y: number };
    /** Authored layer this row copies; rules aimed at the prototype drive every row. */
    prototypeLayerId?: string;
  };
}

export interface CompiledRuntimeCollection {
  id: string;
  name: string;
  dataKey: string;
  prototypeGroupId?: string | null;
  prototypeLayers: CompiledLayer[];
  offsetPerItem: { x: number; y: number };
  capacity: number;
  overflow: 'truncate';
  itemKeyPath: string[];
  sortPath: string[];
  sortDirection: 'none' | 'ascending' | 'descending';
  pageSize: number;
  page: number;
}

export type CompiledPaintOrderEntry =
  { type: 'layer'; id: string } | { type: 'collection'; id: string };

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
  /** Longest authored custom-action clip, used for manifest scheduling metadata. */
  durationFrames: number;
}

/** Same function contract, with input/output field IDs resolved to GDD keys. */
export interface CompiledLogicFunctionDefinition extends Omit<
  import('@ograf-editor/scene-model').LogicFunctionDefinition,
  'inputs' | 'outputs'
> {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

/** Only branches containing internal fields need an external-input policy. */
export interface CompiledDataExposure {
  exposed: boolean;
  defaultValue?: unknown;
  properties?: Record<string, CompiledDataExposure>;
  items?: CompiledDataExposure;
}

/** A flattened, runtime-ready representation of a Composition — what `GraphicElement` interprets. */
export interface CompiledGraphicDescriptor {
  functions?: CompiledLogicFunctionDefinition[];
  width: number;
  height: number;
  crop?: import('@ograf-editor/scene-model').CropRect;
  backgroundColor: string;
  frameRate: number;
  updateTransitionFrames?: number;
  /** Preflight-proven start of the final exit tail; absent preserves authored timing. */
  exitTailStartFrame?: number;
  updateInterruption?: 'queue' | 'replace';
  dataExposure?: Record<string, CompiledDataExposure>;
  /** Includes internal defaults omitted from the public OGraf controller schema. */
  dataDefaults?: Record<string, unknown>;
  /** Editable field identity/ownership retained for package recovery, outside public GDD. */
  sourceDataFields?: FieldDefinition[];
  fonts?: CompiledFontResource[];
  rendererPlugins?: Array<RendererPluginSnapshot & { moduleUrl?: string }>;
  mediaCues?: MediaCue[];
  /** Stable authoring field IDs used by modifiers, resolved to ordinary OGraf data keys. */
  modifierDataKeys?: Record<string, string>;
  modifierDataDefaults?: Record<string, unknown>;
  layers: CompiledLayer[];
  /** Bounded array-driven prototypes expanded by the packaged runtime. */
  collections?: CompiledRuntimeCollection[];
  /** Stable interleaving of ordinary layers and runtime collections. */
  paintOrder?: CompiledPaintOrderEntry[];
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
