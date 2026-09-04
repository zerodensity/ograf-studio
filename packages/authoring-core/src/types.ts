import type {
  AnimatableLayerProperty,
  BlendMode,
  CubicBezierCurve,
  CompositionLayout,
  EasingPreset,
  FieldType,
  FieldValue,
  FieldConstraints,
  FieldOption,
  FieldSchemaInput,
  LayerBinding,
  LayerEffects,
  LayerConstraints,
  LayerSemantics,
  DesignTokenTargetProperty,
  DesignTokenType,
  DesignTokenValue,
  LayerTransform,
  LowerThirdRecipeOptions,
  BugRecipeOptions,
  TickerRecipeOptions,
  ScoreboardRecipeOptions,
  ClockRecipeOptions,
  RepeaterRecipeOptions,
  StylePackId,
  StyleTokenKey,
  NewLayerKind,
  LayerLoopActivation,
  Project,
  PatternLightingLink,
  TilingPatternPatch,
} from '@ograf-editor/scene-model';
import type { ProjectValidationResult } from '@ograf-editor/validation';

export type AuthoringOperation =
  | {
      type: 'set_layer_lighting';
      compositionId?: string;
      layerId: string;
      link: PatternLightingLink | null;
    }
  | {
      type: 'add_effect';
      compositionId?: string;
      layerId: string;
      effectType: import('@ograf-editor/scene-model').EffectType;
      patch?: import('@ograf-editor/scene-model').EffectPatch;
      index?: number;
      id?: string;
    }
  | {
      type: 'update_effect';
      compositionId?: string;
      layerId: string;
      effectId: string;
      patch: import('@ograf-editor/scene-model').EffectPatch;
      scope?: 'authored' | 'frame';
      frame?: number;
    }
  | { type: 'remove_effect'; compositionId?: string; layerId: string; effectId: string }
  | {
      type: 'duplicate_effect';
      compositionId?: string;
      layerId: string;
      effectId: string;
      id?: string;
    }
  | { type: 'reorder_effects'; compositionId?: string; layerId: string; effectIds: string[] }
  | {
      type: 'set_tiling_pattern';
      compositionId?: string;
      patternId?: string;
      id?: string;
      patch: TilingPatternPatch;
      createLayer?: boolean;
    }
  | { type: 'remove_tiling_pattern'; compositionId?: string; patternId: string }
  | { type: 'remove_style_pack'; compositionId?: string }
  | {
      type: 'set_project_metadata';
      id?: string;
      name?: string;
      description?: string;
      version?: string;
      author?: { name: string; email?: string; url?: string };
      supportsRealTime?: boolean;
      supportsNonRealTime?: boolean;
    }
  | {
      type: 'set_composition';
      compositionId?: string;
      name?: string;
      width?: number;
      height?: number;
      frameRate?: number;
      updateTransitionFrames?: number;
      backgroundColor?: string;
    }
  | {
      type: 'set_composition_layout';
      compositionId?: string;
      patch: Partial<Omit<CompositionLayout, 'guides'>>;
    }
  | {
      type: 'set_design_system_name';
      compositionId?: string;
      name: string;
    }
  | {
      type: 'upsert_design_token';
      compositionId?: string;
      id?: string;
      tokenId?: string;
      key: string;
      name?: string;
      tokenType: DesignTokenType;
      value: DesignTokenValue;
      description?: string;
    }
  | {
      type: 'remove_design_token';
      compositionId?: string;
      tokenId: string;
      force?: boolean;
    }
  | {
      type: 'bind_design_token';
      compositionId?: string;
      layerId: string;
      tokenId?: string;
      tokenKey?: string;
      targetProperty: DesignTokenTargetProperty;
    }
  | {
      type: 'unbind_design_token';
      compositionId?: string;
      layerId: string;
      targetProperty: DesignTokenTargetProperty;
    }
  | {
      type: 'add_lifecycle_step';
      compositionId?: string;
      name?: string;
    }
  | {
      type: 'rename_lifecycle_keyframe';
      compositionId?: string;
      keyframeId: string;
      name: string;
    }
  | {
      type: 'move_lifecycle_keyframe';
      compositionId?: string;
      keyframeId: string;
      frame: number;
    }
  | { type: 'remove_lifecycle_step'; compositionId?: string; keyframeId: string }
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
      type: 'group_layers';
      compositionId?: string;
      id?: string;
      layerIds: string[];
    }
  | {
      type: 'ungroup_layers';
      compositionId?: string;
      layerIds?: string[];
      groupId?: string;
    }
  | {
      type: 'save_component';
      compositionId?: string;
      id?: string;
      layerIds: string[];
      name: string;
    }
  | {
      type: 'instantiate_component';
      compositionId?: string;
      componentId: string;
      offset?: { x?: number; y?: number };
      linked?: boolean;
    }
  | {
      type: 'update_component_from_layers';
      compositionId?: string;
      componentId: string;
      layerIds: string[];
    }
  | {
      type: 'refresh_component_instances';
      compositionId?: string;
      componentId: string;
      instanceIds?: string[];
    }
  | {
      type: 'rename_component';
      compositionId?: string;
      componentId: string;
      name: string;
    }
  | { type: 'remove_component'; compositionId?: string; componentId: string }
  | {
      type: 'add_asset';
      compositionId?: string;
      name: string;
      mimeType: string;
      fontFamily?: string;
      fontWeight?: string;
      fontStyle?: 'normal' | 'italic' | 'oblique';
      packagePath?: string;
      licenseName?: string;
      licenseUrl?: string;
      licenseText?: string;
      /** Base64 payload without a data-URI prefix. */
      data: string;
    }
  | {
      type: 'update_asset';
      compositionId?: string;
      assetId: string;
      name?: string;
      fontFamily?: string;
      fontWeight?: string;
      fontStyle?: 'normal' | 'italic' | 'oblique';
      packagePath?: string | null;
      licenseName?: string;
      licenseUrl?: string;
      licenseText?: string;
    }
  | {
      type: 'remove_asset';
      compositionId?: string;
      assetId: string;
      force?: boolean;
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
      type: 'set_layer_semantics';
      compositionId?: string;
      layerId: string;
      patch: Partial<LayerSemantics>;
    }
  | {
      type: 'apply_style_pack';
      compositionId?: string;
      stylePack: StylePackId;
      bindLayers?: boolean;
      /** Preallocated transport IDs for deterministic create-then-target batches. */
      tokenIds?: Partial<Record<StyleTokenKey, string>>;
    }
  | ({
      type: 'create_lower_third';
      compositionId?: string;
    } & LowerThirdRecipeOptions)
  | ({
      type: 'create_repeater';
      compositionId?: string;
    } & RepeaterRecipeOptions)
  | ({
      type: 'create_bug';
      compositionId?: string;
    } & BugRecipeOptions)
  | ({
      type: 'create_ticker';
      compositionId?: string;
    } & TickerRecipeOptions)
  | ({
      type: 'create_scoreboard';
      compositionId?: string;
    } & ScoreboardRecipeOptions)
  | ({
      type: 'create_clock';
      compositionId?: string;
    } & ClockRecipeOptions)
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
      isMaskOnly?: boolean;
      blendMode?: BlendMode;
    }
  | {
      type: 'set_layer_mask';
      compositionId?: string;
      layerId: string;
      sourceLayerId: string | null;
      mode?: 'alpha' | 'path';
      inverted?: boolean;
      hideSource?: boolean;
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
      defaultTokenId?: string | null;
      compositionId?: string;
      /** Internally preallocated so later operations in the same atomic batch can resolve it. */
      id?: string;
      fieldType: FieldType;
      key: string;
      label?: string;
      description?: string;
      defaultValue?: FieldValue;
      required?: boolean;
      options?: FieldOption[];
      constraints?: FieldConstraints;
      fileExtensions?: string[];
      properties?: FieldSchemaInput[];
      items?: FieldSchemaInput | null;
    }
  | {
      type: 'update_data_field';
      defaultTokenId?: string | null;
      compositionId?: string;
      fieldId: string;
      fieldType?: FieldType;
      key?: string;
      label?: string;
      description?: string;
      defaultValue?: FieldValue;
      required?: boolean;
      options?: FieldOption[];
      constraints?: FieldConstraints;
      fileExtensions?: string[];
      properties?: FieldSchemaInput[];
      items?: FieldSchemaInput | null;
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
      type: 'set_layer_bindings';
      compositionId?: string;
      layerId: string;
      bindings: LayerBinding[];
    }
  | {
      type: 'create_runtime_collection';
      compositionId?: string;
      id?: string;
      name?: string;
      fieldId: string;
      prototypeLayerIds: string[];
      offsetPerItem: { x: number; y: number };
      capacity?: number;
      overflow?: 'truncate';
    }
  | {
      type: 'update_runtime_collection';
      compositionId?: string;
      collectionId: string;
      name?: string;
      fieldId?: string;
      prototypeLayerIds?: string[];
      offsetPerItem?: { x: number; y: number };
      capacity?: number;
      overflow?: 'truncate';
    }
  | {
      type: 'remove_runtime_collection';
      compositionId?: string;
      collectionId: string;
    }
  | {
      type: 'add_custom_action';
      compositionId?: string;
      id?: string;
      actionId: string;
      name?: string;
      description?: string;
    }
  | {
      type: 'update_custom_action';
      compositionId?: string;
      actionId: string;
      nextActionId?: string;
      name?: string;
      description?: string;
    }
  | { type: 'remove_custom_action'; compositionId?: string; actionId: string }
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
    kind:
      | 'layer'
      | 'pattern'
      | 'effect'
      | 'property-key'
      | 'lifecycle-keyframe'
      | 'field'
      | 'guide'
      | 'asset'
      | 'timeline-group'
      | 'canvas-group'
      | 'custom-action'
      | 'component'
      | 'loop'
      | 'design-token'
      | 'runtime-collection';
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
  componentInstances: Array<{
    operationIndex: number;
    componentId: string;
    instanceId: string;
    groupId: string;
    linked: boolean;
    layers: Record<string, string>;
    fields: Record<string, string>;
  }>;
  semanticBlocks: Array<{
    operationIndex: number;
    recipe: 'lower-third' | 'bug' | 'ticker' | 'scoreboard' | 'clock';
    name: string;
    groupId: string;
    timelineGroupId: string;
    layers: Record<string, string>;
    fields: Record<string, string>;
    stylePack?: StylePackId;
  }>;
  stylePacks: Array<{
    operationIndex: number;
    packId: StylePackId;
    name: string;
    tokenIds: Record<string, string>;
    affectedLayerIds: string[];
  }>;
  repeaters: Array<{
    operationIndex: number;
    name: string;
    direction: 'horizontal' | 'vertical';
    gap: number;
    items: Array<{
      index: number;
      label: string;
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
