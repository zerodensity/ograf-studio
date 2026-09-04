import JSZip from 'jszip';
import {
  createAsset,
  createComposition,
  createCustomActionDefinition,
  createFieldDefinition,
  createKeyframe,
  createLayerOfKind,
  createProject,
  createTransition,
  defaultValueForFieldType,
  getResolvedLayerAnimationTracks,
  isProjectSourcePath,
  type Element,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
  type GradientPaint,
  type Layer,
  type Project,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor, OGrafManifest } from '@ograf-editor/ograf-types';
import { validateManifest, validateProject } from '@ograf-editor/validation';

const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const UTF8 = new TextDecoder();
const SUPPORTED_ELEMENTS = new Set<Element['type']>([
  'rectangle',
  'ellipse',
  'text',
  'image',
  'path',
  'image-sequence',
  'lottie',
  'pattern',
]);

type UnknownRecord = Record<string, unknown>;

export type OgrafImportMode = 'embedded-project' | 'compiled-descriptor' | 'manifest-only';

export interface OgrafImportResult {
  project: Project;
  mode: OgrafImportMode;
  manifestFileName: string;
  warnings: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEditableProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Array.isArray(value.compositions) &&
    value.compositions.length > 0
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizePackagePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error(`OGraf package contains an unsafe path: "${path}".`);
  }
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error(`OGraf package path escapes its root: "${path}".`);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function resolvePackagePath(baseDir: string, relativePath: string): string | null {
  const clean = relativePath.split(/[?#]/, 1)[0] ?? '';
  if (!clean || clean.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  return normalizePackagePath(baseDir ? `${baseDir}/${clean}` : clean);
}

function decodeText(bytes: Uint8Array): string {
  return UTF8.decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function mimeTypeForPath(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function fileNameFromPath(path: string): string {
  return path.split('/').at(-1) || 'Imported asset';
}

function parseManifest(text: string, path: string): OGrafManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Cannot parse OGraf manifest "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.id !== 'string' ||
    typeof parsed.name !== 'string' ||
    typeof parsed.main !== 'string'
  ) {
    throw new Error(`"${path}" is not an OGraf manifest with string id, name, and main fields.`);
  }
  return parsed as unknown as OGrafManifest;
}

function findBalancedJsonObject(source: string, start: number): string | null {
  const opening = source.indexOf('{', start);
  if (opening < 0) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = opening; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(opening, index + 1);
    }
  }
  return null;
}

function extractCompiledDescriptor(
  mainJs: string,
  warnings: string[],
): CompiledGraphicDescriptor | null {
  const markers = [
    /\b(?:const|let|var)\s+exportedDescriptor\s*=\s*/g,
    /\bstatic\s+descriptor\s*=\s*/g,
    /\b(?:window|globalThis)\.__OGRAF_DESCRIPTOR__\s*=\s*/g,
  ];
  for (const marker of markers) {
    const match = marker.exec(mainJs);
    if (!match) continue;
    const json = findBalancedJsonObject(mainJs, match.index + match[0].length);
    if (!json) {
      warnings.push(
        'Found an embedded descriptor marker in main.js, but its object was incomplete.',
      );
      continue;
    }
    try {
      const candidate: unknown = JSON.parse(json);
      if (
        isRecord(candidate) &&
        Number.isFinite(candidate.width) &&
        Number.isFinite(candidate.height) &&
        Number.isFinite(candidate.frameRate) &&
        Array.isArray(candidate.layers) &&
        Array.isArray(candidate.keyframes) &&
        Array.isArray(candidate.transitions)
      ) {
        return candidate as unknown as CompiledGraphicDescriptor;
      }
      warnings.push(
        'Found descriptor-shaped JSON in main.js, but required dimensions/lists were missing.',
      );
    } catch {
      warnings.push('Found an embedded descriptor marker in main.js, but it was not strict JSON.');
    }
  }
  return null;
}

function numberFromConstraint(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (!isRecord(value)) return fallback;
  for (const key of ['exact', 'ideal', 'max', 'min']) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0)
      return candidate;
  }
  return fallback;
}

