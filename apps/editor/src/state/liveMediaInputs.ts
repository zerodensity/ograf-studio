import {
  createMediaPaint,
  getElementMediaPaint,
  isMediaPaint,
  validateMediaPaint,
  walkElementContents,
  type Composition,
  type Layer,
} from '@ograf-editor/scene-model';
import { nodosInputNameError } from '@ograf-editor/codegen';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { runDiscreteHistoryStep } from './historyStore';

/** Live inputs are names shared by object fills, never separate target references. */
export function liveMediaInputNames(composition: Composition): string[] {
  const paints = [
    composition.backgroundPaint,
    ...composition.layers.flatMap((layer) =>
      walkElementContents(layer.element).map(getElementMediaPaint),
    ),
  ];
  return [
    ...new Set([
      ...paints.flatMap((paint) =>
        isMediaPaint(paint) && paint.source.kind === 'live' ? [paint.source.tag] : [],
      ),
      ...composition.mediaCues.flatMap((cue) =>
        cue.sources.flatMap((source) => (source.kind === 'live' ? [source.tag] : [])),
      ),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function defaultLiveMediaInput(composition: Composition): string {
  return liveMediaInputNames(composition).find(validLiveMediaInputName) ?? 'TextureInput1';
}

export function canUseLiveMediaInput(layer: Layer | undefined): layer is Layer {
  return (
    !!layer &&
    !layer.isLocked &&
    [
      'rectangle',
      'ellipse',
      'path',
      'pattern',
      'text',
      'image',
      'image-sequence',
      'chart',
      'lottie',
    ].includes(layer.element.type)
  );
}

export function validLiveMediaInputName(tag: string): boolean {
  const name = tag.trim();
  return (
    !nodosInputNameError(name) &&
    validateMediaPaint(createMediaPaint({ source: { kind: 'live', tag: name } })).length === 0
  );
}

/** Both Use input here and webcam preview commit the selected object's own fill. */
export function routeLiveMediaInputToLayer(layerId: string, tag: string): boolean {
  if (!validLiveMediaInputName(tag)) return false;
  const state = useProjectStore.getState();
  const composition = state.project.compositions.find(
    (item) => item.id === state.activeCompositionId,
  );
  const layer = composition?.layers.find((item) => item.id === layerId);
  if (!canUseLiveMediaInput(layer)) return false;
  const previous = getElementMediaPaint(layer.element);
  if (previous?.source.kind === 'live' && previous.source.tag === tag.trim()) return true;
  const paint = createMediaPaint({ ...previous, source: { kind: 'live', tag: tag.trim() } });
  runDiscreteHistoryStep(
    () => state.updateLayerPaint(layerId, useTimelineStore.getState().currentFrame, paint),
    'Use live input',
  );
  const current = useProjectStore
    .getState()
    .project.compositions.find((item) => item.id === state.activeCompositionId)
    ?.layers.find((item) => item.id === layerId);
  const applied = current ? getElementMediaPaint(current.element) : undefined;
  return applied?.source.kind === 'live' && applied.source.tag === tag.trim();
}
