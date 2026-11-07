import * as z from 'zod/v4';

/** Parameter names and shapes are validated by the shared typed modifier model after defaults. */
export const modifierParamsSchema = z.record(z.string().min(1).max(128), z.unknown());

export const modifierPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    enabled: z.boolean().optional(),
    params: modifierParamsSchema.optional(),
  })
  .strict();

export const modifierTypeSchema = z.enum([
  'max-text-width',
  'auto-size',
  'auto-follow',
  'hide-empty',
  'grid-arrange',
  'radial-arrange',
  'justify',
  'look-at',
]);
