import {
  createId,
  createDefaultGradient,
  createDefaultTypographyPresets,
  typographyPresetErrors,
  applyTypographyPresetBinding,
  syncTypographyPresets,
  isMediaPaint,
  type BackgroundStyle,
  type DesignSystem,
  type Paint,
  type Project,
  type TypographyPreset,
  type TypographyProperty,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useTestDataStore } from './testDataStore';
import { runDiscreteHistoryStep } from './historyStore';
import { editBrandKitSet } from './templateSetBrandKit';
import {
  backgroundStylesErrors,
  syncCompositionBackgroundStyle,
  enforceBackgroundMediaProfile,
} from './templateSetTheme';
import {
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  type ProjectSetDocument,
} from './projectSet';

export type BrandKitStyleScope = 'set' | 'template';
function active(project: Project) {
  return project.compositions.find(
    (item) => item.id === useProjectStore.getState().activeCompositionId,
  )!;
}
function styleOrigin(id: string, kind: 'typography' | 'backgrounds') {
  const session = useProjectSetStore.getState();
  const template = session.projectSet?.templates.find(
    (item) => item.id === session.activeTemplateId,
  );
  const kit = session.projectSet?.brandKit;
  const shared = kit?.[kind]?.some((style) => style.id === id);
  const overrides =
    kind === 'typography' ? template?.typographyOverrides : template?.backgroundOverrides;
  return {
    origin: !shared
      ? ('local' as const)
      : overrides?.includes(id)
        ? ('overridden' as const)
        : ('inherited' as const),
    sourceName: shared ? kit?.name : undefined,
  };
}
export const getTypographyOrigin = (id: string) => styleOrigin(id, 'typography');
export const getBackgroundStyleOrigin = (id: string) => styleOrigin(id, 'backgrounds');

function pinStyle(id: string, kind: 'typography' | 'backgrounds', override: boolean) {
  const session = useProjectSetStore.getState();
  if (!session.projectSet || !session.activeTemplateId || styleOrigin(id, kind).origin === 'local')
    return;
  const project = useProjectStore.getState().project;
  const set = saveProjectSetTemplateEdits(session.projectSet, session.activeTemplateId, project);
  const key = kind === 'typography' ? 'typographyOverrides' : 'backgroundOverrides';
  const updated = {
    ...set,
    templates: set.templates.map((template) =>
      template.id === session.activeTemplateId
        ? {
            ...template,
            [key]: override
              ? [...new Set([...(template[key] ?? []), id])]
              : (template[key] ?? []).filter((value) => value !== id),
          }
        : template,
    ),
  };
  const resolved = !override ? resolveProjectSetTemplate(updated, session.activeTemplateId) : null;
  const change = () => {
    session.setProjectSet(updated);
    if (resolved) useProjectStore.setState({ project: resolved });
  };
  if (override) change();
  else runDiscreteHistoryStep(change, 'Reset shared style');
}
export const setTypographyOverride = (id: string, override: boolean) =>
  pinStyle(id, 'typography', override);
export const setBackgroundStyleOverride = (id: string, override: boolean) =>
  pinStyle(id, 'backgrounds', override);

function localKitEdit(
  mutate: (kit: DesignSystem, project: Project) => void,
  label: string,
  pin?: { id: string; kind: 'typography' | 'backgrounds' },
) {
  const project = structuredClone(useProjectStore.getState().project);
  mutate(active(project).designSystem, project);
  const resets = project.compositions.flatMap((composition) => {
    const resets = syncTypographyPresets(composition);
    syncCompositionBackgroundStyle(composition);
    return resets;
  });
  enforceBackgroundMediaProfile(project);
  runDiscreteHistoryStep(() => {
    const session = useProjectSetStore.getState();
    if (pin && session.projectSet) {
      const key = pin.kind === 'typography' ? 'typographyOverrides' : 'backgroundOverrides';
      session.setProjectSet({
        ...session.projectSet,
        templates: session.projectSet.templates.map((template) =>
          template.id === session.activeTemplateId
            ? { ...template, [key]: [...new Set([...(template[key] ?? []), pin.id])] }
            : template,
        ),
      });
    }
    useProjectStore.setState({ project });
    useTestDataStore.getState().clearOverrides(resets);
  }, label);
}

export function addTypographyPreset(
  scope: BrandKitStyleScope,
  kind: 'headline' | 'body' | 'caption' = 'headline',
) {
  const id = createId('typography');
  const preset = {
    ...createDefaultTypographyPresets()[['headline', 'body', 'caption'].indexOf(kind)]!,
    id,
  };
  if (scope === 'set')
    editBrandKitSet((set) => {
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      return {
        ...set,
        brandKit: { ...set.brandKit, typography: [...(set.brandKit.typography ?? []), preset] },
      };
    }, 'Add shared typography preset');
  else
    localKitEdit((kit) => {
      kit.typography = [...(kit.typography ?? []), preset];
    }, 'Add typography preset');
  return id;
}

