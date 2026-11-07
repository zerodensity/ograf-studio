import { sha256 } from '@noble/hashes/sha2.js';
import type {
  ChartPreset,
  RendererPluginManifest,
  RendererPluginReference,
  RendererPluginSnapshot,
} from './types';

export const MAX_RENDERER_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_RENDERER_PLUGIN_LICENSE_BYTES = 128 * 1024;
export const MAX_RENDERER_PLUGIN_CATALOG_ENTRIES = 16;
export const MAX_RENDERER_PLUGIN_CATALOG_BYTES = 8 * 1024 * 1024;
export const MAX_RENDERER_PLUGIN_ICON_BYTES = 32 * 1024;

const CHART_PRESETS: readonly ChartPreset[] = [
  'bar',
  'horizontal-bar',
  'stacked-bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'polar-area',
];
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function rendererPluginByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (record(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => (value[key] === undefined ? [] : [[key, sortedJson(value[key])]])),
    );
  }
  return value;
}

/** Hash manifest identity/metadata, exact ESM bytes, and exact distributed license bytes together. */
export function rendererPluginDigest(
  input: Pick<RendererPluginSnapshot, 'manifest' | 'source' | 'licenseText'>,
): string {
  const canonical = JSON.stringify(
    sortedJson({
      manifest: input.manifest,
      source: input.source,
      licenseText: input.licenseText,
    }),
  );
  return [...sha256(new TextEncoder().encode(canonical))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function rendererPluginKey(reference: RendererPluginReference): string {
  return `${reference.id}@${reference.version}#${reference.sha256}`;
}

function iconErrors(value: unknown): string[] {
  if (typeof value !== 'string')
    return ['Renderer plugin icon must be an embedded PNG or WebP data URL.'];
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return ['Renderer plugin icon must be an embedded PNG or WebP base64 data URL.'];
  const encoded = match[2]!;
  if (encoded.length % 4) return ['Renderer plugin icon contains invalid base64.'];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if ((encoded.length / 4) * 3 - padding > MAX_RENDERER_PLUGIN_ICON_BYTES)
    return ['Renderer plugin icon exceeds 32 KiB.'];
  let decoded: string;
  try {
    decoded = atob(encoded);
    if (btoa(decoded) !== encoded) return ['Renderer plugin icon contains invalid base64.'];
  } catch {
    return ['Renderer plugin icon contains invalid base64.'];
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const signatureMatches =
    match[1]!.toLowerCase() === 'png'
      ? bytes.length >= pngSignature.length &&
        pngSignature.every((byte, index) => bytes[index] === byte)
      : bytes.length >= 12 && decoded.slice(0, 4) === 'RIFF' && decoded.slice(8, 12) === 'WEBP';
  return signatureMatches
    ? []
    : ['Renderer plugin icon does not have the declared PNG or WebP image signature.'];
}

export function validateRendererPluginManifest(value: unknown): string[] {
  if (!record(value)) return ['Renderer plugin manifest must be an object.'];
  const errors: string[] = [];
  if (
    value.chartFeatures !== undefined &&
    (!Array.isArray(value.chartFeatures) ||
      value.chartFeatures.some(
        (feature) =>
          ![
            'presentation-v1',
            'canonical-data-v1',
            'morph-update-v1',
            'mark-paint-v1',
            'mark-animation-v1',
          ].includes(String(feature)),
      ) ||
      new Set(value.chartFeatures).size !== value.chartFeatures.length)
  )
    errors.push('Renderer plugin chartFeatures must list unique supported chart contracts.');
  if (value.icon !== undefined) errors.push(...iconErrors(value.icon));
  if (value.schemaVersion !== 1) errors.push('Renderer plugin schemaVersion must be 1.');
  if (value.apiVersion !== 1) errors.push('Renderer plugin apiVersion must be 1.');
  if (value.kind !== 'chart') errors.push('Renderer plugin kind must be chart.');
  if (typeof value.id !== 'string' || value.id.length > 128 || !PLUGIN_ID.test(value.id))
    errors.push('Renderer plugin id must be a lowercase dotted or hyphenated identifier.');
  if (
    typeof value.version !== 'string' ||
    value.version.length > 128 ||
    !VERSION.test(value.version)
  )
    errors.push('Renderer plugin version must be an exact semantic version.');
  for (const key of ['name', 'license'] as const)
    if (typeof value[key] !== 'string' || !value[key].trim())
      errors.push(`Renderer plugin ${key} must be a non-empty string.`);
  for (const key of ['description', 'author'] as const)
    if (value[key] !== undefined && typeof value[key] !== 'string')
      errors.push(`Renderer plugin ${key} must be a string.`);
  if (
    value.library !== undefined &&
    (!record(value.library) ||
      typeof value.library.name !== 'string' ||
      !value.library.name.trim() ||
      typeof value.library.version !== 'string' ||
      !value.library.version.trim())
  )
    errors.push('Renderer plugin library must declare a name and version.');
  if (record(value.library)) {
    for (const [key, maximum] of [
      ['license', 128],
      ['author', 200],
    ] as const) {
      const field = value.library[key];
      if (
        field !== undefined &&
        (typeof field !== 'string' || !field.trim() || field.length > maximum)
      )
        errors.push(
          `Renderer plugin library ${key} must be a non-empty string of at most ${maximum} characters.`,
        );
    }
    if (value.library.homepage !== undefined) {
      const homepage = value.library.homepage;
      let valid =
        typeof homepage === 'string' &&
        homepage.length > 0 &&
        homepage.length <= 2048 &&
        !Array.from(homepage).some(
          (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        );
      if (valid) {
        try {
          const url = new URL(homepage as string);
          valid = url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          valid = false;
        }
      }
      if (!valid)
        errors.push(
          'Renderer plugin library homepage must be an HTTPS URL without credentials, at most 2048 characters.',
        );
    }
  }
  if (
    !Array.isArray(value.presets) ||
    !value.presets.length ||
    value.presets.some((preset) => !CHART_PRESETS.includes(preset as ChartPreset))
  )
    errors.push('Renderer plugin presets must list supported Studio chart presets.');
  else if (new Set(value.presets).size !== value.presets.length)
    errors.push('Renderer plugin presets cannot repeat.');
  return errors;
}

export function validateRendererPluginReference(value: unknown): string[] {
  if (!record(value)) return ['Renderer plugin reference must be an object.'];
  const errors: string[] = [];
  if (typeof value.id !== 'string' || !PLUGIN_ID.test(value.id))
    errors.push('Renderer plugin reference id is invalid.');
  if (typeof value.version !== 'string' || !VERSION.test(value.version))
    errors.push('Renderer plugin reference version must be an exact semantic version.');
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    errors.push('Renderer plugin reference sha256 must be a lowercase SHA-256 digest.');
  return errors;
}

export function validateRendererPluginSnapshot(value: unknown): string[] {
  if (!record(value)) return ['Renderer plugin snapshot must be an object.'];
  const errors = validateRendererPluginManifest(value.manifest);
  if (typeof value.source !== 'string' || !value.source.trim())
    errors.push('Renderer plugin source must be non-empty ESM source.');
  else if (rendererPluginByteLength(value.source) > MAX_RENDERER_PLUGIN_SOURCE_BYTES)
    errors.push('Renderer plugin source exceeds 2 MiB.');
  if (typeof value.licenseText !== 'string' || !value.licenseText.trim())
    errors.push('Renderer plugin licenseText must be non-empty.');
  else if (rendererPluginByteLength(value.licenseText) > MAX_RENDERER_PLUGIN_LICENSE_BYTES)
    errors.push('Renderer plugin licenseText exceeds 128 KiB.');
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    errors.push('Renderer plugin sha256 must be a lowercase SHA-256 digest.');
  if (
    !errors.length &&
    rendererPluginDigest(value as unknown as RendererPluginSnapshot) !== value.sha256
  )
    errors.push('Renderer plugin snapshot integrity does not match its sha256.');
  return errors;
}

export function createRendererPluginSnapshot(input: {
  manifest: RendererPluginManifest;
  source: string;
  licenseText: string;
}): RendererPluginSnapshot {
  const snapshot = {
    ...JSON.parse(JSON.stringify(input)),
    sha256: rendererPluginDigest(input),
  } as RendererPluginSnapshot;
  const errors = validateRendererPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  return snapshot;
}
