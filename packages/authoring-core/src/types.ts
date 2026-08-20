import type {
  AnimatableLayerProperty,
  CubicBezierCurve,
  CompositionLayout,
  EasingPreset,
  FieldType,
  FieldValue,
  LayerBinding,
  LayerEffects,
  LayerConstraints,
  LayerTransform,
  NewLayerKind,
  LayerLoopActivation,
  Project,
} from '@ograf-editor/scene-model';
import type { ProjectValidationResult } from '@ograf-editor/validation';

export type AuthoringOperation =
  | {
      type: 'set_project_metadata';
      name?: string;
      description?: string;
      version?: string;
      author?: { name: string; email?: string; url?: string };
    }
  | {
      type: 'set_composition';
      compositionId?: string;
      name?: string;
      width?: number;
      height?: number;
      frameRate?: number;
      backgroundColor?: string;
    }
  | {
      type: 'set_composition_layout';
      compositionId?: string;
      patch: Partial<Omit<CompositionLayout, 'guides'>>;
    }
  | {
      type: 'add_canvas_guide';
      compositionId?: string;
      axis: 'vertical' | 'horizontal';
      position: number;
    }
  | {
      type: 'update_canvas_guide';
      compositionId?: string;
      guideId: string;
      position: number;
    }
  | { type: 'remove_canvas_guide'; compositionId?: string; guideId: string }
  | {
      type: 'create_timeline_group';
      compositionId?: string;
      /** Internally preallocated so the generated group ID is stable in the result. */
      id?: string;
      layerIds: string[];
      name?: string;
      color?: string;
    }
  | {
      type: 'rename_timeline_group';
      compositionId?: string;
      groupId: string;
      name: string;
    }
  | {
      type: 'set_timeline_group_color';
      compositionId?: string;
      groupId: string;
      color: string;
    }
  | { type: 'ungroup_timeline_group'; compositionId?: string; groupId: string }
  | {
      type: 'add_asset';
      compositionId?: string;
      name: string;
      mimeType: string;
      /** Base64 payload without a data-URI prefix. */
      data: string;
    }
  | {
      type: 'add_layer';
      compositionId?: string;
      /** Internally preallocated so later operations in the same atomic batch can resolve it. */
      id?: string;
      kind: NewLayerKind;
      name?: string;
      transform?: Partial<LayerTransform>;
      element?: Record<string, unknown>;
      effects?: Partial<LayerEffects>;
      index?: number;
    }
  | {
      type: 'duplicate_group';
      compositionId?: string;
      source:
        | { groupId: string; parentId?: never; layerIds?: never }
        | { parentId: string; groupId?: never; layerIds?: never }
        | { layerIds: string[]; groupId?: never; parentId?: never };
      count: number;
      transformOffset?: { x?: number; y?: number };
      frameOffset?: number;
      namePattern?: string;
      bindings?: 'share' | 'clone' | 'clear';
      fieldKeyRewrite?: { from: string; to: string };
      labelRewrite?: { from: string; to: string };
    }
  | { type: 'remove_layer'; compositionId?: string; layerId: string }
  | { type: 'rename_layer'; compositionId?: string; layerId: string; name: string }
  | {
      type: 'set_layer_flags';
      compositionId?: string;
      layerId: string;
      isVisible?: boolean;
      isGuide?: boolean;
    }
  | {
      type: 'set_layer_layout';
      compositionId?: string;
      layerId: string;
      isLocked?: boolean;
      /** Clip direct children to this layer's animated rectangular bounds. */
      clipChildren?: boolean;
      groupId?: string | null;
      parentId?: string | null;
      constraints?: Partial<LayerConstraints>;
    }
  | {
      type: 'update_element';
      compositionId?: string;
      layerId: string;
      patch: Record<string, unknown>;
    }
  | {
      type: 'update_transform';
      compositionId?: string;
      layerId: string;
      scope?: 'authored' | 'frame';
      frame?: number;
      patch: Partial<LayerTransform>;
    }
  | {
      type: 'update_effects';
      compositionId?: string;
      layerId: string;
      scope?: 'authored' | 'frame';
      frame?: number;
      patch: Partial<LayerEffects>;
    }
  | {
      type: 'set_property_key';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      frame: number;
      value: number;
      easing?: EasingPreset;
      curve?: CubicBezierCurve | null;
    }
  | {
      type: 'set_property_track';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      keys: Array<{
        frame: number;
        value: number;
        easing?: EasingPreset;
        curve?: CubicBezierCurve | null;
      }>;
      replace?: boolean;
    }
  | {
      type: 'set_layer_loop';
      compositionId?: string;
      layerId: string;
      /** Preallocated by transports so the returned loop id is stable within an atomic batch. */
      id?: string;
      name?: string;
      activation?: LayerLoopActivation;
      durationFrames?: number;
      phaseOffsetFrames?: number;
      repeatCount?: number | null;
    }
  | {
      type: 'set_loop_property_track';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      keys: Array<{
        frame: number;
        value: number;
        easing?: EasingPreset;
        curve?: CubicBezierCurve | null;
      }>;
      replace?: boolean;
    }
  | { type: 'remove_layer_loop'; compositionId?: string; layerId: string }
  | {
      type: 'stagger_property_track';
      compositionId?: string;
      layerIds: string[];
      property: AnimatableLayerProperty;
      keys: Array<{
        frame: number;
        value: number;
        easing?: EasingPreset;
        curve?: CubicBezierCurve | null;
      }>;
      frameOffset: number;
      replace?: boolean;
    }
  | {
      type: 'move_property_key';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      keyframeId: string;
      frame: number;
    }
  | {
      type: 'remove_property_key';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      keyframeId: string;
    }
  | {
      type: 'set_property_key_easing';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      keyframeId: string;
      easing: EasingPreset;
      curve?: CubicBezierCurve | null;
    }
  | {
      type: 'reorder_layers';
      compositionId?: string;
      layerIds: string[];
    }
  | {
      type: 'add_data_field';
      compositionId?: string;
      /** Internally preallocated so later operations in the same atomic batch can resolve it. */
      id?: string;
      fieldType: FieldType;
      key: string;
      label?: string;
      defaultValue?: FieldValue;
      required?: boolean;
    }
  | {
      type: 'update_data_field';
      compositionId?: string;
      fieldId: string;
      key?: string;
      label?: string;
      defaultValue?: FieldValue;
      required?: boolean;
    }
  | {
      type: 'remove_data_field';
      compositionId?: string;
      fieldId: string;
      force?: boolean;
    }
  | {
      type: 'set_layer_binding';
      compositionId?: string;
      layerId: string;
      binding: LayerBinding | null;
    }
  | {
      type: 'set_transition';
      compositionId?: string;
      transitionId: string;
      durationFrames?: number;
      easing?: EasingPreset;
    };

