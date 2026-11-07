/** Browser-only host for trusted, HTTP(S)-hosted OGraf graphics. */
export interface OGrafPlayerManifest {
  main: string;
  name?: string;
  supportsRealTime: boolean;
  schema?: Record<string, unknown>;
  customActions?: Array<{ id: string; name: string; schema?: Record<string, unknown> }>;
  [key: string]: unknown;
}

export interface OGrafPlayerRenderCharacteristics {
  resolution?: { width?: number; height?: number };
  frameRate?: number;
  accessToPublicInternet?: boolean;
  engine?: string;
  [key: string]: unknown;
}

export interface OGrafPlayerResult {
  statusCode: number;
  statusMessage?: string;
  currentStep?: number;
  [key: string]: unknown;
}

export type OGrafPlayerEvent =
  | {
      type: 'ready' | 'play' | 'stop' | 'update' | 'action' | 'dispose';
      result?: OGrafPlayerResult;
    }
  | { type: 'error'; action: string; error: unknown };

export interface OGrafPlayerOptions {
  container: HTMLElement;
  manifestUrl: string;
  data?: unknown;
  renderCharacteristics?: OGrafPlayerRenderCharacteristics;
  /** Fit the configured resolution to the container's width. Defaults to true. */
  fit?: boolean;
  /** Permit cross-origin manifest and module URLs, subject to CORS. This is not a sandbox. */
  allowCrossOrigin?: boolean;
  /** Cancels manifest fetch; import/load cancellation is observed after they settle. */
  signal?: AbortSignal;
  onEvent?: (event: OGrafPlayerEvent) => void;
}

export interface OGrafPlayer {
  manifest: OGrafPlayerManifest;
  element: HTMLElement;
  renderCharacteristics: OGrafPlayerRenderCharacteristics & {
    resolution: { width: number; height: number };
    frameRate: number;
  };
  play(params?: {
    goto?: number;
    delta?: number;
    skipAnimation?: boolean;
  }): Promise<OGrafPlayerResult | undefined>;
  next(): Promise<OGrafPlayerResult | undefined>;
  stop(params?: { skipAnimation?: boolean }): Promise<OGrafPlayerResult | undefined>;
  update(
    data: unknown,
    options?: { skipAnimation?: boolean },
  ): Promise<OGrafPlayerResult | undefined>;
  action(
    id: string,
    payload?: unknown,
    options?: { skipAnimation?: boolean },
  ): Promise<OGrafPlayerResult | undefined>;
  dispose(): Promise<OGrafPlayerResult | undefined>;
}

/** Extract explicit schema defaults recursively; unsupported schema combinations require explicit data. */
export function dataFromSchemaDefaults(schema: unknown): unknown;

/** Mount a real-time graphic and resolve after its load() completes. */
export function mountOGrafGraphic(options: OGrafPlayerOptions): Promise<OGrafPlayer>;
