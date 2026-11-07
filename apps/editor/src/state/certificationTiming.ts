import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  Graphic,
  RenderType,
} from '@ograf-editor/ograf-types';

export const CERTIFICATION_READINESS_ALLOWANCE_MS = 3_000;
export const MAX_CERTIFICATION_METHOD_TIMEOUT_MS = 120_000;

export interface CertificationMethodTiming {
  authoredDurationMs: number;
  timeoutMs: number;
  capped: boolean;
}

/** Real-time lifecycle promises resolve after authored motion; seeks need only readiness time. */
export function certificationMethodTiming(
  descriptor: CompiledGraphicDescriptor | CompiledTransitionLogicDescriptor | undefined,
  method: keyof Graphic,
  params: unknown,
  renderType: RenderType,
): CertificationMethodTiming {
  const args = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  let frames = 0;
  if (descriptor && renderType === 'realtime' && !args.skipAnimation) {
    if ('definition' in descriptor) {
      if (['playAction', 'stopAction', 'updateAction', 'customAction'].includes(method)) {
        const longest = Math.max(
          0,
          ...descriptor.definition.transitions.map((t) => t.durationFrames),
        );
        // Generic Play can finish a dependent Out cascade, then enter a whole parent chain.
        // Other operations replace one target after their outgoing lanes have finished.
        const lanes = descriptor.definition.slots.length;
        frames = longest * Math.max(1, method === 'playAction' ? lanes * 2 + 1 : lanes + 1);
        if (method === 'customAction' && args.id === 'template.action') {
          const payload = args.payload as { actionId?: unknown } | undefined;
          frames = Math.max(
            frames,
            ...descriptor.templates.flatMap((template) =>
              template.descriptor.customActions
                .filter((action) => action.id === payload?.actionId)
                .map((action) => action.durationFrames),
            ),
          );
        }
      }
    } else if (method === 'playAction') {
      const first =
        descriptor.keyframes.find((k) => k.id === descriptor.startKeyframeId)?.frame ?? 0;
      const targetStep = typeof args.goto === 'number' ? args.goto : 0;
      const targetId =
        targetStep < 0
          ? descriptor.startKeyframeId
          : (descriptor.stepKeyframeIds[targetStep] ?? descriptor.endKeyframeId);
      frames = Math.max(
        0,
        (descriptor.keyframes.find((k) => k.id === targetId)?.frame ?? first) - first,
      );
    } else if (method === 'stopAction') {
      frames =
        descriptor.transitions.find((t) => t.toKeyframeId === descriptor.endKeyframeId)
          ?.durationFrames ?? 0;
    } else if (method === 'updateAction') {
      frames = Math.max(
        descriptor.updateTransitionFrames ?? 0,
        ...descriptor.layers.map((layer) =>
          layer.updateTransition?.style === 'none'
            ? 0
            : (layer.updateTransition?.durationFrames ?? 0),
        ),
        ...(descriptor.collections ?? []).flatMap((collection) =>
          collection.prototypeLayers.map((layer) =>
            layer.updateTransition?.style === 'none'
              ? 0
              : (layer.updateTransition?.durationFrames ?? 0),
          ),
        ),
      );
    } else if (method === 'customAction') {
      frames =
        descriptor.customActions.find((action) => action.id === args.id)?.durationFrames ?? 0;
    }
  }
  const authoredDurationMs =
    descriptor && Number.isFinite(frames) && descriptor.frameRate > 0
      ? Math.ceil((Math.max(0, frames) * 1000) / descriptor.frameRate)
      : 0;
  const wanted = authoredDurationMs + CERTIFICATION_READINESS_ALLOWANCE_MS;
  return {
    authoredDurationMs,
    timeoutMs: Math.min(MAX_CERTIFICATION_METHOD_TIMEOUT_MS, wanted),
    capped: wanted > MAX_CERTIFICATION_METHOD_TIMEOUT_MS,
  };
}

export function certificationPromiseWithTimeout<T>(
  promise: Promise<T>,
  method: string,
  timing: CertificationMethodTiming,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `${method}() did not resolve within ${timing.timeoutMs} ms ` +
              `(authored motion ${timing.authoredDurationMs} ms plus readiness allowance` +
              `${timing.capped ? '; bounded certification limit reached' : ''}).`,
          ),
        ),
      timing.timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