function inferCompositionSettings(manifest: OGrafManifest) {
  const requirement = manifest.renderRequirements?.[0];
  return {
    width: numberFromConstraint(requirement?.resolution?.width, 1920),
    height: numberFromConstraint(requirement?.resolution?.height, 1080),
    frameRate: numberFromConstraint(requirement?.frameRate, 25),
  };
}

function isGradient(value: unknown): value is GradientPaint {
  return (
    isRecord(value) &&
    (value.type === 'linear' || value.type === 'radial' || value.type === 'conic') &&
    typeof value.angle === 'number' &&
    Array.isArray(value.stops)
  );
}

function inferFieldType(key: string, schema: UnknownRecord): FieldType {
  const declared = Array.isArray(schema.type)
    ? schema.type.find((item): item is string => typeof item === 'string' && item !== 'null')
    : schema.type;
  const defaultValue = schema.default;
  const gddType = typeof schema.gddType === 'string' ? schema.gddType : '';
  const hint = `${key} ${typeof schema.title === 'string' ? schema.title : ''}`.toLowerCase();
  if (gddType === 'select') return 'select';
  if (gddType === 'select-multiple') return 'select-multiple';
  if (gddType === 'duration-ms') return 'duration-ms';
  if (gddType === 'percentage') return 'percentage';
  if (gddType === 'file-path') return 'file-path';
  if (gddType === 'file-path/image-path') return 'image-url';
  if (gddType === 'single-line') return 'text';
  if (gddType === 'multi-line') return 'textarea';
  if (gddType === 'color-rrggbb' || gddType === 'color-rrggbbaa') return 'color';
  if (declared === 'boolean') return 'boolean';
  if (declared === 'integer') return 'integer';
  if (declared === 'number') return 'number';
  if (declared === 'object' && (isGradient(defaultValue) || isRecord(schema.properties))) {
    const properties = schema.properties;
    if (isRecord(properties) && 'stops' in properties && 'angle' in properties) return 'gradient';
  }
  if (declared === 'object') return 'object';
  if (declared === 'array') return 'array';
  if (
    schema.format === 'uri' ||
    schema.format === 'uri-reference' ||
    /image|logo|photo|src|url/.test(hint)
  ) {
    return 'image-url';
  }
  if (
    schema.format === 'color' ||
    (typeof defaultValue === 'string' && /^#[0-9a-f]{3,8}$/i.test(defaultValue))
  ) {
    return 'color';
  }
  if (
    schema.format === 'textarea' ||
    (typeof defaultValue === 'string' && defaultValue.includes('\n'))
  ) {
    return 'textarea';
  }
  return 'text';
}

function coerceFieldDefault(
  type: FieldType,
  value: unknown,
  key: string,
  warnings: string[],
): FieldValue {
  if (value === undefined) return defaultValueForFieldType(type);
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (
    ['number', 'integer', 'duration-ms', 'percentage'].includes(type) &&
    typeof value === 'number' &&
    Number.isFinite(value)
  )
    return value;
  if (type === 'gradient' && isGradient(value)) return clone(value);
  if (type === 'object' && isRecord(value)) return clone(value) as FieldValue;
  if (type === 'array' && Array.isArray(value)) return clone(value) as FieldValue;
  if (
    (type === 'text' ||
      type === 'textarea' ||
      type === 'color' ||
      type === 'image-url' ||
      type === 'file-path' ||
      type === 'select') &&
    typeof value === 'string'
  ) {
    return value;
  }
  if (
    type === 'select-multiple' &&
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string')
  ) {
    return [...value];
  }
  warnings.push(
    `Data field "${key}" had a default the editor cannot represent exactly; it was converted to text.`,
  );
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fieldsFromManifest(manifest: OGrafManifest, warnings: string[]): FieldDefinition[] {
  if (!isRecord(manifest.schema) || !isRecord(manifest.schema.properties)) return [];
  const required = new Set(
    Array.isArray(manifest.schema.required)
      ? manifest.schema.required.filter((item): item is string => typeof item === 'string')
      : [],
  );
  const fieldFromSchema = (
    key: string,
    value: UnknownRecord,
    required: boolean,
  ): FieldDefinition => {
    const type = inferFieldType(key, value);
    const nestedRequired = new Set(
      Array.isArray(value.required)
        ? value.required.filter((item): item is string => typeof item === 'string')
        : [],
    );
    const properties =
      type === 'object' && isRecord(value.properties)
        ? Object.entries(value.properties).flatMap(([propertyKey, property]) =>
            isRecord(property)
              ? [fieldFromSchema(propertyKey, property, nestedRequired.has(propertyKey))]
              : [],
          )
        : [];
    const items =
      type === 'array' && isRecord(value.items)
        ? fieldFromSchema('item', value.items, true)
        : undefined;
    return createFieldDefinition(type, {
      key,
      label: typeof value.title === 'string' ? value.title : key,
      description: typeof value.description === 'string' ? value.description : '',
      defaultValue: coerceFieldDefault(type, value.default, key, warnings),
      required,
      options: (() => {
        const enumerated =
          type === 'select-multiple' && isRecord(value.items) && Array.isArray(value.items.enum)
            ? value.items.enum
            : Array.isArray(value.enum)
              ? value.enum
              : [];
        const labels =
          isRecord(value.gddOptions) && isRecord(value.gddOptions.labels)
            ? value.gddOptions.labels
            : {};
        return enumerated
          .filter((item): item is string => typeof item === 'string')
          .map((option) => ({
            value: option,
            label: typeof labels[option] === 'string' ? labels[option] : option,
          }));
      })(),
      constraints: {
        ...(Number.isInteger(value.minLength) ? { minLength: Number(value.minLength) } : {}),
        ...(Number.isInteger(value.maxLength) ? { maxLength: Number(value.maxLength) } : {}),
        ...(typeof value.minimum === 'number' ? { minimum: value.minimum } : {}),
        ...(typeof value.maximum === 'number' ? { maximum: value.maximum } : {}),
        ...(typeof value.pattern === 'string' ? { pattern: value.pattern } : {}),
        ...(typeof value.multipleOf === 'number' ? { step: value.multipleOf } : {}),
        ...(Number.isInteger(value.minItems) ? { minItems: Number(value.minItems) } : {}),
        ...(Number.isInteger(value.maxItems) ? { maxItems: Number(value.maxItems) } : {}),
      },
      fileExtensions:
        isRecord(value.gddOptions) && Array.isArray(value.gddOptions.extensions)
          ? value.gddOptions.extensions.filter(
              (extension): extension is string => typeof extension === 'string',
            )
          : [],
      properties,
      ...(items ? { items } : {}),
    });
  };

  const fields: FieldDefinition[] = [];
  for (const [key, value] of Object.entries(manifest.schema.properties)) {
    if (!isRecord(value)) {
      warnings.push(`Data schema property "${key}" was not an object and was skipped.`);
      continue;
    }
    fields.push(fieldFromSchema(key, value, required.has(key)));
  }
  return fields;
}

function durationToFrames(
  milliseconds: number | undefined,
  frameRate: number,
  warnings: string[],
): number {
  if (milliseconds === undefined) return 12;
  if (milliseconds < 0) {
    warnings.push('A dynamic action duration (-1) was approximated as 12 frames.');
    return 12;
  }
  return Math.max(0, Math.round((milliseconds / 1000) * frameRate));
}

function lifecycleFromManifest(manifest: OGrafManifest, frameRate: number, warnings: string[]) {
  let stepCount = Number.isInteger(manifest.stepCount) ? (manifest.stepCount ?? 1) : 1;
  if (stepCount < 0) {
    warnings.push('The manifest declares a dynamic step count; one editable Step was created.');
    stepCount = 1;
  }
  if (stepCount > 100)
    warnings.push(`The manifest declares ${stepCount} Steps; import was capped at 100.`);
  stepCount = Math.min(stepCount, 100);
  const keyframes = [createKeyframe({ name: 'Start', role: 'start' })];
  for (let step = 0; step < stepCount; step += 1) {
    keyframes.push(createKeyframe({ name: `Step ${step + 1}`, role: 'step' }));
  }
  keyframes.push(createKeyframe({ name: 'End', role: 'end' }));

  const playDuration = manifest.actionDurations?.find((entry) => entry.type === 'playAction');
  const stopDuration = manifest.actionDurations?.find((entry) => entry.type === 'stopAction');
  const transitions = keyframes.slice(1).map((keyframe, index) => {
    const destinationRole = keyframe.role;
    let milliseconds: number | undefined;
    if (destinationRole === 'step' && playDuration?.type === 'playAction') {
      const step = index;
      milliseconds =
        playDuration.steps?.find((entry) => entry.step === step)?.duration ??
        playDuration.steps?.find((entry) => entry.step === undefined)?.duration ??
        playDuration.duration;
    } else if (destinationRole === 'end' && stopDuration?.type === 'stopAction') {
      milliseconds = stopDuration.duration;
    }
    return createTransition(keyframes[index]!.id, keyframe.id, {
      durationFrames: durationToFrames(milliseconds, frameRate, warnings),
      easing: 'linear',
    });
  });
  return { keyframes, transitions };
}

function lifecycleFromDescriptor(descriptor: CompiledGraphicDescriptor) {
  const ordered = [...descriptor.keyframes].sort((left, right) => left.frame - right.frame);
  let step = 0;
  const keyframes = ordered.map((keyframe) => {
    const name =
      keyframe.role === 'start' ? 'Start' : keyframe.role === 'end' ? 'End' : `Step ${(step += 1)}`;
    return createKeyframe({ id: keyframe.id, name, role: keyframe.role });
  });
  const transitions = descriptor.transitions.map((transition) =>
    createTransition(transition.fromKeyframeId, transition.toKeyframeId, {
      durationFrames: Math.max(0, Math.round(transition.durationFrames)),
      easing: transition.easing,
    }),
  );
  return { keyframes, transitions };
}

function nameForLayer(layer: UnknownRecord, element: Element, index: number): string {
  if (typeof layer.name === 'string' && layer.name.trim()) return layer.name;
  if (element.type === 'text' && element.content.trim()) {
    return element.content.trim().replace(/\s+/g, ' ').slice(0, 40);
  }
  const label = element.type
    .split('-')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
  return `${label} ${index + 1}`;
}

function fieldTypeForBinding(targetProperty: string, element: Element): FieldType {
  if (targetProperty === 'src') return 'image-url';
  if (targetProperty === 'fill') {
    const fill = 'fill' in element ? element.fill : '';
    return typeof fill === 'string' ? 'color' : 'gradient';
  }
  if (targetProperty === 'color') return 'color';
  return 'text';
}

function currentBoundValue(targetProperty: string, element: Element, type: FieldType): FieldValue {
  const value = (element as unknown as UnknownRecord)[targetProperty];
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string')) ||
    isGradient(value)
  ) {
    return clone(value);
  }
  return defaultValueForFieldType(type);
}

function isSupportedElement(value: unknown): value is Element {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    SUPPORTED_ELEMENTS.has(value.type as Element['type'])
  );
}

