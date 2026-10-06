import type { CompiledGraphicDescriptor, OGrafManifest } from '@ograf-editor/ograf-types';
import {
  isMediaPaint,
  templateThumbnailName,
  type Composition,
  type Paint,
  type Project,
} from '@ograf-editor/scene-model';
import { validateManifest, validateProject } from '@ograf-editor/validation';
import { assembleManifest } from './assembleManifest';
import { compileDescriptor } from './compileDescriptor';
import { projectForExportProfile, type ExportProfile } from './exportProfiles';

export interface ExportArtifacts {
  manifest: OGrafManifest;
  manifestFileName: string;
  mainJs: string;
  resources: Array<{ path: string; data: string; base64: boolean; mimeType?: string }>;
  projectErrors: string[];
  manifestErrors: string[];
  valid: boolean;
  errors: string[];
  profile?: ExportProfile;
}

/** A blob-mounted package supplies exact resource URLs without borrowing the host page's base. */
export const EXPORTED_RESOURCE_URLS_KEY = '__ografPackageResourceUrls';

const CHARTJS_LICENSE = `The MIT License (MIT)

Copyright (c) 2014-2024 Chart.js Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'text/css': 'css',
  'text/plain': 'txt',
};

export function generateMainJs(
  descriptor: CompiledGraphicDescriptor,
  graphicRuntimeSource: string,
  resourcePaths: readonly string[] = [],
): string {
  return `${graphicRuntimeSource}
