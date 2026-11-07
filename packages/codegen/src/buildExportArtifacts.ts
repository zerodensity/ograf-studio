import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  OGrafManifest,
} from '@ograf-editor/ograf-types';
import {
  isMediaPaint,
  getElementShaderPaints,
  isShaderPaint,
  mapElementContents,
  walkElementContents,
  isElementImageSourceBinding,
  templateThumbnailName,
  type Composition,
  type Paint,
  type Project,
} from '@ograf-editor/scene-model';
import { validateManifest, validateProject } from '@ograf-editor/validation';
import { assembleManifest } from './assembleManifest';
import { compileDescriptor } from './compileDescriptor';
import { compileDataExposure, fieldValueForExport } from './compileDataSchema';
import { projectForExportProfile, type ExportProfile } from './exportProfiles';
import { buildNodosInputContract, type NodosInputContract } from './nodosInputs';
import {
  RUNTIME_PACKAGE_LICENSES,
  STUDIO_RUNTIME_LICENSE_PATH,
  STUDIO_RUNTIME_NOTICE,
} from './runtimeLicenses';
import {
  mapTickerFeedResources,
  tickerFeedResourceRuntimeSource,
  TICKER_FEED_RESOURCE_PATH,
} from './tickerFeedResources';

export interface ExportArtifacts {
  /** Expected existing Nodos pins and native-value projection for the exported HTML page. */
  nodosInputContract?: NodosInputContract;
  /** Exact packaged descriptor, available before importing the generated entry module. */
  descriptor?: CompiledGraphicDescriptor;
  /** Coordinated set descriptor; the package has one controller for all template states. */
  transitionDescriptor?: CompiledTransitionLogicDescriptor;
  /** Public per-state data forms used only by the optional self-contained preview. */
  offlinePreviewStateSchemas?: Record<string, Record<string, Record<string, unknown>>>;
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
  return `${STUDIO_RUNTIME_NOTICE}
${graphicRuntimeSource}
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
${tickerFeedResourceRuntimeSource('exportedResourceUrl')}
const exportedLayers = [...exportedDescriptor.layers, ...(exportedDescriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers)];
const exportedImageBindings = [];
for (const cue of exportedDescriptor.mediaCues ?? []) {
  cue.sources = cue.sources.map((source) => source.kind === 'clip'
    ? { ...source, src: exportedResourceUrl(source.src) }
    : { ...source, ...(source.fallback ? { fallback: exportedResourceUrl(source.fallback) } : {}) });
}
function exportedPaintResources(paint) {
  if (paint?.type === 'shader' && paint.inputImage) return { ...paint, inputImage: { ...paint.inputImage, source: exportedResourceUrl(paint.inputImage.source) } };
  if (!paint || typeof paint !== 'object' || paint.type !== 'media') return paint;
  if (paint.source?.kind === 'clip') return { ...paint, source: { ...paint.source, src: exportedResourceUrl(paint.source.src) } };
  if (paint.source?.kind === 'live' && paint.source.fallback) return { ...paint, source: { ...paint.source, fallback: exportedResourceUrl(paint.source.fallback) } };
  return paint;
}
function exportedElementResources(element) {
  if (element.type === 'ticker') {
    element.background = exportedPaintResources(element.background);
    for (const item of element.items) {
      exportedElementResources(item.element);
      for (const effect of item.effects?.stack ?? []) if (effect.shader) effect.shader = exportedPaintResources(effect.shader);
    }
  }
  if ('fill' in element) element.fill = exportedPaintResources(element.fill);
  if (element.type === 'text' && element.strokePaint) element.strokePaint = exportedPaintResources(element.strokePaint);
  if (element.type === 'shader' && element.inputImage) element.inputImage.source = exportedResourceUrl(element.inputImage.source);
  if (element.type === 'image' || element.type === 'audio') element.src = exportedResourceUrl(element.src);
  if (element.type === 'image-sequence') element.frames = element.frames.map(exportedResourceUrl);
}
for (const layer of exportedLayers) {
  exportedElementResources(layer.element);
  if (layer.element.type === 'ticker')
    for (const binding of layer.bindings ?? []) {
      if (binding.targetProperty === 'items') {
        exportedImageBindings.push({ ...binding, sourcePath: [...(binding.sourcePath ?? []), ${JSON.stringify(TICKER_FEED_RESOURCE_PATH)}] });
        if (binding.valueMap) binding.valueMap = Object.fromEntries(Object.entries(binding.valueMap).map(([key, value]) => [key, exportedTickerFeedResources(value)]));
        continue;
      }
      const target = /^items\\.([^.]+)\\.src$/.exec(binding.targetProperty);
      if (!target || layer.element.items.find((item) => item.id === target[1])?.element.type !== 'image') continue;
      exportedImageBindings.push(binding);
      if (binding.valueMap) binding.valueMap = Object.fromEntries(Object.entries(binding.valueMap).map(([key, value]) => [key, exportedResourceUrl(value)]));
    }
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
for (const plugin of exportedDescriptor.rendererPlugins ?? []) {
  if (plugin.moduleUrl) plugin.moduleUrl = exportedResourceUrl(plugin.moduleUrl);
}
function exportedImageValue(value, path) {
  if (path.length === 1 && path[0] === ${JSON.stringify(TICKER_FEED_RESOURCE_PATH)}) return exportedTickerFeedResources(value);
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
  resolveExternalData(data, current) { return exportedData(this.filterPublicData(data, current)); }
  load(params) { return super.load({ ...params, data: exportedData(params?.data) }); }
  updateAction(params) { return super.updateAction({ ...params, data: exportedData(params?.data) }); }
  setActionsSchedule(params) {
    return super.setActionsSchedule({ ...params, schedule: Array.isArray(params?.schedule) ? params.schedule.map((scheduled) =>
      scheduled?.action?.type === 'updateAction' ? { ...scheduled, action: { ...scheduled.action, params: { ...scheduled.action.params, data: exportedData(scheduled.action.params?.data) } } } : scheduled
    ) : params?.schedule });
  }
}
if (exportedDescriptor.dataDefaults) exportedDescriptor.dataDefaults = exportedData(exportedDescriptor.dataDefaults);
export default ExportedGraphic;
`;
}