function importCustomActions(manifest: OGrafManifest) {
  return (manifest.customActions ?? []).map((action) =>
    createCustomActionDefinition({
      actionId: action.id,
      name: action.name,
      description: action.description ?? '',
    }),
  );
}

function projectFromManifest(
  manifest: OGrafManifest,
  dataFields: FieldDefinition[],
  entries: Map<string, Uint8Array>,
  manifestPath: string,
  warnings: string[],
): Project {
  const settings = inferCompositionSettings(manifest);
  const lifecycle = lifecycleFromManifest(manifest, settings.frameRate, warnings);
  const assets: ReturnType<typeof createAsset>[] = [];
  const resolveAsset = makeAssetResolver(entries, assets, warnings);
  const manifestDirectory = dirname(manifestPath);
  const resolveFieldDefaultAssets = (field: FieldDefinition, value: FieldValue): FieldValue => {
    if (field.type === 'image-url' && typeof value === 'string') {
      return resolveAsset(value, manifestDirectory);
    }
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, FieldValue>;
      return Object.fromEntries(
        Object.entries(record).map(([key, childValue]) => {
          const child = field.properties.find((property) => property.key === key);
          return [key, child ? resolveFieldDefaultAssets(child, childValue) : childValue];
        }),
      );
    }
    if (field.type === 'array' && field.items && Array.isArray(value)) {
      return value.map((item) => resolveFieldDefaultAssets(field.items!, item));
    }
    return value;
  };
  for (const field of dataFields) {
    field.defaultValue = resolveFieldDefaultAssets(field, field.defaultValue);
  }
  for (const thumbnail of manifest.thumbnails ?? [])
    resolveAsset(thumbnail.file, manifestDirectory);
  const composition = createComposition({
    name: manifest.name,
    ...settings,
    keyframes: lifecycle.keyframes,
    transitions: lifecycle.transitions,
    dataFields,
    customActions: importCustomActions(manifest),
    assets,
  });
  for (const layer of composition.layers)
    if (layer.element.type === 'pattern') delete layer.element.definition;
  return createProject({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? '',
    version: manifest.version ?? '0.1.0',
    author: manifest.author ? clone(manifest.author) : { name: '' },
    supportsRealTime: manifest.supportsRealTime,
    supportsNonRealTime: manifest.supportsNonRealTime,
    mainCompositionId: composition.id,
    compositions: [composition],
  });
}

