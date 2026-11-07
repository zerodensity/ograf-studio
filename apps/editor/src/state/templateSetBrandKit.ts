import {
  applyDesignTokenBinding,
  syncDesignerBindingDefaults,
  createId,
  normalizeDesignTokenValue,
  isMediaPaint,
  syncTypographyPresets,
  type DesignSystem,
  type DesignToken,
  type DesignTokenType,
  type DesignTokenTargetProperty,
} from '@ograf-editor/scene-model';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import {
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  validateProjectSetDocument,
  type ProjectSetDocument,
} from './projectSet';
import { runDiscreteHistoryStep } from './historyStore';
import { sharedBrandKitFromProject } from './templateSetTheme';
import { saveTemplateSetSettings } from './templateSetSettingsStore';
import { templateSetSettingsFromProject } from './templateSetSettings';
import { useTestDataStore } from './testDataStore';
import { validateProject } from '@ograf-editor/validation';

function shareFonts(set: ProjectSetDocument): ProjectSetDocument {
  const families = new Set(
    [
      ...(set.brandKit?.tokens
        .filter((token) => token.type === 'font-family')
        .map((token) => String(token.value)) ?? []),
      ...(set.brandKit?.typography?.map((style) => style.properties.fontFamily) ?? []),
    ].flatMap((familyList) =>
      familyList.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, '')),
    ),
  );
  const assets = [...set.assets];
  for (const template of set.templates)
    for (const composition of template.project.compositions) {
      for (const font of composition.assets.filter(
        (asset) => asset.kind === 'font' && families.has(asset.fontFamily ?? ''),
      )) {
        if (
          !assets.some(
            (asset) =>
              asset.kind === 'font' &&
              asset.dataUri === font.dataUri &&
              asset.fontFamily === font.fontFamily,
          )
        )
          assets.push({ ...structuredClone(font), id: createId('font') });
      }
    }
  const next = { ...set, assets };
  for (const style of next.brandKit?.backgrounds ?? []) {
    if (!isMediaPaint(style.paint)) continue;
    const share = (reference: string) => {
      if (!reference.startsWith('asset:')) return reference;
      if (assets.some((asset) => asset.id === reference.slice(6))) return reference;
      const ordered = [
        ...set.templates.filter(
          (template) => template.id === useProjectSetStore.getState().activeTemplateId,
        ),
        ...set.templates,
      ];
      const source = ordered
        .flatMap((template) => template.project.compositions)
        .flatMap((composition) => composition.assets)
        .find((asset) => asset.id === reference.slice(6));
      if (!source) throw new Error('Shared background references a missing asset.');
      let shared = assets.find(
        (asset) => asset.kind === source.kind && asset.dataUri === source.dataUri,
      );
      if (!shared) {
        shared = { ...structuredClone(source), id: createId('shared-media') };
        assets.push(shared);
      }
      return `asset:${shared.id}`;
    };
    if (style.paint.source.kind === 'clip') style.paint.source.src = share(style.paint.source.src);
    else if (style.paint.source.fallback)
      style.paint.source.fallback = share(style.paint.source.fallback);
  }
  return next;
}

/** Resolve every child before publishing any state, so invalid theme changes are atomic. */
export function editBrandKitSet(
  change: (set: ProjectSetDocument) => ProjectSetDocument,
  label: string,
) {
  const session = useProjectSetStore.getState();
  if (!session.projectSet) throw new Error('Create or open a Template Set first.');
  const editor = useProjectStore.getState();
  const synced = session.activeTemplateId
    ? saveProjectSetTemplateEdits(session.projectSet, session.activeTemplateId, editor.project)
    : session.projectSet;
  let updated = shareFonts(change(structuredClone(synced)));
  validateProjectSetDocument(updated);
  updated = {
    ...updated,
    templates: updated.templates.map((template) => ({
      ...template,
      project: resolveProjectSetTemplate(updated, template.id),
    })),
  };
  const active = updated.templates.find((template) => template.id === session.activeTemplateId);
  for (const template of updated.templates) {
    const validation = validateProject(template.project);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
  }
  const typeChanged =
    JSON.stringify(synced.brandKit?.typography) !== JSON.stringify(updated.brandKit?.typography);
  const resets =
    typeChanged && active
      ? active.project.compositions.flatMap((composition) => syncTypographyPresets(composition))
      : [];
  runDiscreteHistoryStep(() => {
    session.setProjectSet(updated);
    if (active) useProjectStore.setState({ project: active.project });
    useTestDataStore.getState().clearOverrides(resets);
  }, label);
}

