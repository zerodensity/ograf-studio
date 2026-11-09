import * as z from 'zod/v4';
import { modifierParamsSchema, modifierPatchSchema, modifierTypeSchema } from './modifierSchemas';
import {
  BLEND_MODES,
  LAYER_MOTION_STYLES,
  REVEAL_ANIMATION_PROPERTIES,
  layerMotionDirections,
  EFFECT_TYPES,
  STYLE_PACK_IDS,
  VISUAL_RULE_OPERATOR_VALUES,
  VISUAL_RULE_TRIGGER_VALUES,
  VISUAL_RULE_PLAYOUT_OPERATIONS,
  visualRulePlayoutActionErrors,
  visualRulePlayoutDataErrors,
  MAX_TIMER_VALUE_MS,
  isLogicFunctionAlias,
  logicFunctionJsonErrors,
  MAX_LOGIC_FUNCTION_SOURCE_BYTES,
  type LogicJsonValue,
  TEXT_ANIMATION_TYPES,
  isClockTimeZoneValid,
  isClockTimerFormatValid,
  type AnimatableLayerProperty,
  type DesignTokenTargetProperty,
  type FieldValue,
  type LayerMotionDirection,
  type LayerMotionStyle,
} from '@ograf-editor/scene-model';

export const originalPromptSchema = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, 'Supply the original user prompt as nonblank text.')
  .describe('Verbatim user request for this template, from the MCP client conversation.');

const logicFunctionMappingSchema = (maximum: number) =>
  z
    .unknown()
    .superRefine((value, context) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        context.addIssue({
          code: 'custom',
          message: 'Function mappings must be alias-to-ID objects.',
        });
        return;
      }
      const aliases = Object.keys(value);
      if (aliases.length > maximum)
        context.addIssue({
          code: 'custom',
          message: `Function mappings support at most ${maximum} aliases.`,
        });
      // Inspect the raw object before z.record drops prototype-sensitive keys.
      for (const alias of aliases)
        if (!isLogicFunctionAlias(alias))
          context.addIssue({
            code: 'custom',
            path: [alias],
            message: 'Function aliases must be safe identifiers.',
          });
    })
    .pipe(z.record(z.string().refine(isLogicFunctionAlias), z.string().min(1).max(256)));

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

export const textAnimationPatchSchema = z
  .object({
    type: z.enum(TEXT_ANIMATION_TYPES).optional(),
    split: z.enum(['grapheme', 'word']).optional(),
    durationFrames: z.number().int().positive().optional(),
    cursor: z.enum(['none', 'bar', 'block']).optional(),
    cursorBlinkFrames: z.number().int().positive().optional(),
    replayOnUpdate: z.boolean().optional(),
    customActionId: z.string().nullable().optional(),
    animators: z.unknown().optional(),
    countFrom: z.number().finite().nullable().optional(),
    countRoll: z.enum(['none', 'up', 'down']).optional(),
  })
  .strict();

export const clockTimerSettingsPatchSchema = z
  .object({
    mode: z.enum(['clock', 'count-up', 'count-down']).optional(),
    source: z.enum(['automatic', 'manual']).optional(),
    manualValue: z.union([z.number().finite(), z.string().max(256)]).optional(),
    format: z
      .string()
      .min(1)
      .max(128)
      .refine(isClockTimerFormatValid, 'Use a time token and balanced literal brackets.')
      .optional(),
    hourCycle: z.enum(['12', '24']).optional(),
    timeZone: z
      .string()
      .min(1)
      .max(128)
      .refine(isClockTimeZoneValid, 'Use local, UTC or a valid IANA time zone.')
      .optional(),
    padHours: z.boolean().optional(),
    padMinutes: z.boolean().optional(),
    padSeconds: z.boolean().optional(),
    showAmPm: z.boolean().optional(),
    uppercaseAmPm: z.boolean().optional(),
    initialValueMs: z.number().finite().min(0).max(MAX_TIMER_VALUE_MS).optional(),
    limitMs: z.number().finite().min(0).max(MAX_TIMER_VALUE_MS).nullable().optional(),
    endBehavior: z.enum(['stop', 'continue', 'loop']).optional(),
    autoStart: z.boolean().optional(),
    pauseWhenOffAir: z.boolean().optional(),
    referenceTimeMs: z.number().finite().min(-8.64e15).max(8.64e15).optional(),
    prefix: z.string().max(256).optional(),
    suffix: z.string().max(256).optional(),
  })
  .strict();