function addManifestValidationWarnings(manifest: OGrafManifest, warnings: string[]) {
  const validation = validateManifest(manifest);
  for (const error of validation.errors.slice(0, 12))
    warnings.push(`Manifest validation: ${error}`);
  if (validation.errors.length > 12) {
    warnings.push(
      `Manifest validation reported ${validation.errors.length - 12} additional errors.`,
    );
  }
}

function importEmbeddedProject(entries: Map<string, Uint8Array>): Project | null {
  const candidates = [...entries.keys()].filter((path) => isProjectSourcePath(path));
  for (const path of candidates) {
    try {
      const parsed: unknown = JSON.parse(decodeText(entries.get(path)!));
      if (isEditableProject(parsed)) return parsed;
    } catch {
      // Continue to compiled-descriptor recovery when an optional embedded source is malformed.
    }
  }
  return null;
}

function makeAssetResolver(
  entries: Map<string, Uint8Array>,
  assets: ReturnType<typeof createAsset>[],
  warnings: string[],
) {
  const referenceBySource = new Map<string, string>();
  return (source: string, baseDir: string): string => {
    if (!source) return source;
    const existing = referenceBySource.get(source);
    if (existing) return existing;
    if (source.startsWith('data:')) {
      const mimeType = /^data:([^;,]+)/.exec(source)?.[1] ?? 'application/octet-stream';
      const asset = createAsset({
        name: `Imported asset ${assets.length + 1}`,
        dataUri: source,
        mimeType,
      });
      assets.push(asset);
      const reference = `asset:${asset.id}`;
      referenceBySource.set(source, reference);
      return reference;
    }
    if (
      source.startsWith('asset:') ||
      source.startsWith('//') ||
      /^[a-z][a-z0-9+.-]*:/i.test(source)
    ) {
      return source;
    }
    let path: string;
    try {
      const resolved = resolvePackagePath(baseDir, source);
      if (!resolved) return source;
      path = resolved;
    } catch {
      warnings.push(`Resource path "${source}" was unsafe and was left unchanged.`);
      return source;
    }
    const bytes = entries.get(path);
    if (!bytes) {
      warnings.push(`Referenced resource "${path}" was not present in the selected package.`);
      return source;
    }
    const mimeType = mimeTypeForPath(path);
    if (!mimeType.startsWith('image/')) {
      warnings.push(
        `Resource "${path}" is not a supported editor image asset and was left unchanged.`,
      );
      return source;
    }
    const dataUri = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
    const asset = createAsset({ name: fileNameFromPath(path), dataUri, mimeType });
    assets.push(asset);
    const reference = `asset:${asset.id}`;
    referenceBySource.set(source, reference);
    referenceBySource.set(path, reference);
    return reference;
  };
}

