import * as z from 'zod/v4';

export const MAX_PLAYOUT_REQUEST_BYTES = 96 * 1024;
export const MAX_PLAYOUT_DATA_BYTES = 64 * 1024;

const id = z.string().min(1).max(256);

/** Keep operator payloads bounded and lossless across the JSON bridge. */
const playoutDataSchema = z.record(z.string(), z.unknown()).superRefine((data, context) => {
  let count = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (++count > 4096 || depth > 16) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || seen.has(value)) return false;
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    seen.add(value);
    const valid = Object.values(value).every((child) => visit(child, depth + 1));
    seen.delete(value);
    return valid;
  };
  if (!visit(data, 0)) {
    context.addIssue({
      code: 'custom',
      message: 'Playout data must be JSON-safe, with at most 4096 values and 16 nested levels.',
    });
    return;
  }
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_PLAYOUT_DATA_BYTES)
    context.addIssue({ code: 'custom', message: 'Playout data must not exceed 64 KiB.' });
});

export const livePlayoutOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load') }).strict(),
  z.object({ type: z.literal('unload') }).strict(),
  z
    .object({
      type: z.literal('prepare'),
      slotId: id,
      stateId: id,
      data: playoutDataSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('take'),
      slotId: id,
      stateId: id.optional(),
      preparedRequestId: id.optional(),
      data: playoutDataSchema.optional(),
    })
    .strict()
    .refine(
      (operation) => operation.preparedRequestId === undefined || operation.stateId === undefined,
      {
        message: 'preparedRequestId applies only when taking the prepared state; omit stateId.',
        path: ['preparedRequestId'],
      },
    ),
  z
    .object({
      type: z.literal('update'),
      slotId: id,
      stateId: id.optional(),
      // Omission preserves authored transition updates for existing integrations.
      mode: z.enum(['in-place', 'transition']).optional(),
      data: playoutDataSchema,
    })
    .strict(),
  z.object({ type: z.literal('out'), slotId: id }).strict(),
  z.object({ type: z.literal('clear'), slotId: id.optional() }).strict(),
  z
    .object({
      type: z.literal('template-action'),
      slotId: id,
      actionId: id,
      data: playoutDataSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('loop'),
      slotId: id,
      groupId: id,
      action: z.enum(['pause', 'resume', 'next']),
    })
    .strict(),
]);

export const livePlayoutRequestSchema = z
  .discriminatedUnion('action', [
    z
      .object({ action: z.literal('read'), target: z.enum(['live', 'preview']).optional() })
      .strict(),
    z
      .object({
        action: z.literal('command'),
        target: z.enum(['live', 'preview']).optional(),
        expectedRevision: id,
        requestId: id,
        operation: livePlayoutOperationSchema,
      })
      .strict(),
  ])
  .refine(
    (request) =>
      request.target !== 'preview' ||
      request.action === 'read' ||
      request.operation.type === 'update',
    {
      message:
        'The preview target supports data updates only. Use Studio controls to take graphics in or out.',
    },
  );

export type LivePlayoutOperation = z.infer<typeof livePlayoutOperationSchema>;
export type LivePlayoutRequest = z.infer<typeof livePlayoutRequestSchema>;
