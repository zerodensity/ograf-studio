import {
  chartMarkAnimationCount,
  chartMarkAnimationPresetCompatible,
  isAnimationPresetPluginSnapshot,
  rendererPluginKey,
  studioPluginReference,
  validateAnimationPresetPluginSnapshot,
  type AnimationPluginPreset,
  type AnimationPresetPluginSnapshot,
  type ChartElement,
  type ChartMarkAnimationPhase,
  type Composition,
} from '@ograf-editor/scene-model';
import type { InstalledStudioPlugin } from './pluginSettingsStore';

export interface ChartMarkAnimationPack {
  snapshot: AnimationPresetPluginSnapshot;
  retained: boolean;
  presets: AnimationPluginPreset[];
}

/** Exact validated source pins remain portable; local installation never grants implicit trust. */
export function chartMarkAnimationPacks(
  composition: Composition,
  element: ChartElement,
  installed: readonly InstalledStudioPlugin[],
  side: 'in' | 'out',
): ChartMarkAnimationPack[] {
  const packs = new Map<string, ChartMarkAnimationPack>();
  const add = (snapshot: AnimationPresetPluginSnapshot, retained: boolean) => {
    if (validateAnimationPresetPluginSnapshot(snapshot).length) return;
    const presets = snapshot.presets.filter((preset) =>
      chartMarkAnimationPresetCompatible(element, preset, side),
    );
    if (!presets.length) return;
    const key = rendererPluginKey(studioPluginReference(snapshot));
    if (packs.has(key) && !packs.get(key)!.retained) return;
    packs.set(key, { snapshot, retained, presets });
  };
  for (const snapshot of composition.animationPresetPlugins ?? []) add(snapshot, true);
  for (const entry of installed)
    if (entry.enabled && entry.trusted && isAnimationPresetPluginSnapshot(entry.snapshot))
      add(entry.snapshot, false);
  return [...packs.values()].sort((a, b) =>
    `${a.snapshot.manifest.name} ${a.snapshot.manifest.version}`.localeCompare(
      `${b.snapshot.manifest.name} ${b.snapshot.manifest.version}`,
    ),
  );
}

export function chartMarkAnimationChoiceKey(
  phase?: Pick<ChartMarkAnimationPhase, 'reference' | 'presetId'>,
): string {
  return phase ? JSON.stringify([rendererPluginKey(phase.reference), phase.presetId]) : '';
}

export interface ChartMarkAnimationDraft {
  durationFrames: string;
  delayFrames: string;
  staggerFrames: string;
  parameters: Record<string, string>;
}

export function chartMarkAnimationDraft(
  phase: ChartMarkAnimationPhase | undefined,
  preset: AnimationPluginPreset | undefined,
  availableFrames: number,
): ChartMarkAnimationDraft {
  return {
    durationFrames: String(phase?.durationFrames ?? Math.max(1, Math.min(12, availableFrames))),
    delayFrames: String(phase?.delayFrames ?? 0),
    staggerFrames: String(phase?.staggerFrames ?? 0),
    parameters: Object.fromEntries(
      (preset?.parameters ?? []).map((parameter) => [
        parameter.id,
        String(phase?.parameters?.[parameter.id] ?? parameter.default),
      ]),
    ),
  };
}

/** Drafts are not source edits. Validate the complete staggered span before one atomic Apply. */
export function parseChartMarkAnimationDraft(
  draft: ChartMarkAnimationDraft,
  preset: AnimationPluginPreset,
  element: ChartElement,
  availableFrames: number,
): Omit<ChartMarkAnimationPhase, 'reference' | 'presetId'> {
  const integer = (value: string, name: string, min: number, max: number) => {
    const result = value.trim() ? Number(value) : NaN;
    if (!Number.isInteger(result) || result < min || result > max)
      throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
    return result;
  };
  const durationFrames = integer(draft.durationFrames, 'Duration', 1, 1500);
  const delayFrames = integer(draft.delayFrames, 'Delay', 0, 1500);
  const staggerFrames = integer(draft.staggerFrames, 'Stagger', 0, 100);
  const span =
    durationFrames + delayFrames + (chartMarkAnimationCount(element) - 1) * staggerFrames;
  if (span > availableFrames)
    throw new Error(
      `All bars / slices need ${span} frames; only ${availableFrames} fit in this phase.`,
    );
  const parameters = Object.fromEntries(
    (preset.parameters ?? []).map((parameter) => {
      const text = draft.parameters[parameter.id];
      const number = text?.trim() ? Number(text) : NaN;
      if (!Number.isFinite(number) || number < parameter.min || number > parameter.max)
        throw new Error(`${parameter.label} must be from ${parameter.min} to ${parameter.max}.`);
      return [parameter.id, number];
    }),
  );
  return { durationFrames, delayFrames, staggerFrames, parameters };
}
