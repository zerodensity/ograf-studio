import { canvasFrame } from './canvasViewStore';
import { create } from 'zustand';
import {
  cropRectPoints,
  FULL_SOURCE_CROP,
  getCompositionOutputRect,
  getLayerTransformAtFrame,
  normalizeCanvasCrop,
  normalizeCropRect,
  normalizeSourceCrop,
  type CropRect,
  type GeometryPoint,
  type LayerCrop,
  type Project,
  type SourceCrop,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { usePathEditStore } from './pathEditStore';
import { runDiscreteHistoryStep } from './historyStore';

export interface CropToolMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface CropToolGeometry {
  /** Maps normalized crop coordinates into composition pixels. */
  matrix: CropToolMatrix;
  /** Full, uncropped dimensions, independent of the viewport zoom. */
  pixelSize: { width: number; height: number };
  entries: {
    layerId: string;
    width: number;
    height: number;
    /** Maps layer-local pixels into composition pixels, including parent transforms. */
    matrix: CropToolMatrix;
  }[];
}

export interface SourceCropOptions {
  value?: SourceCrop;
  src?: string;
  video?: boolean;
  layerId?: string;
  sourceAspectRatio?: number;
  onChange: (crop: SourceCrop | undefined) => void;
}

export interface CropToolRequest {
  id: string;
  kind: 'layers' | 'canvas' | 'source';
  projectId: string;
  compositionId: string;
  frame: number;
  layerIds: string[];
  initial: CropRect;
  draft: CropRect;
  pixelSize: { width: number; height: number };
  geometry?: CropToolGeometry;
  source?: SourceCropOptions;
}

interface CropToolState {
  request: CropToolRequest | null;
  error: string | null;
  open: (layerIds: string[]) => void;
  openCanvas: () => void;
  openSource: (options: SourceCropOptions) => void;
  close: () => void;
  setDraft: (rect: CropRect) => void;
  resetDraft: () => void;
  configureGeometry: (geometry: CropToolGeometry) => void;
  apply: () => boolean;
}

function transform(matrix: CropToolMatrix, point: GeometryPoint): GeometryPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function inverseTransform(matrix: CropToolMatrix, point: GeometryPoint): GeometryPoint {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error('This object has no visible area at the current frame.');
  const x = point.x - matrix.e;
  const y = point.y - matrix.f;
  return {
    x: (matrix.d * x - matrix.c * y) / determinant,
    y: (-matrix.b * x + matrix.a * y) / determinant,
  };
}

function boundsFor(points: GeometryPoint[]): CropRect {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}

function clamp(rect: CropRect) {
  return normalizeCropRect(rect, { width: 1, height: 1 });
}

function validateGeometry(geometry: CropToolGeometry) {
  const matrices = [geometry.matrix, ...geometry.entries.map((entry) => entry.matrix)];
  if (
    matrices.some((matrix) => Object.values(matrix).some((value) => !Number.isFinite(value))) ||
    [geometry.pixelSize, ...geometry.entries].some(
      (size) =>
        !Number.isFinite(size.width) ||
        !Number.isFinite(size.height) ||
        size.width <= 0 ||
        size.height <= 0,
    )
  )
    throw new Error('The crop bounds could not be measured. Cancel and try again.');
  for (const matrix of matrices) inverseTransform(matrix, { x: 0, y: 0 });
}

function clockwise(points: GeometryPoint[]) {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return area < 0 ? points.reverse() : points;
}

export const useCropToolStore = create<CropToolState>((set, get) => {
  let originalProject: Project | null = null;
  let draftEdited = false;
  const begin = () => {
    const timeline = useTimelineStore.getState();
    timeline.controller?.pause();
    timeline.setPlaying(false);
    timeline.setPreviewLoopLayerId(null);
    usePathEditStore.getState().stop();
    const state = useProjectStore.getState();
    const composition = state.project.compositions.find(
      (item) => item.id === state.activeCompositionId,
    );
    if (!composition) return null;
    return {
      project: state.project,
      composition,
      common: {
        id: crypto.randomUUID(),
        projectId: state.project.id,
        compositionId: composition.id,
        frame: canvasFrame(composition),
      },
    };
  };
  return {
    request: null,
    error: null,
    open: (layerIds) => {
      const context = begin();
      if (!context) return;
      const ids = [...new Set(layerIds)];
      const layers = context.composition.layers.filter((layer) => ids.includes(layer.id));
      if (
        !layers.length ||
        layers.length !== ids.length ||
        layers.some((layer) => layer.isLocked || layer.element.type === 'audio')
      ) {
        set({ error: 'Select unlocked visual layers to crop.' });
        return;
      }
      originalProject = context.project;
      draftEdited = false;
      const pose = getLayerTransformAtFrame(layers[0]!, context.common.frame);
      const initial =
        layers.length === 1 && layers[0]!.crop
          ? clamp(boundsFor(layers[0]!.crop!.points))
          : { ...FULL_SOURCE_CROP };
      set({
        request: {
          ...context.common,
          kind: 'layers',
          layerIds: layers.map((layer) => layer.id),
          initial,
          draft: { ...initial },
          pixelSize: { width: Math.max(1, pose.width), height: Math.max(1, pose.height) },
        },
        error: null,
      });
    },
    openCanvas: () => {
      const context = begin();
      if (!context) return;
      originalProject = context.project;
      draftEdited = false;
      const { composition } = context;
      const output = getCompositionOutputRect(composition);
      const pixelSize = { width: composition.width, height: composition.height };
      const initial = clamp({
        x: output.x / composition.width,
        y: output.y / composition.height,
        width: output.width / composition.width,
        height: output.height / composition.height,
      });
      set({
        request: {
          ...context.common,
          kind: 'canvas',
          layerIds: [],
          initial,
          draft: { ...initial },
          pixelSize,
          geometry: {
            matrix: { a: composition.width, b: 0, c: 0, d: composition.height, e: 0, f: 0 },
            entries: [],
            pixelSize,
          },
        },
        error: null,
      });
    },
    openSource: (source) => {
      const context = begin();
      if (!context) return;
      const layer = source.layerId
        ? context.composition.layers.find((item) => item.id === source.layerId)
        : undefined;
      if (source.layerId && (!layer || layer.isLocked)) {
        set({ error: 'Unlock the source layer before cropping.' });
        return;
      }
      originalProject = context.project;
      draftEdited = false;
      const initial = clamp(source.value ?? FULL_SOURCE_CROP);
      const aspect = source.sourceAspectRatio ?? source.value?.sourceAspectRatio ?? 16 / 9;
      set({
        request: {
          ...context.common,
          kind: 'source',
          layerIds: source.layerId ? [source.layerId] : [],
          initial,
          draft: { ...initial },
          pixelSize: { width: aspect * 1000, height: 1000 },
          source: { ...source },
        },
        error: null,
      });
    },
    close: () => {
      originalProject = null;
      draftEdited = false;
      set({ request: null, error: null });
    },
    setDraft: (rect) => {
      draftEdited = true;
      set((state) =>
        state.request
          ? {
              request: { ...state.request, draft: clamp(rect) },
            }
          : {},
      );
    },
    resetDraft: () => {
      draftEdited = true;
      set((state) =>
        state.request
          ? {
              request: { ...state.request, draft: { ...FULL_SOURCE_CROP } },
            }
          : {},
      );
    },
    configureGeometry: (geometry) => {
      const { request } = get();
      if (!request) return;
      try {
        validateGeometry(geometry);
        if (
          request.kind === 'layers' &&
          (geometry.entries.length !== request.layerIds.length ||
            request.layerIds.some((id) => !geometry.entries.some((entry) => entry.layerId === id)))
        )
          throw new Error('The selected crop objects could not be measured.');
        let initial = request.initial;
        if (!request.geometry && request.kind === 'layers' && request.layerIds.length > 1) {
          const composition = originalProject?.compositions.find(
            (item) => item.id === request.compositionId,
          );
          const layers = request.layerIds.map((id) =>
            composition?.layers.find((layer) => layer.id === id),
          );
          if (layers.every((layer) => layer?.crop)) {
            initial = clamp(
              boundsFor(
                geometry.entries.flatMap((entry) => {
                  const layer = layers.find((item) => item!.id === entry.layerId)!;
                  return layer.crop!.points.map((point) =>
                    inverseTransform(
                      geometry.matrix,
                      transform(entry.matrix, {
                        x: point.x * entry.width,
                        y: point.y * entry.height,
                      }),
                    ),
                  );
                }),
              ),
            );
          }
        }
        set({
          request: {
            ...request,
            geometry,
            pixelSize: geometry.pixelSize,
            initial,
            draft: request.geometry || draftEdited ? request.draft : { ...initial },
          },
        });
      } catch (cause) {
        set({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    apply: () => {
      const { request } = get();
      if (!request) return false;
      try {
        const state = useProjectStore.getState();
        if (
          state.project.id !== request.projectId ||
          state.activeCompositionId !== request.compositionId
        )
          throw new Error('The active template changed. Cancel crop and select the object again.');
        if (state.project !== originalProject)
          throw new Error(
            'The template changed while cropping. Cancel crop and start again to use the latest changes.',
          );
        const composition = state.project.compositions.find(
          (item) => item.id === request.compositionId,
        )!;
        if (canvasFrame(composition) !== request.frame)
          throw new Error('The current frame changed while cropping. Cancel crop and start again.');
        const layers = request.layerIds.map((id) =>
          composition.layers.find((layer) => layer.id === id),
        );
        if (layers.some((layer) => !layer || layer.isLocked))
          throw new Error('A crop object was removed or locked. Cancel crop and select it again.');
        // An existing group crop can be a rotated polygon in a member's local space.
        // Merely accepting its bounding rectangle must not replace that polygon.
        if (!draftEdited) {
          get().close();
          return true;
        }
        const rect = clamp(request.draft);
        const full = rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1;
        if (request.kind === 'canvas') {
          const crop = normalizeCanvasCrop(
            {
              x: rect.x * composition.width,
              y: rect.y * composition.height,
              width: rect.width * composition.width,
              height: rect.height * composition.height,
            },
            composition.width,
            composition.height,
          );
          runDiscreteHistoryStep(() => state.setCompositionCrop(crop), 'Crop canvas');
        } else if (request.kind === 'source') {
          if (!request.source) throw new Error('The source crop target is unavailable.');
          if (!request.geometry)
            throw new Error('Wait for the media source to load before applying its crop.');
          validateGeometry(request.geometry);
          const aspect = request.geometry.pixelSize.width / request.geometry.pixelSize.height;
          const crop = normalizeSourceCrop({
            ...rect,
            ...(aspect ? { sourceAspectRatio: aspect } : {}),
          });
          runDiscreteHistoryStep(() => request.source!.onChange(crop), 'Crop media source');
        } else {
          const geometry = request.geometry;
          if (!geometry)
            throw new Error(
              'The object bounds are still being measured. Try applying the crop again.',
            );
          validateGeometry(geometry);
          const crops: Record<string, LayerCrop | undefined> = {};
          for (const entry of geometry.entries) {
            crops[entry.layerId] = full
              ? undefined
              : {
                  points:
                    request.layerIds.length === 1
                      ? cropRectPoints(rect)
                      : clockwise(
                          cropRectPoints(rect).map((point) => {
                            const local = inverseTransform(
                              entry.matrix,
                              transform(geometry.matrix, point),
                            );
                            return { x: local.x / entry.width, y: local.y / entry.height };
                          }),
                        ),
                };
          }
          runDiscreteHistoryStep(
            () => state.setLayerCrops(crops),
            request.layerIds.length > 1 ? 'Crop group' : 'Crop layer',
          );
        }
        get().close();
        return true;
      } catch (cause) {
        set({ error: cause instanceof Error ? cause.message : String(cause) });
        return false;
      }
    },
  };
});
