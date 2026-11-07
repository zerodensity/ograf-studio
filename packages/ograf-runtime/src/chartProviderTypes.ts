import type {
  chartAnimationProgress,
  normalizeChartAnimation,
  ChartElement,
  ChartMarkPose,
} from '@ograf-editor/scene-model';

/** Renderer v1 has synchronous frame sampling after asynchronous module/asset initialization. */
export interface ChartRenderer {
  renderAtFrame(frame: number): void;
  update(element: ChartElement): void;
  /** Optional explicit Take replay; data morph providers otherwise retain their update origin. */
  resetAnimation?(): void;
  /** Paint override coverage and foreground only; never axes/grid in the mask. */
  renderMarkLayers?(mask: HTMLCanvasElement, foreground: HTMLCanvasElement): void;
  dispose(): void;
}

export interface ChartRendererHostAPI {
  apiVersion: 1;
  frameRate: number;
  chartAnimationProgress: typeof chartAnimationProgress;
  normalizeChartAnimation: typeof normalizeChartAnimation;
  chartAnimationEndFrame(element: ChartElement): number;
  /** Samples mark-local curves on the layer lifecycle clock, independently of data replay. */
  sampleChartMarkAnimation?(markIndex: number): ChartMarkPose | null;
}

export interface ChartRendererProvider {
  apiVersion: 1;
  create(
    canvas: HTMLCanvasElement,
    element: ChartElement,
    hostAPI: ChartRendererHostAPI,
  ): ChartRenderer | Promise<ChartRenderer>;
}
