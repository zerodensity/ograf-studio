import {
  createMediaPaint,
  getElementMediaPaint,
  parseLottieJson,
  type Layer,
} from '@ograf-editor/scene-model';
import { prepareAssetImport } from './assetImport';
import { mediaFileImportError } from '../panels/mediaFileImport';
import { getActiveComposition, useProjectStore } from './projectStore';
import { runDiscreteHistoryStep } from './historyStore';
import { useSelectionStore } from './selectionStore';

export type CanvasDropKind = 'image' | 'video' | 'font' | 'lottie' | 'unsupported';
export function canvasDropKind(file: Pick<File, 'name' | 'type'>): CanvasDropKind {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(extension) ||
    file.type.startsWith('image/')
  )
    return 'image';
  if (['mp4', 'webm'].includes(extension) || ['video/mp4', 'video/webm'].includes(file.type))
    return 'video';
  if (['woff', 'woff2', 'otf', 'ttf'].includes(extension)) return 'font';
  if (extension === 'json' || file.type === 'application/json') return 'lottie';
  return 'unsupported';
}

export function canvasDropPlacement(
  width: number,
  height: number,
  canvas: { width: number; height: number },
  point: { x: number; y: number },
) {
  const scale = Math.min(1, (canvas.width * 0.8) / width, (canvas.height * 0.8) / height);
  const w = width * scale,
    h = height * scale;
  return { x: point.x - w / 2, y: point.y - h / 2, width: w, height: h };
}

export function applyCanvasBrandColor(
  reference: { tokenId: string; projectId: string; compositionId: string },
  targetId: string,
): void {
  const state = useProjectStore.getState();
  if (
    state.project.id !== reference.projectId ||
    state.activeCompositionId !== reference.compositionId
  )
    throw new Error('This Brand Kit color belongs to a different document.');
  const composition = getActiveComposition(state.project, state.activeCompositionId);
  const token = composition.designSystem.tokens.find(
    (item) => item.id === reference.tokenId && item.type === 'color',
  );
  const layer = composition.layers.find((item) => item.id === targetId);
  if (!token) throw new Error('This color is not available in the active template.');
  if (!layer || layer.isLocked) throw new Error('Drop the color on an unlocked object.');
  const element = layer.element;
  if (!['text', 'rectangle', 'ellipse', 'path', 'pattern'].includes(element.type))
    throw new Error('This object does not have an editable color fill.');
  const property = element.type === 'text' && !element.fill ? 'color' : 'fill';
  runDiscreteHistoryStep(
    () => state.bindDesignToken(layer.id, token.id, property),
    'Apply Brand Kit color',
  );
}

function sameLayer(before: Layer | undefined, after: Layer | undefined): boolean {
  return (
    !!before &&
    !!after &&
    !after.isLocked &&
    JSON.stringify(before.element) === JSON.stringify(after.element)
  );
}

/** Decode first, then publish asset and layer changes together as one history step. */
export async function placeCanvasNonImage(
  file: File,
  point: { x: number; y: number },
  targetId?: string,
  replace = false,
): Promise<string | null> {
  const initial = useProjectStore.getState();
  const projectId = initial.project.id;
  const initialComposition = getActiveComposition(initial.project, initial.activeCompositionId);
  const target = initialComposition.layers.find((layer) => layer.id === targetId);
  const kind = canvasDropKind(file);
  if (kind !== 'video' && kind !== 'font' && kind !== 'lottie')
    throw new Error(
      `${file.name}: unsupported file. Use an image, SVG, MP4, WebM, Lottie JSON or font.`,
    );
  if (file.size <= 0) throw new Error(`${file.name} is empty.`);
  if (replace && kind !== 'video') throw new Error('Alt-drop replaces an image or video source.');
  if (replace && (!target || target.isLocked || !getElementMediaPaint(target.element)))
    throw new Error('Alt-drop a video onto an unlocked video-filled object.');
  if (kind === 'font' && target && (target.isLocked || target.element.type !== 'text'))
    throw new Error('Drop a font onto an unlocked text object, or onto empty canvas to import it.');
  if (kind === 'video') {
    const error = mediaFileImportError(file);
    if (error) throw new Error(error);
  }
  const lottie = kind === 'lottie' ? parseLottieJson(await file.text()) : undefined;
  const prepared = kind === 'lottie' ? undefined : await prepareAssetImport(file);
  const current = useProjectStore.getState();
  if (current.project.id !== projectId || current.activeCompositionId !== initialComposition.id)
    throw new Error('The document changed while importing. Drop the file again.');
  const composition = getActiveComposition(current.project, current.activeCompositionId);
  const nextTarget = composition.layers.find((layer) => layer.id === targetId);
  if ((replace || (kind === 'font' && target)) && !sameLayer(target, nextTarget))
    throw new Error('The target changed while importing. Drop the file again.');
  if (kind === 'video' && (!prepared?.width || !prepared.height))
    throw new Error(`${file.name}: the browser could not read its video dimensions.`);
  let selected: string | null = null;
  runDiscreteHistoryStep(
    () => {
      const store = useProjectStore.getState();
      const assetId = prepared ? store.addPreparedAsset(prepared.asset) : undefined;
      if (kind === 'font') {
        if (nextTarget && assetId && prepared?.asset.fontFamily) {
          const actualFont = getActiveComposition(
            useProjectStore.getState().project,
            initialComposition.id,
          ).assets.find((item) => item.id === assetId);
          store.updateLayerElement(nextTarget.id, {
            fontFamily: actualFont?.fontFamily ?? prepared.asset.fontFamily,
          });
          selected = nextTarget.id;
        }
        return;
      }
      if (kind === 'video' && replace && nextTarget && assetId) {
        store.updateLayerElement(nextTarget.id, {
          fill: {
            ...getElementMediaPaint(nextTarget.element)!,
            source: { kind: 'clip', src: `asset:${assetId}` },
          },
        });
        selected = nextTarget.id;
        return;
      }
      const width = kind === 'lottie' ? Number(lottie?.w) : prepared!.width!;
      const height = kind === 'lottie' ? Number(lottie?.h) : prepared!.height!;
      const safeWidth = Number.isFinite(width) && width > 0 ? width : 640;
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 360;
      const id = store.addLayer(
        kind === 'lottie' ? 'lottie' : 'rectangle',
        canvasDropPlacement(safeWidth, safeHeight, composition, point),
      );
      if (kind === 'lottie') store.updateLayerElement(id, { animationData: lottie });
      else
        store.updateLayerElement(id, {
          fill: createMediaPaint({ source: { kind: 'clip', src: `asset:${assetId}` } }),
        });
      store.renameLayer(id, file.name.replace(/\.[^.]+$/, '') || 'Imported');
      selected = id;
    },
    kind === 'font'
      ? 'Import font'
      : replace
        ? 'Replace video'
        : kind === 'lottie'
          ? 'Import Lottie'
          : 'Import video',
  );
  if (selected) useSelectionStore.getState().select(selected);
  return selected;
}