function projectFromDescriptor(
  manifest: OGrafManifest,
  descriptor: CompiledGraphicDescriptor,
  entries: Map<string, Uint8Array>,
  manifestPath: string,
  mainPath: string,
  dataFields: FieldDefinition[],
  warnings: string[],
): Project {
  const lifecycle = lifecycleFromDescriptor(descriptor);
  const assets: ReturnType<typeof createAsset>[] = [];
  const resolveAsset = makeAssetResolver(entries, assets, warnings);
  const fieldByKey = new Map(dataFields.map((field) => [field.key, field]));
  const layers: Layer[] = [];
  const mainDirectory = dirname(mainPath);
  const manifestDirectory = dirname(manifestPath);
  const ordinaryById = new Map(descriptor.layers.map((layer) => [layer.id, layer]));
  const collectionsById = new Map(
    (descriptor.collections ?? []).map((collection) => [collection.id, collection]),
  );
  const compiledEntries: Array<{
    compiled: CompiledGraphicDescriptor['layers'][number];
    collectionId?: string;
    prototypeGroupId?: string | null;
  }> = [];
  const paintOrder = descriptor.paintOrder ?? [
    ...descriptor.layers.map((layer) => ({ type: 'layer' as const, id: layer.id })),
    ...(descriptor.collections ?? []).map((collection) => ({
      type: 'collection' as const,
      id: collection.id,
    })),
  ];
  for (const entry of paintOrder) {
    if (entry.type === 'layer') {
      const compiled = ordinaryById.get(entry.id);
      if (compiled) compiledEntries.push({ compiled });
      continue;
    }
    const collection = collectionsById.get(entry.id);
    if (!collection) continue;
    compiledEntries.push(
      ...collection.prototypeLayers.map((compiled) => ({
        compiled,
        collectionId: collection.id,
        prototypeGroupId: collection.prototypeGroupId,
      })),
    );
  }

  for (const [index, entry] of compiledEntries.entries()) {
    const { compiled } = entry;
    const raw = compiled as unknown as UnknownRecord;
    if (!isSupportedElement(compiled.element)) {
      warnings.push(
        `Layer ${index + 1} uses unsupported element type "${String((compiled.element as unknown as UnknownRecord)?.type)}" and was skipped.`,
      );
      continue;
    }
    const element = clone(compiled.element);
    if (element.type === 'image' && element.src)
      element.src = resolveAsset(element.src, mainDirectory);
    if (element.type === 'image-sequence') {
      element.frames = element.frames.map((frame) => resolveAsset(frame, mainDirectory));
    }
    const layer = createLayerOfKind(element.type);
    layer.id = compiled.id;
    layer.name = nameForLayer(raw, element, index);
    layer.isVisible = compiled.isVisible;
    layer.isMaskOnly = compiled.isMaskOnly ?? false;
    layer.mask = compiled.mask ? { ...compiled.mask } : null;
    layer.blendMode = compiled.blendMode ?? 'normal';
    if (entry.collectionId) {
      layer.groupId = entry.prototypeGroupId ?? `${entry.collectionId}-prototype`;
    }
    layer.element = { ...layer.element, ...element } as Element;
    layer.effects = { ...layer.effects, ...clone(compiled.effects) };
    layer.keyframes = clone(compiled.keyframes);
    layer.animationTracks = clone(compiled.animationTracks);
    if (layer.element.type === 'text' && !layer.animationTracks.strokeWidth?.length) {
      layer.animationTracks.strokeWidth =
        getResolvedLayerAnimationTracks(layer).strokeWidth?.map((key) => ({ ...key })) ?? [];
    }
    layer.loop = compiled.loop ? clone(compiled.loop) : null;
    if (compiled.lighting) {
      const { definition: _definition, ...link } = compiled.lighting;
      layer.lighting = clone(link);
    }
    const compiledBindings = compiled.bindings ?? (compiled.binding ? [compiled.binding] : []);
    for (const binding of compiledBindings) {
      let field = fieldByKey.get(binding.dataKey);
      if (!field) {
        const type = fieldTypeForBinding(binding.targetProperty, element);
        field = createFieldDefinition(type, {
          key: binding.dataKey,
          label: binding.dataKey,
          defaultValue: currentBoundValue(binding.targetProperty, element, type),
        });
        dataFields.push(field);
        fieldByKey.set(field.key, field);
        warnings.push(
          `Binding data key "${field.key}" was absent from the manifest schema; an editable field was inferred.`,
        );
      }
      layer.bindings.push({
        fieldId: field.id,
        targetProperty: binding.targetProperty,
        ...(binding.sourcePath?.length ? { sourcePath: [...binding.sourcePath] } : {}),
        ...(binding.valueMap ? { valueMap: clone(binding.valueMap) } : {}),
      });
    }
    if (compiled.clipParentId) layer.parentId = compiled.clipParentId;
    layers.push(layer);
  }

  for (const layer of layers) {
    if (!layer.parentId) continue;
    const parent = layers.find((candidate) => candidate.id === layer.parentId);
    if (parent) parent.clipChildren = true;
    else {
      warnings.push(
        `Layer "${layer.name}" referenced missing clip parent "${layer.parentId}"; clipping was removed.`,
      );
      layer.parentId = null;
    }
  }

  for (const field of dataFields) {
    if (field.type === 'image-url' && typeof field.defaultValue === 'string') {
      field.defaultValue = resolveAsset(field.defaultValue, manifestDirectory);
    }
  }
  for (const thumbnail of manifest.thumbnails ?? [])
    resolveAsset(thumbnail.file, manifestDirectory);

  const runtimeCollections = (descriptor.collections ?? []).flatMap((collection) => {
    const field = fieldByKey.get(collection.dataKey);
    if (!field || field.type !== 'array' || field.items?.type !== 'object') {
      warnings.push(
        `Runtime collection "${collection.name}" could not be restored because its object-item array field is missing.`,
      );
      return [];
    }
    field.constraints = { ...field.constraints, maxItems: collection.capacity };
    return [
      {
        id: collection.id,
        name: collection.name,
        fieldId: field.id,
        prototypeLayerIds: collection.prototypeLayers.map((layer) => layer.id),
        offsetPerItem: { ...collection.offsetPerItem },
        capacity: collection.capacity,
        overflow: collection.overflow,
      },
    ];
  });

  const composition = createComposition({
    name: manifest.name,
    width: descriptor.width,
    height: descriptor.height,
    frameRate: descriptor.frameRate,
    backgroundColor: descriptor.backgroundColor,
    layers,
    keyframes: lifecycle.keyframes,
    transitions: lifecycle.transitions,
    dataFields,
    runtimeCollections,
    patterns: [
      ...new Map([
        ...compiledEntries.flatMap(({ compiled }) =>
          compiled.lighting?.definition
            ? [[compiled.lighting.definition.id, clone(compiled.lighting.definition)] as const]
            : [],
        ),
        ...layers.flatMap((layer) =>
          layer.element.type === 'pattern' && layer.element.definition
            ? [[layer.element.definition.id, layer.element.definition] as const]
            : [],
        ),
      ]).values(),
    ],
    customActions: importCustomActions(manifest),
    assets,
  });
  for (const layer of composition.layers)
    if (layer.element.type === 'pattern') delete layer.element.definition;
  return createProject({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? '',
    version: manifest.version ?? '0.1.0',
    author: manifest.author ? clone(manifest.author) : { name: '' },
    supportsRealTime: manifest.supportsRealTime,
    supportsNonRealTime: manifest.supportsNonRealTime,
    mainCompositionId: composition.id,
    compositions: [composition],
  });
}