export function updateTypographyPreset(
  scope: BrandKitStyleScope,
  id: string,
  patch: Partial<Omit<TypographyPreset, 'id'>>,
) {
  const update = (kit: DesignSystem) => {
    const preset = kit.typography?.find((item) => item.id === id);
    if (!preset) throw new Error('Typography preset not found.');
    const next = {
      ...preset,
      ...patch,
      properties: { ...preset.properties, ...patch.properties },
      id,
    };
    const errors = typographyPresetErrors(next);
    if (errors.length) throw new Error(errors.join(' '));
    kit.typography = kit.typography!.map((item) => (item.id === id ? next : item));
  };
  if (scope === 'set')
    editBrandKitSet((set) => {
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      update(set.brandKit);
      return set;
    }, 'Edit shared typography preset');
  else {
    const shared = getTypographyOrigin(id).origin !== 'local';
    localKitEdit(
      (kit, project) => {
        update(kit);
        if (shared)
          for (const composition of project.compositions) {
            composition.designSystem.typography = (composition.designSystem.typography ?? []).map(
              (item) =>
                item.id === id
                  ? structuredClone(kit.typography!.find((item) => item.id === id)!)
                  : item,
            );
          }
      },
      'Edit typography preset',
      shared ? { id, kind: 'typography' } : undefined,
    );
  }
}

function styleUsed(project: Project, id: string, kind: 'typography' | 'backgrounds') {
  return project.compositions.some((composition) =>
    kind === 'backgrounds'
      ? composition.backgroundStyleId === id ||
        composition.designSystem.defaultBackgroundStyleId === id
      : [
          ...composition.layers,
          ...composition.components.flatMap((component) => component.layers),
        ].some((layer) => layer.typographyBinding?.presetId === id),
  );
}

function removeStyle(scope: BrandKitStyleScope, id: string, kind: 'typography' | 'backgrounds') {
  if (scope === 'set')
    editBrandKitSet((set) => {
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      if (
        (kind === 'backgrounds' && set.brandKit.defaultBackgroundStyleId === id) ||
        set.templates.some((template) => styleUsed(template.project, id, kind))
      )
        throw new Error('This style is still used. Detach its uses before removing it.');
      if (kind === 'typography')
        set.brandKit.typography = set.brandKit.typography?.filter((style) => style.id !== id);
      else set.brandKit.backgrounds = set.brandKit.backgrounds?.filter((style) => style.id !== id);
      for (const template of set.templates) {
        if (kind === 'typography')
          template.typographyOverrides = template.typographyOverrides?.filter(
            (value) => value !== id,
          );
        else
          template.backgroundOverrides = template.backgroundOverrides?.filter(
            (value) => value !== id,
          );
        for (const composition of template.project.compositions) {
          if (kind === 'typography')
            composition.designSystem.typography = composition.designSystem.typography?.filter(
              (style) => style.id !== id,
            );
          else
            composition.designSystem.backgrounds = composition.designSystem.backgrounds?.filter(
              (style) => style.id !== id,
            );
        }
      }
      return set;
    }, 'Remove shared style');
  else {
    if (styleOrigin(id, kind).origin !== 'local')
      throw new Error('Remove shared styles in Template Set scope.');
    localKitEdit((kit, project) => {
      if (styleUsed(project, id, kind))
        throw new Error('This style is still used. Detach its uses first.');
      if (kind === 'typography')
        kit.typography = kit.typography?.filter((style) => style.id !== id);
      else kit.backgrounds = kit.backgrounds?.filter((style) => style.id !== id);
    }, 'Remove style');
  }
}
export const removeTypographyPreset = (scope: BrandKitStyleScope, id: string) =>
  removeStyle(scope, id, 'typography');
export const removeBackgroundStyle = (scope: BrandKitStyleScope, id: string) =>
  removeStyle(scope, id, 'backgrounds');

