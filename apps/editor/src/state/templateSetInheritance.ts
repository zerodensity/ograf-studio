import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { resolveProjectSetTemplate, saveProjectSetTemplateEdits } from './projectSet';
import { runDiscreteHistoryStep } from './historyStore';
import { TEMPLATE_SET_SETTING_KEYS, type TemplateSetSettingKey } from './templateSetSettings';

export function useTemplateSettingOrigin(key: TemplateSetSettingKey) {
  const set = useProjectSetStore((state) => state.projectSet);
  const templateId = useProjectSetStore((state) => state.activeTemplateId);
  const compositionId = useProjectStore((state) => state.activeCompositionId);
  const mainId = useProjectStore((state) => state.project.mainCompositionId);
  const template = set?.templates.find((item) => item.id === templateId);
  const projectWide = key === 'supportsRealTime' || key === 'supportsNonRealTime';
  const inherited =
    !!set?.settings &&
    !!template &&
    template.inheritSettings !== false &&
    (projectWide || compositionId === mainId);
  return {
    origin: !inherited
      ? ('local' as const)
      : template.settingsOverrides?.includes(key)
        ? ('overridden' as const)
        : ('inherited' as const),
    sourceName: inherited ? set.name : undefined,
  };
}

/** Explicit metadata, not value equality, determines whether future master edits propagate. */
export function setTemplateSettingOverrides(keys: TemplateSetSettingKey[], override: boolean) {
  if (keys.some((key) => !TEMPLATE_SET_SETTING_KEYS.includes(key)))
    throw new Error('Unknown inherited setting.');
  const session = useProjectSetStore.getState();
  if (!session.projectSet || !session.activeTemplateId || !session.projectSet.settings) return;
  const editor = useProjectStore.getState();
  const template = session.projectSet.templates.find(
    (item) => item.id === session.activeTemplateId,
  );
  if (!template || template.inheritSettings === false) return;
  if (keys.every((key) => Boolean(template.settingsOverrides?.includes(key)) === override)) return;
  const change = () => {
    const synced = saveProjectSetTemplateEdits(session.projectSet!, template.id, editor.project);
    const updated = {
      ...synced,
      templates: synced.templates.map((item) =>
        item.id === template.id
          ? {
              ...item,
              settingsOverrides: override
                ? [...new Set([...(item.settingsOverrides ?? []), ...keys])]
                : (item.settingsOverrides ?? []).filter((key) => !keys.includes(key)),
            }
          : item,
      ),
    };
    const resolved = !override ? resolveProjectSetTemplate(updated, template.id) : null;
    session.setProjectSet(updated);
    if (resolved) useProjectStore.setState({ project: resolved });
  };
  if (override) change();
  else runDiscreteHistoryStep(change, 'Reset settings to Template Set');
}

export function setTemplateSettingOverride(key: TemplateSetSettingKey, override: boolean) {
  setTemplateSettingOverrides([key], override);
}