const editSet = editBrandKitSet;

export function initializeSharedBrandKit() {
  const kit = sharedBrandKitFromProject(useProjectStore.getState().project);
  editSet(
    (set) => ({
      ...set,
      brandKit: kit,
      templates: set.templates.map((template) => ({ ...template, brandKitOverrides: [] })),
    }),
    'Create master Brand Kit',
  );
}

export function replaceSharedBrandKit(kit: DesignSystem) {
  editSet(
    (set) => ({
      ...set,
      brandKit: structuredClone(kit),
      templates: set.templates.map((template) => ({
        ...template,
        brandKitOverrides: template.brandKitOverrides?.filter((id) =>
          kit.tokens.some((token) => token.id === id),
        ),
      })),
    }),
    'Set master Brand Kit',
  );
}

export function updateSharedBrandKit(patch: Partial<DesignSystem>) {
  editSet((set) => {
    if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
    return { ...set, brandKit: { ...set.brandKit, ...structuredClone(patch) } };
  }, 'Update master Brand Kit');
}

export function updateSharedBrandToken(id: string, patch: Partial<Omit<DesignToken, 'id'>>) {
  editSet((set) => {
    if (!set.brandKit?.tokens.some((token) => token.id === id))
      throw new Error('Shared token not found.');
    const tokens = set.brandKit.tokens.map((token) => {
      if (token.id !== id) return token;
      const next = { ...token, ...patch, id };
      next.value = normalizeDesignTokenValue(next.type, next.value);
      return next;
    });
    return { ...set, brandKit: { ...set.brandKit, tokens } };
  }, 'Edit shared design token');
}

export function addSharedBrandToken(type: DesignTokenType = 'color') {
  const id = createId('design-token');
  editSet((set) => {
    if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
    let index = set.brandKit.tokens.length + 1;
    while (set.brandKit.tokens.some((token) => token.key === `token_${index}`)) index++;
    const token: DesignToken = {
      id,
      key: `token_${index}`,
      name: `Token ${index}`,
      type,
      value:
        type === 'color'
          ? '#ffffff'
          : type === 'font-family'
            ? 'Arial'
            : type === 'font-weight'
              ? 700
              : type === 'number'
                ? 16
                : '',
      description: '',
    };
    return { ...set, brandKit: { ...set.brandKit, tokens: [...set.brandKit.tokens, token] } };
  }, 'Add shared design token');
  return id;
}

export function removeSharedBrandToken(id: string) {
  editSet((set) => {
    if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
    for (const template of set.templates)
      for (const composition of template.project.compositions) {
        if (
          [
            ...composition.layers,
            ...composition.components.flatMap((component) => component.layers),
          ].some((layer) => layer.designTokenBindings.some((binding) => binding.tokenId === id)) ||
          [
            ...composition.dataFields,
            ...composition.components.flatMap((component) => component.dataFields),
          ].some((field) => field.defaultTokenId === id) ||
          composition.designSystem.stylePackColors?.some(
            (link) => link.sourceTokenId === id || link.targetTokenId === id,
          )
        )
          throw new Error('This shared token is still linked. Unlink its uses before removing it.');
        composition.designSystem.tokens = composition.designSystem.tokens.filter(
          (token) => token.id !== id,
        );
      }
    return {
      ...set,
      brandKit: { ...set.brandKit, tokens: set.brandKit.tokens.filter((token) => token.id !== id) },
      templates: set.templates.map((template) => ({
        ...template,
        brandKitOverrides: template.brandKitOverrides?.filter((tokenId) => tokenId !== id),
      })),
    };
  }, 'Remove shared design token');
}

export function getBrandTokenOrigin(tokenId: string) {
  const { projectSet: set, activeTemplateId } = useProjectSetStore.getState();
  const template = set?.templates.find((item) => item.id === activeTemplateId);
  const shared = !!template && !!set?.brandKit?.tokens.some((token) => token.id === tokenId);
  return {
    origin: !shared
      ? ('local' as const)
      : template.brandKitOverrides?.includes(tokenId)
        ? ('overridden' as const)
        : ('inherited' as const),
    sourceName: shared ? set?.brandKit?.name : undefined,
  };
}

export function useBrandTokenOrigin(tokenId: string) {
  useProjectSetStore((state) => state.projectSet);
  useProjectSetStore((state) => state.activeTemplateId);
  return getBrandTokenOrigin(tokenId);
}

