import * as z from 'zod/v4';
import { transitionLogicErrors } from '@ograf-editor/scene-model';

/** Definitions cross the JSON bridge; reject oversized or lossy values before domain validation. */
const transitionLogicDefinition = z
  .record(z.string(), z.unknown())
  .superRefine((definition, context) => {
    let count = 0;
    const ancestors = new Set<object>();
    const visit = (value: unknown, depth: number): boolean => {
      if (++count > 32768 || depth > 32) return false;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value !== 'object' || ancestors.has(value)) return false;
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        return false;
      ancestors.add(value);
      const valid = Object.values(value).every((child) => visit(child, depth + 1));
      ancestors.delete(value);
      return valid;
    };
    if (!visit(definition, 0)) {
      context.addIssue({
        code: 'custom',
        message:
          'Transition Logic must be JSON-safe, with at most 32768 values and 32 nested levels.',
      });
      return;
    }
    if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > 1024 * 1024) {
      context.addIssue({ code: 'custom', message: 'Transition Logic must not exceed 1 MiB.' });
      return;
    }
    for (const message of transitionLogicErrors(definition))
      context.addIssue({ code: 'custom', message });
  });

const id = z.string().min(1);
const settingKey = z.enum([
  'width',
  'height',
  'frameRate',
  'backgroundColor',
  'supportsRealTime',
  'supportsNonRealTime',
  'updateTransitionFrames',
  'updateInterruption',
  'layout.showRulers',
  'layout.showActionSafe',
  'layout.showTitleSafe',
  'layout.showCenterMarker',
  'layout.dimOutsideCanvas',
  'layout.snappingEnabled',
  'layout.snapToGrid',
  'layout.snapToGuides',
  'layout.snapToLayers',
  'layout.gridSize',
  'layout.snapThreshold',
  'layout.boundsMode',
  'layout.overflowPreview',
]);
const brandToken = z
  .object({
    id,
    key: id,
    name: id,
    type: z.enum(['color', 'number', 'text', 'font-family', 'font-weight']),
    value: z.union([z.string(), z.number()]),
    description: z.string().default(''),
  })
  .strict();
const styleKind = z.enum(['typography', 'background']);
const styleData = z.record(z.string(), z.unknown());
const brandKit = z
  .object({
    name: id,
    tokens: z.array(brandToken).max(1024),
    typography: z.array(styleData).max(256).optional(),
    backgrounds: z.array(styleData).max(256).optional(),
    defaultBackgroundStyleId: id.nullable().optional(),
  })
  .strict();
const position = {
  targetTemplateId: id.nullable().optional(),
  side: z.enum(['before', 'after']).default('after'),
};
const layout = z
  .object({
    showRulers: z.boolean().optional(),
    showActionSafe: z.boolean().optional(),
    showTitleSafe: z.boolean().optional(),
    showCenterMarker: z.boolean().optional(),
    dimOutsideCanvas: z.boolean().optional(),
    snappingEnabled: z.boolean().optional(),
    snapToGrid: z.boolean().optional(),
    snapToGuides: z.boolean().optional(),
    snapToLayers: z.boolean().optional(),
    gridSize: z.number().int().positive().optional(),
    snapThreshold: z.number().int().nonnegative().optional(),
    boundsMode: z.enum(['allow', 'contain']).optional(),
    overflowPreview: z.enum(['visible', 'clip']).optional(),
  })
  .strict();
export const templateSetOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('set_transition_logic'),
      definition: transitionLogicDefinition
        .nullable()
        .describe(
          'Definition/null. v6 slot updateMode; v5 recipe incomingAnimation/outgoingAnimation (template/builtin/plugin), pinned animationPresetPlugins; reads v1-4. Nonshared content moves; shared objects morph. Admission guards/defaults/precedence kept. parentSlotId cascades Out/Clear; takeOutSlotIds awaits targets/dependents Out, no restore.',
        ),
    })
    .strict(),
  z.object({ type: z.literal('upsert_brand_style'), kind: styleKind, style: styleData }).strict(),
  z.object({ type: z.literal('remove_brand_style'), kind: styleKind, styleId: id }).strict(),
  z
    .object({
      type: z.literal('set_brand_style_override'),
      kind: styleKind,
      templateId: id,
      styleId: id,
      override: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('apply_typography'),
      layerIds: z.array(id).min(1).max(100),
      presetId: id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('reset_typography_property'),
      layerId: id,
      property: z.enum([
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'textAlign',
        'textTransform',
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_background_style'),
      styleId: id.nullable(),
      asDefault: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_background_paint'),
      paint: z.union([z.string(), styleData, z.null()]),
    })
    .strict(),
  z.object({ type: z.literal('reset_background') }).strict(),
  z
    .object({
      type: z.literal('set_setting_override'),
      templateId: id,
      key: settingKey,
      override: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('set_brand_kit'), brandKit }).strict(),
  z.object({ type: z.literal('upsert_brand_token'), token: brandToken }).strict(),
  z.object({ type: z.literal('remove_brand_token'), tokenId: id }).strict(),
  z
    .object({
      type: z.literal('set_brand_token_override'),
      templateId: id,
      tokenId: id,
      override: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('create'), name: id.optional() }).strict(),
  z.object({ type: z.literal('new_template'), ...position }).strict(),
  z.object({ type: z.literal('duplicate_template'), templateId: id }).strict(),
  z.object({ type: z.literal('copy_template'), templateId: id }).strict(),
  z.object({ type: z.literal('paste_template'), ...position }).strict(),
  z.object({ type: z.literal('remove_template'), templateId: id }).strict(),
  z.object({ type: z.literal('undo_remove') }).strict(),
  z.object({ type: z.literal('activate_template'), templateId: id }).strict(),
  z.object({ type: z.literal('rename_template'), templateId: id, name: id }).strict(),
  z.object({ type: z.literal('rename_set'), name: id }).strict(),
  z
    .object({
      type: z.literal('reorder_template'),
      templateId: id,
      targetTemplateId: id,
      side: z.enum(['before', 'after']),
    })
    .strict(),
  z.object({ type: z.literal('set_inheritance'), templateId: id, inherit: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('set_defaults'),
      patch: z
        .object({
          width: z.number().int().min(1).max(32768).optional(),
          height: z.number().int().min(1).max(32768).optional(),
          frameRate: z.number().positive().max(240).optional(),
          backgroundColor: id.optional(),
          supportsRealTime: z.boolean().optional(),
          supportsNonRealTime: z.boolean().optional(),
          updateTransitionFrames: z.number().int().nonnegative().optional(),
          updateInterruption: z.enum(['queue', 'replace']).optional(),
          layout: layout.optional(),
        })
        .strict(),
      inheritance: z.record(z.string(), z.boolean()).optional(),
    })
    .strict(),
  z.object({ type: z.literal('set_control_value'), controlId: id, value: z.unknown() }).strict(),
  z
    .object({
      type: z.literal('bind_control'),
      controlId: id,
      templateId: id,
      compositionId: id,
      fieldId: id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('bind_asset'),
      slotId: id,
      templateId: id,
      compositionId: id,
      templateAssetId: id.nullable(),
    })
    .strict(),
  z
    .object({ type: z.literal('set_asset_slot_source'), slotId: id, assetId: id.nullable() })
    .strict(),
]);
