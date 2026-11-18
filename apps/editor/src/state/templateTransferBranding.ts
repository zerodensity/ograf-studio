import {
  applyDesignTokenBinding,
  createId,
  isMediaPaint,
  isShaderPaint,
  TYPOGRAPHY_PROPERTIES,
  type Asset,
  type BackgroundStyle,
  type Composition,
  type DesignSystem,
  type DesignToken,
  type Layer,
  type Project,
  type TypographyPreset,
} from '@ograf-editor/scene-model';
import type {
  TemplateTransferMapping,
  TemplateTransferOptions,
} from '@ograf-editor/agent-tools/template-transfer-review';
import { projectFontFamily } from './projectFonts';
import type { ProjectSetBrandKitLinks, ProjectSetDocument } from './projectSet';

export interface TemplateTransferSourceBrandKit {
  kit: DesignSystem;
  assets?: readonly Asset[];
  overrides?: {
    tokenIds?: readonly string[];
    typographyIds?: readonly string[];
    backgroundIds?: readonly string[];
    background?: boolean;
  };
}

export interface TemplateTransferMappingRow {
  kind: 'token' | 'typography' | 'background';
  sourceId: string;
  sourceLabel: string;
  sourceKey?: string;
  sourceType?: string;
  sourceValue: string;
  action: 'link' | 'keep-local' | 'import';
  destinationId?: string;
  destinationLabel?: string;
  destinationKey?: string;
  destinationValue?: string;
  candidates: { id: string; label: string; key?: string; value: string }[];
  affectedCount: number;
  overridesCount: number;
  uses: {
    compositionId: string;
    layerId?: string;
    layerName?: string;
    property: string;
    overridden: boolean;
  }[];
  conflicts: string[];
}

interface AppliedTransferBranding {
  project: Project;
  destination: ProjectSetDocument;
  brandKitLinks?: ProjectSetBrandKitLinks;
  brandKitOverrides?: string[];
  typographyOverrides?: string[];
  backgroundOverrides?: string[];
  backgroundOverridden?: boolean;
  mappings: TemplateTransferMappingRow[];
  warnings: string[];
}

type BrandKind = TemplateTransferMapping['kind'];
type BrandDefinition = DesignToken | TypographyPreset | BackgroundStyle;
type BrandUse = TemplateTransferMappingRow['uses'][number];
type BrandLayer = Omit<Layer, 'componentLink'> & Pick<Partial<Layer>, 'componentLink'>;

interface SourceRole {
  kind: BrandKind;
  definition: BrandDefinition;
  master?: BrandDefinition;
  uses: BrandUse[];
}

function definitions(kit: DesignSystem | undefined, kind: BrandKind): BrandDefinition[] {
  if (kind === 'token') return kit?.tokens ?? [];
  if (kind === 'typography') return kit?.typography ?? [];
  return kit?.backgrounds ?? [];
}

const kinds: BrandKind[] = ['token', 'typography', 'background'];
const roleId = (kind: BrandKind, id: string) => `${kind}:${id}`;
const isToken = (definition: BrandDefinition): definition is DesignToken => 'key' in definition;
const isTypography = (definition: BrandDefinition): definition is TypographyPreset =>
  'properties' in definition;
const isBackground = (definition: BrandDefinition): definition is BackgroundStyle =>
  'paint' in definition;

function valueLabel(definition: BrandDefinition): string {
  if (isToken(definition)) return String(definition.value);
  if (isTypography(definition)) {
    const { fontFamily, fontSize, fontWeight } = definition.properties;
    return `${fontFamily} · ${fontSize}px · ${fontWeight}`;
  }
  return typeof definition.paint === 'string' ? definition.paint : definition.paint.type;
}

function overrideAtLayer(layer: BrandLayer, property: string, reset = false): boolean {
  const pointer =
    '/element/' +
    property.replace(/\[(\d+)\]|\./g, (_, index: string) =>
      index === undefined ? '/' : `/${index}`,
    );
  const link = layer.componentLink;
  if (!link?.overridePaths) return false;
  if (reset)
    link.overridePaths = link.overridePaths.filter(
      (path) => path !== pointer && !path.startsWith(pointer + '/'),
    );
  return link.overridePaths.some((path) => pointer === path || pointer.startsWith(path + '/'));
}