export function packageDescriptorResources(
  composition: Composition,
  descriptor: CompiledGraphicDescriptor,
  namespace = '',
): {
  descriptor: CompiledGraphicDescriptor;
  composition: Composition;
  resources: ExportArtifacts['resources'];
  /** Late-bound Rules payloads use the owner's resource namespace and the target's field paths. */
  packageResourceUri(uri: string): string;
} {
  const packaged = structuredClone(descriptor);
  const packagedComposition = structuredClone(composition);
  const resources: ExportArtifacts['resources'] = Object.entries(RUNTIME_PACKAGE_LICENSES).map(
    ([path, data]) => ({ path, data, base64: false, mimeType: 'text/plain' }),
  );
  for (const plugin of packaged.rendererPlugins ?? []) {
    const directory = `plugins/${plugin.manifest.id}/${plugin.manifest.version}/${plugin.sha256}`;
    plugin.moduleUrl = `${directory}/renderer.js`;
    resources.push(
      { path: plugin.moduleUrl, data: plugin.source, base64: false, mimeType: 'text/javascript' },
      {
        path: `${directory}/LICENSE.txt`,
        data: plugin.licenseText,
        base64: false,
        mimeType: 'text/plain',
      },
    );
  }
  const shaderNotices = new Map<string, string>();
  for (const layer of [
    ...packaged.layers,
    ...(packaged.collections ?? []).flatMap((collection) => collection.prototypeLayers),
  ]) {
    const paints = [
      ...walkElementContents(layer.element)
        .flatMap(getElementShaderPaints)
        .map((entry) => entry.paint),
      ...(layer.element.type === 'ticker'
        ? layer.element.items.flatMap((item) =>
            (item.effects?.stack ?? []).flatMap((effect) => (effect.shader ? [effect.shader] : [])),
          )
        : []),
      ...(layer.element.type === 'ticker' && isShaderPaint(layer.element.background)
        ? [layer.element.background]
        : []),
      ...(layer.effects.stack ?? []).flatMap((effect) => (effect.shader ? [effect.shader] : [])),
    ];
    for (const paint of paints) {
      const provenance = paint.packProvenance;
      if (!provenance) continue;
      const reference = provenance.reference;
      const path = `licenses/shader-packs/${reference.id}/${reference.version}/${reference.sha256}/LICENSE.txt`;
      const previous = shaderNotices.get(path);
      if (previous !== undefined && previous !== provenance.licenseText)
        throw new Error('Copied shader pack notices disagree for the same exact origin.');
      shaderNotices.set(path, provenance.licenseText);
    }
  }
  for (const [path, data] of shaderNotices)
    resources.push({ path, data, base64: false, mimeType: 'text/plain' });
  const pathByDataUri = new Map<string, string>();
  const pathByAssetId = new Map<string, string>();
  let fallbackCounter = 0;
  const pathByOriginalPath = new Map<string, string>();
  const namespaced = (path: string) => (namespace ? `${namespace}/${path}` : path);
  const conflictsWithStudioLicense = (path: string) => {
    const candidate = path.toLowerCase();
    const reserved = STUDIO_RUNTIME_LICENSE_PATH.toLowerCase();
    return (
      candidate === reserved ||
      candidate.startsWith(`${reserved}/`) ||
      reserved.startsWith(`${candidate}/`)
    );
  };

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
    const originalPath = asset.packagePath?.trim() || `assets/${asset.id}.${extension}`;
    const existingPath = pathByDataUri.get(asset.dataUri);
    if (existingPath) {
      pathByAssetId.set(asset.id, existingPath);
      pathByOriginalPath.set(originalPath, existingPath);
      if (asset.licenseText?.trim())
        resources.push({
          path: namespaced(`licenses/${asset.id}-LICENSE.txt`),
          data: asset.licenseText,
          base64: false,
        });
      continue;
    }
    const path = namespaced(originalPath);
    if (conflictsWithStudioLicense(path))
      throw new Error(`Asset path "${path}" conflicts with the Studio runtime license path.`);
    pathByOriginalPath.set(originalPath, path);
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
        path: namespaced(`licenses/${asset.id}-LICENSE.txt`),
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
    if (!uri.startsWith('data:')) return pathByOriginalPath.get(uri) ?? uri;
    const existing = pathByDataUri.get(uri);
    if (existing) return existing;
    const parsed = parseDataUri(uri);
    const registered = composition.assets.find((asset) => asset.dataUri === uri);
    const basename = registered?.id ?? `embedded-${fallbackCounter++}`;
    const extension = EXTENSION_BY_MIME[parsed.mimeType] ?? 'bin';
    const path = namespaced(`assets/${basename}.${extension}`);
    resources.push({ path, data: parsed.data, base64: parsed.base64, mimeType: parsed.mimeType });
    pathByDataUri.set(uri, path);
    return path;
  };

  const packagePaint = (paint: Paint | undefined): Paint | undefined => {
    if (isShaderPaint(paint) && paint.inputImage)
      return {
        ...paint,
        inputImage: { ...paint.inputImage, source: packageUri(paint.inputImage.source) },
      };
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
    layer.element = mapElementContents(layer.element, (element) => {
      if (element.type === 'ticker') {
        if (element.background) element.background = packagePaint(element.background)!;
        for (const item of element.items)
          for (const effect of item.effects?.stack ?? [])
            if (effect.shader) effect.shader = packagePaint(effect.shader) as typeof effect.shader;
      }
      if ('fill' in element && element.fill)
        element.fill = packagePaint(element.fill) as typeof element.fill;
      if (element.type === 'text' && element.strokePaint)
        element.strokePaint = packagePaint(element.strokePaint) as typeof element.strokePaint;
      if (element.type === 'shader' && element.inputImage)
        element.inputImage.source = packageUri(element.inputImage.source);
      if ((element.type === 'image' || element.type === 'audio') && element.src)
        element.src = packageUri(element.src);
      if (element.type === 'image-sequence') element.frames = element.frames.map(packageUri);
      return element;
    });
    if (layer.element.type === 'ticker')
      for (const binding of layer.bindings ?? [])
        if (isElementImageSourceBinding(layer.element, binding.targetProperty) && binding.valueMap)
          binding.valueMap = Object.fromEntries(
            Object.entries(binding.valueMap).map(([key, value]) => [
              key,
              typeof value === 'string' ? packageUri(value) : value,
            ]),
          );
    if ('fill' in layer.element && layer.element.fill)
      layer.element.fill = packagePaint(layer.element.fill) as typeof layer.element.fill;
    if (layer.element.type === 'image') {
      if (layer.element.src) layer.element.src = packageUri(layer.element.src);
      for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : [])) {
        if (binding.targetProperty === 'src' && binding.valueMap)
          binding.valueMap = Object.fromEntries(
            Object.entries(binding.valueMap).map(([key, value]) => [
              key,
              typeof value === 'string' ? packageUri(value) : value,
            ]),
          );
      }
    } else if (layer.element.type === 'audio' && layer.element.src) {
      layer.element.src = packageUri(layer.element.src);
    } else if (layer.element.type === 'image-sequence') {
      layer.element.frames = layer.element.frames.map(packageUri);
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
  const packageBoundValue = (
    value: Composition['dataFields'][number]['defaultValue'],
    path: readonly string[],
  ): typeof value => {
    if (path.length === 1 && path[0] === TICKER_FEED_RESOURCE_PATH)
      return mapTickerFeedResources(value, packageUri) as typeof value;
    if (Array.isArray(value)) return value.map((item) => packageBoundValue(item, path));
    if (!path.length) return typeof value === 'string' ? packageUri(value) : value;
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, path[0]!)) return value;
    const record = value as Record<string, typeof value>;
    return { ...record, [path[0]!]: packageBoundValue(record[path[0]!]!, path.slice(1)) };
  };
  // Image bindings may use a text/file-path field or an object/collection child. Package the
  // actual bound default as well; value-map inputs remain keys, not resource URLs.
  for (const layer of packagedLayers) {
    for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : [])) {
      if (layer.element.type === 'ticker' && binding.targetProperty === 'items') {
        if (binding.valueMap)
          binding.valueMap = Object.fromEntries(
            Object.entries(binding.valueMap).map(([key, value]) => [
              key,
              mapTickerFeedResources(value, packageUri) as typeof value,
            ]),
          );
        else {
          const field = packagedComposition.dataFields.find((item) => item.key === binding.dataKey);
          if (field)
            field.defaultValue = packageBoundValue(field.defaultValue, [
              ...(binding.sourcePath ?? []),
              TICKER_FEED_RESOURCE_PATH,
            ]);
        }
        continue;
      }
      if (!isElementImageSourceBinding(layer.element, binding.targetProperty) || binding.valueMap)
        continue;
      const field = packagedComposition.dataFields.find((item) => item.key === binding.dataKey);
      if (field)
        field.defaultValue = packageBoundValue(field.defaultValue, binding.sourcePath ?? []);
    }
  }
  if (packaged.dataExposure) {
    packaged.sourceDataFields = structuredClone(packagedComposition.dataFields);
    packaged.dataExposure =
      compileDataExposure(packagedComposition.dataFields) ?? packaged.dataExposure;
    packaged.dataDefaults = Object.fromEntries(
      packagedComposition.dataFields.map((field) => [
        field.key,
        fieldValueForExport(field, field.defaultValue),
      ]),
    );
  }
  return {
    descriptor: packaged,
    composition: packagedComposition,
    resources,
    packageResourceUri: packageUri,
  };
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
  const projectErrors = [
    ...projectValidation.errors,
    ...[
      ...sourceDescriptor.layers,
      ...(sourceDescriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
    ].flatMap((layer) =>
      (layer.visualRules ?? []).some(
        (rule) => rule.enabled && rule.actions.some((action) => action.type === 'playout'),
      )
        ? [
            `Layer "${layer.id}" uses Rules playout actions. Export the coordinated template set from Transitions instead of a single template.`,
          ]
        : [],
    ),
    ...[
      ...sourceDescriptor.layers,
      ...(sourceDescriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
    ]
      .filter((layer) => layer.element.type === 'chart' && layer.element.provider == null)
      .map(
        (layer) =>
          `Chart layer "${composition.layers.find((candidate) => candidate.id === layer.id)?.name ?? layer.id}" has no assigned renderer provider. Select a pinned chart plugin before exporting.`,
      ),
  ];
  const errors = [...projectErrors, ...manifestValidation.errors];
  return {
    descriptor: packaged.descriptor,
    nodosInputContract: buildNodosInputContract(packaged.composition),
    manifest,
    manifestFileName: `${manifest.id}.ograf.json`,
    mainJs: generateMainJs(
      packaged.descriptor,
      graphicRuntimeSource,
      packaged.resources.map((resource) => resource.path),
    ),
    resources: packaged.resources,
    projectErrors,
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
    const reserved = STUDIO_RUNTIME_LICENSE_PATH.toLowerCase();
    const candidate = path.toLowerCase();
    if (
      path !== STUDIO_RUNTIME_LICENSE_PATH &&
      (candidate === reserved ||
        candidate.startsWith(`${reserved}/`) ||
        reserved.startsWith(`${candidate}/`))
    )
      errors.push(`Package path "${path}" conflicts with the Studio runtime license path.`);
    uniquePaths.add(path);
  }
  for (const thumbnail of artifacts.manifest.thumbnails ?? []) {
    if (!artifacts.resources.some((resource) => resource.path === thumbnail.file))
      errors.push(`Thumbnail file is missing from the package: "${thumbnail.file}".`);
  }
  return errors;
}