export function applyTypographyToLayers(ids: string[], presetId: string | null) {
  const project = structuredClone(useProjectStore.getState().project);
  const composition = active(project);
  const layers = composition.layers.filter(
    (layer) => ids.includes(layer.id) && layer.element.type === 'text',
  );
  if (!layers.length) throw new Error('Select a text object first.');
  if (layers.some((layer) => layer.isLocked))
    throw new Error('Unlock the selected text objects first.');
  const preset = presetId
    ? composition.designSystem.typography?.find((item) => item.id === presetId)
    : null;
  if (presetId && !preset) throw new Error('Typography preset not found.');
  const resets = layers.flatMap((layer) => {
    if (!preset) {
      delete layer.typographyBinding;
      return [];
    }
    return applyTypographyPresetBinding(composition, layer, preset);
  });
  runDiscreteHistoryStep(() => {
    useProjectStore.setState({ project });
    useTestDataStore.getState().clearOverrides(resets);
  }, 'Apply typography preset');
}

export function resetTypographyProperty(layerId: string, property: TypographyProperty) {
  const project = structuredClone(useProjectStore.getState().project);
  const composition = active(project);
  const layer = composition.layers.find((item) => item.id === layerId);
  const preset = composition.designSystem.typography?.find(
    (item) => item.id === layer?.typographyBinding?.presetId,
  );
  if (!layer || !preset || layer.isLocked) return;
  layer.typographyBinding!.overrides = (layer.typographyBinding!.overrides ?? []).filter(
    (key) => key !== property,
  );
  layer.designTokenBindings = layer.designTokenBindings.filter(
    (binding) => binding.targetProperty !== property,
  );
  const resets = applyTypographyPresetBinding(composition, layer, preset, false);
  runDiscreteHistoryStep(() => {
    useProjectStore.setState({ project });
    useTestDataStore.getState().clearOverrides(resets);
  }, 'Reset typography property');
}

function promotePaint(set: ProjectSetDocument, paint: Paint): Paint {
  const next = structuredClone(paint);
  if (!isMediaPaint(next)) return next;
  const session = useProjectSetStore.getState();
  const composition = set.templates
    .find((item) => item.id === session.activeTemplateId)
    ?.project.compositions.find(
      (item) => item.id === useProjectStore.getState().activeCompositionId,
    );
  const promote = (value: string) => {
    if (!value.startsWith('asset:')) return value;
    const source =
      composition?.assets.find((asset) => asset.id === value.slice(6)) ??
      set.assets.find((asset) => asset.id === value.slice(6));
    if (!source) throw new Error('Background media asset is missing.');
    let shared = set.assets.find(
      (asset) => asset.dataUri === source.dataUri && asset.kind === source.kind,
    );
    if (!shared) {
      shared = { ...structuredClone(source), id: createId('shared-media') };
      set.assets.push(shared);
    }
    return `asset:${shared.id}`;
  };
  if (next.source.kind === 'clip') next.source.src = promote(next.source.src);
  else if (next.source.fallback) next.source.fallback = promote(next.source.fallback);
  return next;
}

export function addBackgroundStyle(scope: BrandKitStyleScope) {
  const id = createId('background');
  const style: BackgroundStyle = { id, name: 'Background', paint: createDefaultGradient() };
  if (scope === 'set')
    editBrandKitSet((set) => {
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      set.brandKit.backgrounds = [...(set.brandKit.backgrounds ?? []), style];
      return set;
    }, 'Add shared background style');
  else
    localKitEdit((kit) => {
      kit.backgrounds = [...(kit.backgrounds ?? []), style];
    }, 'Add background style');
  return id;
}

export function updateBackgroundStyle(
  scope: BrandKitStyleScope,
  id: string,
  patch: Partial<Omit<BackgroundStyle, 'id'>>,
) {
  const update = (kit: DesignSystem, paint?: Paint) => {
    const style = kit.backgrounds?.find((item) => item.id === id);
    if (!style) throw new Error('Background style not found.');
    const next = { ...style, ...patch, id, ...(paint !== undefined ? { paint } : {}) };
    const errors = backgroundStylesErrors([next]);
    if (errors.length) throw new Error(errors.join(' '));
    kit.backgrounds = kit.backgrounds!.map((item) => (item.id === id ? next : item));
  };
  if (scope === 'set')
    editBrandKitSet((set) => {
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      update(set.brandKit, patch.paint !== undefined ? promotePaint(set, patch.paint) : undefined);
      return set;
    }, 'Edit shared background style');
  else {
    const shared = getBackgroundStyleOrigin(id).origin !== 'local';
    localKitEdit(
      (kit, project) => {
        update(kit);
        if (shared)
          for (const composition of project.compositions)
            composition.designSystem.backgrounds = (composition.designSystem.backgrounds ?? []).map(
              (style) =>
                style.id === id
                  ? structuredClone(kit.backgrounds!.find((item) => item.id === id)!)
                  : style,
            );
      },
      'Edit background style',
      shared ? { id, kind: 'backgrounds' } : undefined,
    );
  }
}