function catalogUses(project: Project, sourceKit: TemplateTransferSourceBrandKit | undefined) {
  const roles = new Map<string, SourceRole>();
  const insert = (kind: BrandKind, definition: BrandDefinition, source = false) => {
    const key = roleId(kind, definition.id);
    const role = roles.get(key);
    if (role && source) role.master = definition;
    if (!role)
      roles.set(key, {
        kind,
        definition,
        uses: [],
        ...(source ? { master: definition } : {}),
      });
  };
  const registerUse = (kind: BrandKind, id: string, occurrence: BrandUse) => {
    roles.get(roleId(kind, id))?.uses.push(occurrence);
  };
  for (const composition of project.compositions) {
    for (const kit of [
      composition.designSystem,
      ...composition.components.map((component) => component.context?.designSystem),
    ])
      for (const kind of kinds) for (const item of definitions(kit, kind)) insert(kind, item);
  }
  for (const kind of kinds)
    for (const item of definitions(sourceKit?.kit, kind)) insert(kind, item, true);
  for (const composition of project.compositions) {
    for (const layer of [
      ...composition.layers,
      ...composition.components.flatMap((component) => component.layers),
    ]) {
      const at = { compositionId: composition.id, layerId: layer.id, layerName: layer.name };
      for (const binding of layer.designTokenBindings)
        registerUse('token', binding.tokenId, {
          ...at,
          property: binding.targetProperty,
          overridden:
            binding.overridden === true ||
            overrideAtLayer(layer, binding.targetProperty) ||
            sourceKit?.overrides?.tokenIds?.includes(binding.tokenId) === true,
        });
      const preset = layer.typographyBinding;
      if (preset)
        for (const property of TYPOGRAPHY_PROPERTIES)
          registerUse('typography', preset.presetId, {
            ...at,
            property,
            overridden:
              preset.overrides?.includes(property) === true ||
              layer.designTokenBindings.some((binding) => binding.targetProperty === property) ||
              overrideAtLayer(layer, property) ||
              sourceKit?.overrides?.typographyIds?.includes(preset.presetId) === true,
          });
    }
    const styleId = composition.backgroundStyleId;
    if (styleId)
      registerUse('background', styleId, {
        compositionId: composition.id,
        property: 'Canvas background',
        overridden:
          composition.backgroundPaintOverridden === true ||
          (composition.id === project.mainCompositionId &&
            sourceKit?.overrides?.background === true) ||
          sourceKit?.overrides?.backgroundIds?.includes(styleId) === true,
      });
  }
  return roles;
}

function compatible(source: BrandDefinition, destination: BrandDefinition): boolean {
  return !isToken(source) || (isToken(destination) && destination.type === source.type);
}

function memberKits(destination: ProjectSetDocument): DesignSystem[] {
  return destination.templates.flatMap(({ project }) =>
    project.compositions.flatMap((composition) => [
      composition.designSystem,
      ...composition.components.flatMap((component) =>
        component.context?.designSystem ? [component.context.designSystem] : [],
      ),
    ]),
  );
}

function availableKey(key: string, keys: ReadonlySet<string>, suffix: string): string {
  if (!keys.has(key)) return key;
  const base = `${key.slice(0, 106)}.${suffix}`;
  let result = base;
  let index = 2;
  while (keys.has(result)) result = `${base}${index++}`;
  return result;
}

function requestForRole(role: SourceRole, destination: DesignSystem | undefined) {
  const candidates = definitions(destination, role.kind).filter((item) =>
    compatible(role.definition, item),
  );
  const source = role.master ?? role.definition;
  const keyMatch = isToken(source)
    ? destination?.tokens.find(({ key }) => key === source.key)
    : undefined;
  return {
    candidates,
    suggested: keyMatch && compatible(source, keyMatch) ? keyMatch : undefined,
    conflicts:
      keyMatch && !compatible(source, keyMatch)
        ? [`Destination key “${keyMatch.key}” uses a different token type.`]
        : [],
  };
}

function fontFamilyKey(value: string): string {
  return value
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .toLowerCase();
}

