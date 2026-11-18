import {
  createId,
  isMediaPaint,
  isShaderPaint,
  walkElementContents,
  type Asset,
  type Composition,
  type DesignSystem,
  type Element,
  type FieldDefinition,
  type FieldValue,
  type Layer,
  type LayerEffects,
  type MediaPaintSource,
  type Project,
} from '@ograf-editor/scene-model';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import { projectFontFamily } from './projectFonts';
import type { ProjectSetDocument } from './projectSet';

function localizeComponents(composition: Composition, destinationIds: ReadonlySet<string>) {
  const byId = new Map(composition.components.map((component) => [component.id, component]));
  const kept = new Set(composition.components.filter(({ scope }) => scope !== 'set'));
  const pending = [...composition.layers, ...[...kept].flatMap((component) => component.layers)];
  while (pending.length) {
    const link = pending.pop()!.componentLink;
    if (!link) continue;
    const source = byId.get(link.componentId);
    if (!source || kept.has(source)) continue;
    kept.add(source);
    pending.push(...source.layers);
  }
  const renamed = new Map<string, string>();
  composition.components = composition.components
    .filter((component) => kept.has(component))
    .map((component) => {
      if (component.scope !== 'set' && !destinationIds.has(component.id)) return component;
      const id = createId('component');
      renamed.set(component.id, id);
      return { ...structuredClone(component), id, scope: 'local' };
    });
  for (const layer of [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ]) {
    const link = layer.componentLink;
    const id = link && renamed.get(link.componentId);
    if (link && id) link.componentId = id;
  }
}

function compositionAssets(composition: Composition): Asset[] {
  return [
    ...composition.assets,
    ...composition.components.flatMap((component) => component.resources ?? []),
  ];
}

function familyKey(family: string): string {
  return family
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .toLowerCase();
}

function fontWeightRange(asset: Asset): readonly [number, number] {
  const values = (asset.fontWeight || '100 900')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((value) => (value === 'normal' ? 400 : value === 'bold' ? 700 : Number(value)));
  const [min, max = min] = values;
  // An unrecognized descriptor cannot establish that faces are distinct.
  if (values.length > 2 || !min || !max || min < 1 || max > 1000 || min > max) return [1, 1000];
  return [min, max];
}

function fontFacesConflict(source: Asset, destination: Asset): boolean {
  if (
    source.dataUri === destination.dataUri ||
    (source.fontStyle || 'normal') !== (destination.fontStyle || 'normal')
  )
    return false;
  const [sourceMin, sourceMax] = fontWeightRange(source);
  const [destinationMin, destinationMax] = fontWeightRange(destination);
  return sourceMin <= destinationMax && destinationMin <= sourceMax;
}

function renameFontFamilies(incoming: Asset[], destination: Asset[]): Map<string, string> {
  const destinationFaces = new Map<string, Asset[]>();
  for (const asset of destination) {
    if (asset.kind !== 'font') continue;
    const family = familyKey(projectFontFamily(asset));
    const faces = destinationFaces.get(family) ?? [];
    faces.push(asset);
    destinationFaces.set(family, faces);
  }
  const families = new Map<string, string>();
  for (const asset of incoming) {
    if (asset.kind !== 'font') continue;
    const family = familyKey(projectFontFamily(asset));
    const faces = destinationFaces.get(family);
    if (!families.has(family) && faces?.some((face) => fontFacesConflict(asset, face)))
      families.set(family, createId('ograf-local-font'));
  }
  return families;
}