function commitBackground(project: Project, overridden: boolean, label: string) {
  enforceBackgroundMediaProfile(project);
  runDiscreteHistoryStep(() => {
    const session = useProjectSetStore.getState();
    if (session.projectSet && active(project).id === project.mainCompositionId)
      session.setProjectSet({
        ...session.projectSet,
        templates: session.projectSet.templates.map((template) =>
          template.id === session.activeTemplateId
            ? { ...template, backgroundOverridden: overridden }
            : template,
        ),
      });
    useProjectStore.setState({ project });
  }, label);
}
export function setDefaultBackgroundStyle(id: string | null) {
  editBrandKitSet((set) => {
    if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
    if (id && !set.brandKit.backgrounds?.some((style) => style.id === id))
      throw new Error('Background style not found.');
    set.brandKit.defaultBackgroundStyleId = id;
    return set;
  }, 'Set default background style');
}
export function applyBackgroundStyle(id: string | null) {
  const project = structuredClone(useProjectStore.getState().project),
    composition = active(project);
  if (id) {
    composition.backgroundStyleId = id;
    delete composition.backgroundPaintOverridden;
    syncCompositionBackgroundStyle(composition);
  } else {
    delete composition.backgroundStyleId;
    delete composition.backgroundPaint;
    delete composition.backgroundPaintOverridden;
  }
  commitBackground(project, true, 'Apply background style');
}
export function updateCompositionBackgroundPaint(paint: Paint | undefined) {
  const errors =
    paint !== undefined
      ? backgroundStylesErrors([{ id: 'background', name: 'Background', paint }])
      : [];
  if (errors.length) throw new Error(errors.join(' '));
  const project = structuredClone(useProjectStore.getState().project),
    composition = active(project);
  if (paint === undefined) delete composition.backgroundPaint;
  else composition.backgroundPaint = structuredClone(paint);
  composition.backgroundPaintOverridden = true;
  commitBackground(project, true, 'Edit background paint');
}
export function resetCompositionBackground() {
  const session = useProjectSetStore.getState(),
    editor = useProjectStore.getState();
  const current = active(editor.project);
  if (
    session.projectSet?.brandKit &&
    session.activeTemplateId &&
    editor.activeCompositionId === editor.project.mainCompositionId &&
    (session.projectSet.brandKit.defaultBackgroundStyleId !== undefined ||
      !current.backgroundStyleId)
  ) {
    const set = saveProjectSetTemplateEdits(
      session.projectSet,
      session.activeTemplateId,
      editor.project,
    );
    const updated = {
      ...set,
      templates: set.templates.map((template) =>
        template.id === session.activeTemplateId
          ? { ...template, backgroundOverridden: false }
          : template,
      ),
    };
    const source = updated.templates.find((template) => template.id === session.activeTemplateId)!;
    source.settingsOverrides = (source.settingsOverrides ?? []).filter(
      (key) => key !== 'backgroundColor',
    );
    const main = source.project.compositions.find(
      (composition) => composition.id === source.project.mainCompositionId,
    )!;
    delete main.backgroundPaintOverridden;
    if (updated.brandKit?.defaultBackgroundStyleId === undefined) {
      delete main.backgroundStyleId;
      delete main.backgroundPaint;
    }
    const project = resolveProjectSetTemplate(updated, session.activeTemplateId);
    runDiscreteHistoryStep(() => {
      session.setProjectSet(updated);
      useProjectStore.setState({ project });
    }, 'Reset background to master');
  } else {
    const project = structuredClone(editor.project),
      composition = active(project);
    delete composition.backgroundPaintOverridden;
    syncCompositionBackgroundStyle(composition);
    commitBackground(project, false, 'Reset background style');
  }
}
export function getBackgroundOrigin() {
  const editor = useProjectStore.getState(),
    composition = active(editor.project),
    session = useProjectSetStore.getState();
  const template = session.projectSet?.templates.find(
    (item) => item.id === session.activeTemplateId,
  );
  const sharedDefault =
    composition.id === editor.project.mainCompositionId &&
    session.projectSet?.brandKit?.defaultBackgroundStyleId !== undefined;
  return {
    origin:
      composition.backgroundPaintOverridden || (sharedDefault && template?.backgroundOverridden)
        ? ('overridden' as const)
        : sharedDefault || composition.backgroundStyleId
          ? ('inherited' as const)
          : ('local' as const),
    sourceName: sharedDefault
      ? session.projectSet?.brandKit?.name
      : composition.designSystem.backgrounds?.find(
          (style) => style.id === composition.backgroundStyleId,
        )?.name,
  };
}
