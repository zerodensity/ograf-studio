// TS mirrors of the OGraf Graphics spec (https://ograf.ebu.io/v1/specification/docs/Specification.html).
// Hand-authored from the spec as understood at the time of writing — not generated from the live
// JSON Schema. Vendor-extension (`v_`-prefixed) fields are permitted by the spec on most objects
// but are not modeled here since nothing in this codebase emits or reads them yet.

export type RenderType = 'realtime' | 'non-realtime';

export interface RenderCharacteristics {
  resolution?: { width: number; height: number };
  frameRate?: number;
  accessToPublicInternet?: boolean;
  engine?: string;
}

export interface ReturnPayload {
  statusCode: number;
  statusMessage?: string;
}

export interface PlayActionReturnPayload extends ReturnPayload {
  currentStep?: number;
}

export interface LoadParams {
  data?: unknown;
  renderType: RenderType;
  renderCharacteristics: RenderCharacteristics;
}

export interface UpdateActionParams {
  data: unknown;
  skipAnimation?: boolean;
}

export interface PlayActionParams {
  delta?: number;
  goto?: number;
  skipAnimation?: boolean;
}

export interface StopActionParams {
  skipAnimation?: boolean;
}

export interface CustomActionParams {
  id: string;
  payload: unknown;
  skipAnimation?: boolean;
}

export interface GoToTimeParams {
  timestamp: number;
}

export interface ScheduledAction {
  timestamp: number;
  action: {
    type: 'updateAction' | 'playAction' | 'stopAction' | 'customAction';
    params: unknown;
  };
}

export interface SetActionsScheduleParams {
  schedule: ScheduledAction[];
}

/**
 * The contract every OGraf graphic's `main` module default-exports a class implementing —
 * `class extends HTMLElement implements Graphic`. Must tolerate overlapping/concurrent calls
 * (queue or abort in-flight animation) per spec.
 */
export interface Graphic {
  load(params: LoadParams): Promise<ReturnPayload | undefined>;
  dispose(params: Record<string, never>): Promise<ReturnPayload | undefined>;
  updateAction(params: UpdateActionParams): Promise<ReturnPayload | undefined>;
  playAction(params: PlayActionParams): Promise<PlayActionReturnPayload>;
  stopAction(params: StopActionParams): Promise<ReturnPayload | undefined>;
  customAction(params: CustomActionParams): Promise<ReturnPayload | undefined>;
  /** Non-realtime graphics only. */
  goToTime(params: GoToTimeParams): Promise<ReturnPayload | undefined>;
  /** Non-realtime graphics only. */
  setActionsSchedule(params: SetActionsScheduleParams): Promise<ReturnPayload | undefined>;
}

/** Non-standard HTTP-adjacent status code the spec reserves for "error thrown inside the graphic's own method". */
export const GRAPHIC_ERROR_STATUS_CODE = 550;

export interface ManifestAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface ManifestCustomAction {
  id: string;
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
}

/**
 * Static animation durations, in **integer milliseconds** (-1 = dynamic/unknown). Shaped as a
 * discriminated union on `type`, exactly as the EBU schema defines it — note it is `type`, not
 * `action`, `playAction` carries a `steps[]` array rather than a single `step`, and `customAction`
 * requires `customActionId`. The schema sets `additionalProperties: false` on each variant, so a
 * near-miss here produces a manifest a real renderer rejects.
 */
export type ManifestActionDuration =
  | {
      type: 'playAction';
      duration: number;
      /** Per-target-step overrides; an entry without `step` is the fallback for unlisted steps. */
      steps?: { step?: number; duration: number }[];
    }
  | { type: 'updateAction'; duration: number }
  | { type: 'stopAction'; duration: number }
  | { type: 'customAction'; customActionId: string; duration: number };

/** Modeled after MediaTrackConstraints' ConstrainDouble — see the EBU schema's lib/constraints/number.json. */
export interface NumberConstraint {
  min?: number;
  max?: number;
  exact?: number;
  ideal?: number;
}

/** Modeled after MediaTrackConstraints' ConstrainBoolean — see the EBU schema's lib/constraints/boolean.json. */
export interface BooleanConstraint {
  exact?: boolean;
  ideal?: boolean;
}

export interface ManifestEngineRequirement {
  type: string;
  version: { min: string };
}

export interface ManifestRenderRequirement {
  resolution?: { width?: NumberConstraint; height?: NumberConstraint };
  frameRate?: NumberConstraint;
  accessToPublicInternet?: BooleanConstraint;
  engine?: ManifestEngineRequirement[];
}

export interface ManifestThumbnail {
  file: string;
  resolution?: { width: number; height: number };
}

/** The shape of a `*.ograf.json` manifest file. */
export interface OGrafManifest {
  $schema: string;
  id: string;
  name: string;
  /** Path (relative to the manifest) to the JS entry file. */
  main: string;
  supportsRealTime: boolean;
  supportsNonRealTime: boolean;
  version?: string;
  description?: string;
  author?: ManifestAuthor;
  /** JSON Schema describing the graphic's public data model (same shape `load`/`updateAction` receive as `data`). */
  schema?: Record<string, unknown>;
  customActions?: ManifestCustomAction[];
  actionDurations?: ManifestActionDuration[];
  /** Default 1. 0 = auto-play-then-stop, no pause. -1 = dynamic/unknown. >1 = multiple pausable steps. */
  stepCount?: number;
  /** OR-combined across entries — a Renderer needs to satisfy at least one. */
  renderRequirements?: ManifestRenderRequirement[];
  thumbnails?: ManifestThumbnail[];
}

export const OGRAF_MANIFEST_SCHEMA_URL =
  'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';

export * from './descriptor';
