import type { Composition } from '@ograf-editor/scene-model';

interface EditorLoopSample {
  composition: Composition;
  frame: number;
  elapsedFrames: number | null;
}

const samples = new Map<string, EditorLoopSample>();
const keyFor = (composition: Composition, layerId: string) => `${composition.id}:${layerId}`;

/** Last rendered phase, outside source/Undo; null records an explicitly inactive loop. */
export function recordEditorLoopSample(
  composition: Composition,
  layerId: string,
  frame: number,
  elapsedFrames: number | undefined,
): void {
  const key = keyFor(composition, layerId);
  if (
    !Number.isFinite(frame) ||
    (elapsedFrames !== undefined && (!Number.isFinite(elapsedFrames) || elapsedFrames < 0))
  ) {
    samples.delete(key);
    return;
  }
  samples.set(key, { composition, frame, elapsedFrames: elapsedFrames ?? null });
}

/** Source identity and base frame prevent freezing a phase from a replaced document or seek. */
export function getEditorLoopSample(
  composition: Composition,
  layerId: string,
  frame: number,
): { elapsedFrames: number | null } | undefined {
  if (!Number.isFinite(frame)) return;
  const sample = samples.get(keyFor(composition, layerId));
  if (sample?.composition !== composition || Math.abs(sample.frame - frame) > 1e-6) return;
  return { elapsedFrames: sample.elapsedFrames };
}

export function clearEditorLoopSamples(composition: Composition): void {
  for (const [key, sample] of samples) if (sample.composition === composition) samples.delete(key);
}