export const tickerItemSchema = z
  .object({
    id: z.string().regex(/^[-A-Za-z0-9_]{1,100}$/),
    name: z.string().max(512).optional(),
    width: z.number().finite().positive().max(16384),
    height: z.number().finite().positive().max(16384).optional(),
    element: z
      .object({
        type: z.enum([
          'rectangle',
          'ellipse',
          'text',
          'image',
          'path',
          'pattern',
          'image-sequence',
          'lottie',
          'shader',
        ]),
      })
      .catchall(z.unknown()),
    effects: z.record(z.string(), z.unknown()).optional(),
    animation: z
      .object({
        type: z.enum(['none', 'fade', 'rise', 'scale']),
        durationMs: z.number().finite().min(0).max(60000),
        delayMs: z.number().finite().min(0).max(60000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const tickerPatchSchema = z
  .object({
    items: z
      .array(tickerItemSchema)
      .max(128)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Ticker item IDs must be unique.',
      )
      .optional(),
    speedPixelsPerSecond: z.number().finite().min(0).max(2000).optional(),
    gap: z.number().finite().min(0).max(16384).optional(),
    direction: z.enum(['left', 'right']).optional(),
    textDirection: z.enum(['auto', 'ltr', 'rtl']).optional(),
    updatePolicy: z.enum(['next-appearance', 'immediate']).optional(),
    entryFade: z.number().finite().min(0).max(16384).optional(),
    exitFade: z.number().finite().min(0).max(16384).optional(),
    fadeSoftness: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

const elementPatchSchema = z
  .object({
    ...tickerPatchSchema.shape,
    crawl: z
      .object({
        speedPixelsPerSecond: z.number().finite().min(0).max(2000).optional(),
        gap: z.number().finite().min(0).max(8192).optional(),
        direction: z.enum(['left', 'right']).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    clock: clockTimerSettingsPatchSchema.nullable().optional(),
    textAnimation: textAnimationPatchSchema.optional(),
  })
  .catchall(z.unknown());

const cropRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const sourceCropSchema = cropRectSchema.extend({
  sourceAspectRatio: z.number().positive().optional(),
});

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

export const propertySchema = z
  .string()
  .regex(
    /^(x|y|width|height|rotation|opacity|transformOrigin[XY]|motionPathProgress|strokeWidth|blur|dropShadow(Opacity|Offset[XY]|Blur)|fill\.stops\[(0|[1-9]\d*)\]\.offset|(fill|strokePaint)\.parameters\.[A-Za-z_]\w*(\.[xyrgba])?|effects\.[\w-]+\.(radius|offset[XY]|opacity|amount|angle)|modifiers\.[\w-]+\.[A-Za-z]\w*)$/,
  )
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
export const dataConnectionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    format: z.enum(['json', 'csv']).optional(),
    source: z.enum(['url', 'embedded', 'public-markets']).optional(),
    target: z.enum(['editor-preview', 'coordinated-preview', 'both']).optional(),
    publicMarkets: z
      .object({
        symbols: z
          .array(z.string().regex(/^[A-Z0-9]{1,12}-USD$/))
          .min(1)
          .max(16)
          .refine(
            (symbols) => new Set(symbols).size === symbols.length,
            'Product IDs must be unique.',
          ),
      })
      .strict()
      .optional(),
    url: z.string().max(8192).optional(),
    embeddedText: z
      .string()
      .max(5 * 1024 * 1024)
      .optional(),
    refreshMs: z.number().int().min(0).max(86400000).optional(),
    missing: z.enum(['default', 'empty', 'keep-last']).optional(),
    enabled: z.boolean().optional(),
    mappings: z
      .array(z.object({ fieldId: z.string().min(1), sourcePath: z.string().max(1024) }).strict())
      .max(512)
      .optional(),
  })
  .strict();

const layerBindingSchema = z.union([
  z.object({
    fieldId: z.string(),
    targetProperty: z.string(),
    sourcePath: z.array(z.string().min(1)).optional(),
    valueMap: valueMapSchema,
  }),
  z.object({
    fieldKey: z.string(),
    targetProperty: z.string(),
    sourcePath: z.array(z.string().min(1)).optional(),
    valueMap: valueMapSchema,
  }),
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
export const designTokenTargetPropertySchema = z
  .string()
  .regex(
    /^(effects\.[a-zA-Z0-9_-]+\.(color|radius|offsetX|offsetY|opacity|amount|angle)|(fill|strokePaint)\.parameters\.[A-Za-z_][A-Za-z_0-9]*|fill|fill\.stops\[(0|[1-9]\d*)\]\.color|dropShadowColor|strokeColor|strokeWidth|borderRadius(TopLeft|TopRight|BottomRight|BottomLeft)?|color|fontFamily|fontSize|fontWeight)$/,
  ) as z.ZodType<DesignTokenTargetProperty>;

const paintSchema = z.union([z.string().min(1), gradientPaintSchema]);
const stylePackSchema = z.enum(STYLE_PACK_IDS);
const recipePlacementSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict();
const recipeMotionSchema = z
  .object({
    style: z.enum(['wipe', 'stagger', 'slide', 'none']).optional(),
    entrance: z.enum(['left', 'right', 'up', 'down', 'none']).optional(),
    exit: z.enum(['left', 'right', 'up', 'down', 'none']).optional(),
    staggerFrames: z.number().int().nonnegative().max(120).optional(),
    entranceDurationFrames: z.number().int().min(2).max(600).optional(),
    exitDurationFrames: z.number().int().min(2).max(600).optional(),
    entranceEasing: easingSchema.optional(),
    exitEasing: easingSchema.optional(),
  })
  .strict();
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
  'object',
  'array',
]);
export const fieldValueSchema: z.ZodType<FieldValue> = z.lazy(() =>
  z.union([
    gradientPaintSchema,
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(fieldValueSchema),
    z.record(z.string(), fieldValueSchema),
  ]),
);
const fieldOptionSchema = z.object({ value: z.string(), label: z.string() }).strict();
const fieldConstraintsSchema = z
  .object({
    maxLength: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    pattern: z.string().optional(),
    step: z.number().positive().finite().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().max(100).optional(),
  })
  .strict();
const fieldSchemaInputSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).optional(),
      key: z.string().min(1),
      label: z.string().optional(),
      description: z.string().optional(),
      fieldType: fieldTypeSchema,
      nodosType: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .regex(/^[A-Za-z_][A-Za-z0-9_.]*$/)
        .optional(),
      defaultValue: fieldValueSchema.optional(),
      required: z.boolean().optional(),
      exposeToOgraf: z.boolean().optional(),
      options: z.array(fieldOptionSchema).optional(),
      constraints: fieldConstraintsSchema.optional(),
      fileExtensions: z.array(z.string()).optional(),
      properties: z.array(fieldSchemaInputSchema).optional(),
      items: fieldSchemaInputSchema.nullable().optional(),
    })
    .strict(),
);

const tilingPatch = z
  .object({
    lighting: z
      .record(z.string(), z.union([z.number().finite(), z.boolean()]))
      .nullable()
      .optional(),
    fitRows: z.boolean().optional(),
    name: z.string().min(1).optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
    rows: z.number().int().min(1).max(32).optional(),
    rowHeight: z.number().finite().optional(),
    rowGap: z.number().finite().optional(),
    gap: z.number().finite().optional(),
    spacingVariation: z.number().min(0).max(1).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    offsetX: z.number().finite().optional(),
    offsetY: z.number().finite().optional(),
    direction: z.enum(['left', 'right', 'alternate']).optional(),
    cycleFrames: z.number().int().min(1).max(1000000).optional(),
    cyclesPerLoop: z.number().int().min(0).max(32).optional(),
    speedVariation: z.number().min(0).max(1).optional(),
    phase: z.number().finite().optional(),
    rowPhaseStep: z.number().finite().optional(),
    symbols: z.array(z.record(z.string(), z.unknown())).min(1).max(32).optional(),
    sequence: z
      .array(
        z.object({ symbolKey: z.string().min(1), gapScale: z.number().min(0).max(100) }).strict(),
      )
      .min(1)
      .max(64)
      .optional(),
    rowOverrides: z.array(z.record(z.string(), z.unknown())).max(32).optional(),
  })
  .strict();

const effectPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().describe('add_effect: false unless blendMode is set').optional(),
    blendMode: z
      .string()
      .regex(/^(normal|screen|add|multiply|overlay|darken|lighten)$/)
      .optional(),
    blendOpacity: z.number().min(0).max(1).optional(),
    params: z.record(z.string(), z.union([z.number().finite(), z.string()])).optional(),
    shader: z.unknown().describe('iChannel0=input; no inputImage.').optional(),
  })
  .strict();

const mediaCueSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.literal('clip'),
      mediaType: z.enum(['audio', 'video']),
      src: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.literal('live'),
      tag: z.string().min(1),
      fallback: z.string().min(1).optional(),
    })
    .strict(),
]);
const mediaCueTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('timeline'), startFrame: frame }).strict(),
  z.object({ type: z.literal('lifecycle'), keyframeId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('customAction'), actionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('manual') }).strict(),
]);
const mediaCueTransitionSchema = z
  .object({
    type: z.enum(['cut', 'crossfade']),
    durationFrames: z.number().int().nonnegative(),
    audio: z.enum(['follow-picture', 'cut', 'crossfade']),
    onFailure: z.enum(['keep-current', 'fallback', 'transparent']),
  })
  .strict();
const mediaCueVisualSchema = z
  .object({
    targetLayerId: z.string().nullable(),
    fit: z.enum(['cover', 'contain', 'fill']),
    positionX: z.number().min(0).max(1),
    positionY: z.number().min(0).max(1),
    crop: sourceCropSchema.optional(),
  })
  .strict();
const mediaCueSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    sources: z.array(mediaCueSourceSchema).min(1),
    activeSourceId: z.string().nullable(),
    trigger: mediaCueTriggerSchema,
    trimStartMs: z.number().nonnegative(),
    trimEndMs: z.number().positive().nullable(),
    durationFrames: z.number().int().positive().nullable(),
    loop: z.boolean(),
    speed: z.number().min(0.1).max(16),
    volume: z.number().min(0).max(1),
    muted: z.boolean(),
    retrigger: z.enum(['restart', 'resume', 'ignore']),
    transition: mediaCueTransitionSchema,
    visual: mediaCueVisualSchema,
  })
  .strict();
const mediaCuePatchSchema = mediaCueSchema.omit({ id: true }).partial().strict();

const visualRuleConditionShape = {
  fieldId: z.string(),
  sourcePath: z.array(z.string()).optional(),
  operator: z.enum(VISUAL_RULE_OPERATOR_VALUES).optional(),
  value: z.unknown().optional(),
  compareFieldId: z.string().optional(),
  compareSourcePath: z.array(z.string()).optional(),
  ignoreCase: z.boolean().optional(),
};

const visualRuleConditionSchema = z.object(visualRuleConditionShape).strict();

const visualRuleTargetShape = {
  targetLayerId: z.string().optional(),
  targetGroupId: z.string().optional(),
  transitionFrames: z.number().optional(),
};

const layerMotionSpecSchema = z
  .object({
    // Checked below rather than as an enum: the style list lives in the guide, not the contract.
    style: z.string().transform((style) => style as LayerMotionStyle),
    durationFrames: z.number().int().positive(),
  })
  .catchall(z.unknown())
  .superRefine((spec, context) => {
    const allowed = new Set([
      'style',
      'direction',
      'durationFrames',
      'distance',
      'easing',
      'offsetFrames',
    ]);
    for (const key of Object.keys(spec))
      if (!allowed.has(key))
        context.addIssue({ code: 'custom', path: [key], message: 'Unknown motion setting.' });
    if (!LAYER_MOTION_STYLES.includes(spec.style))
      context.addIssue({
        code: 'custom',
        path: ['style'],
        message: `Unknown motion style. Use ${LAYER_MOTION_STYLES.join(', ')}.`,
      });
    if (!Number.isInteger(spec.durationFrames) || Number(spec.durationFrames) < 1)
      context.addIssue({
        code: 'custom',
        path: ['durationFrames'],
        message: 'Use positive frames.',
      });
    const directions = layerMotionDirections(spec.style);
    if (
      spec.direction !== undefined &&
      !directions.includes(spec.direction as LayerMotionDirection)
    )
      context.addIssue({
        code: 'custom',
        path: ['direction'],
        message: `Use ${directions.join(', ') || 'no direction'} for ${spec.style}.`,
      });
    if (
      spec.offsetFrames !== undefined &&
      !(Number.isInteger(spec.offsetFrames) && Number(spec.offsetFrames) >= 0)
    )
      context.addIssue({ code: 'custom', path: ['offsetFrames'], message: 'Use 0+ frames.' });
    if (
      spec.distance !== undefined &&
      !(typeof spec.distance === 'number' && Number.isFinite(spec.distance) && spec.distance >= 0)
    )
      context.addIssue({
        code: 'custom',
        path: ['distance'],
        message: 'Use a non-negative distance.',
      });
    if (spec.easing !== undefined && !easingSchema.safeParse(spec.easing).success)
      context.addIssue({ code: 'custom', path: ['easing'], message: 'Unknown easing preset.' });
  });