async function entriesFromZip(data: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(data);
  const entries = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const path = normalizePackagePath(entry.name);
    const bytes = await entry.async('uint8array');
    total += bytes.byteLength;
    if (total > MAX_PACKAGE_BYTES)
      throw new Error('OGraf package expands beyond the 128 MB import limit.');
    if (entries.has(path)) throw new Error(`OGraf package contains duplicate file "${path}".`);
    entries.set(path, bytes);
  }
  return entries;
}

async function importEntries(entries: Map<string, Uint8Array>): Promise<OgrafImportResult> {
  const manifestPaths = [...entries.keys()].filter((path) => /\.ograf\.json$/i.test(path));
  if (manifestPaths.length === 0) throw new Error('No *.ograf.json manifest was found.');
  if (manifestPaths.length > 1) {
    throw new Error(
      `The selection contains multiple OGraf manifests: ${manifestPaths.join(', ')}.`,
    );
  }
  const manifestPath = manifestPaths[0]!;
  const manifest = parseManifest(decodeText(entries.get(manifestPath)!), manifestPath);
  const warnings: string[] = [];
  addManifestValidationWarnings(manifest, warnings);

  const embedded = importEmbeddedProject(entries);
  if (embedded) {
    warnings.push(
      'The package contained editable .ogs source; it was preferred over reverse conversion.',
    );
    return finalizeImport({
      project: embedded,
      mode: 'embedded-project',
      manifestFileName: manifestPath,
      warnings,
    });
  }

  const dataFields = fieldsFromManifest(manifest, warnings);
  const manifestDirectory = dirname(manifestPath);
  let mainPath = '';
  try {
    mainPath = resolvePackagePath(manifestDirectory, manifest.main) ?? '';
  } catch {
    warnings.push(`Manifest main path "${manifest.main}" is unsafe.`);
  }
  const mainBytes = mainPath ? entries.get(mainPath) : undefined;
  if (!mainBytes) {
    warnings.push(
      `The manifest entry module "${manifest.main}" was not selected; only manifest metadata was imported.`,
    );
  }
  const descriptor = mainBytes ? extractCompiledDescriptor(decodeText(mainBytes), warnings) : null;
  if (descriptor) {
    const project = projectFromDescriptor(
      manifest,
      descriptor,
      entries,
      manifestPath,
      mainPath,
      dataFields,
      warnings,
    );
    warnings.push(
      'Layer names and authoring-only groups, guides, constraints, and unlocked state are not present in compiled OGraf output and were reconstructed with defaults.',
    );
    return finalizeImport({
      project,
      mode: 'compiled-descriptor',
      manifestFileName: manifestPath,
      warnings,
    });
  }

  warnings.push(
    'No compatible editable descriptor was found in main.js. Manifest metadata, lifecycle hints, schema fields, and custom actions were imported, but opaque JavaScript visual layers were not executed or reverse-engineered.',
  );
  return finalizeImport({
    project: projectFromManifest(manifest, dataFields, entries, manifestPath, warnings),
    mode: 'manifest-only',
    manifestFileName: manifestPath,
    warnings,
  });
}

