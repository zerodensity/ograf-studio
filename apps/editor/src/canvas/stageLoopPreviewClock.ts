import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import { compiledLoopElapsedFrames } from '@ograf-editor/ograf-runtime';

interface ActiveLoopTime {
  activation: string;
  baseFrame: number;
  contentFrame: number;
  elapsed: number;
}

/** Advance each active loop with the pausable content clock, retaining time spent on OGraf Steps. */
export class StageLoopPreviewClock {
  #active = new Map<string, ActiveLoopTime>();

  sample(
    descriptor: CompiledGraphicDescriptor,
    layer: CompiledLayer,
    baseFrame: number,
    contentTimeMs: number,
  ): number | undefined {
    const canonicalElapsed = compiledLoopElapsedFrames(descriptor, layer, baseFrame);
    if (canonicalElapsed === undefined) {
      this.#active.delete(layer.id);
      return undefined;
    }
    const contentFrame = (contentTimeMs * descriptor.frameRate) / 1000;
    const activation = JSON.stringify({
      definition:
        layer.element.type === 'pattern' || layer.lighting
          ? { type: 'lifecycle' }
          : layer.loop?.activation,
      startsAt: baseFrame - canonicalElapsed,
    });
    const previous = this.#active.get(layer.id);
    // Explicit seeks reset content time to composition time, including a seek to the same held
    // Step. Backward seeks or a changed activation also discard the previous on-air epoch.
    const reset =
      !previous ||
      previous.activation !== activation ||
      Math.abs(contentFrame - baseFrame) < 1e-6 ||
      baseFrame < previous.baseFrame ||
      contentFrame < previous.contentFrame;
    const elapsed = reset
      ? canonicalElapsed
      : previous.elapsed + Math.max(0, contentFrame - previous.contentFrame);
    this.#active.set(layer.id, { activation, baseFrame, contentFrame, elapsed });
    return elapsed;
  }
}
