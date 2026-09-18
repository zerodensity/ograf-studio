/** User-selected visual reference; transient chat context, never part of an OGraf project. */
export const MAX_AREA_REFERENCES = 8;
export const MAX_AREA_REFERENCE_DATA = 12_000_000;
export const MAX_AREA_POLYGON_POINTS = 512;

export interface AgentAreaReference {
  projectId: string;
  compositionId: string;
  frame: number;
  revision: number | null;
  compositionWidth: number;
  compositionHeight: number;
  rect: { x: number; y: number; width: number; height: number };
  /** Optional closed freehand outline in composition coordinates; rect is its crop bounds.
   * Uses even-odd fill, with pixels outside the outline transparent in image. */
  polygon?: { x: number; y: number }[];
  instruction?: string;
  image: { mimeType: 'image/png'; data: string; width: number; height: number };
}