export function setBrandTokenOverride(tokenId: string, override: boolean) {
  if (getBrandTokenOrigin(tokenId).origin === 'local') return;
  const session = useProjectSetStore.getState();
  const editor = useProjectStore.getState();
  const template = session.projectSet!.templates.find(
    (item) => item.id === session.activeTemplateId,
  )!;
  if (Boolean(template.brandKitOverrides?.includes(tokenId)) === override) return;
  const synced = saveProjectSetTemplateEdits(
    session.projectSet!,
    session.activeTemplateId!,
    editor.project,
  );
  const updated = {
    ...synced,
    templates: synced.templates.map((template) =>
      template.id === session.activeTemplateId
        ? {
            ...template,
            brandKitOverrides: override
              ? [...new Set([...(template.brandKitOverrides ?? []), tokenId])]
              : (template.brandKitOverrides ?? []).filter((id) => id !== tokenId),
          }
        : template,
    ),
  };
  const resolved = !override ? resolveProjectSetTemplate(updated, session.activeTemplateId!) : null;
  const apply = () => {
    session.setProjectSet(updated);
    if (resolved) useProjectStore.setState({ project: resolved });
  };
  if (override) apply();
  else runDiscreteHistoryStep(apply, 'Reset token to master Brand Kit');
}

export function getBrandBindingOrigin(layerId: string, property: DesignTokenTargetProperty) {
  const editor = useProjectStore.getState();
  const composition = editor.project.compositions.find(
    (item) => item.id === editor.activeCompositionId,
  )!;
  const binding = composition.layers
    .find((layer) => layer.id === layerId)
    ?.designTokenBindings.find((item) => item.targetProperty === property);
  if (!binding) return { origin: 'local' as const };
  const token = getBrandTokenOrigin(binding.tokenId);
  const localName = composition.designSystem.tokens.find(
    (item) => item.id === binding.tokenId,
  )?.name;
  return {
    origin: binding.overridden ? ('overridden' as const) : ('inherited' as const),
    sourceName:
      token.origin === 'overridden'
        ? `This template · ${localName}`
        : (token.sourceName ?? localName),
  };
}

export function setBrandBindingOverride(
  layerId: string,
  property: DesignTokenTargetProperty,
  override: boolean,
) {
  runDiscreteHistoryStep(
    () => {
      const state = useProjectStore.getState();
      const project = structuredClone(state.project);
      const composition = project.compositions.find(
        (item) => item.id === state.activeCompositionId,
      )!;
      const layer = composition.layers.find((item) => item.id === layerId);
      const binding = layer?.designTokenBindings.find((item) => item.targetProperty === property);
      if (!layer || !binding || layer.isLocked) return;
      binding.overridden = override;
      const before = structuredClone({ element: layer.element, effects: layer.effects });
      const token = composition.designSystem.tokens.find((item) => item.id === binding.tokenId);
      if (!override && token) {
        if (property === 'fill' && 'fill' in layer.element && token.type === 'color')
          layer.element.fill = String(token.value);
        applyDesignTokenBinding(layer, binding, token);
        const resets = syncDesignerBindingDefaults(composition, layer, before, [property]);
        for (const dataBinding of layer.bindings) {
          if (
            token.type === 'color' &&
            dataBinding.targetProperty === property &&
            !dataBinding.valueMap &&
            !dataBinding.sourcePath?.length
          ) {
            const field = composition.dataFields.find((item) => item.id === dataBinding.fieldId);
            if (field?.type === 'color') field.defaultTokenId = token.id;
          }
        }
        useTestDataStore.getState().clearOverrides(resets);
      }
      useProjectStore.setState({ project });
    },
    override ? 'Override object style' : 'Reset object style',
  );
}

export function updateSharedBrandBackground(color: string) {
  const session = useProjectSetStore.getState();
  if (!session.projectSet) throw new Error('Create or open a Template Set first.');
  if (session.projectSet.brandKit?.defaultBackgroundStyleId) {
    editBrandKitSet((set) => {
      set.brandKit!.defaultBackgroundStyleId = null;
      set.settings = { ...set.settings!, backgroundColor: color };
      return set;
    }, 'Set solid master background');
    return;
  }
  saveTemplateSetSettings(
    {
      ...(session.projectSet.settings ??
        templateSetSettingsFromProject(useProjectStore.getState().project)),
      backgroundColor: color,
    },
    {},
  );
}
