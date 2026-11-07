import {
  ANIMATION_PRESET_TRACK_PROPERTIES,
  resolveAnimationPresetKeyValue,
  studioPluginKey,
  studioPluginReference,
  validateAnimationPresetPluginSnapshot,
} from './animationPresetPlugins';
import { getTrackValueAtFrame } from './layerAnimation';
import { layerMotionWindows, type LayerMotionWindows } from './layerMotion';
import {
  MAX_RENDERER_PLUGIN_CATALOG_BYTES,
  MAX_RENDERER_PLUGIN_CATALOG_ENTRIES,
  rendererPluginByteLength,
  validateRendererPluginReference,
} from './rendererPlugins';
import type {
  AnimationPluginPreset,
  AnimationPresetPluginSnapshot,
  ChartElement,
  ChartMarkAnimationPhase,
  ChartMarkAnimationOptions,
  ChartMarkPose,
  ChartPreset,
  CompiledChartMarkAnimationPhase,
  CompiledChartMarkAnimations,
  Composition,
  Layer,
} from './types';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
// Like the layer preset baker, accept JSON-only Immer drafts as well as plain source objects.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const IDENTITY: ChartMarkPose = {
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  scale: 1,
  clipLeft: 0,
  clipRight: 0,
  clipTop: 0,
  clipBottom: 0,
  blur: 0,
};

export function chartMarkAnimationKind(preset: ChartPreset): 'rectangle' | 'ellipse' | null {
  if (['bar', 'horizontal-bar', 'stacked-bar'].includes(preset)) return 'rectangle';
  if (['pie', 'doughnut', 'polar-area'].includes(preset)) return 'ellipse';
  return null;
}

export function chartMarkAnimationCount(element: ChartElement): number {
  const labels = Array.isArray(element.data?.labels) ? element.data.labels.length : 0;
  const datasets = Array.isArray(element.data?.datasets) ? element.data.datasets.length : 0;
  return Math.max(1, labels * datasets);
}

/** Keep phase-relative metadata aligned when lifecycle clocks are retimed or ported. */
export function retimeChartMarkAnimations(
  element: ChartElement,
  windows: LayerMotionWindows | null,
  mapFrame: (frame: number) => number,
): void {
  if (!windows) return;
  for (const side of ['in', 'out'] as const) {
    const phase = element.markAnimations?.[side];
    if (!phase) continue;
    const anchor = side === 'in' ? windows.start : windows.lastStep;
    const end = side === 'in' ? windows.firstStep : windows.end;
    const start = anchor + phase.delayFrames;
    const available = Math.max(1, mapFrame(end) - mapFrame(anchor));
    const delay = Math.max(0, mapFrame(start) - mapFrame(anchor));
    const duration = Math.max(1, mapFrame(start + phase.durationFrames) - mapFrame(start));
    const stagger = Math.max(0, mapFrame(start + phase.staggerFrames) - mapFrame(start));
    phase.delayFrames = Math.min(delay, available - 1);
    phase.durationFrames = Math.min(duration, available - phase.delayFrames);
    const gaps = chartMarkAnimationCount(element) - 1;
    phase.staggerFrames = gaps
      ? Math.min(stagger, Math.floor((available - phase.delayFrames - phase.durationFrames) / gaps))
      : stagger;
  }
}

export function chartMarkAnimationPresetCompatible(
  element: Pick<ChartElement, 'preset'>,
  preset: AnimationPluginPreset,
  side: 'in' | 'out',
): boolean {
  const kind = chartMarkAnimationKind(element.preset);
  return (
    kind !== null &&
    !!preset.tracks[side]?.length &&
    (!preset.targetKinds ||
      preset.targetKinds.includes('chart') ||
      preset.targetKinds.includes(kind))
  );
}

