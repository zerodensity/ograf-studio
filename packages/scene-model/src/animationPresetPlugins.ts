import { sha256 } from '@noble/hashes/sha2.js';
import {
  isShaderPackPluginSnapshot,
  shaderPackPluginDigest,
  validateShaderPackPluginSnapshot,
} from './shaderPackPlugins';
import { createLayerKeyframe, createLayerPropertyKeyframe } from './factory';
import {
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  isAnimatableLayerPropertyApplicable,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
} from './layerAnimation';
import { layerMotionWindows } from './layerMotion';
import { CHART_ANIMATION_EASINGS } from './chartAnimation';
import {
  MAX_RENDERER_PLUGIN_CATALOG_BYTES,
  MAX_RENDERER_PLUGIN_CATALOG_ENTRIES,
  MAX_RENDERER_PLUGIN_LICENSE_BYTES,
  rendererPluginByteLength,
  rendererPluginKey,
  rendererPluginDigest,
  validateRendererPluginManifest,
  validateRendererPluginSnapshot,
} from './rendererPlugins';
import type {
  AnimationPluginPreset,
  AnimationPresetApplyOptions,
  AnimationPresetKey,
  AnimationPresetPluginManifest,
  AnimationPresetPluginSnapshot,
  AnimationPresetTrackProperty,
  AnimationPresetTrack,
  Composition,
  Layer,
  RendererPluginSnapshot,
  StudioPluginReference,
  StudioPluginSnapshot,
} from './types';

