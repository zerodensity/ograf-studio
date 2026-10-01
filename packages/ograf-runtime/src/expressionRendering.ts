import { sampleCompiledLayerVisualState } from './loopRendering';
import { resolveBoundElement } from './renderElement';
import { measureExpressionText } from './expressionTextBounds';
import {
  resolveExpressionTransforms,
  expressionSourceRect,
  getTrackValueAtFrame,
  expressionDataScope,
  expressionTimelineScope,
  type MaskRenderState,
  type ExpressionDiagnostic,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';

/** Apply scripts to the sampled frame before transforms and masks are rendered. */
export function resolveFrameExpressions(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, MaskRenderState>,
  data: Record<string, unknown> = {},
  diagnostics?: ExpressionDiagnostic[],
): Map<string, MaskRenderState> {
  if (!descriptor.scripting?.enabled && !descriptor.layers.some((layer) => layer.expressions))
    return new Map(states);
  const clock = [...states.values()][0] as
    (MaskRenderState & { expressionFrame?: number; expressionExitProgress?: number }) | undefined;
  const frame = clock?.expressionFrame ?? 0;
  const boundsCache = new Map<string, ReturnType<typeof expressionSourceRect>>();
  const lastFrame = Math.max(0, ...descriptor.keyframes.map((key) => key.frame));
  const sampleFrame = (seconds: number) =>
    Math.max(0, Math.min(seconds * descriptor.frameRate, lastFrame));
  const transforms = resolveExpressionTransforms(
    descriptor.layers.flatMap((layer) => {
      const state = states.get(layer.id);
      if (!state) return [];
      const expressionState = state as MaskRenderState & {
        expressionFrame?: number;
        expressionExitProgress?: number;
      };
      const frame = expressionState.expressionFrame ?? 0;
      const samples = new Map<number, MaskRenderState['transform']>();
      const sampleTransform = (seconds: number) => {
        const at = sampleFrame(seconds);
        let sampled = samples.get(at);
        if (!sampled) {
          sampled = sampleCompiledLayerVisualState(layer, at, undefined, data).transform;
          // Bound memory even when a user script requests many distinct times.
          if (samples.size >= 128) samples.delete(samples.keys().next().value!);
          samples.set(at, sampled);
        }
        return sampled;
      };
      return [
        {
          ...layer,
          ...(layer.collectionItem
            ? {
                prototypeLayerId: layer.collectionItem.prototypeLayerId,
                referenceScope: JSON.stringify([
                  layer.collectionItem.collectionId,
                  layer.collectionItem.index,
                ]),
              }
            : {}),
          transform: state.transform,
          sampleTransform,
          sourceRectAtTime: (seconds: number, includeExtents: boolean) => {
            const at = sampleFrame(seconds);
            const key = JSON.stringify([layer.id, at, includeExtents]);
            const cached = boundsCache.get(key);
            if (cached) return cached;
            let element = resolveBoundElement(layer, data);
            if (element.type === 'text')
              element = {
                ...element,
                strokeWidth: getTrackValueAtFrame(
                  layer.animationTracks.strokeWidth ?? [],
                  at,
                  element.strokeWidth,
                ),
              };
            const bounds = expressionSourceRect(
              element,
              sampleTransform(seconds),
              includeExtents,
              measureExpressionText,
            );
            boundsCache.set(key, bounds);
            return bounds;
          },
          scope: {
            frame,
            time: frame / descriptor.frameRate,
            ...expressionTimelineScope(descriptor.keyframes, frame),
            ...(expressionState.expressionExitProgress === undefined
              ? {}
              : {
                  'timeline.exitProgress': expressionState.expressionExitProgress,
                }),
          },
        },
      ];
    }),
    {
      frame,
      time: frame / descriptor.frameRate,
      'comp.width': descriptor.width,
      'comp.height': descriptor.height,
      ...expressionDataScope(data),
      ...expressionTimelineScope(descriptor.keyframes, frame),
      ...(clock?.expressionExitProgress === undefined
        ? {}
        : { 'timeline.exitProgress': clock.expressionExitProgress }),
    },
    diagnostics,
    descriptor.expressionApiVersion,
    descriptor.scripting,
  );
  return new Map(
    [...states].map(([id, state]) => [
      id,
      { ...state, transform: transforms.get(id) ?? state.transform },
    ]),
  );
}