function rewriteReferences(
  project: Project,
  assets: ReadonlyMap<string, string>,
  patterns: ReadonlyMap<string, string>,
  fonts: ReadonlyMap<string, string>,
) {
  const reference = (value: string) => assets.get(value) ?? value;
  const fontStack = (value: string) =>
    fonts.size
      ? value.replace(
          /(?:[^,'"]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')+/g,
          (family) => fonts.get(familyKey(family)) ?? family,
        )
      : value;
  const mediaSource = (source: MediaPaintSource) => {
    if (source.kind === 'clip') source.src = reference(source.src);
    else if (source.fallback) source.fallback = reference(source.fallback);
  };
  const paint = (value: unknown) => {
    if (isMediaPaint(value)) mediaSource(value.source);
    else if (isShaderPaint(value) && value.inputImage)
      value.inputImage.source = reference(value.inputImage.source);
  };
  const cues = (items: Composition['mediaCues'] = []) => {
    for (const cue of items) cue.sources.forEach(mediaSource);
  };
  const effects = (value: LayerEffects | undefined) => {
    for (const entry of value?.stack ?? []) paint(entry.shader);
  };
  const element = (value: Element) => {
    for (const entry of walkElementContents(value)) {
      if ('fill' in entry) paint(entry.fill);
      if (entry.type === 'shader') paint(entry);
      if ((entry.type === 'audio' || entry.type === 'image') && entry.src)
        entry.src = reference(entry.src);
      if (entry.type === 'image-sequence') entry.frames = entry.frames.map(reference);
      if (entry.type === 'text') {
        paint(entry.strokePaint);
        entry.fontFamily = fontStack(entry.fontFamily);
        for (const run of entry.runs ?? []) {
          if (run.fontFamily) run.fontFamily = fontStack(run.fontFamily);
        }
      }
      if (entry.type === 'pattern') {
        entry.patternId = patterns.get(entry.patternId) ?? entry.patternId;
        if (entry.definition)
          entry.definition.id = patterns.get(entry.definition.id) ?? entry.definition.id;
      }
      if (entry.type === 'ticker') {
        paint(entry.background);
        for (const item of entry.items) effects(item.effects);
      }
    }
  };
  const fieldValue = (field: FieldDefinition, value: FieldValue): FieldValue => {
    if (typeof value === 'string' && ['image-url', 'file-path'].includes(field.type))
      return reference(value);
    if (field.type === 'array' && field.items && Array.isArray(value))
      return value.map((item) => fieldValue(field.items!, item));
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, FieldValue>;
      for (const property of field.properties)
        if (Object.hasOwn(record, property.key))
          record[property.key] = fieldValue(property, record[property.key]!);
    }
    return value;
  };
  const field = (value: FieldDefinition) => {
    value.defaultValue = fieldValue(value, value.defaultValue);
    value.properties.forEach(field);
    if (value.items) field(value.items);
  };
  const designSystem = (value: DesignSystem | undefined, fields: FieldDefinition[]) => {
    if (!value) return;
    for (const token of [
      ...value.tokens,
      ...(value.stylePackRestore?.tokens.map((item) => item.token) ?? []),
    ])
      if (token.type === 'font-family' && typeof token.value === 'string')
        token.value = fontStack(token.value);
    for (const style of value.typography ?? [])
      style.properties.fontFamily = fontStack(style.properties.fontFamily);
    for (const style of value.backgrounds ?? []) paint(style.paint);
    for (const layer of value.stylePackRestore?.layers ?? [])
      for (const entry of layer.properties) paint(entry.value);
    for (const saved of value.stylePackRestore?.fields ?? []) {
      const definition = fields.find((candidate) => candidate.id === saved.fieldId);
      if (definition) saved.defaultValue = fieldValue(definition, saved.defaultValue);
    }
  };
  const assertNoOpaqueReferences = (value: unknown, location: string): void => {
    if (!assets.size && !fonts.size) return;
    const contains = (item: unknown): boolean =>
      typeof item === 'string'
        ? assets.has(item) || fontStack(item) !== item
        : !!item && typeof item === 'object' && Object.values(item).some(contains);
    if (contains(value))
      throw new Error(
        `Keep appearance cannot remap an asset or font referenced by ${location}. Change that reference in the source before transferring.`,
      );
  };
  const needsFontAlias = (element: Element, property: string): boolean => {
    if (element.type === 'text' && property === 'fontFamily')
      return fontStack(element.fontFamily) !== element.fontFamily;
    if (element.type !== 'ticker') return false;
    const match = /^items\.([^.]+)\.(.+)$/.exec(property);
    const item = match && element.items.find(({ id }) => id === match[1]);
    return !!item && needsFontAlias(item.element, match![2]!);
  };
  const layer = (value: Omit<Layer, 'componentLink'> & Pick<Partial<Layer>, 'componentLink'>) => {
    assertNoOpaqueReferences(value.visualRules, `a rule on “${value.name}”`);
    assertNoOpaqueReferences(value.bindings, `a binding on “${value.name}”`);
    if (
      fonts.size &&
      value.bindings.some(({ targetProperty }) => needsFontAlias(value.element, targetProperty))
    )
      throw new Error(
        `Keep appearance cannot rename a font used by a live font-family binding on “${value.name}”. Detach the binding or resolve the matching font first.`,
      );
    element(value.element);
    effects(value.effects);
    if (value.lighting)
      value.lighting.patternId = patterns.get(value.lighting.patternId) ?? value.lighting.patternId;
    if (value.componentLink?.baseline) layer(value.componentLink.baseline);
    Object.values(value.componentLink?.fieldBaselines ?? {}).forEach(field);
  };
  for (const resource of project.shaders) paint(resource.paint);
  for (const composition of project.compositions) {
    composition.layers.forEach(layer);
    composition.dataFields.forEach(field);
    designSystem(composition.designSystem, composition.dataFields);
    paint(composition.backgroundPaint);
    composition.layout.presentationBackgroundImageSource = reference(
      composition.layout.presentationBackgroundImageSource,
    );
    cues(composition.mediaCues);
    const fields = new Map(composition.dataFields.map((value) => [value.id, value]));
    for (const rundown of composition.testRundowns ?? [])
      for (const row of rundown.rows)
        for (const [id, value] of Object.entries(row.values)) {
          const definition = fields.get(id);
          if (definition) row.values[id] = fieldValue(definition, value);
        }
    // Script and connector strings are not editable source-model references.
    for (const oldReference of assets.keys()) {
      if (composition.functions?.some(({ source }) => source.includes(oldReference)))
        throw new Error(
          'Keep appearance cannot remap an asset referenced inside a function. Change that reference in the source before transferring.',
        );
      if (
        composition.dataConnections.some(({ embeddedText }) => embeddedText.includes(oldReference))
      )
        throw new Error(
          'Keep appearance cannot remap an asset referenced inside a data connection. Change that reference in the source before transferring.',
        );
    }
    for (const definition of composition.components) {
      definition.layers.forEach(layer);
      definition.dataFields.forEach(field);
      designSystem(definition.context?.designSystem, definition.dataFields);
      cues(definition.context?.mediaCues);
    }
  }
}