function finalizeImport(result: OgrafImportResult): OgrafImportResult {
  const validation = validateProject(result.project);
  for (const error of validation.errors)
    result.warnings.push(`Converted project validation: ${error}`);
  for (const warning of validation.warnings)
    result.warnings.push(`Converted project warning: ${warning}`);
  return result;
}

/** Pure import entry used by tests and non-picker callers. */
export async function importOgrafData(
  fileName: string,
  data: ArrayBuffer | Uint8Array | string,
): Promise<OgrafImportResult> {
  if (/\.zip$/i.test(fileName)) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return importEntries(await entriesFromZip(bytes));
  }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return importEntries(new Map([[normalizePackagePath(fileName), bytes]]));
}

async function importSelectedFiles(files: readonly File[]): Promise<OgrafImportResult> {
  if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) {
    return importOgrafData(files[0]!.name, await files[0]!.arrayBuffer());
  }
  const entries = new Map<string, Uint8Array>();
  let total = 0;
  for (const file of files) {
    const path = normalizePackagePath(file.webkitRelativePath || file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    total += bytes.byteLength;
    if (total > MAX_PACKAGE_BYTES)
      throw new Error('Selected OGraf files exceed the 128 MB import limit.');
    entries.set(path, bytes);
  }
  return importEntries(entries);
}

function importViaInputFallback(): Promise<OgrafImportResult | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.ograf.zip,.zip,.ograf.json,.json,.js,.png,.jpg,.jpeg,.gif,.webp,.svg';
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) resolve(null);
      else importSelectedFiles(files).then(resolve).catch(reject);
    };
    input.click();
  });
}

/** Selects an OGraf ZIP, or a manifest plus its companion files, and recovers an editable project. */
export async function importEditableProjectFromOgraf(): Promise<OgrafImportResult | null> {
  // A normal file input works in every supported browser and allows ZIPs or multi-selected loose
  // package files without relying on the less portable File System Access API.
  return importViaInputFallback();
}