const exportedDescriptor = ${JSON.stringify(descriptor)};
const exportedModuleBaseUrl = import.meta.url;
const exportedResourcePaths = new Set(${JSON.stringify(resourcePaths)});
function exportedRelativeResourceUrl(value) {
  if (exportedModuleBaseUrl.startsWith('blob:')) {
    const resourceUrl = globalThis[${JSON.stringify(EXPORTED_RESOURCE_URLS_KEY)}]?.[exportedModuleBaseUrl]?.[value];
    if (!resourceUrl) throw new Error('Packaged resource is unavailable in the blob module: ' + value);
    return resourceUrl;
  }
  return new URL(value, exportedModuleBaseUrl).href;
}
function exportedResourceUrl(value) {
  if (typeof value !== 'string' || (!exportedResourcePaths.has(value) && !value.startsWith('assets/'))) return value;
  return exportedRelativeResourceUrl(value);
}
const exportedLayers = [...exportedDescriptor.layers, ...(exportedDescriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers)];
const exportedImageBindings = [];
for (const cue of exportedDescriptor.mediaCues ?? []) {
  cue.sources = cue.sources.map((source) => source.kind === 'clip'
    ? { ...source, src: exportedResourceUrl(source.src) }
    : { ...source, ...(source.fallback ? { fallback: exportedResourceUrl(source.fallback) } : {}) });
}
function exportedPaintResources(paint) {
  if (!paint || typeof paint !== 'object' || paint.type !== 'media') return paint;
  if (paint.source?.kind === 'clip') return { ...paint, source: { ...paint.source, src: exportedResourceUrl(paint.source.src) } };
  if (paint.source?.kind === 'live' && paint.source.fallback) return { ...paint, source: { ...paint.source, fallback: exportedResourceUrl(paint.source.fallback) } };
  return paint;
}
for (const layer of exportedLayers) {
  if (layer.element && typeof layer.element === 'object' && 'fill' in layer.element)
    layer.element.fill = exportedPaintResources(layer.element.fill);
  if (layer.element.type === 'image') {
    layer.element.src = exportedResourceUrl(layer.element.src);
    for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : [])) {
      if (binding.targetProperty !== 'src') continue;
      exportedImageBindings.push(binding);
      if (binding.valueMap) binding.valueMap = Object.fromEntries(Object.entries(binding.valueMap).map(([key, value]) => [key, exportedResourceUrl(value)]));
    }
  } else if (layer.element.type === 'audio') {
    layer.element.src = exportedResourceUrl(layer.element.src);
  } else if (layer.element.type === 'image-sequence') {
    layer.element.frames = layer.element.frames.map(exportedResourceUrl);
  }
}
for (const font of exportedDescriptor.fonts ?? []) {
  if (font.source && !/^[a-z][a-z0-9+.-]*:/i.test(font.source)) {
    font.source = exportedRelativeResourceUrl(font.source);
  }
}
function exportedImageValue(value, path) {
  if (Array.isArray(value)) return value.map((item) => exportedImageValue(item, path));
  if (path.length === 0) return exportedResourceUrl(value);
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, path[0])) return value;
  return { ...value, [path[0]]: exportedImageValue(value[path[0]], path.slice(1)) };
}
function exportedData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const resolved = { ...data };
  for (const binding of exportedImageBindings) {
    if (Object.prototype.hasOwnProperty.call(resolved, binding.dataKey))
      resolved[binding.dataKey] = exportedImageValue(resolved[binding.dataKey], binding.sourcePath ?? []);
  }
  return resolved;
}
class ExportedGraphic extends GraphicElement {
  static descriptor = exportedDescriptor;
  load(params) { return super.load({ ...params, data: exportedData(params?.data) }); }
  updateAction(params) { return super.updateAction({ ...params, data: exportedData(params?.data) }); }
  setActionsSchedule(params) {
    return super.setActionsSchedule({ ...params, schedule: Array.isArray(params?.schedule) ? params.schedule.map((scheduled) =>
      scheduled?.action?.type === 'updateAction' ? { ...scheduled, action: { ...scheduled.action, params: { ...scheduled.action.params, data: exportedData(scheduled.action.params?.data) } } } : scheduled
    ) : params?.schedule });
  }
}
export default ExportedGraphic;
`;
}

function packageDescriptorResources(
  composition: Composition,
  descriptor: CompiledGraphicDescriptor,
): {
  descriptor: CompiledGraphicDescriptor;
  composition: Composition;
  resources: ExportArtifacts['resources'];
} {
  const packaged = structuredClone(descriptor);
  const packagedComposition = structuredClone(composition);
  const resources: ExportArtifacts['resources'] = [];
  if (composition.layers.some((layer) => layer.element.type === 'chart')) {
    resources.push({ path: 'licenses/chartjs-LICENSE.txt', data: CHARTJS_LICENSE, base64: false });
  }
  const pathByDataUri = new Map<string, string>();
  const pathByAssetId = new Map<string, string>();
  let fallbackCounter = 0;

  const parseDataUri = (uri: string) => {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri);
    if (!match) throw new Error('Cannot package a malformed data URI resource.');
    return {
      mimeType: match[1]!,
      base64: match[2] === ';base64',
      data: match[2] ? match[3]! : decodeURIComponent(match[3]!),
    };
  };

  for (const asset of composition.assets) {
    const parsed = parseDataUri(asset.dataUri);
    const extension = EXTENSION_BY_MIME[asset.mimeType || parsed.mimeType] ?? 'bin';
    const existingPath = pathByDataUri.get(asset.dataUri);
    if (existingPath) {
      pathByAssetId.set(asset.id, existingPath);
      continue;
    }
    const path = asset.packagePath?.trim() || `assets/${asset.id}.${extension}`;
    resources.push({
      path,
      data: parsed.data,
      base64: parsed.base64,
      mimeType: asset.mimeType || parsed.mimeType,
    });
    pathByAssetId.set(asset.id, path);
    pathByDataUri.set(asset.dataUri, path);
    if (asset.licenseText?.trim()) {
      resources.push({
        path: `licenses/${asset.id}-LICENSE.txt`,
        data: asset.licenseText,
        base64: false,
      });
    }
  }

  const packageUri = (uri: string): string => {
    if (uri.startsWith('asset:')) {
      const path = pathByAssetId.get(uri.slice('asset:'.length));
      if (!path) throw new Error(`Cannot package unknown asset reference "${uri}".`);
      return path;
    }
    if (!uri.startsWith('data:')) return uri;
    const existing = pathByDataUri.get(uri);
    if (existing) return existing;
    const parsed = parseDataUri(uri);
    const registered = composition.assets.find((asset) => asset.dataUri === uri);
    const basename = registered?.id ?? `embedded-${fallbackCounter++}`;
    const extension = EXTENSION_BY_MIME[parsed.mimeType] ?? 'bin';
    const path = `assets/${basename}.${extension}`;
    resources.push({ path, data: parsed.data, base64: parsed.base64, mimeType: parsed.mimeType });
    pathByDataUri.set(uri, path);
    return path;
  };

  const packagePaint = (paint: Paint | undefined): Paint | undefined => {
    if (!isMediaPaint(paint)) return paint;
    return paint.source.kind === 'clip'
      ? { ...paint, source: { ...paint.source, src: packageUri(paint.source.src) } }
      : {
          ...paint,
          source: {
            ...paint.source,
            ...(paint.source.fallback ? { fallback: packageUri(paint.source.fallback) } : {}),
          },
        };
  };

  const packagedLayers = [
    ...packaged.layers,
    ...(packaged.collections ?? []).flatMap((collection) => collection.prototypeLayers),
  ];
  for (const layer of packagedLayers) {
    if ('fill' in layer.element && layer.element.fill)
      layer.element.fill = packagePaint(layer.element.fill) as typeof layer.element.fill;
    if (layer.element.type === 'image' && layer.element.src) {
      layer.element.src = packageUri(layer.element.src);
    } else if (layer.element.type === 'audio' && layer.element.src) {
      layer.element.src = packageUri(layer.element.src);
    } else if (layer.element.type === 'image-sequence') {
      layer.element.frames = layer.element.frames.map(packageUri);
    }
    if (layer.element.type === 'image') {
      // Mapped data values (e.g. a select field choosing an icon) bypass element.src at runtime.
      for (const binding of layer.bindings ?? []) {
        if (binding.targetProperty !== 'src' || !binding.valueMap) continue;
        binding.valueMap = Object.fromEntries(
          Object.entries(binding.valueMap).map(([key, value]) => [
            key,
            typeof value === 'string' ? packageUri(value) : value,
          ]),
        );
      }
    }
  }
  for (const cue of packaged.mediaCues ?? []) {
    cue.sources = cue.sources.map((source) =>
      source.kind === 'clip'
        ? { ...source, src: packageUri(source.src) }
        : {
            ...source,
            ...(source.fallback ? { fallback: packageUri(source.fallback) } : {}),
          },
    );
  }
  for (const cue of packagedComposition.mediaCues) {
    cue.sources = cue.sources.map((source) =>
      source.kind === 'clip'
        ? { ...source, src: packageUri(source.src) }
        : {
            ...source,
            ...(source.fallback ? { fallback: packageUri(source.fallback) } : {}),
          },
    );
  }
  for (const font of packaged.fonts ?? []) {
    font.source = packageUri(font.source);
  }
  const packageFieldValue = (
    field: Composition['dataFields'][number],
    value: typeof field.defaultValue,
  ): typeof field.defaultValue => {
    if (field.type === 'image-url' && typeof value === 'string') return packageUri(value);
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, typeof field.defaultValue>;
      return Object.fromEntries(
        Object.entries(record).map(([key, childValue]) => {
          const child = field.properties.find((property) => property.key === key);
          return [key, child ? packageFieldValue(child, childValue) : childValue];
        }),
      );
    }
    if (field.type === 'array' && field.items && Array.isArray(value)) {
      return value.map((item) => packageFieldValue(field.items!, item));
    }
    return value;
  };
  for (const field of packagedComposition.dataFields) {
    field.defaultValue = packageFieldValue(field, field.defaultValue);
  }
  return { descriptor: packaged, composition: packagedComposition, resources };
}

/** Shared exact-artifact compiler used by the editor and the MCP authoring host. */
export function buildExportArtifactsWithRuntime(
  project: Project,
  composition: Composition,
  graphicRuntimeSource: string,
  profile?: ExportProfile,
): ExportArtifacts {
  const outputProject = profile ? projectForExportProfile(project, profile) : project;
  const sourceDescriptor = compileDescriptor(composition);
  const packaged = packageDescriptorResources(composition, sourceDescriptor);
  const manifest = assembleManifest(outputProject, packaged.composition, packaged.descriptor);
  const projectValidation = validateProject(outputProject);
  const manifestValidation = validateManifest(manifest);
  const errors = [...projectValidation.errors, ...manifestValidation.errors];
  return {
    manifest,
    manifestFileName: `${manifest.id}.ograf.json`,
    mainJs: generateMainJs(
      packaged.descriptor,
      graphicRuntimeSource,
      packaged.resources.map((resource) => resource.path),
    ),
    resources: packaged.resources,
    projectErrors: projectValidation.errors,
    manifestErrors: manifestValidation.errors,
    valid: errors.length === 0,
    errors,
    ...(profile ? { profile } : {}),
  };
}

/** Adds the rendered thumbnail before certification of the complete package. */
export function withExportThumbnail(
  artifacts: ExportArtifacts,
  project: Pick<Project, 'id'>,
  pngBase64: string,
): ExportArtifacts {
  const file = templateThumbnailName(project);
  const manifest = { ...artifacts.manifest, thumbnails: [{ file }] };
  const manifestErrors = validateManifest(manifest).errors;
  const errors = [...artifacts.projectErrors, ...manifestErrors];
  return {
    ...artifacts,
    manifest,
    resources: [...artifacts.resources, { path: file, data: pngBase64, base64: true }],
    manifestErrors,
    errors,
    valid: errors.length === 0,
  };
}

export function validatePackageLayout(artifacts: ExportArtifacts): string[] {
  const errors: string[] = [];
  if (!artifacts.manifestFileName.endsWith('.ograf.json')) {
    errors.push(
      `Manifest filename must end with ".ograf.json", got "${artifacts.manifestFileName}".`,
    );
  }
  if (artifacts.manifest.main !== 'main.js') {
    errors.push(`Manifest main must point to "main.js", got "${artifacts.manifest.main}".`);
  }
  if (!artifacts.mainJs.trim()) errors.push('main.js is empty.');

  const paths = [artifacts.manifestFileName, 'main.js', ...artifacts.resources.map((r) => r.path)];
  const uniquePaths = new Set<string>();
  for (const path of paths) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      errors.push(`Package path must be a safe relative URL: "${path}".`);
    }
    if (uniquePaths.has(path)) errors.push(`Package contains duplicate path "${path}".`);
    uniquePaths.add(path);
  }
  for (const thumbnail of artifacts.manifest.thumbnails ?? []) {
    if (!artifacts.resources.some((resource) => resource.path === thumbnail.file))
      errors.push(`Thumbnail file is missing from the package: "${thumbnail.file}".`);
  }
  return errors;
}
