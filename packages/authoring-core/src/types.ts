import type {
  AuthoringPrompt,
  PathEdit,
  CropRect,
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
  MediaCue,
  RendererPluginReference,
  FieldDefinition,
  DataConnectionPatch,
  LogicFunctionDefinition,
  TestDataRundown,
} from '@ograf-editor/scene-model';
import type { ProjectValidationResult } from '@ograf-editor/validation';

export type AuthoringOperation =
  | {
      type: 'add_review_comment';
      compositionId: string;
      text: string;
      author: string;
      layerId?: string | null;
      frame: number;
      x: number;
      y: number;
      id?: string;
      createdAt?: string;
    }
  | { type: 'set_review_comment_resolved'; commentId: string; resolved: boolean }
  | { type: 'save_review_version'; name: string; id?: string; createdAt?: string }
  | { type: 'set_review_approval'; author: string | null; at?: string }
  | { type: 'set_test_rundowns'; compositionId?: string; rundowns: TestDataRundown[] }
  | {
      type: 'add_modifier';
      compositionId?: string;
      layerId: string;
      modifierType: import('@ograf-editor/scene-model').LayerModifier['type'];
      params?: Record<string, unknown>;
      name?: string;
      enabled?: boolean;
      index?: number;
      id?: string;
    }
  | {
      type: 'update_modifier';
      compositionId?: string;
      layerId: string;
      modifierId: string;
      patch: { name?: string; enabled?: boolean; params?: Record<string, unknown> };
      scope?: 'authored' | 'frame';
      frame?: number;
    }
  | {
      type: 'remove_modifier' | 'duplicate_modifier';
      compositionId?: string;
      layerId: string;
      modifierId: string;
      id?: string;
    }
  | {
      type: 'reorder_modifiers';
      compositionId?: string;
      layerId: string;
      modifierIds: string[];
    }
  | {
      type: 'set_layer_lighting';
      compositionId?: string;
      layerId: string;
      link: PatternLightingLink | null;
    }
  | {
      type: 'add_effect';
      compositionId?: string;
      layerId?: string;
      groupId?: string;
      effectType: import('@ograf-editor/scene-model').EffectType;
      patch?: import('@ograf-editor/scene-model').EffectPatch;
      index?: number;
      id?: string;
    }
  | {
      type: 'update_effect';
      compositionId?: string;
      layerId?: string;
      groupId?: string;
      effectId: string;
      patch: import('@ograf-editor/scene-model').EffectPatch;
      scope?: 'authored' | 'frame';
      frame?: number;
    }
  | {
      type: 'remove_effect';
      compositionId?: string;
      layerId?: string;
      groupId?: string;
      effectId: string;
    }
  | {
      type: 'duplicate_effect';
      compositionId?: string;
      layerId?: string;
      groupId?: string;
      effectId: string;
      id?: string;
    }
  | {
      type: 'reorder_effects';
      compositionId?: string;
      layerId?: string;
      groupId?: string;
      effectIds: string[];
    }
  | {
      type: 'set_tiling_pattern';
      compositionId?: string;
      patternId?: string;
      id?: string;
      patch: TilingPatternPatch;
      createLayer?: boolean;
    }
  | { type: 'remove_tiling_pattern'; compositionId?: string; patternId: string }
  | {
      type: 'remove_renderer_plugin';
      compositionId?: string;
      /** Remove only this unused pinned snapshot; installed trust/settings are unaffected. */
      reference: RendererPluginReference;
    }
  | { type: 'remove_style_pack'; compositionId?: string }
  | {
      type: 'set_project_metadata';
      thumbnailFrame?: number | null;
      id?: string;
      name?: string;
      description?: string;
      version?: string;
      author?: { name: string; email?: string; url?: string };
      /** Actual user prompt the user intends to include in the template and export. */
      authoringPrompt?: AuthoringPrompt;
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
      updateInterruption?: 'queue' | 'replace';
      backgroundColor?: string;
      crop?: CropRect | null;
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
      type: 'retime_animation_phase';
      compositionId?: string;
      phase: 'in' | 'on-air' | 'out' | 'entire';
      targetFrames: number;
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
      scope?: 'local' | 'set';
      layerIds: string[];
      name: string;
    }
  | {
      type: 'instantiate_component';
      compositionId?: string;
      componentId: string;
      offset?: { x?: number; y?: number };
      linked?: boolean;
      /** Reserved once by MCP for deterministic create-then-edit batches and proposals. */
      identity?: {
        instanceId: string;
        groupId: string;
        layerIds: Record<string, string>;
        fieldIds: Record<string, string>;
        keyIds: Record<string, Record<string, string>>;
      };
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
      type: 'update_component_layer';
      compositionId?: string;
      componentId: string;
      sourceLayerId: string;
      /** Authored layer fields; id and componentLink cannot be changed. Element/effects merge. */
      patch: Record<string, unknown>;
    }
  | {
      type: 'update_component_field';
      compositionId?: string;
      componentId: string;
      fieldId: string;
      patch: Partial<
        Omit<
          FieldDefinition,
          'id' | 'generatedShaderParameter' | 'properties' | 'items' | 'defaultTokenId'
        >
      > & {
        defaultTokenId?: string | null;
        properties?: FieldSchemaInput[];
        items?: FieldSchemaInput | null;
      };
    }
  | {
      type: 'reset_component_overrides';
      compositionId?: string;
      layerIds: string[];
      /** JSON Pointer paths; omitted resets every authored override on the selected members. */
      paths?: string[];
    }
  | {
      type: 'make_component_unique';
      compositionId?: string;
      id?: string;
      instanceId: string;
      name?: string;
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
      type: 'add_media_cue';
      compositionId?: string;
      cue: Omit<MediaCue, 'id'> & { id?: string };
    }
  | {
      type: 'update_media_cue';
      compositionId?: string;
      cueId: string;
      patch: Partial<Omit<MediaCue, 'id'>>;
    }
  | {
      type: 'remove_media_cue';
      compositionId?: string;
      cueId: string;
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
      /** Internal transport identity reserved while resolving batch selectors. */
      identitySeed?: string;
    } & LowerThirdRecipeOptions)
  | ({
      type: 'create_repeater';
      compositionId?: string;
      identitySeed?: string;
    } & RepeaterRecipeOptions)
  | ({
      type: 'create_bug';
      compositionId?: string;
      identitySeed?: string;
    } & BugRecipeOptions)
  | ({
      type: 'create_ticker';
      compositionId?: string;
      identitySeed?: string;
    } & TickerRecipeOptions)
  | ({
      type: 'create_scoreboard';
      compositionId?: string;
      identitySeed?: string;
    } & ScoreboardRecipeOptions)
  | ({
      type: 'create_clock';
      compositionId?: string;
      identitySeed?: string;
    } & ClockRecipeOptions)
  | ({
      type: 'create_countdown';
      compositionId?: string;
      identitySeed?: string;
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
      type: 'set_layer_crop';
      compositionId?: string;
      layerId: string;
      crop: CropRect | null;
      coordinateSpace?: 'layer' | 'composition';
      frame?: number;
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
      autoLayout?: Partial<import('@ograf-editor/scene-model').LayerAutoLayout>;
      updateTransition?: Partial<import('@ograf-editor/scene-model').LayerUpdateTransition>;
      motionPath?: import('@ograf-editor/scene-model').LayerMotionPath | null;
      motionBlur?: { enabled: boolean; shutterAngle: number } | null;
      textPath?: import('@ograf-editor/scene-model').LayerTextPath | null;
    }
  | {
      type: 'set_layer_motion';
      compositionId?: string;
      layerId: string;
      side: 'in' | 'out';
      /** null clears the preset and holds the on-air pose through that window. */
      spec: import('@ograf-editor/scene-model').LayerMotionSpec | null;
    }
  | {
      type: 'apply_animation_preset';
      compositionId?: string;
      layerId: string;
      reference: RendererPluginReference;
      presetId: string;
      side: 'in' | 'out';
      target?: 'layer' | 'chart-marks';
      durationFrames: number;
      offsetFrames?: number;
      delayFrames?: number;
      staggerFrames?: number;
      parameters?: Record<string, number>;
    }
  | {
      type: 'remove_animation_preset_plugin';
      compositionId?: string;
      reference: RendererPluginReference;
    }
  | {
      type: 'set_layer_visual_rules';
      compositionId?: string;
      layerId: string;
      rules: import('@ograf-editor/scene-model').LayerVisualRule[];
    }
  | {
      type: 'update_element';
      compositionId?: string;
      layerId: string;
      patch: Record<string, unknown>;
    }
  | {
      type: 'edit_path';
      compositionId?: string;
      layerId: string;
      frame?: number;
      edit: PathEdit;
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
      timing?: import('@ograf-editor/scene-model').LayerLoopClip['timing'] | null;
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
      type: 'reset_property_animation';
      compositionId?: string;
      layerId: string;
      property: AnimatableLayerProperty;
      /** Required playhead time used to freeze this channel's static value. */
      frame: number;
      /** Optional elapsed local-loop time for held or custom-action playback. */
      loopElapsedFrames?: number;
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
      type: 'add_data_connection';
      compositionId?: string;
      /** Internally reserved so proposal acceptance preserves generated identities. */
      id?: string;
      connection: DataConnectionPatch;
    }
  | {
      type: 'update_data_connection';
      compositionId?: string;
      connectionId: string;
      patch: DataConnectionPatch;
    }
  | {
      type: 'remove_data_connection';
      compositionId?: string;
      connectionId: string;
    }
  | {
      type: 'add_data_field';
      nodosType?: string;
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
      exposeToOgraf?: boolean;
      options?: FieldOption[];
      constraints?: FieldConstraints;
      fileExtensions?: string[];
      properties?: FieldSchemaInput[];
      items?: FieldSchemaInput | null;
    }
  | {
      type: 'update_data_field';
      /** Null clears the engine-specific type while retaining the ordinary field schema. */
      nodosType?: string | null;
      defaultTokenId?: string | null;
      compositionId?: string;
      fieldId: string;
      fieldType?: FieldType;
      key?: string;
      label?: string;
      description?: string;
      defaultValue?: FieldValue;
      required?: boolean;
      exposeToOgraf?: boolean;
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
      itemKeyPath?: string[];
      sortPath?: string[];
      sortDirection?: 'none' | 'ascending' | 'descending';
      pageSize?: number;
      page?: number;
    }
  | {
      type: 'set_logic_functions';
      compositionId?: string;
      functions: LogicFunctionDefinition[];
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
      itemKeyPath?: string[];
      sortPath?: string[];
      sortDirection?: 'none' | 'ascending' | 'descending';
      pageSize?: number;
      page?: number;
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
      | 'modifier'
      | 'property-key'
      | 'lifecycle-keyframe'
      | 'field'
      | 'data-connection'
      | 'guide'
      | 'asset'
      | 'timeline-group'
      | 'canvas-group'
      | 'custom-action'
      | 'component'
      | 'loop'
      | 'design-token'
      | 'runtime-collection'
      | 'media-cue'
      | 'review-comment'
      | 'review-version';
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
    recipe: 'lower-third' | 'bug' | 'ticker' | 'scoreboard' | 'clock' | 'countdown';
    name: string;
    groupId: string;
    timelineGroupId: string;
    layers: Record<string, string>;
    fields: Record<string, string>;
    stylePack?: StylePackId;
    componentId?: string;
    instanceId?: string;
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
  /** Explicit file-open boundary; ordinary edits and synchronization retain the current set. */
  documentContext?: 'standalone';
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