/** Prepare a portable incoming child, leaving the source and existing destination unchanged. */
export function preparePreservedTransferProject(
  project: Project,
  destination: ProjectSetDocument,
): Project {
  const next = structuredClone(project);
  const library = componentLibraryFromTemplates(destination);
  const destinationIds = new Set(library.map(({ id }) => id));
  for (const composition of next.compositions) localizeComponents(composition, destinationIds);

  const destinationAssets = [
    ...destination.assets,
    ...library.flatMap((component) => component.resources ?? []),
    ...destination.templates.flatMap(({ project }) =>
      project.compositions.flatMap(compositionAssets),
    ),
  ];
  const reservedAssetIds = new Set(destinationAssets.map(({ id }) => id));
  const reservedPackagePaths = new Set(destinationAssets.map(({ packagePath }) => packagePath));
  const incomingAssets = next.compositions.flatMap(compositionAssets);
  const assetReferences = new Map<string, string>();
  for (const asset of incomingAssets) {
    const reference = `asset:${asset.id}`;
    if (reservedAssetIds.has(asset.id) && !assetReferences.has(reference))
      assetReferences.set(reference, `asset:${createId('asset')}`);
  }
  const reservedPatterns = new Set(
    library.flatMap((component) => (component.patterns ?? []).map(({ id }) => id)),
  );
  const patternIds = new Map<string, string>();
  for (const composition of next.compositions)
    for (const pattern of [
      ...composition.patterns,
      ...composition.components.flatMap((component) => component.patterns ?? []),
    ]) {
      if (reservedPatterns.has(pattern.id) && !patternIds.has(pattern.id))
        patternIds.set(pattern.id, createId('pattern'));
    }
  const fonts = renameFontFamilies(incomingAssets, destinationAssets);
  if (assetReferences.size || patternIds.size || fonts.size)
    rewriteReferences(next, assetReferences, patternIds, fonts);
  for (const asset of incomingAssets) {
    const newReference = assetReferences.get(`asset:${asset.id}`);
    if (newReference) asset.id = newReference.slice('asset:'.length);
    if (newReference || (asset.packagePath && reservedPackagePaths.has(asset.packagePath)))
      delete asset.packagePath;
    const family = asset.kind === 'font' && fonts.get(familyKey(projectFontFamily(asset)));
    if (family) asset.fontFamily = family;
  }
  for (const composition of next.compositions)
    for (const pattern of [
      ...composition.patterns,
      ...composition.components.flatMap((component) => component.patterns ?? []),
    ])
      pattern.id = patternIds.get(pattern.id) ?? pattern.id;
  return next;
}