export interface AuthoringChangeSummary {
  operationCount: number;
  operationTypes: string[];
  affectedCompositionIds: string[];
  affectedLayerIds: string[];
  affectedFrames: number[];
  generatedIds: Array<{
    operationIndex: number;
    kind: 'layer' | 'property-key' | 'field' | 'guide' | 'asset' | 'timeline-group' | 'loop';
    id: string;
  }>;
  clearedBindings: Array<{ layerId: string; layerName: string; fieldId: string }>;
  warnings: string[];
  duplicateGroups: Array<{
    operationIndex: number;
    copies: Array<{
      n: number;
      groupId: string;
      layers: Record<string, string>;
      fields: Record<string, string>;
    }>;
  }>;
}

export interface ApplyOperationsRequest {
  expectedRevision: number;
  operations: AuthoringOperation[];
  dryRun?: boolean;
  reason?: string;
}

export interface AuthoringMutationResult {
  sessionId: string;
  revision: number;
  previousRevision: number;
  dryRun: boolean;
  undoToken?: string;
  summary: AuthoringChangeSummary;
  validation: ProjectValidationResult;
  project: Project;
}

export interface AuthoringSessionSnapshot {
  sessionId: string;
  revision: number;
  project: Project;
  validation: ProjectValidationResult;
}

export interface AuthoringSessionChange {
  sessionId: string;
  revision: number;
  source: 'agent' | 'editor' | 'undo' | 'redo' | 'system';
  reason?: string;
  project: Project;
  summary?: AuthoringChangeSummary;
}

export interface AuthoringChangeRecord {
  revision: number;
  source: AuthoringSessionChange['source'];
  timestamp: string;
  reason?: string;
  summary?: AuthoringChangeSummary;
  affectedLayerIds: string[];
}