/** Validate source pins, parameters, rounded key collisions and the full staggered lifecycle span. */
export function chartMarkAnimationErrors(
  element: ChartElement,
  catalog: readonly AnimationPresetPluginSnapshot[] = [],
  windows?: LayerMotionWindows | null,
): string[] {
  if (element.markAnimations === undefined) return [];
  if (!record(element.markAnimations)) return ['Chart mark animations must be an object.'];
  const choices = element.markAnimations as Record<string, unknown>;
  const errors: string[] = [];
  if (Object.keys(choices).some((side) => side !== 'in' && side !== 'out'))
    errors.push('Chart mark animations contain an unknown side.');
  for (const side of ['in', 'out'] as const) {
    const phase = choices[side];
    if (phase === undefined) continue;
    const label = `Chart mark ${side} animation`;
    if (!record(phase)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (
      Object.keys(phase).some(
        (key) =>
          ![
            'reference',
            'presetId',
            'parameters',
            'durationFrames',
            'delayFrames',
            'staggerFrames',
          ].includes(key),
      )
    )
      errors.push(`${label} contains unsupported fields.`);
    let validTiming = true;
    for (const [field, minimum, maximum] of [
      ['durationFrames', 1, 1500],
      ['delayFrames', 0, 1500],
      ['staggerFrames', 0, 100],
    ] as const) {
      const value = phase[field];
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < minimum ||
        value > maximum
      ) {
        errors.push(`${label} ${field} must be an integer from ${minimum} to ${maximum}.`);
        validTiming = false;
      }
    }
    if (!chartMarkAnimationKind(element.preset))
      errors.push(`${label} is supported only on bars and slices, not ${element.preset}.`);
    const referenceErrors = validateRendererPluginReference(phase.reference);
    if (
      record(phase.reference) &&
      Object.keys(phase.reference).some((key) => !['id', 'version', 'sha256'].includes(key))
    )
      referenceErrors.push('Chart mark animation reference contains unsupported fields.');
    errors.push(...referenceErrors.map((error) => `${label}: ${error}`));
    const snapshot = !referenceErrors.length
      ? catalog.find(
          (candidate) =>
            record(candidate) &&
            record(candidate.manifest) &&
            candidate.manifest.id ===
              (phase.reference as ChartMarkAnimationPhase['reference']).id &&
            candidate.manifest.version ===
              (phase.reference as ChartMarkAnimationPhase['reference']).version &&
            candidate.sha256 === (phase.reference as ChartMarkAnimationPhase['reference']).sha256,
        )
      : undefined;
    if (!referenceErrors.length && !snapshot)
      errors.push(`${label} requires its exact pinned animation definition, version and digest.`);
    const snapshotErrors = snapshot ? validateAnimationPresetPluginSnapshot(snapshot) : [];
    errors.push(...snapshotErrors.map((error) => `${label}: ${error}`));
    const preset = snapshotErrors.length
      ? undefined
      : snapshot?.presets.find((item) => item.id === phase.presetId);
    if (snapshot && !snapshotErrors.length && !preset)
      errors.push(`${label} preset was not found in the pinned animation pack.`);
    if (preset && !chartMarkAnimationPresetCompatible(element, preset, side))
      errors.push(`${label} preset does not support this mark kind and animation side.`);
    const parameters: Record<string, number> = Object.fromEntries(
      (preset?.parameters ?? []).map((parameter) => [parameter.id, parameter.default]),
    );
    if (phase.parameters !== undefined && !record(phase.parameters))
      errors.push(`${label} parameters must be a numeric object.`);
    else
      for (const [id, value] of Object.entries(phase.parameters ?? {})) {
        const parameter = preset?.parameters?.find((item) => item.id === id);
        if (
          !parameter ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < parameter.min ||
          value > parameter.max
        )
          errors.push(`${label} parameter ${id} is unknown or outside its declared range.`);
        else parameters[id] = value;
      }
    if (validTiming && windows !== undefined) {
      const span =
        (phase.durationFrames as number) +
        (phase.delayFrames as number) +
        (chartMarkAnimationCount(element) - 1) * (phase.staggerFrames as number);
      const available = windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0;
      if (span > available)
        errors.push(
          `${label} duration, delay and all staggered marks must fit its ${available}-frame lifecycle window.`,
        );
    }
    if (preset && validTiming) {
      for (const track of preset.tracks[side] ?? []) {
        if (
          new Set(track.keys.map((key) => Math.round(key.at * (phase.durationFrames as number))))
            .size !== track.keys.length
        )
          errors.push(`${label} duration is too short: preset keys collide at a frame.`);
        try {
          for (const key of track.keys)
            resolveAnimationPresetKeyValue(track, key.value, IDENTITY[track.property], parameters);
        } catch (cause) {
          errors.push(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    }
  }
  return errors;
}

/** Pin and apply atomically without touching the chart layer's authored transform tracks. */
export function applyChartMarkAnimationPreset(
  composition: Composition,
  layer: Layer,
  snapshot: AnimationPresetPluginSnapshot,
  presetId: string,
  side: 'in' | 'out',
  options: ChartMarkAnimationOptions,
): void {
  if (layer.element.type !== 'chart') throw new Error('Chart mark animation needs a chart layer.');
  if (layer.isLocked) throw new Error('Chart mark animation target is locked.');
  if (side !== 'in' && side !== 'out')
    throw new Error('Chart mark animation side must be in or out.');
  const snapshotErrors = validateAnimationPresetPluginSnapshot(snapshot);
  if (snapshotErrors.length) throw new Error(snapshotErrors.join(' '));
  const reference = studioPluginReference(snapshot);
  const catalog = copy(composition.animationPresetPlugins ?? []);
  const at = catalog.findIndex(
    (candidate) => studioPluginKey(studioPluginReference(candidate)) === studioPluginKey(reference),
  );
  if (at < 0) catalog.push(copy(snapshot));
  else catalog[at] = copy(snapshot);
  if (
    catalog.length > MAX_RENDERER_PLUGIN_CATALOG_ENTRIES ||
    rendererPluginByteLength(JSON.stringify(catalog)) > MAX_RENDERER_PLUGIN_CATALOG_BYTES
  )
    throw new Error('Chart animation catalog exceeds its 16-pack or 8 MiB limit.');
  const element: ChartElement = {
    ...layer.element,
    markAnimations: {
      ...layer.element.markAnimations,
      [side]: { ...copy(options), reference, presetId },
    },
  };
  const errors = chartMarkAnimationErrors(element, catalog, layerMotionWindows(composition));
  if (errors.length) throw new Error(errors.join(' '));
  layer.element = element;
  composition.animationPresetPlugins = catalog;
}

/** Bake one compact curve set per phase. Mark count never multiplies saved key data. */
export function bakeChartMarkAnimations(
  element: ChartElement,
  catalog: readonly AnimationPresetPluginSnapshot[],
  windows: LayerMotionWindows | null,
): CompiledChartMarkAnimations | undefined {
  const errors = chartMarkAnimationErrors(element, catalog, windows);
  if (errors.length) throw new Error(errors.join(' '));
  if (!element.markAnimations?.in && !element.markAnimations?.out) return undefined;
  const result: CompiledChartMarkAnimations = {};
  for (const side of ['in', 'out'] as const) {
    const phase = element.markAnimations[side];
    if (!phase) continue;
    const snapshot = catalog.find(
      (candidate) =>
        studioPluginKey(studioPluginReference(candidate)) === studioPluginKey(phase.reference),
    )!;
    const preset = snapshot.presets.find((item) => item.id === phase.presetId)!;
    const parameters = {
      ...Object.fromEntries(
        (preset.parameters ?? []).map((parameter) => [parameter.id, parameter.default]),
      ),
      ...phase.parameters,
    };
    result[side] = {
      startFrame: (side === 'in' ? windows!.start : windows!.lastStep) + phase.delayFrames,
      durationFrames: phase.durationFrames,
      staggerFrames: phase.staggerFrames,
      staggerSlots: chartMarkAnimationCount(element),
      tracks: Object.fromEntries(
        (preset.tracks[side] ?? []).map((track) => [
          track.property,
          track.keys.map((key, index) => ({
            id: `chart-mark-${side}-${track.property}-${index}`,
            frame: Math.round(key.at * phase.durationFrames),
            value: resolveAnimationPresetKeyValue(
              track,
              key.value,
              IDENTITY[track.property],
              parameters,
            ),
            easing: key.easing ?? 'linear',
          })),
        ]),
      ),
    };
  }
  return result;
}

/** Frame sampling is seekable and independent of a renderer's data-update replay clock. */
export function sampleChartMarkAnimations(
  compiled: CompiledChartMarkAnimations | undefined,
  frame: number,
  index: number,
): ChartMarkPose {
  const result = { ...IDENTITY };
  const at = Number.isFinite(frame) ? frame : 0;
  const ordinal = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const sample = (phase: CompiledChartMarkAnimationPhase) => {
    const slot = Math.min(ordinal, Math.max(0, phase.staggerSlots - 1));
    const local = at - phase.startFrame - slot * phase.staggerFrames;
    for (const property of ANIMATION_PRESET_TRACK_PROPERTIES) {
      const keys = phase.tracks[property];
      if (keys?.length) result[property] = getTrackValueAtFrame(keys, local, IDENTITY[property]);
    }
  };
  if (compiled?.in) sample(compiled.in);
  if (compiled?.out && at >= compiled.out.startFrame) sample(compiled.out);
  for (const property of ['opacity', 'clipLeft', 'clipRight', 'clipTop', 'clipBottom'] as const)
    result[property] = Math.max(0, Math.min(1, result[property]));
  result.scale = Math.max(0, result.scale);
  result.blur = Math.max(0, result.blur);
  return result;
}