export const MAX_ANIMATION_PRESET_DEFINITION_BYTES = 2 * 1024 * 1024;
export const MAX_ANIMATION_PLUGIN_PRESETS = 64;
export const MAX_ANIMATION_PRESET_PARAMETERS = 16;
export const MAX_ANIMATION_PRESET_KEYS = 64;
export const ANIMATION_PRESET_TRACK_PROPERTIES: readonly AnimationPresetTrackProperty[] = [
  'x',
  'y',
  'rotation',
  'opacity',
  'scale',
  'clipLeft',
  'clipRight',
  'clipTop',
  'clipBottom',
  'blur',
];
const ELEMENT_TYPES = [
  'text',
  'rectangle',
  'ellipse',
  'path',
  'image',
  'image-sequence',
  'lottie',
  'audio',
  'shader',
  'pattern',
  'chart',
];
const ID = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && ID.test(value) && !forbidden.has(value);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${label}: unknown field ${key}.`);
}
function text(value: unknown, maximum = 200): boolean {
  return typeof value === 'string' && !!value.trim() && value.length <= maximum;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => (value[key] === undefined ? [] : [[key, canonical(value[key])]])),
    );
  return value;
}
export function animationPresetPluginDigest(
  input: Pick<AnimationPresetPluginSnapshot, 'manifest' | 'presets' | 'licenseText'>,
): string {
  return [
    ...sha256(
      new TextEncoder().encode(
        JSON.stringify(
          canonical({
            manifest: input.manifest,
            presets: input.presets,
            licenseText: input.licenseText,
          }),
        ),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Outer union guards identify the kind; callers must separately validate integrity and trust. */
export function isRendererPluginSnapshot(value: unknown): value is RendererPluginSnapshot {
  return record(value) && record(value.manifest) && value.manifest.kind === 'chart';
}
export function isAnimationPresetPluginSnapshot(
  value: unknown,
): value is AnimationPresetPluginSnapshot {
  return record(value) && record(value.manifest) && value.manifest.kind === 'animation-presets';
}
export function studioPluginReference(snapshot: StudioPluginSnapshot): StudioPluginReference {
  return { id: snapshot.manifest.id, version: snapshot.manifest.version, sha256: snapshot.sha256 };
}
export const studioPluginKey = rendererPluginKey;
export function studioPluginDigest(snapshot: StudioPluginSnapshot): string {
  return isRendererPluginSnapshot(snapshot)
    ? rendererPluginDigest(snapshot)
    : isAnimationPresetPluginSnapshot(snapshot)
      ? animationPresetPluginDigest(snapshot)
      : shaderPackPluginDigest(snapshot);
}

export function validateAnimationPresetPluginManifest(value: unknown): string[] {
  if (!record(value)) return ['Animation preset plugin manifest must be an object.'];
  const errors = fields(
    value,
    [
      'schemaVersion',
      'apiVersion',
      'kind',
      'id',
      'version',
      'name',
      'license',
      'author',
      'icon',
      'description',
    ],
    'Animation manifest',
  );
  if (value.kind !== 'animation-presets')
    errors.push('Animation manifest kind must be animation-presets.');
  errors.push(
    ...validateRendererPluginManifest({ ...value, kind: 'chart', presets: ['bar'] }).map((error) =>
      error.replace('Renderer plugin', 'Animation preset plugin'),
    ),
  );
  if (!text(value.name))
    errors.push('Animation manifest name must be a non-empty string of at most 200 characters.');
  if (!text(value.license, 128))
    errors.push('Animation manifest license must be a non-empty string of at most 128 characters.');
  if (value.author !== undefined && !text(value.author))
    errors.push('Animation manifest author must be a non-empty string of at most 200 characters.');
  if (value.description !== undefined && !text(value.description, 2000))
    errors.push(
      'Animation manifest description must be a non-empty string of at most 2000 characters.',
    );
  return errors;
}

function presetErrors(value: unknown, index: number): string[] {
  const label = `Animation preset ${index}`;
  if (!record(value)) return [`${label} must be an object.`];
  const errors = fields(
    value,
    ['id', 'name', 'description', 'targetKinds', 'parameters', 'tracks'],
    label,
  );
  if (!identifier(value.id)) errors.push(`${label} id must be a safe non-prototype identifier.`);
  if (!text(value.name)) errors.push(`${label} name must be non-empty, at most 200 characters.`);
  if (value.description !== undefined && !text(value.description, 2000))
    errors.push(`${label} description must be non-empty, at most 2000 characters.`);
  if (
    value.targetKinds !== undefined &&
    (!Array.isArray(value.targetKinds) ||
      !value.targetKinds.length ||
      value.targetKinds.some((kind) => typeof kind !== 'string' || !ELEMENT_TYPES.includes(kind)) ||
      new Set(value.targetKinds).size !== value.targetKinds.length)
  )
    errors.push(`${label} targetKinds must be unique supported element kinds.`);
  const parameters = value.parameters === undefined ? [] : value.parameters;
  const parameterIds = new Set<string>();
  if (!Array.isArray(parameters) || parameters.length > MAX_ANIMATION_PRESET_PARAMETERS)
    errors.push(`${label} parameters must be an array of at most 16 declarations.`);
  else
    for (const parameter of parameters) {
      if (!record(parameter)) {
        errors.push(`${label} parameter must be an object.`);
        continue;
      }
      errors.push(
        ...fields(
          parameter,
          ['id', 'label', 'default', 'min', 'max', 'step'],
          `${label} parameter`,
        ),
      );
      if (!identifier(parameter.id) || parameterIds.has(parameter.id))
        errors.push(`${label} parameter id must be safe and unique.`);
      else parameterIds.add(parameter.id);
      if (!text(parameter.label))
        errors.push(`${label} parameter label must be non-empty, at most 200 characters.`);
      if (
        ![parameter.default, parameter.min, parameter.max, parameter.step].every(finite) ||
        Number(parameter.min) > Number(parameter.max) ||
        Number(parameter.step) <= 0 ||
        Number(parameter.default) < Number(parameter.min) ||
        Number(parameter.default) > Number(parameter.max)
      )
        errors.push(
          `${label} parameter values must be finite, ordered, with a positive step and in-range default.`,
        );
    }
  if (!record(value.tracks)) {
    errors.push(`${label} tracks must be an object.`);
    return errors;
  }
  errors.push(...fields(value.tracks, ['in', 'out'], `${label} tracks`));
  if (value.tracks.in === undefined && value.tracks.out === undefined)
    errors.push(`${label} needs an in or out track set.`);
  for (const side of ['in', 'out'] as const) {
    const tracks = value.tracks[side];
    if (tracks === undefined) continue;
    if (
      !Array.isArray(tracks) ||
      !tracks.length ||
      tracks.length > ANIMATION_PRESET_TRACK_PROPERTIES.length
    ) {
      errors.push(`${label} ${side} must have 1..10 tracks.`);
      continue;
    }
    const properties = new Set<string>();
    for (const track of tracks) {
      if (!record(track)) {
        errors.push(`${label} track must be an object.`);
        continue;
      }
      errors.push(...fields(track, ['property', 'mode', 'keys'], `${label} track`));
      if (
        typeof track.property !== 'string' ||
        !ANIMATION_PRESET_TRACK_PROPERTIES.includes(
          track.property as AnimationPresetTrackProperty,
        ) ||
        properties.has(track.property)
      )
        errors.push(`${label} track property must be supported and unique per side.`);
      else properties.add(track.property);
      if (!['absolute', 'offset', 'factor'].includes(String(track.mode)))
        errors.push(`${label} track mode is invalid.`);
      if (
        !Array.isArray(track.keys) ||
        track.keys.length < 2 ||
        track.keys.length > MAX_ANIMATION_PRESET_KEYS
      ) {
        errors.push(`${label} track needs 2..64 keys.`);
        continue;
      }
      let previousAt = -1;
      for (const key of track.keys) {
        if (!record(key)) {
          errors.push(`${label} key must be an object.`);
          continue;
        }
        errors.push(...fields(key, ['at', 'value', 'easing'], `${label} key`));
        if (!finite(key.at) || key.at < 0 || key.at > 1 || key.at <= previousAt)
          errors.push(`${label} key times must be sorted and unique in 0..1.`);
        if (finite(key.at)) previousAt = key.at;
        if (key.value !== 'on-air' && !finite(key.value)) {
          if (!record(key.value))
            errors.push(
              `${label} key value must be numeric, on-air or a declared parameter expression.`,
            );
          else {
            errors.push(
              ...fields(key.value, ['parameter', 'multiplier', 'offset'], `${label} expression`),
            );
            if (typeof key.value.parameter !== 'string' || !parameterIds.has(key.value.parameter))
              errors.push(`${label} expression uses an unknown parameter.`);
            for (const component of ['multiplier', 'offset'])
              if (key.value[component] !== undefined && !finite(key.value[component]))
                errors.push(`${label} expression ${component} must be finite.`);
          }
        }
        if (
          track.mode === 'absolute' &&
          finite(key.value) &&
          typeof track.property === 'string' &&
          ANIMATION_PRESET_TRACK_PROPERTIES.includes(
            track.property as AnimationPresetTrackProperty,
          ) &&
          !valueInRange(track.property as AnimationPresetTrackProperty, key.value)
        )
          errors.push(`${label} absolute key value is outside the property range.`);
        if (
          key.easing !== undefined &&
          (typeof key.easing !== 'string' || !CHART_ANIMATION_EASINGS.includes(key.easing as never))
        )
          errors.push(`${label} key easing must be a supported preset.`);
      }
      if (track.keys[0]?.at !== 0 || track.keys.at(-1)?.at !== 1)
        errors.push(`${label} track must include exact endpoints 0 and 1.`);
      if ((side === 'in' ? track.keys.at(-1) : track.keys[0])?.value !== 'on-air')
        errors.push(`${label} ${side} anchor endpoint must use on-air.`);
    }
  }
  return errors;
}

function snapshotErrors(value: unknown, checkIntegrity: boolean): string[] {
  if (!record(value)) return ['Animation preset plugin snapshot must be an object.'];
  const errors = fields(
    value,
    ['manifest', 'presets', 'licenseText', 'sha256'],
    'Animation snapshot',
  );
  errors.push(...validateAnimationPresetPluginManifest(value.manifest));
  if (
    !Array.isArray(value.presets) ||
    !value.presets.length ||
    value.presets.length > MAX_ANIMATION_PLUGIN_PRESETS
  )
    errors.push('Animation snapshot presets must have 1..64 entries.');
  else {
    const ids = new Set<string>();
    value.presets.forEach((preset, index) => {
      errors.push(...presetErrors(preset, index));
      if (record(preset) && typeof preset.id === 'string') {
        if (ids.has(preset.id)) errors.push('Animation preset ids must be unique.');
        ids.add(preset.id);
      }
    });
    if (
      !errors.length &&
      rendererPluginByteLength(JSON.stringify(value.presets)) >
        MAX_ANIMATION_PRESET_DEFINITION_BYTES
    )
      errors.push('Animation preset definitions exceed 2 MiB.');
  }
  if (
    typeof value.licenseText !== 'string' ||
    !value.licenseText.trim() ||
    rendererPluginByteLength(value.licenseText) > MAX_RENDERER_PLUGIN_LICENSE_BYTES
  )
    errors.push('Animation licenseText must be non-empty and at most 128 KiB.');
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    errors.push('Animation snapshot sha256 must be a lowercase SHA-256 digest.');
  if (
    checkIntegrity &&
    !errors.length &&
    animationPresetPluginDigest(value as unknown as AnimationPresetPluginSnapshot) !== value.sha256
  )
    errors.push('Animation preset snapshot integrity does not match its sha256.');
  return errors;
}
export function validateAnimationPresetPluginSnapshot(value: unknown): string[] {
  return snapshotErrors(value, true);
}
export function createAnimationPresetPluginSnapshot(input: {
  manifest: AnimationPresetPluginManifest;
  presets: AnimationPluginPreset[];
  licenseText: string;
}): AnimationPresetPluginSnapshot {
  const errors = snapshotErrors({ ...input, sha256: '0'.repeat(64) }, false);
  if (errors.length) throw new Error(errors.join(' '));
  return { ...copy(input), sha256: animationPresetPluginDigest(input) };
}
export function validateStudioPluginSnapshot(value: unknown): string[] {
  if (isRendererPluginSnapshot(value)) return validateRendererPluginSnapshot(value);
  if (isAnimationPresetPluginSnapshot(value)) return validateAnimationPresetPluginSnapshot(value);
  if (isShaderPackPluginSnapshot(value)) return validateShaderPackPluginSnapshot(value);
  return ['Unknown Studio plugin kind.'];
}

function valueInRange(property: AnimationPresetTrackProperty, value: number): boolean {
  return (
    Number.isFinite(value) &&
    (!['opacity', 'clipLeft', 'clipRight', 'clipTop', 'clipBottom'].includes(property) ||
      (value >= 0 && value <= 1)) &&
    (!['scale', 'blur'].includes(property) || value >= 0)
  );
}

/**
 * Resolve one validated data-only preset key against its on-air anchor. Shared by the ordinary
 * baker and transition preflight so declared parameter ranges never bypass property constraints.
 */
export function resolveAnimationPresetKeyValue(
  track: Pick<AnimationPresetTrack, 'property' | 'mode'>,
  keyValue: AnimationPresetKey['value'],
  onAir: number,
  parameters: Readonly<Record<string, number>>,
): number {
  let value = onAir;
  if (keyValue !== 'on-air') {
    const numeric =
      typeof keyValue === 'number'
        ? keyValue
        : parameters[keyValue.parameter]! * (keyValue.multiplier ?? 1) + (keyValue.offset ?? 0);
    value =
      track.mode === 'offset'
        ? onAir + numeric
        : track.mode === 'factor'
          ? onAir * numeric
          : numeric;
  }
  if (!valueInRange(track.property, value))
    throw new Error(`Animation property ${track.property} resolves outside its supported range.`);
  return value;
}

/** Bake portable numeric tracks; no plugin source is evaluated and failures leave both inputs intact. */
export function applyAnimationPreset(
  composition: Composition,
  layer: Layer,
  snapshot: AnimationPresetPluginSnapshot,
  presetId: string,
  side: 'in' | 'out',
  options: AnimationPresetApplyOptions,
): void {
  if (layer.isLocked) throw new Error('Animation preset target is locked.');
  const errors = validateAnimationPresetPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  const preset = snapshot.presets.find((entry) => entry.id === presetId);
  if (!preset) throw new Error('Animation preset id was not found in the pinned plugin.');
  if (side !== 'in' && side !== 'out') throw new Error('Animation preset side must be in or out.');
  if (preset.targetKinds && !preset.targetKinds.includes(layer.element.type))
    throw new Error('Animation preset does not support this element kind.');
  const tracks = preset.tracks[side];
  if (!tracks?.length) throw new Error(`Animation preset has no ${side} tracks.`);
  const windows = layerMotionWindows(composition);
  if (!windows) throw new Error('Animation presets need Start, at least one Step, and End.');
  const duration = options.durationFrames;
  const offset = options.offsetFrames ?? 0;
  const available = side === 'in' ? windows.inFrames : windows.outFrames;
  if (
    !Number.isInteger(duration) ||
    duration < 1 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    duration + offset > available
  )
    throw new Error('Animation duration and offset must fit inside this lifecycle window.');
  if (options.parameters !== undefined && !record(options.parameters))
    throw new Error('Animation parameters must be a numeric object.');
  const params: Record<string, number> = Object.fromEntries(
    (preset.parameters ?? []).map((parameter) => [parameter.id, parameter.default]),
  );
  for (const [id, value] of Object.entries(options.parameters ?? {})) {
    const parameter = preset.parameters?.find((entry) => entry.id === id);
    if (!parameter || !finite(value) || value < parameter.min || value > parameter.max)
      throw new Error(`Animation parameter ${id} is unknown or outside its declared range.`);
    params[id] = value;
  }
  const anchor = side === 'in' ? windows.firstStep : windows.lastStep;
  const finish = (side === 'in' ? windows.firstStep : windows.end) - offset;
  const start = finish - duration;
  const prepared = copy(layer);
  prepared.animationTracks = copy(
    layer.animationTrackMode === 'independent'
      ? layer.animationTracks
      : getResolvedLayerAnimationTracks(layer),
  );
  for (const track of tracks) {
    if (!isAnimatableLayerPropertyApplicable(layer, track.property))
      throw new Error(`Animation property ${track.property} is unavailable on this layer.`);
    const onAir = getLayerPropertyValueAtFrame(layer, track.property, anchor);
    const frames = new Set<number>();
    const keys = track.keys.map((key) => {
      const frame = start + Math.round(key.at * duration);
      if (frames.has(frame))
        throw new Error(
          'Animation duration is too short: normalized key times collide at a frame.',
        );
      frames.add(frame);
      const value = resolveAnimationPresetKeyValue(track, key.value, onAir, params);
      return createLayerPropertyKeyframe(frame, value, { easing: key.easing ?? 'linear' });
    });
    const outside = (prepared.animationTracks[track.property] ?? []).filter((key) =>
      side === 'in'
        ? key.frame > windows.firstStep || key.frame < windows.start
        : key.frame < windows.lastStep || key.frame > windows.end,
    );
    const putHold = (frame: number, value: number) => {
      if (!keys.some((key) => key.frame === frame))
        keys.push(createLayerPropertyKeyframe(frame, value, { easing: 'linear' }));
    };
    const initialValue = keys[0]!.value;
    const finalValue = keys.at(-1)!.value;
    if (side === 'in') {
      putHold(windows.start, initialValue);
      putHold(windows.firstStep, onAir);
    } else {
      putHold(windows.lastStep, onAir);
      putHold(windows.end, finalValue);
    }
    prepared.animationTracks[track.property] = sortLayerPropertyKeyframes([...outside, ...keys]);
  }
  const snapshotCopy = copy(snapshot);
  const reference = studioPluginReference(snapshotCopy);
  const catalog = [...(composition.animationPresetPlugins ?? [])];
  const existing = catalog.findIndex(
    (entry) => studioPluginKey(studioPluginReference(entry)) === studioPluginKey(reference),
  );
  if (existing < 0) catalog.push(snapshotCopy);
  else catalog[existing] = snapshotCopy;
  if (
    catalog.length > MAX_RENDERER_PLUGIN_CATALOG_ENTRIES ||
    catalog.reduce(
      (size, entry) =>
        size +
        rendererPluginByteLength(JSON.stringify(entry.manifest)) +
        rendererPluginByteLength(JSON.stringify(entry.presets)) +
        rendererPluginByteLength(entry.licenseText),
      0,
    ) > MAX_RENDERER_PLUGIN_CATALOG_BYTES
  )
    throw new Error('Animation preset catalog exceeds its 16-entry or 8 MiB limit.');
  const changedFrames = new Set<number>([
    windows.start,
    windows.firstStep,
    windows.lastStep,
    windows.end,
  ]);
  for (const track of tracks)
    for (const key of prepared.animationTracks[track.property] ?? []) changedFrames.add(key.frame);
  prepared.keyframes = sortLayerKeyframes([
    ...prepared.keyframes,
    ...[...changedFrames]
      .filter((frame) => !prepared.keyframes.some((key) => key.frame === frame))
      .map((frame) => createLayerKeyframe(frame, getLayerTransformAtFrame(prepared, frame))),
  ]);
  for (const key of prepared.keyframes)
    key.transform = getLayerTransformAtFrame(prepared, key.frame);
  prepared.animationPresets = {
    ...prepared.animationPresets,
    [side]: {
      reference,
      presetId,
      durationFrames: duration,
      ...(offset ? { offsetFrames: offset } : {}),
      parameters: params,
    },
  };
  prepared.motion = { ...(prepared.motion ?? { in: null, out: null }), [side]: null };
  // All allocation, validation, collision checks and pinning limits have succeeded.
  layer.animationTracks = prepared.animationTracks;
  layer.keyframes = prepared.keyframes;
  layer.animationPresets = prepared.animationPresets;
  layer.motion = prepared.motion;
  composition.animationPresetPlugins = catalog;
}