export const authoringOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_review_comment'),
    compositionId: z.string(),
    id: z.string().optional(),
    text: z.string().trim().min(1).max(2000),
    author: z.string().trim().min(1).max(128),
    layerId,
    frame,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    type: z.literal('set_review_comment_resolved'),
    commentId: z.string().min(1).max(256),
    resolved: z.boolean(),
  }),
  z.object({
    type: z.literal('save_review_version'),
    id: z.string().optional(),
    name: z.string().trim().min(1).max(128),
  }),
  z.object({
    type: z.literal('set_review_approval'),
    author: z.string().trim().min(1).max(128).nullable(),
  }),
  z.object({
    type: z.literal('set_test_rundowns'),
    compositionId,
    rundowns: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().min(1).max(128),
          rows: z
            .array(
              z.object({
                id: z.string().min(1).max(256),
                values: z.record(z.string(), fieldValueSchema),
              }),
            )
            .max(2000),
        }),
      )
      .max(32),
  }),
  z.object({
    type: z.literal('add_modifier'),
    compositionId,
    layerId,
    layerName,
    modifierType: modifierTypeSchema,
    params: modifierParamsSchema.optional(),
    name: z.string().trim().min(1).max(256).optional(),
    enabled: z.boolean().optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('update_modifier'),
    compositionId,
    layerId,
    layerName,
    modifierId: z.string().min(1),
    patch: modifierPatchSchema,
    scope: z.enum(['authored', 'frame']).default('authored'),
    frame: frame.optional(),
  }),
  z.object({
    type: z.literal('remove_modifier'),
    compositionId,
    layerId,
    layerName,
    modifierId: z.string().min(1),
  }),
  z.object({
    type: z.literal('duplicate_modifier'),
    compositionId,
    layerId,
    layerName,
    modifierId: z.string().min(1),
  }),
  z.object({
    type: z.literal('reorder_modifiers'),
    compositionId,
    layerId,
    layerName,
    modifierIds: z.array(z.string().min(1)).max(16),
  }),
  z.object({
    type: z.literal('set_layer_lighting'),
    compositionId,
    layerId,
    layerName,
    link: z.record(z.string(), z.union([z.string(), z.number().finite()])).nullable(),
  }),
  z.object({
    type: z.literal('add_effect'),
    compositionId,
    layerId,
    layerName,
    groupId: z.string().min(1).optional(),
    effectType: z.enum(EFFECT_TYPES),
    patch: effectPatchSchema.optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('update_effect'),
    compositionId,
    layerId,
    layerName,
    groupId: z.string().min(1).optional(),
    effectId: z.string(),
    patch: effectPatchSchema,
    scope: z.enum(['authored', 'frame']).default('authored'),
    frame: frame.optional(),
  }),
  z.object({
    type: z.literal('remove_effect'),
    compositionId,
    layerId,
    layerName,
    groupId: z.string().min(1).optional(),
    effectId: z.string(),
  }),
  z.object({
    type: z.literal('duplicate_effect'),
    compositionId,
    layerId,
    layerName,
    groupId: z.string().min(1).optional(),
    effectId: z.string(),
  }),
  z.object({
    type: z.literal('reorder_effects'),
    compositionId,
    layerId,
    layerName,
    groupId: z.string().min(1).optional(),
    effectIds: z.array(z.string()).max(16),
  }),

  z.object({
    type: z.literal('set_tiling_pattern'),
    compositionId,
    patternId: z.string().optional(),
    patternName: z.string().optional(),
    patch: tilingPatch,
    createLayer: z.boolean().default(true),
  }),
  z.object({ type: z.literal('remove_tiling_pattern'), compositionId, patternId: z.string() }),
  z.object({
    type: z.literal('remove_renderer_plugin'),
    compositionId,
    reference: z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }),
  z.object({
    type: z.literal('set_project_metadata'),
    thumbnailFrame: z.number().int().nonnegative().nullable().optional(),
    id: z.string().min(1).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    author: z
      .object({ name: z.string(), email: z.string().optional(), url: z.string().optional() })
      .optional(),
    authoringPrompt: z
      .object({ id: z.string().min(1), text: z.string().min(1) })
      .describe('Actual user prompt intended for inclusion in the template and export.')
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
    updateInterruption: z.enum(['queue', 'replace']).optional(),
    backgroundColor: z.string().optional(),
    crop: cropRectSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('set_composition_layout'),
    compositionId,
    patch: z
      .object({
        showRulers: z.boolean().optional(),
        showActionSafe: z.boolean().optional(),
        showTitleSafe: z.boolean().optional(),
        showCenterMarker: z.boolean().optional(),
        dimOutsideCanvas: z.boolean().optional(),
        presentationBackground: z
          .enum(['none', 'big-buck-bunny', 'still-image', 'webcam'])
          .optional(),
        presentationBackgroundImageSource: z.string().max(2048).optional(),
        presentationBackgroundImageName: z.string().max(260).optional(),
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
    type: z.literal('retime_animation_phase'),
    compositionId,
    phase: z.enum(['in', 'on-air', 'out', 'entire']),
    targetFrames: z.number().int().min(1),
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
      .regex(/^#[0-9a-fA-F]{6}$/)
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
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
    scope: z.enum(['local', 'set']).default('local'),
    layerIds: z.array(z.string()).min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('instantiate_component'),
    compositionId,
    componentId: z.string().min(1),
    instanceId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
      .refine(
        (id) => !['__proto__', 'constructor', 'prototype'].includes(id),
        'Use a safe component instance ID.',
      )
      .optional(),
    offset: z.object({ x: z.number().optional(), y: z.number().optional() }).strict().optional(),
    linked: z.boolean().default(true),
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
    type: z.literal('update_component_layer'),
    compositionId,
    componentId: z.string().min(1),
    sourceLayerId: z.string().min(1),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('update_component_field'),
    compositionId,
    componentId: z.string().min(1),
    fieldId: z.string().min(1),
    patch: z
      .object({
        type: fieldTypeSchema.optional(),
        key: z.string().min(1).optional(),
        label: z.string().optional(),
        description: z.string().optional(),
        defaultValue: fieldValueSchema.optional(),
        defaultTokenId: z.string().nullable().optional(),
        required: z.boolean().optional(),
        exposeToOgraf: z.boolean().optional(),
        options: z.array(fieldOptionSchema).optional(),
        constraints: fieldConstraintsSchema.optional(),
        fileExtensions: z.array(z.string()).optional(),
        properties: z.array(fieldSchemaInputSchema).optional(),
        items: fieldSchemaInputSchema.nullable().optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.literal('reset_component_overrides'),
    compositionId,
    layerIds: z.array(z.string().min(1)).min(1),
    paths: z
      .array(
        z
          .string()
          .max(4096)
          .regex(/^\/(?:[^~]|~[01])*$/),
      )
      .min(1)
      .max(1024)
      .optional(),
  }),
  z.object({
    type: z.literal('make_component_unique'),
    compositionId,
    instanceId: z.string().min(1),
    name: z.string().min(1).optional(),
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
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
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
    type: z.literal('add_media_cue'),
    compositionId,
    cue: mediaCueSchema,
  }),
  z.object({
    type: z.literal('update_media_cue'),
    compositionId,
    cueId: z.string().min(1),
    patch: mediaCuePatchSchema,
  }),
  z.object({
    type: z.literal('remove_media_cue'),
    compositionId,
    cueId: z.string().min(1),
  }),
  z.object({
    type: z.literal('add_layer'),
    compositionId,
    kind: z.enum([
      'rectangle',
      'ellipse',
      'chart',
      'text',
      'clock',
      'ticker',
      'image',
      'path',
      'pattern',
      'image-sequence',
      'lottie',
      'shader',
    ]),
    name: z.string().optional(),
    transform: transform.optional(),
    element: elementPatchSchema.optional(),
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
    type: z.literal('apply_style_pack'),
    compositionId,
    stylePack: stylePackSchema,
    bindLayers: z.boolean().default(true),
  }),
  z.object({ type: z.literal('remove_style_pack'), compositionId }),
  z.object({
    type: z.literal('create_lower_third'),
    compositionId,
    asComponent: z.boolean().optional(),
    stylePack: stylePackSchema.optional(),
    name: z.string().min(1).optional(),
    placement: recipePlacementSchema.optional(),
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
    motion: recipeMotionSchema.optional(),
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
    type: z.enum([
      'create_bug',
      'create_ticker',
      'create_scoreboard',
      'create_clock',
      'create_countdown',
    ]),
    compositionId,
    asComponent: z.boolean().optional(),
    stylePack: stylePackSchema.optional(),
    name: z.string().min(1).optional(),
    placement: recipePlacementSchema.optional(),
    content: z
      .object({
        label: z.string().optional(),
        text: z.string().optional(),
        homeName: z.string().optional(),
        homeScore: z.number().int().nonnegative().optional(),
        awayScore: z.number().int().nonnegative().optional(),
        awayName: z.string().optional(),
        hours: z.string().optional(),
        minutes: z.string().optional(),
      })
      .strict()
      .optional(),
    fieldKey: z.string().min(1).optional(),
    fieldKeys: z
      .object({
        label: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        homeName: z.string().min(1).optional(),
        homeScore: z.string().min(1).optional(),
        awayScore: z.string().min(1).optional(),
        awayName: z.string().min(1).optional(),
        hours: z.string().min(1).optional(),
        minutes: z.string().min(1).optional(),
        value: z.string().min(1).optional(),
        feed: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    ...tickerPatchSchema.shape,
    // Recipe calls historically accepted up to 4000; native playback normalizes to its limit.
    speedPixelsPerSecond: z.number().finite().min(0).max(4000).optional(),
    mode: clockTimerSettingsPatchSchema.shape.mode,
    source: clockTimerSettingsPatchSchema.shape.source,
    format: clockTimerSettingsPatchSchema.shape.format,
    timeZone: clockTimerSettingsPatchSchema.shape.timeZone,
    hourCycle: clockTimerSettingsPatchSchema.shape.hourCycle,
    durationSeconds: z
      .number()
      .finite()
      .min(0)
      .max(MAX_TIMER_VALUE_MS / 1000)
      .optional(),
    alarms: z.boolean().optional(),
    motion: recipeMotionSchema.optional(),
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
    isMaskOnly: z.boolean().optional(),
    blendMode: z.enum(BLEND_MODES).optional(),
  }),
  z.object({
    type: z.literal('set_layer_mask'),
    compositionId,
    layerId,
    layerName,
    sourceLayerId: z.string().nullable().optional(),
    sourceLayerName: z.string().min(1).optional(),
    mode: z.enum(['alpha', 'path']).default('alpha'),
    inverted: z.boolean().default(false),
    hideSource: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('set_layer_crop'),
    compositionId,
    layerId,
    layerName,
    crop: cropRectSchema.nullable(),
    coordinateSpace: z.enum(['layer', 'composition']).default('layer'),
    frame: frame.optional(),
  }),
  z.object({
    type: z.literal('set_layer_layout'),
    compositionId,
    layerId,
    layerName,
    isLocked: z.boolean().optional(),
    clipChildren: z.boolean().optional(),
    motionBlur: z.unknown().optional(),
    textPath: z
      .object({
        sourceLayerId: z.string(),
        startOffset: z.number(),
        alignment: z.enum(['start', 'center', 'end']),
      })
      .strict()
      .nullable()
      .optional(),
    groupId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    constraints: z
      .object({
        horizontal: z.enum(['left', 'right', 'left-right', 'center', 'scale']).optional(),
        vertical: z.enum(['top', 'bottom', 'top-bottom', 'center', 'scale']).optional(),
      })
      .strict()
      .optional(),
    autoLayout: z
      .object({
        direction: z.enum(['none', 'horizontal', 'vertical']).optional(),
        gap: z.number().min(0).optional(),
        paddingTop: z.number().min(0).optional(),
        paddingRight: z.number().min(0).optional(),
        paddingBottom: z.number().min(0).optional(),
        paddingLeft: z.number().min(0).optional(),
        align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
        hugWidth: z.boolean().optional(),
        hugHeight: z.boolean().optional(),
        minWidth: z.number().min(0).optional(),
        maxWidth: z.number().min(0).optional(),
        collapseHidden: z.boolean().optional(),
      })
      .strict()
      .optional(),
    updateTransition: z
      .object({
        style: z
          .enum([
            'inherit',
            'none',
            'crossfade',
            'slide-left',
            'slide-right',
            'slide-up',
            'slide-down',
          ])
          .optional(),
        durationFrames: z.number().int().min(0).optional(),
        distance: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    motionPath: z
      .object({
        sourceLayerId: z.string().min(1),
        progress: z.number().min(0).max(1),
        orientToPath: z.boolean(),
        offsetX: z.number(),
        offsetY: z.number(),
        rotationOffset: z.number().min(-360).max(360).optional(),
      })
      .strict()
      .nullable()
      .optional(),
  }),
  z.object({
    type: z.literal('set_layer_motion'),
    compositionId,
    layerId,
    layerName,
    side: z.enum(['in', 'out']),
    spec: layerMotionSpecSchema.nullable(),
  }),
  z
    .object({
      type: z.literal('apply_animation_preset'),
      compositionId,
      layerId,
      layerName,
      reference: z
        .object({
          id: z.string().min(1),
          version: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      presetId: z.string().min(1),
      side: z.enum(['in', 'out']),
      target: z.enum(['layer', 'chart-marks']).optional(),
      durationFrames: z.number().int().positive(),
      offsetFrames: z.number().int().nonnegative().optional(),
      delayFrames: z.number().int().nonnegative().optional(),
      staggerFrames: z.number().int().nonnegative().optional(),
      parameters: z.record(z.string(), z.number().finite()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove_animation_preset_plugin'),
      compositionId,
      reference: z
        .object({
          id: z.string().min(1),
          version: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    })
    .strict(),
  z.object({
    type: z.literal('set_layer_visual_rules'),
    compositionId,
    layerId,
    layerName,
    rules: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          enabled: z.boolean(),
          hostGroupId: z.string().min(1).optional(),
          trigger: z.enum(VISUAL_RULE_TRIGGER_VALUES).optional(),
          keyboard: z
            .object({
              key: z
                .string()
                .min(1)
                .max(128)
                .refine(
                  (key) => key === ' ' || key.trim().length > 0,
                  'A keyboard key is required.',
                ),
              ctrl: z.boolean().optional(),
              alt: z.boolean().optional(),
              shift: z.boolean().optional(),
              meta: z.boolean().optional(),
              repeat: z.boolean().optional(),
            })
            .strict()
            .optional(),
          timerAlarm: z
            .object({
              sourceLayerId: z.string().min(1),
              thresholdMs: z.number().finite().min(0).max(MAX_TIMER_VALUE_MS),
              direction: z.enum(['up', 'down']),
            })
            .strict()
            .optional(),
          ...visualRuleConditionShape,
          fieldId: z.string().optional(),
          conditions: z.array(z.record(z.string(), z.unknown())).optional(),
          match: z.enum(['all', 'any']).optional(),
          eventId: z.string().optional(),
          delayFrames: z.number().optional(),
          actions: z.array(
            z.discriminatedUnion('type', [
              z
                .object({
                  type: z.enum(['visibility', 'toggle-visibility']),
                  visible: z.boolean().optional(),
                  ...visualRuleTargetShape,
                })
                .strict(),
              z
                .object({
                  type: z.literal('property'),
                  targetProperty: z.string().min(1),
                  value: z.unknown(),
                  ...visualRuleTargetShape,
                })
                .strict(),
              z.object({ type: z.literal('custom-action'), actionId: z.string().min(1) }).strict(),
              z.object({ type: z.literal('play-sound'), cueId: z.string().min(1) }).strict(),
              z
                .object({
                  type: z.literal('take-media'),
                  cueId: z.string().min(1),
                  sourceId: z.string().min(1).optional(),
                })
                .strict(),
              z
                .object({ type: z.literal('shader-animation'), actionId: z.string().min(1) })
                .strict(),
              z
                .object({
                  type: z.literal('playout'),
                  operation: z.enum(VISUAL_RULE_PLAYOUT_OPERATIONS),
                  slotId: z.string().min(1).max(256).regex(/\S/),
                  stateId: z.string().min(1).max(256).regex(/\S/).optional(),
                  data: z
                    .record(z.string(), z.unknown())
                    .superRefine((data, context) => {
                      for (const message of visualRulePlayoutDataErrors(data))
                        context.addIssue({ code: 'custom', message });
                    })
                    .transform((data) => data as Record<string, FieldValue>)
                    .optional(),
                })
                .strict(),
              z
                .object({
                  type: z.literal('set-data'),
                  fieldId: z.string().min(1),
                  mode: z.enum(['set', 'toggle', 'increase', 'decrease']),
                  value: z.unknown().optional(),
                })
                .strict(),
            ]),
          ),
        })
        .strict()
        .superRefine((rule, context) => {
          const trigger = rule.trigger ?? 'data';
          if ((trigger === 'key-down' || trigger === 'key-up') && !rule.keyboard)
            context.addIssue({
              code: 'custom',
              path: ['keyboard'],
              message: 'Keyboard rules require keyboard:{key,...modifiers}.',
            });
          if (trigger === 'timer-alarm' && !rule.timerAlarm) {
            context.addIssue({
              code: 'custom',
              path: ['timerAlarm'],
              message: 'Timer alarm rules require sourceLayerId, thresholdMs and direction.',
            });
          }
          for (const [index, condition] of (rule.conditions ?? []).entries()) {
            const parsed = visualRuleConditionSchema.safeParse(condition);
            if (!parsed.success)
              for (const issue of parsed.error.issues)
                context.addIssue({
                  code: 'custom',
                  path: ['conditions', index, ...issue.path.map(String)],
                  message: issue.message,
                });
          }
          if (trigger === 'data' && !rule.fieldId) {
            context.addIssue({
              code: 'custom',
              path: ['fieldId'],
              message: 'Data rules require a fieldId; other triggers do not.',
            });
          }
          if (trigger === 'custom-action' && !rule.eventId) {
            context.addIssue({
              code: 'custom',
              path: ['eventId'],
              message: 'custom-action rules name the triggering custom actionId in eventId.',
            });
          }
          const conditions = [
            ...(trigger === 'data' ? [rule] : []),
            ...(rule.conditions ?? []).map((condition) => ({
              operator: String(condition.operator ?? ''),
            })),
          ];
          if (
            trigger !== 'data' &&
            conditions.some((condition) =>
              ['changed', 'increased', 'decreased'].includes(condition.operator ?? ''),
            )
          ) {
            context.addIssue({
              code: 'custom',
              path: ['conditions'],
              message: 'changed/increased/decreased watch data, so they need a data trigger.',
            });
          }
          const isState =
            trigger === 'hover' ||
            (trigger === 'data' &&
              !conditions.some((condition) =>
                ['changed', 'increased', 'decreased'].includes(condition.operator ?? ''),
              ));
          if (isState && (rule.delayFrames ?? 0) > 0) {
            context.addIssue({
              code: 'custom',
              path: ['delayFrames'],
              message: 'Delays apply to event triggers only.',
            });
          }
          for (const [index, action] of rule.actions.entries()) {
            if (action.type === 'playout')
              for (const message of visualRulePlayoutActionErrors(action))
                context.addIssue({ code: 'custom', path: ['actions', index], message });
            if (action.type === 'visibility' && action.visible === undefined)
              context.addIssue({
                code: 'custom',
                path: ['actions', index, 'visible'],
                message: 'visibility actions need visible; use toggle-visibility to flip.',
              });
            if (action.type === 'toggle-visibility' && action.visible !== undefined)
              context.addIssue({
                code: 'custom',
                path: ['actions', index, 'visible'],
                message: 'toggle-visibility flips the current visibility; omit visible.',
              });
          }
          if (isState && rule.actions.some((action) => action.type === 'toggle-visibility')) {
            context.addIssue({
              code: 'custom',
              path: ['actions'],
              message: 'toggle-visibility needs an event trigger; state rules use visibility.',
            });
          }
        }),
    ),
  }),
  z.object({
    type: z.literal('update_element'),
    compositionId,
    layerId,
    layerName,
    patch: elementPatchSchema,
  }),
  z.object({
    type: z.literal('edit_path'),
    compositionId,
    layerId,
    layerName,
    frame: frame.optional(),
    // Geometry validates action-specific fields in scene-model. Capabilities publish their contract.
    edit: z
      .object({
        action: z.enum(['convert', 'move', 'handles', 'insert', 'remove', 'smooth', 'corner']),
      })
      .catchall(z.unknown()),
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
        z
          .object({
            type: z.literal('customAction'),
            customActionId: z.string().min(1),
          })
          .strict(),
      ])
      .optional(),
    durationFrames: z.number().int().positive().optional(),
    phaseOffsetFrames: z.number().int().optional(),
    repeatCount: z.number().int().positive().nullable().optional(),
    timing: z
      .object({
        groupId: z.string().trim().min(1),
        holdFieldId: z.string().min(1),
        holdRanges: z
          .array(
            z
              .object({
                startFrame: z.number().int().nonnegative(),
                endFrame: z.number().int().positive(),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .nullable()
      .optional(),
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
    type: z.literal('reset_property_animation'),
    compositionId,
    layerId,
    layerName,
    property: z.union([propertySchema, z.enum(REVEAL_ANIMATION_PROPERTIES)]),
    frame,
    loopElapsedFrames: z.number().finite().nonnegative().optional(),
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
    type: z.literal('add_data_connection'),
    compositionId,
    connection: dataConnectionPatchSchema,
  }),
  z.object({
    type: z.literal('update_data_connection'),
    compositionId,
    connectionId: z.string().min(1),
    patch: dataConnectionPatchSchema,
  }),
  z.object({
    type: z.literal('remove_data_connection'),
    compositionId,
    connectionId: z.string().min(1),
  }),
  z.object({
    type: z.literal('add_data_field'),
    exposeToNodos: z.boolean().optional(),
    nodosType: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z_][A-Za-z0-9_.]*$/)
      .optional(),
    defaultTokenId: z.string().nullable().optional(),
    compositionId,
    fieldType: fieldTypeSchema,
    key: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    defaultValue: fieldValueSchema.optional(),
    required: z.boolean().optional(),
    exposeToOgraf: z.boolean().optional(),
    options: z.array(fieldOptionSchema).optional(),
    constraints: fieldConstraintsSchema.optional(),
    fileExtensions: z.array(z.string()).optional(),
    properties: z.array(fieldSchemaInputSchema).optional(),
    items: fieldSchemaInputSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('update_data_field'),
    exposeToNodos: z.boolean().optional(),
    nodosType: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z_][A-Za-z0-9_.]*$/)
      .nullable()
      .optional(),
    defaultTokenId: z.string().nullable().optional(),
    compositionId,
    fieldId: z.string().optional(),
    fieldKey: z.string().optional(),
    fieldType: fieldTypeSchema.optional(),
    key: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    defaultValue: fieldValueSchema.optional(),
    required: z.boolean().optional(),
    exposeToOgraf: z.boolean().optional(),
    options: z.array(fieldOptionSchema).optional(),
    constraints: fieldConstraintsSchema.optional(),
    fileExtensions: z.array(z.string()).optional(),
    properties: z.array(fieldSchemaInputSchema).optional(),
    items: fieldSchemaInputSchema.nullable().optional(),
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
  z
    .object({
      type: z.literal('set_logic_functions'),
      compositionId,
      functions: z
        .array(
          z
            .object({
              type: z.literal('javascript'),
              version: z.literal(1),
              id: z.string().min(1).max(128),
              name: z.string().min(1).max(128),
              enabled: z.boolean(),
              pointer: z.boolean().optional(),
              source: z
                .string()
                .min(1)
                .refine(
                  (source) =>
                    source.trim().length > 0 &&
                    new TextEncoder().encode(source).byteLength <= MAX_LOGIC_FUNCTION_SOURCE_BYTES,
                  'Function source must be a nonempty expression of at most128KiB UTF-8.',
                ),
              inputs: logicFunctionMappingSchema(128),
              outputs: logicFunctionMappingSchema(128),
              actions: z.array(z.string().min(1).max(256)).max(128),
              emits: logicFunctionMappingSchema(64).optional(),
              media: logicFunctionMappingSchema(64).optional(),
              initialState: z
                .unknown()
                .superRefine((value, context) => {
                  for (const message of logicFunctionJsonErrors(value))
                    context.addIssue({ code: 'custom', message });
                })
                .transform((value) => value as LogicJsonValue)
                .optional(),
              timeoutMs: z.number().int().min(16).max(1000).optional(),
            })
            .strict(),
        )
        .max(8),
    })
    .strict(),
  z.object({
    type: z.literal('create_runtime_collection'),
    compositionId,
    name: z.string().min(1).optional(),
    fieldId: z.string().optional(),
    fieldKey: z.string().optional(),
    layerIds: z.array(z.string()).min(1).optional(),
    layerNames: z.array(z.string().min(1)).min(1).optional(),
    groupId: z.string().min(1).optional(),
    offsetPerItem: z.object({ x: z.number(), y: z.number() }).strict(),
    capacity: z.number().int().min(1).max(100).default(12),
    overflow: z.literal('truncate').default('truncate'),
    itemKeyPath: z.array(z.string()).default([]),
    sortPath: z.array(z.string()).default([]),
    sortDirection: z.enum(['none', 'ascending', 'descending']).default('none'),
    pageSize: z.number().int().min(0).max(100).default(0),
    page: z.number().int().min(0).default(0),
  }),
  z.object({
    type: z.literal('update_runtime_collection'),
    compositionId,
    collectionId: z.string().min(1),
    name: z.string().min(1).optional(),
    fieldId: z.string().optional(),
    fieldKey: z.string().optional(),
    layerIds: z.array(z.string()).min(1).optional(),
    layerNames: z.array(z.string().min(1)).min(1).optional(),
    groupId: z.string().min(1).optional(),
    offsetPerItem: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    capacity: z.number().int().min(1).max(100).optional(),
    overflow: z.literal('truncate').optional(),
    itemKeyPath: z.array(z.string()).optional(),
    sortPath: z.array(z.string()).optional(),
    sortDirection: z.enum(['none', 'ascending', 'descending']).optional(),
    pageSize: z.number().int().min(0).max(100).optional(),
    page: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('remove_runtime_collection'),
    compositionId,
    collectionId: z.string().min(1),
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
