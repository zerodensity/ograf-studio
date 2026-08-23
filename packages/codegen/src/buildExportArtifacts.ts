import type { CompiledGraphicDescriptor, OGrafManifest } from '@ograf-editor/ograf-types';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { validateManifest, validateProject } from '@ograf-editor/validation';
import { assembleManifest } from './assembleManifest';
import { compileDescriptor } from './compileDescriptor';

export interface ExportArtifacts {
  manifest: OGrafManifest;
  manifestFileName: string;
  mainJs: string;
  resources: Array<{ path: string; data: string; base64: boolean }>;
  projectErrors: string[];
  manifestErrors: string[];
  valid: boolean;
  errors: string[];
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
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
): string {
  return `${graphicRuntimeSource}
const exportedDescriptor = ${JSON.stringify(descriptor)};
const exportedModuleBaseUrl = import.meta.url.startsWith('blob:') ? document.baseURI : import.meta.url;
for (const layer of exportedDescriptor.layers) {
  if (layer.element.type === 'image' && layer.element.src?.startsWith('assets/')) {
    layer.element.src = new URL(layer.element.src, exportedModuleBaseUrl).href;
  } else if (layer.element.type === 'image-sequence') {
    layer.element.frames = layer.element.frames.map((frame) =>
      frame.startsWith('assets/') ? new URL(frame, exportedModuleBaseUrl).href : frame
    );
  }
}
for (const font of exportedDescriptor.fonts ?? []) {
  if (font.source?.startsWith('assets/')) {
    font.source = new URL(font.source, exportedModuleBaseUrl).href;
  }
}
class ExportedGraphic extends GraphicElement {
  static descriptor = exportedDescriptor;
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
  const pathByDataUri = new Map<string, string>();
  const pathByAssetId = new Map<string, string>();
  let fallbackCounter = 0;

  const parseDataUri = (uri: string) => {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri);
    if (!match) throw new Error('Cannot package a malformed data URI resource.');
    return { mimeType: match[1]!, base64: match[2] === ';base64', data: match[3]! };
  };

  for (const asset of composition.assets) {
    const parsed = parseDataUri(asset.dataUri);
    const extension = EXTENSION_BY_MIME[asset.mimeType || parsed.mimeType] ?? 'bin';
    const path = `assets/${asset.id}.${extension}`;
    resources.push({ path, data: parsed.data, base64: parsed.base64 });
    pathByAssetId.set(asset.id, path);
    pathByDataUri.set(asset.dataUri, path);
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
    resources.push({ path, data: parsed.data, base64: parsed.base64 });
    pathByDataUri.set(uri, path);
    return path;
  };

  for (const layer of packaged.layers) {
    if (layer.element.type === 'image' && layer.element.src) {
      layer.element.src = packageUri(layer.element.src);
    } else if (layer.element.type === 'image-sequence') {
      layer.element.frames = layer.element.frames.map(packageUri);
    }
  }
  for (const font of packaged.fonts ?? []) {
    font.source = packageUri(font.source);
  }
  for (const field of packagedComposition.dataFields) {
    if (field.type === 'image-url' && typeof field.defaultValue === 'string') {
      field.defaultValue = packageUri(field.defaultValue);
    }
  }
  return { descriptor: packaged, composition: packagedComposition, resources };
}

/** Shared exact-artifact compiler used by the editor and the MCP authoring host. */
export function buildExportArtifactsWithRuntime(
  project: Project,
  composition: Composition,
  graphicRuntimeSource: string,
): ExportArtifacts {
  const sourceDescriptor = compileDescriptor(composition);
  const packaged = packageDescriptorResources(composition, sourceDescriptor);
  const manifest = assembleManifest(project, packaged.composition, packaged.descriptor);
  const projectValidation = validateProject(project);
  const manifestValidation = validateManifest(manifest);
  const errors = [...projectValidation.errors, ...manifestValidation.errors];
  return {
    manifest,
    manifestFileName: `${manifest.id}.ograf.json`,
    mainJs: generateMainJs(packaged.descriptor, graphicRuntimeSource),
    resources: packaged.resources,
    projectErrors: projectValidation.errors,
    manifestErrors: manifestValidation.errors,
    valid: errors.length === 0,
    errors,
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
  return errors;
}
