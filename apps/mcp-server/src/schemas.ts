import * as z from 'zod/v4';
import type { AnimatableLayerProperty } from '@ograf-editor/scene-model';

export const EASING_PRESETS = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'quad-in',
  'quad-out',
  'quad-in-out',
  'cubic-in',
  'cubic-out',
  'cubic-in-out',
  'quart-in',
  'quart-out',
  'quart-in-out',
  'quint-in',
  'quint-out',
  'quint-in-out',
  'sine-in',
  'sine-out',
  'sine-in-out',
  'expo-in',
  'expo-out',
  'expo-in-out',
  'circ-in',
  'circ-out',
  'circ-in-out',
  'back-in',
  'back-out',
  'back-in-out',
  'bounce-in',
  'bounce-out',
  'bounce-in-out',
  'elastic-in',
  'elastic-out',
  'elastic-in-out',
] as const;

export const easingSchema = z.enum(EASING_PRESETS);

export const gradientPaintSchema = z
  .object({
    type: z.enum(['linear', 'radial', 'conic']),
    angle: z.number().finite(),
    stops: z
      .array(
        z
          .object({
            offset: z.number().min(0).max(1),
            color: z.string().min(1),
            opacity: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

const fixedPropertySchema = z.enum([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'transformOriginX',
  'transformOriginY',
  'blur',
  'dropShadowOpacity',
  'dropShadowOffsetX',
  'dropShadowOffsetY',
  'dropShadowBlur',
]);

export const propertySchema = z
  .union([
    fixedPropertySchema,
    z
      .string()
      .regex(
        /^fill\.stops\[(0|[1-9]\d*)\]\.offset$/,
        'Use fill.stops[N].offset with a zero-based gradient stop index.',
      ),
  ])
  .transform((value) => value as AnimatableLayerProperty);

const compositionId = z.string().optional();
const layerId = z.string().optional();
const layerName = z.string().optional();
const frame = z.number().int().nonnegative();
const curve = z
  .object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() })
  .nullable()
  .optional();
const valueMapSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), gradientPaintSchema]))
  .optional();
const layerBindingSchema = z.union([
  z.object({ fieldId: z.string(), targetProperty: z.string(), valueMap: valueMapSchema }),
  z.object({ fieldKey: z.string(), targetProperty: z.string(), valueMap: valueMapSchema }),
]);
const transform = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    transformOriginX: z.number().optional(),
    transformOriginY: z.number().optional(),
  })
  .strict();
const effects = z
  .object({
    blur: z.number().nonnegative().optional(),
    dropShadowEnabled: z.boolean().optional(),
    dropShadowColor: z.string().optional(),
    dropShadowOpacity: z.number().min(0).max(1).optional(),
    dropShadowOffsetX: z.number().optional(),
    dropShadowOffsetY: z.number().optional(),
    dropShadowBlur: z.number().nonnegative().optional(),
  })
  .strict();

export const semanticLayerRoleSchema = z.enum([
  'none',
  'background',
  'container',
  'accent',
  'headline',
  'subheadline',
  'label',
  'value',
  'logo',
  'image',
  'icon',
  'mask',
  'decorative',
  'ticker',
  'score',
  'custom',
]);

export const designTokenTypeSchema = z.enum([
  'color',
  'number',
  'text',
  'font-family',
  'font-weight',
]);
export const designTokenTargetPropertySchema = z.enum([
  'fill',
  'strokeColor',
  'strokeWidth',
  'borderRadius',
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
]);

const paintSchema = z.union([z.string().min(1), gradientPaintSchema]);
const fieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'integer',
  'duration-ms',
  'percentage',
  'boolean',
  'color',
  'gradient',
  'image-url',
  'file-path',
  'select',
  'select-multiple',
]);
export const fieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  gradientPaintSchema,
]);
const fieldOptionSchema = z.object({ value: z.string(), label: z.string() }).strict();
const fieldConstraintsSchema = z
  .object({
    maxLength: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    pattern: z.string().optional(),
    step: z.number().positive().finite().optional(),
  })
  .strict();

