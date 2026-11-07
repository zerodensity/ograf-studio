import { sha256 } from '@noble/hashes/sha2.js';
import {
  inspectShaderElement,
  normalizeShaderElement,
  shaderImageInputBytes,
  MAX_SHADER_IMAGE_BYTES,
} from './shader';
import {
  MAX_RENDERER_PLUGIN_LICENSE_BYTES,
  rendererPluginByteLength,
  validateRendererPluginManifest,
} from './rendererPlugins';
import type {
  ShaderPackPluginManifest,
  ShaderPackPluginSnapshot,
  ShaderPackPreset,
  ShaderPackPresetTarget,
  ShaderPaint,
} from './types';

export const MAX_SHADER_PACK_ENTRIES = 64;
export const MAX_SHADER_PACK_SOURCE_BYTES = 128 * 1024;
export const MAX_SHADER_PACK_DEFINITION_BYTES = 2 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, max: number): boolean =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const id = (value: unknown): boolean =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
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
export function isShaderPackPluginSnapshot(value: unknown): value is ShaderPackPluginSnapshot {
  return record(value) && record(value.manifest) && value.manifest.kind === 'shader-pack';
}
export function shaderPackPluginDigest(
  input: Pick<ShaderPackPluginSnapshot, 'manifest' | 'shaders' | 'licenseText'>,
): string {
  return [
    ...sha256(
      new TextEncoder().encode(
        JSON.stringify(
          canonical({
            manifest: input.manifest,
            shaders: input.shaders,
            licenseText: input.licenseText,
          }),
        ),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export function validateShaderPackPluginManifest(value: unknown): string[] {
  if (!record(value)) return ['Shader pack manifest must be an object.'];
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
      'description',
      'icon',
    ],
    'Shader pack manifest',
  );
  if (value.kind !== 'shader-pack') errors.push('Shader pack manifest kind must be shader-pack.');
  errors.push(
    ...validateRendererPluginManifest({ ...value, kind: 'chart', presets: ['bar'] }).map((error) =>
      error.replace('Renderer plugin', 'Shader pack'),
    ),
  );
  for (const [key, max] of [
    ['name', 200],
    ['license', 128],
    ['author', 200],
    ['description', 2000],
  ] as const) {
    if (['author', 'description'].includes(key) && value[key] === undefined) continue;
    if (!text(value[key], max))
      errors.push(`Shader pack ${key} must be non-empty, at most ${max} characters.`);
  }
  return errors;
}
function paintErrors(value: unknown, targets: ShaderPackPresetTarget[]): string[] {
  if (!record(value)) return ['Shader pack paint must be an object.'];
  const errors = fields(
    value,
    ['type', 'name', 'fragmentSource', 'speed', 'resolutionScale', 'parameters', 'inputImage'],
    'Shader pack paint',
  );
  if (value.type !== 'shader') errors.push('Shader pack paint type must be shader.');
  if (
    !text(value.fragmentSource, MAX_SHADER_PACK_SOURCE_BYTES) ||
    (typeof value.fragmentSource === 'string' &&
      rendererPluginByteLength(value.fragmentSource) > MAX_SHADER_PACK_SOURCE_BYTES)
  )
    errors.push('Shader pack GLSL source must be non-empty and at most 128 KiB.');
  if (value.name !== undefined && !text(value.name, 128))
    errors.push('Shader pack paint name must be non-empty, at most 128 characters.');
  if (!finite(value.speed) || !finite(value.resolutionScale))
    errors.push('Shader pack speed and resolutionScale must be finite numbers.');
  if (!record(value.parameters)) errors.push('Shader pack parameters must be an object.');
  else
    for (const [name, parameter] of Object.entries(value.parameters)) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
        ['constructor', 'prototype', '__proto__'].includes(name)
      )
        errors.push('Shader pack parameter identifiers are invalid.');
      if (
        typeof parameter !== 'boolean' &&
        !finite(parameter) &&
        !(
          Array.isArray(parameter) &&
          parameter.length >= 2 &&
          parameter.length <= 4 &&
          parameter.every(finite)
        )
      )
        errors.push('Shader pack parameter values must be finite numbers, booleans or vectors.');
    }
  if (value.inputImage !== undefined) {
    if (!record(value.inputImage)) errors.push('Shader pack inputImage must be an object.');
    else {
      errors.push(
        ...fields(value.inputImage, ['source', 'name', 'wrap', 'filter'], 'Shader pack inputImage'),
      );
      if (
        typeof value.inputImage.source !== 'string' ||
        shaderImageInputBytes(value.inputImage.source) < 0
      )
        errors.push(
          'Shader pack inputs must be embedded PNG/JPEG data, never external or asset references.',
        );
      else {
        const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
          value.inputImage.source,
        );
        if (
          !match ||
          match[2]!.length % 4 ||
          shaderImageInputBytes(value.inputImage.source) > MAX_SHADER_IMAGE_BYTES
        )
          errors.push('Shader pack input image must have valid bounded base64 data.');
        else
          try {
            const decoded = atob(match[2]!);
            const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
            const magic =
              match[1]!.toLowerCase() === 'png'
                ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
                : [0xff, 0xd8, 0xff];
            if (
              btoa(decoded) !== match[2] ||
              bytes.length < magic.length ||
              magic.some((byte, index) => bytes[index] !== byte)
            )
              errors.push('Shader pack input image data does not match its PNG/JPEG format.');
          } catch {
            errors.push('Shader pack input image has invalid base64.');
          }
      }
      if (value.inputImage.name !== undefined && !text(value.inputImage.name, 256))
        errors.push('Shader pack input image name is invalid.');
      if (
        !['clamp', 'repeat'].includes(String(value.inputImage.wrap)) ||
        !['linear', 'nearest'].includes(String(value.inputImage.filter))
      )
        errors.push('Shader pack image wrap/filter is invalid.');
    }
    if (targets.includes('effect'))
      errors.push('Shader pack effect entries must not embed inputImage.');
  }
  if (!errors.length)
    for (const target of targets)
      errors.push(
        ...inspectShaderElement(value as unknown as ShaderPaint, {
          channel0Provided: target === 'effect',
        }).errors.map((error) => `Shader pack ${target}: ${error}`),
      );
  return errors;
}
function snapshotErrors(value: unknown, integrity: boolean): string[] {
  if (!record(value)) return ['Shader pack snapshot must be an object.'];
  const errors = fields(
    value,
    ['manifest', 'shaders', 'licenseText', 'sha256'],
    'Shader pack snapshot',
  );
  errors.push(...validateShaderPackPluginManifest(value.manifest));
  if (
    !Array.isArray(value.shaders) ||
    !value.shaders.length ||
    value.shaders.length > MAX_SHADER_PACK_ENTRIES
  )
    errors.push('Shader pack shaders must have 1..64 entries.');
  else {
    const ids = new Set<string>();
    for (const preset of value.shaders) {
      if (!record(preset)) {
        errors.push('Shader pack preset must be an object.');
        continue;
      }
      errors.push(
        ...fields(
          preset,
          ['id', 'name', 'description', 'targets', 'paint', 'license', 'author'],
          'Shader pack preset',
        ),
      );
      if (!id(preset.id) || ids.has(String(preset.id)))
        errors.push('Shader pack preset ids must be safe and unique.');
      else ids.add(String(preset.id));
      if (!text(preset.name, 128))
        errors.push('Shader pack preset name must be non-empty, at most 128 characters.');
      for (const [key, max] of [
        ['description', 2000],
        ['license', 128],
        ['author', 200],
      ] as const)
        if (preset[key] !== undefined && !text(preset[key], max))
          errors.push(`Shader pack preset ${key} is invalid.`);
      if (
        !Array.isArray(preset.targets) ||
        !preset.targets.length ||
        preset.targets.some((target) => !['fill', 'outline', 'effect'].includes(String(target))) ||
        new Set(preset.targets).size !== preset.targets.length
      )
        errors.push('Shader pack preset targets must be unique fill/outline/effect values.');
      else errors.push(...paintErrors(preset.paint, preset.targets as ShaderPackPresetTarget[]));
    }
    if (
      !errors.length &&
      rendererPluginByteLength(JSON.stringify(value.shaders)) > MAX_SHADER_PACK_DEFINITION_BYTES
    )
      errors.push('Shader pack definitions exceed 2 MiB.');
  }
  if (
    typeof value.licenseText !== 'string' ||
    !value.licenseText.trim() ||
    rendererPluginByteLength(value.licenseText) > MAX_RENDERER_PLUGIN_LICENSE_BYTES
  )
    errors.push('Shader pack licenseText must be non-empty and at most 128 KiB.');
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    errors.push('Shader pack sha256 must be a lowercase SHA-256 digest.');
  if (
    integrity &&
    !errors.length &&
    shaderPackPluginDigest(value as unknown as ShaderPackPluginSnapshot) !== value.sha256
  )
    errors.push('Shader pack integrity does not match its sha256.');
  return errors;
}
export function validateShaderPackPluginSnapshot(value: unknown): string[] {
  return snapshotErrors(value, true);
}
export function createShaderPackPluginSnapshot(input: {
  manifest: ShaderPackPluginManifest;
  shaders: ShaderPackPreset[];
  licenseText: string;
}): ShaderPackPluginSnapshot {
  const errors = snapshotErrors({ ...input, sha256: '0'.repeat(64) }, false);
  if (errors.length) throw new Error(errors.join(' '));
  return { ...copy(input), sha256: shaderPackPluginDigest(input) };
}
export function resolveShaderPackPresetPaint(
  snapshot: ShaderPackPluginSnapshot,
  presetId: string,
  target: ShaderPackPresetTarget,
): ShaderPaint {
  const errors = validateShaderPackPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  const preset = snapshot.shaders.find((entry) => entry.id === presetId);
  if (!preset) throw new Error('Shader pack preset was not found.');
  if (!preset.targets.includes(target))
    throw new Error('Shader pack preset does not support this target.');
  const paint = normalizeShaderElement(copy(preset.paint));
  paint.name = preset.name;
  paint.packProvenance = {
    reference: {
      id: snapshot.manifest.id,
      version: snapshot.manifest.version,
      sha256: snapshot.sha256,
    },
    presetId: preset.id,
    packName: snapshot.manifest.name,
    license: preset.license ?? snapshot.manifest.license,
    licenseText: snapshot.licenseText,
    ...((preset.author ?? snapshot.manifest.author)
      ? { author: (preset.author ?? snapshot.manifest.author)! }
      : {}),
  };
  return paint;
}