function rewriteFontStack(stack: string, rename: (family: string) => string | undefined): string {
  return stack.replace(
    /(?:[^,'"]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')+/g,
    (family) => rename(fontFamilyKey(family)) ?? family,
  );
}

function importResources(
  project: Project,
  destination: ProjectSetDocument,
  sourceKit: TemplateTransferSourceBrandKit | undefined,
) {
  const sourceAssets = sourceKit?.assets ?? [];
  const preparedAssets = project.compositions.flatMap((composition) => composition.assets);
  const assets = [...destination.assets];
  const aliases = new Map<string, string>();
  const imported = new Map<Asset, string>();
  const missing = new Set<string>();

  const add = (asset: Asset, family?: string): string => {
    if (imported.has(asset)) return imported.get(asset)!;
    const copy = structuredClone(asset);
    copy.id = createId('asset');
    delete copy.packagePath;
    if (family) copy.fontFamily = family;
    assets.push(copy);
    imported.set(asset, copy.id);
    return copy.id;
  };
  const fontStack = (stack: string) =>
    rewriteFontStack(stack, (family) => {
      const sharedFaces = sourceAssets.filter(
        (asset) => asset.kind === 'font' && fontFamilyKey(projectFontFamily(asset)) === family,
      );
      const faces = sharedFaces.length
        ? sharedFaces
        : preparedAssets.filter(
            (asset) => asset.kind === 'font' && fontFamilyKey(projectFontFamily(asset)) === family,
          );
      if (!faces.length) {
        if (
          !['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy'].includes(family)
        )
          missing.add(family);
        return undefined;
      }
      if (!aliases.has(family)) {
        const prepared = preparedAssets.find(
          (asset) =>
            asset.kind === 'font' &&
            projectFontFamily(asset).startsWith('ograf-local-font-') &&
            faces.some(
              (face) =>
                face.dataUri === asset.dataUri &&
                face.fontWeight === asset.fontWeight &&
                face.fontStyle === asset.fontStyle,
            ),
        );
        const alias = prepared ? projectFontFamily(prepared) : createId('ograf-local-font');
        aliases.set(family, alias);
        for (const face of faces) add(face, alias);
      }
      return aliases.get(family);
    });
  const reference = (value: string): string => {
    if (!value.startsWith('asset:')) return value;
    const id = value.slice('asset:'.length);
    const asset =
      sourceAssets.find((item) => item.id === id) ?? preparedAssets.find((item) => item.id === id);
    if (!asset) throw new Error(`Source Brand Kit asset ${value} is unavailable.`);
    return `asset:${add(asset)}`;
  };

  return {
    assets,
    missing,
    resolve(definition: BrandDefinition) {
      if (isToken(definition) && definition.type === 'font-family')
        definition.value = fontStack(String(definition.value));
      if (isTypography(definition))
        definition.properties.fontFamily = fontStack(definition.properties.fontFamily);
      if (!isBackground(definition)) return;
      const paint = definition.paint;
      if (isMediaPaint(paint)) {
        if (paint.source.kind === 'clip') paint.source.src = reference(paint.source.src);
        else if (paint.source.fallback) paint.source.fallback = reference(paint.source.fallback);
      }
      if (isShaderPaint(paint) && paint.inputImage)
        paint.inputImage.source = reference(paint.inputImage.source);
    },
  };
}

function installToken(kit: DesignSystem, token: DesignToken): void {
  const existing = kit.tokens.find((item) => item.id === token.id);
  if (existing) {
    Object.assign(existing, token, { key: existing.key });
    return;
  }
  const keys = new Set(kit.tokens.map(({ key }) => key));
  kit.tokens.push({ ...token, key: availableKey(token.key, keys, 'linked') });
}

function installStyle<T extends TypographyPreset | BackgroundStyle>(catalog: T[], style: T): void {
  const index = catalog.findIndex(({ id }) => id === style.id);
  if (index < 0) catalog.push(structuredClone(style));
  else catalog[index] = structuredClone(style);
}

function assertUnusedDestinationId(
  project: Project,
  kind: BrandKind,
  sourceId: string,
  destinationId: string,
) {
  if (sourceId === destinationId) return;
  const collides = project.compositions.some((composition) =>
    [
      composition.designSystem,
      ...composition.components.map((component) => component.context?.designSystem),
    ].some((kit) => definitions(kit, kind).some(({ id }) => id === destinationId)),
  );
  if (collides)
    throw new Error(
      `Destination ID “${destinationId}” is already used by a local definition. Choose another mapping or keep the local value.`,
    );
}

function assertAvailableTokenIdentity(composition: Composition, id: string) {
  const defaults = [
    ...composition.dataFields,
    ...composition.components.flatMap((component) => component.dataFields),
    ...composition.layers.flatMap((layer) =>
      Object.values(layer.componentLink?.fieldBaselines ?? {}),
    ),
  ];
  const usesLocalField = defaults.some(function ownsDefault(field): boolean {
    return (
      field.defaultTokenId === id ||
      field.properties.some(ownsDefault) ||
      (field.items !== null && field.items !== undefined && ownsDefault(field.items))
    );
  });
  if (
    usesLocalField ||
    composition.designSystem.stylePackColors?.some(
      (link) => link.sourceTokenId === id || link.targetTokenId === id,
    )
  )
    throw new Error(
      'This destination token ID is also used by local field defaults or palette links. Choose another destination token or keep the local role.',
    );
}

function rebindToken(
  layer: BrandLayer,
  sourceId: string,
  target: DesignToken,
  resetOverrides: boolean,
): boolean {
  const matches = layer.designTokenBindings.filter((binding) => binding.tokenId === sourceId);
  for (const binding of matches) {
    binding.tokenId = target.id;
    if (resetOverrides) delete binding.overridden;
    if (overrideAtLayer(layer, binding.targetProperty, resetOverrides)) binding.overridden = true;
    if (!binding.overridden) applyDesignTokenBinding(layer, binding, target);
  }
  if (layer.componentLink?.baseline)
    rebindToken(layer.componentLink.baseline, sourceId, target, resetOverrides);
  return matches.length > 0;
}

function rebindTypography(
  layer: BrandLayer,
  sourceId: string,
  targetId: string,
  resetOverrides: boolean,
): boolean {
  const binding = layer.typographyBinding;
  const matching = binding?.presetId === sourceId;
  if (binding && matching) {
    binding.presetId = targetId;
    const kept = [
      ...(resetOverrides ? [] : (binding.overrides ?? [])),
      ...TYPOGRAPHY_PROPERTIES.filter((property) =>
        overrideAtLayer(layer, property, resetOverrides),
      ),
    ];
    if (kept.length) binding.overrides = [...new Set(kept)];
    else delete binding.overrides;
  }
  if (layer.componentLink?.baseline)
    rebindTypography(layer.componentLink.baseline, sourceId, targetId, resetOverrides);
  return matching;
}

function applyRole(
  project: Project,
  role: SourceRole,
  target: BrandDefinition,
  resetOverrides: boolean,
  sourceKit: TemplateTransferSourceBrandKit | undefined,
  result: AppliedTransferBranding,
): void {
  const sourceId = role.definition.id;
  for (const composition of project.compositions) {
    const kit = composition.designSystem;
    if (isToken(target)) {
      const layers = [
        ...composition.layers,
        ...composition.components.flatMap((component) => component.layers),
      ];
      if (
        !layers.some((layer) =>
          layer.designTokenBindings.some(({ tokenId }) => tokenId === sourceId),
        )
      )
        continue;
      if (target.id === sourceId) assertAvailableTokenIdentity(composition, sourceId);
      const preserve = !resetOverrides && sourceKit?.overrides?.tokenIds?.includes(sourceId);
      const value = preserve ? kit.tokens.find(({ id }) => id === sourceId)?.value : undefined;
      const definition = value === undefined ? target : { ...target, value };
      for (const layer of composition.layers)
        rebindToken(layer, sourceId, definition, resetOverrides);
      for (const component of composition.components) {
        const used = component.layers
          .map((layer) => rebindToken(layer, sourceId, definition, resetOverrides))
          .some(Boolean);
        if (used && component.context?.designSystem)
          installToken(component.context.designSystem, definition);
      }
      installToken(kit, definition);
      result.brandKitLinks!.tokenIds.push(target.id);
      if (preserve) (result.brandKitOverrides ??= []).push(target.id);
    } else if (isTypography(target)) {
      const preserve = !resetOverrides && sourceKit?.overrides?.typographyIds?.includes(sourceId);
      const owned = preserve ? kit.typography?.find(({ id }) => id === sourceId) : undefined;
      const definition = owned ? { ...target, properties: owned.properties } : target;
      let used = composition.layers
        .map((layer) => rebindTypography(layer, sourceId, target.id, resetOverrides))
        .some(Boolean);
      for (const component of composition.components) {
        const usesStyle = component.layers
          .map((layer) => rebindTypography(layer, sourceId, target.id, resetOverrides))
          .some(Boolean);
        if (usesStyle && component.context?.designSystem)
          installStyle((component.context.designSystem.typography ??= []), definition);
        used ||= usesStyle;
      }
      if (!used) continue;
      installStyle((kit.typography ??= []), definition);
      result.brandKitLinks!.typographyIds.push(target.id);
      if (preserve) (result.typographyOverrides ??= []).push(target.id);
    } else if (composition.backgroundStyleId === sourceId) {
      const preserve = !resetOverrides && sourceKit?.overrides?.backgroundIds?.includes(sourceId);
      const owned = preserve ? kit.backgrounds?.find(({ id }) => id === sourceId) : undefined;
      const definition = owned ? { ...target, paint: owned.paint } : target;
      installStyle((kit.backgrounds ??= []), definition);
      composition.backgroundStyleId = target.id;
      if (resetOverrides) delete composition.backgroundPaintOverridden;
      if (composition.id === project.mainCompositionId)
        result.backgroundOverridden = !resetOverrides && sourceKit?.overrides?.background === true;
      result.brandKitLinks!.backgroundIds.push(target.id);
      if (preserve) (result.backgroundOverrides ??= []).push(target.id);
    }
  }
}

function ownsMasterOverride(role: SourceRole, sourceKit?: TemplateTransferSourceBrandKit): boolean {
  const overrides = sourceKit?.overrides;
  const key =
    role.kind === 'token'
      ? 'tokenIds'
      : role.kind === 'typography'
        ? 'typographyIds'
        : 'backgroundIds';
  return overrides?.[key]?.includes(role.definition.id) === true;
}

export function applyTemplateTransferBranding(
  project: Project,
  destination: ProjectSetDocument,
  sourceKit: TemplateTransferSourceBrandKit | undefined,
  options: TemplateTransferOptions,
): AppliedTransferBranding {
  const keep = options.policy === 'keep-appearance';
  const bring = options.policy === 'bring-source-branding';
  if (bring && !sourceKit)
    throw new Error(
      'This source has no recoverable shared Brand Kit. Choose Keep appearance or map available roles to the destination kit.',
    );
  if (options.policy === 'adopt-destination' && !destination.brandKit)
    throw new Error('Create a destination Brand Kit before adopting its definitions.');

  const roles = catalogUses(project, sourceKit);
  const supplied = new Map<string, TemplateTransferMapping>();
  for (const mapping of options.mappings ?? []) {
    const key = roleId(mapping.kind, mapping.sourceId);
    if (!roles.has(key))
      throw new Error(`Unknown source Brand Kit definition: ${mapping.sourceId}.`);
    if (supplied.has(key)) throw new Error(`Duplicate transfer mapping for ${mapping.sourceId}.`);
    supplied.set(key, mapping);
  }

  const master = bring
    ? structuredClone(destination.brandKit ?? { name: sourceKit!.kit.name, tokens: [] })
    : destination.brandKit;
  const resources = importResources(project, destination, sourceKit);
  const reservedKeys = new Set([
    ...memberKits(destination).flatMap((kit) => kit.tokens.map(({ key }) => key)),
    ...(master?.tokens.map(({ key }) => key) ?? []),
  ]);
  const result: AppliedTransferBranding = {
    project: keep ? project : structuredClone(project),
    destination,
    brandKitLinks: { tokenIds: [], typographyIds: [], backgroundIds: [] },
    mappings: [],
    warnings: [],
  };
  const claimed = new Map<string, boolean>();
  let imported = false;
  for (const role of roles.values()) {
    const source = role.definition;
    const mapping = supplied.get(roleId(role.kind, source.id));
    const { candidates, suggested, conflicts } = requestForRole(role, destination.brandKit);
    const action =
      mapping?.action ??
      (!keep && !bring && suggested ? 'link' : bring && role.master ? 'import' : 'keep-local');
    let target: BrandDefinition | undefined;
    if (action === 'link') {
      if (keep) throw new Error('Keep appearance keeps every source definition local.');
      target = mapping?.destinationId
        ? candidates.find(({ id }) => id === mapping.destinationId)
        : suggested;
      if (!target)
        throw new Error(`Choose a compatible destination definition for “${source.name}”.`);
    } else if (action === 'import') {
      if (!bring || !role.master)
        throw new Error(
          `“${source.name}” has no shared source definition to import under this policy.`,
        );
      target = { ...structuredClone(role.master), id: createId('brand') };
      if (isToken(target)) {
        const requested = mapping?.destinationKey;
        if (
          requested &&
          (reservedKeys.has(requested) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(requested))
        )
          throw new Error(`Import key “${requested}” must be a unique semantic key.`);
        target.key = requested ?? availableKey(target.key, reservedKeys, 'imported');
        reservedKeys.add(target.key);
      }
      resources.resolve(target);
      if (isToken(target)) master!.tokens.push(target);
      if (isTypography(target)) (master!.typography ??= []).push(target);
      if (isBackground(target)) (master!.backgrounds ??= []).push(target);
      imported = true;
    }
    if (target && role.uses.length) {
      const targetKey = roleId(role.kind, target.id);
      const resetOverrides = mapping?.resetOverrides === true;
      const preservesOverride = !resetOverrides && ownsMasterOverride(role, sourceKit);
      if (claimed.has(targetKey) && (preservesOverride || claimed.get(targetKey)))
        throw new Error(
          `“${target.name}” cannot keep two independent overrides. Choose separate destination definitions or reset the mapped override.`,
        );
      claimed.set(targetKey, preservesOverride);
      assertUnusedDestinationId(project, role.kind, source.id, target.id);
      applyRole(result.project, role, target, resetOverrides, sourceKit, result);
    }
    result.mappings.push({
      kind: role.kind,
      sourceId: source.id,
      sourceLabel: source.name,
      ...(isToken(source) ? { sourceKey: source.key, sourceType: source.type } : {}),
      sourceValue: valueLabel(source),
      action,
      ...(target
        ? {
            destinationId: target.id,
            destinationLabel: target.name,
            ...(isToken(target) ? { destinationKey: target.key } : {}),
            destinationValue: valueLabel(target),
          }
        : {}),
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.name,
        ...(isToken(candidate) ? { key: candidate.key } : {}),
        value: valueLabel(candidate),
      })),
      affectedCount: role.uses.length,
      overridesCount: role.uses.filter(({ overridden }) => overridden).length,
      uses: role.uses.slice(0, 128),
      conflicts: mapping || action !== 'keep-local' ? [] : conflicts,
    });
  }
  if (imported) {
    // An empty destination can adopt the source default. Existing members keep their backdrop.
    if (!destination.brandKit && destination.templates.length === 0) {
      const defaultStyleId = sourceKit?.kit.defaultBackgroundStyleId;
      const approved = result.mappings.find(
        (row) => row.kind === 'background' && row.sourceId === defaultStyleId,
      );
      if (approved?.destinationId) master!.defaultBackgroundStyleId = approved.destinationId;
    }
    result.destination = { ...destination, brandKit: master, assets: resources.assets };
  }
  for (const key of ['tokenIds', 'typographyIds', 'backgroundIds'] as const)
    result.brandKitLinks![key] = [...new Set(result.brandKitLinks![key])];
  if (Object.values(result.brandKitLinks!).every((ids) => ids.length === 0))
    delete result.brandKitLinks;
  for (const key of ['brandKitOverrides', 'typographyOverrides', 'backgroundOverrides'] as const)
    if (result[key]) result[key] = [...new Set(result[key])];
  result.warnings = [...resources.missing].map(
    (family) =>
      `Source font “${family}” has no embedded master resource. Verify that the font is installed where this set will be used.`,
  );
  return result;
}