export const authoringOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_project_metadata'),
    id: z.string().min(1).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    author: z
      .object({ name: z.string(), email: z.string().optional(), url: z.string().optional() })
      .optional(),
    supportsRealTime: z.boolean().optional(),
    supportsNonRealTime: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('set_composition'),
    compositionId,
    name: z.string().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    frameRate: z.number().positive().optional(),
    updateTransitionFrames: z.number().int().nonnegative().optional(),
    backgroundColor: z.string().optional(),
  }),
  z.object({
    type: z.literal('set_composition_layout'),
    compositionId,
    patch: z
      .object({
        showRulers: z.boolean().optional(),
        showActionSafe: z.boolean().optional(),
        showTitleSafe: z.boolean().optional(),
        snappingEnabled: z.boolean().optional(),
        snapToGrid: z.boolean().optional(),
        snapToGuides: z.boolean().optional(),
        snapToLayers: z.boolean().optional(),
        gridSize: z.number().int().positive().optional(),
        snapThreshold: z.number().int().nonnegative().optional(),
        boundsMode: z.enum(['allow', 'contain']).optional(),
        overflowPreview: z.enum(['visible', 'clip']).optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.literal('set_design_system_name'),
    compositionId,
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('upsert_design_token'),
    compositionId,
    tokenId: z.string().min(1).optional(),
    key: z.string().min(1),
    name: z.string().min(1).optional(),
    tokenType: designTokenTypeSchema,
    value: z.union([z.string(), z.number()]),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('remove_design_token'),
    compositionId,
    tokenId: z.string().min(1),
    force: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('bind_design_token'),
    compositionId,
    layerId,
    layerName,
    tokenId: z.string().min(1).optional(),
    tokenKey: z.string().min(1).optional(),
    targetProperty: designTokenTargetPropertySchema,
  }),
  z.object({
    type: z.literal('unbind_design_token'),
    compositionId,
    layerId,
    layerName,
    targetProperty: designTokenTargetPropertySchema,
  }),
  z.object({
    type: z.literal('add_lifecycle_step'),
    compositionId,
    name: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('rename_lifecycle_keyframe'),
    compositionId,
    keyframeId: z.string(),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('move_lifecycle_keyframe'),
    compositionId,
    keyframeId: z.string(),
    frame,
  }),
  z.object({
    type: z.literal('remove_lifecycle_step'),
    compositionId,
    keyframeId: z.string(),
  }),
  z.object({
    type: z.literal('add_canvas_guide'),
    compositionId,
    axis: z.enum(['vertical', 'horizontal']),
    position: z.number(),
  }),
  z.object({
    type: z.literal('update_canvas_guide'),
    compositionId,
    guideId: z.string(),
    position: z.number(),
  }),
  z.object({ type: z.literal('remove_canvas_guide'), compositionId, guideId: z.string() }),
  z.object({
    type: z.literal('create_timeline_group'),
    compositionId,
    layerIds: z.array(z.string()).min(2),
    name: z.string().min(1).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  }),
  z.object({
    type: z.literal('rename_timeline_group'),
    compositionId,
    groupId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('set_timeline_group_color'),
    compositionId,
    groupId: z.string().min(1),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
  }),
  z.object({
    type: z.literal('ungroup_timeline_group'),
    compositionId,
    groupId: z.string().min(1),
  }),
  z.object({
    type: z.literal('group_layers'),
    compositionId,
    layerIds: z.array(z.string()).min(2),
  }),
  z.object({
    type: z.literal('ungroup_layers'),
    compositionId,
    layerIds: z.array(z.string()).optional(),
    groupId: z.string().optional(),
  }),
  z.object({
    type: z.literal('save_component'),
    compositionId,
    layerIds: z.array(z.string()).min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('instantiate_component'),
    compositionId,
    componentId: z.string().min(1),
    offset: z.object({ x: z.number().optional(), y: z.number().optional() }).strict().optional(),
    linked: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('update_component_from_layers'),
    compositionId,
    componentId: z.string().min(1),
    layerIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal('refresh_component_instances'),
    compositionId,
    componentId: z.string().min(1),
    instanceIds: z.array(z.string().min(1)).min(1).optional(),
  }),
  z.object({
    type: z.literal('rename_component'),
    compositionId,
    componentId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('remove_component'),
    compositionId,
    componentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('add_asset'),
    compositionId,
    name: z.string().min(1),
    mimeType: z.enum([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'font/ttf',
      'font/otf',
      'font/woff',
      'font/woff2',
      'text/css',
      'text/plain',
    ]),
    fontFamily: z.string().min(1).optional(),
    fontWeight: z.string().min(1).optional(),
    fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(),
    packagePath: z.string().min(1).optional(),
    licenseName: z.string().optional(),
    licenseUrl: z.string().optional(),
    licenseText: z.string().optional(),
    data: z.string().min(1),
  }),
  z.object({
    type: z.literal('update_asset'),
    compositionId,
    assetId: z.string(),
    name: z.string().min(1).optional(),
    fontFamily: z.string().min(1).optional(),
    fontWeight: z.string().min(1).optional(),
    fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(),
    packagePath: z.string().min(1).nullable().optional(),
    licenseName: z.string().optional(),
    licenseUrl: z.string().optional(),
    licenseText: z.string().optional(),
  }),
  z.object({
    type: z.literal('remove_asset'),
    compositionId,
    assetId: z.string(),
    force: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('add_layer'),
    compositionId,
    kind: z.enum(['rectangle', 'ellipse', 'text', 'image', 'path', 'image-sequence', 'lottie']),
    name: z.string().optional(),
    transform: transform.optional(),
    element: z.record(z.string(), z.unknown()).optional(),
    effects: effects.optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('set_layer_semantics'),
    compositionId,
    layerId,
    layerName,
    patch: z
      .object({
        role: semanticLayerRoleSchema.optional(),
        tags: z.array(z.string()).max(64).optional(),
        description: z.string().max(1000).optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.literal('create_lower_third'),
    compositionId,
    name: z.string().min(1).optional(),
    placement: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    content: z
      .object({ headline: z.string().optional(), subheadline: z.string().optional() })
      .strict()
      .optional(),
    fieldKeys: z
      .object({ headline: z.string().min(1).optional(), subheadline: z.string().min(1).optional() })
      .strict()
      .optional(),
    theme: z
      .object({
        background: paintSchema.optional(),
        accent: paintSchema.optional(),
        primaryText: z.string().min(1).optional(),
        secondaryText: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    motion: z
      .object({
        style: z.enum(['wipe', 'stagger', 'slide', 'none']).optional(),
        entrance: z.enum(['left', 'right', 'up', 'down', 'none']).optional(),
        exit: z.enum(['left', 'right', 'up', 'down', 'none']).optional(),
        staggerFrames: z.number().int().nonnegative().max(120).optional(),
      })
      .strict()
      .optional(),
  }),
  z.object({
    type: z.literal('create_repeater'),
    compositionId,
    name: z.string().min(1).optional(),
    layerIds: z.array(z.string()).min(1),
    items: z
      .array(
        z
          .object({
            label: z.string().min(1).optional(),
            data: z.record(z.string(), fieldValueSchema).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(100),
    direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
    gap: z.number().nonnegative().default(24),
  }),
  z.object({
    type: z.literal('duplicate_group'),
    compositionId,
    source: z.union([
      z.object({ groupId: z.string().min(1) }).strict(),
      z.object({ parentId: z.string().min(1) }).strict(),
      z.object({ layerIds: z.array(z.string()).min(1) }).strict(),
    ]),
    count: z.number().int().min(1).max(100),
    transformOffset: z
      .object({ x: z.number().optional(), y: z.number().optional() })
      .strict()
      .optional(),
    frameOffset: z.number().int().default(0),
    namePattern: z.string().optional(),
    bindings: z.enum(['share', 'clone', 'clear']).default('clone'),
    fieldKeyRewrite: z.object({ from: z.string(), to: z.string() }).strict().optional(),
    labelRewrite: z.object({ from: z.string(), to: z.string() }).strict().optional(),
  }),
  z.object({ type: z.literal('remove_layer'), compositionId, layerId, layerName }),
  z.object({
    type: z.literal('rename_layer'),
    compositionId,
    layerId,
    layerName,
    name: z.string(),
  }),
  z.object({
    type: z.literal('set_layer_flags'),
    compositionId,
    layerId,
    layerName,
    isVisible: z.boolean().optional(),
    isGuide: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('set_layer_layout'),
    compositionId,
    layerId,
    layerName,
    isLocked: z.boolean().optional(),
    clipChildren: z.boolean().optional(),
    groupId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    constraints: z
      .object({
        horizontal: z.enum(['left', 'right', 'left-right', 'center', 'scale']).optional(),
        vertical: z.enum(['top', 'bottom', 'top-bottom', 'center', 'scale']).optional(),
      })
      .strict()
      .optional(),
  }),
  z.object({
    type: z.literal('update_element'),
    compositionId,
    layerId,
    layerName,
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('update_transform'),
    compositionId,
    layerId,
    layerName,
    scope: z.enum(['authored', 'frame']).default('authored'),
    frame: frame.optional(),
    patch: transform,
  }),
  z.object({
    type: z.literal('update_effects'),
    compositionId,
    layerId,
    layerName,
    scope: z.enum(['authored', 'frame']).default('authored'),
    frame: frame.optional(),
    patch: effects,
  }),
  z.object({
    type: z.literal('set_property_key'),
    compositionId,
    layerId,
    layerName,
    property: propertySchema,
    frame,
    value: z.number(),
    easing: easingSchema.optional(),
    curve,
  }),
  z.object({
    type: z.literal('set_property_track'),
    compositionId,
    layerId,
    layerName,
    property: propertySchema,
    keys: z
      .array(
        z.object({
          frame,
          value: z.number(),
          easing: easingSchema.optional(),
          curve,
        }),
      )
      .min(1),
    replace: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('set_layer_loop'),
    compositionId,
    layerId,
    layerName,
    name: z.string().min(1).optional(),
    activation: z
      .union([
        z.object({ type: z.literal('lifecycle') }).strict(),
        z.object({ type: z.literal('step'), stepKeyframeId: z.string().min(1) }).strict(),
      ])
      .optional(),
    durationFrames: z.number().int().positive().optional(),
    phaseOffsetFrames: z.number().int().optional(),
    repeatCount: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    type: z.literal('set_loop_property_track'),
    compositionId,
    layerId,
    layerName,
    property: propertySchema,
    keys: z
      .array(
        z.object({
          frame,
          value: z.number(),
          easing: easingSchema.optional(),
          curve,
        }),
      )
      .min(1),
    replace: z.boolean().default(true),
  }),
  z.object({ type: z.literal('remove_layer_loop'), compositionId, layerId, layerName }),
  z.object({
    type: z.literal('stagger_property_track'),
    compositionId,
    layerIds: z.array(z.string()).min(1).optional(),
    layerNamePattern: z.string().min(1).optional(),
    property: propertySchema,
    keys: z
      .array(
        z.object({
          frame,
          value: z.number(),
          easing: easingSchema.optional(),
          curve,
        }),
      )
      .min(1),
    frameOffset: z.number().int(),
    replace: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('move_property_key'),
    compositionId,
    layerId,
    layerName,
    property: propertySchema,
    keyframeId: z.string(),
    frame,
  }),
  z.object({
    type: z.literal('remove_property_key'),
    compositionId,
    layerId,
    layerName,
    property: propertySchema,
    keyframeId: z.string(),
  }),
  z.object({
    type: z.literal('set_property_key_easing'),
    compositionId,
    layerId,
    layerName,
    property: propertySchema,
    keyframeId: z.string(),
    easing: easingSchema,
    curve,
  }),
  z.object({
    type: z.literal('reorder_layers'),
    compositionId,
    layerIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('add_data_field'),
    compositionId,
    fieldType: fieldTypeSchema,
    key: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    defaultValue: fieldValueSchema.optional(),
    required: z.boolean().optional(),
    options: z.array(fieldOptionSchema).optional(),
    constraints: fieldConstraintsSchema.optional(),
    fileExtensions: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('update_data_field'),
    compositionId,
    fieldId: z.string().optional(),
    fieldKey: z.string().optional(),
    fieldType: fieldTypeSchema.optional(),
    key: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    defaultValue: fieldValueSchema.optional(),
    required: z.boolean().optional(),
    options: z.array(fieldOptionSchema).optional(),
    constraints: fieldConstraintsSchema.optional(),
    fileExtensions: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('remove_data_field'),
    compositionId,
    fieldId: z.string(),
    force: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('set_layer_binding'),
    compositionId,
    layerId,
    layerName,
    binding: layerBindingSchema.nullable(),
  }),
  z.object({
    type: z.literal('set_layer_bindings'),
    compositionId,
    layerId,
    layerName,
    bindings: z.array(layerBindingSchema),
  }),
  z.object({
    type: z.literal('add_custom_action'),
    compositionId,
    actionId: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('update_custom_action'),
    compositionId,
    actionId: z.string(),
    nextActionId: z.string().min(1).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('remove_custom_action'),
    compositionId,
    actionId: z.string(),
  }),
  z.object({
    type: z.literal('set_transition'),
    compositionId,
    transitionId: z.string(),
    durationFrames: z.number().int().nonnegative().optional(),
    easing: easingSchema.optional(),
  }),
]);
