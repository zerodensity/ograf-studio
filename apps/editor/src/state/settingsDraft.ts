import { TEMPLATE_SET_SETTING_KEYS, type TemplateSetSettings } from './templateSetSettings';

export interface SettingsDialogDraft {
  settings: TemplateSetSettings;
  inheritance: Record<string, boolean>;
  baselineSettings: TemplateSetSettings;
  baselineInheritance: Record<string, boolean>;
}

export function createSettingsDialogDraft(
  settings: TemplateSetSettings,
  inheritance: Record<string, boolean>,
): SettingsDialogDraft {
  return {
    settings: structuredClone(settings),
    inheritance: { ...inheritance },
    baselineSettings: structuredClone(settings),
    baselineInheritance: { ...inheritance },
  };
}

/** Apply only authored draft changes, preserving newer values in other scopes. */
export function mergeSettingsDraft(
  current: TemplateSetSettings,
  baseline: TemplateSetSettings,
  draft: TemplateSetSettings,
): TemplateSetSettings {
  let next = structuredClone(current);
  for (const key of TEMPLATE_SET_SETTING_KEYS) {
    if (key.startsWith('layout.')) {
      const layoutKey = key.slice(7) as keyof TemplateSetSettings['layout'];
      if (!Object.is(baseline.layout[layoutKey], draft.layout[layoutKey]))
        next.layout = { ...next.layout, [layoutKey]: draft.layout[layoutKey] };
    } else {
      const property = key as Exclude<keyof TemplateSetSettings, 'layout'>;
      if (!Object.is(baseline[property], draft[property]))
        next = { ...next, [property]: draft[property] };
    }
  }
  return next;
}

/** Live edits update untouched controls without discarding staged set edits. */
export function rebaseSettingsDialogDraft(
  draft: SettingsDialogDraft,
  settings: TemplateSetSettings,
  inheritance: Record<string, boolean>,
): SettingsDialogDraft {
  if (
    JSON.stringify(draft.baselineSettings) === JSON.stringify(settings) &&
    JSON.stringify(draft.baselineInheritance) === JSON.stringify(inheritance)
  )
    return draft;

  return {
    settings: mergeSettingsDraft(settings, draft.baselineSettings, draft.settings),
    inheritance: Object.fromEntries(
      Object.entries(inheritance).map(([id, inherit]) => [
        id,
        Object.hasOwn(draft.baselineInheritance, id) &&
        Object.hasOwn(draft.inheritance, id) &&
        draft.inheritance[id] !== draft.baselineInheritance[id]
          ? draft.inheritance[id]!
          : inherit,
      ]),
    ),
    baselineSettings: structuredClone(settings),
    baselineInheritance: { ...inheritance },
  };
}
