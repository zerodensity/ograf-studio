import * as z from 'zod/v4';
import type { AgentAreaReference } from '@ograf-editor/agent-tools';
import {
  MAX_AREA_REFERENCES,
  MAX_AREA_REFERENCE_DATA,
  MAX_AREA_POLYGON_POINTS,
} from '@ograf-editor/agent-tools/chat-references';

const dimension = z.number().int().positive().max(100_000);
const areaSchema = z.object({
  instruction: z.string().max(2000).optional(),
  projectId: z.string().min(1).max(200),
  compositionId: z.string().min(1).max(200),
  frame: z.number().finite().nonnegative(),
  revision: z.number().int().nonnegative().nullable(),
  compositionWidth: dimension,
  compositionHeight: dimension,
  rect: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: dimension,
    height: dimension,
  }),
  polygon: z
    .array(
      z.object({
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
      }),
    )
    .min(3)
    .max(MAX_AREA_POLYGON_POINTS)
    .optional(),
  image: z.object({
    mimeType: z.literal('image/png'),
    data: z
      .string()
      .min(32)
      .max(6_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: dimension.max(1024),
    height: dimension.max(1024),
  }),
});

export function parseAreaReferences(value: unknown, sessionId: string): AgentAreaReference[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AREA_REFERENCES)
    throw new Error('Select between one and eight areas.');
  const areas = value.map((area) => parseAreaReference(area, sessionId));
  if (areas.reduce((bytes, area) => bytes + area.image.data.length, 0) > MAX_AREA_REFERENCE_DATA)
    throw new Error('The combined area images are too large.');
  if (areas.some((area) => area.compositionId !== areas[0]!.compositionId))
    throw new Error('All areas must belong to the same composition.');
  return areas;
}

export function parseAreaReference(value: unknown, sessionId: string): AgentAreaReference {
  const area = areaSchema.parse(value);
  if (sessionId !== `editor:${area.projectId}`)
    throw new Error('Area reference belongs to another project.');
  if (
    area.rect.x + area.rect.width > area.compositionWidth ||
    area.rect.y + area.rect.height > area.compositionHeight
  )
    throw new Error('Area reference is outside the composition.');
  if (
    area.polygon?.some(
      ({ x, y }) =>
        x < area.rect.x ||
        y < area.rect.y ||
        x > area.rect.x + area.rect.width ||
        y > area.rect.y + area.rect.height,
    )
  )
    throw new Error('Freehand outline is outside its crop bounds.');
  const png = Buffer.from(area.image.data, 'base64');
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) !== area.image.width ||
    png.readUInt32BE(20) !== area.image.height
  )
    throw new Error('Area reference is not a valid PNG with the specified dimensions.');
  return area;
}
