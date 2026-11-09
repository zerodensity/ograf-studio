import { create } from 'zustand';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { saveProjectSetTemplateEdits, updateProjectSetSettings } from './projectSet';
import { resolveProjectSetTemplate } from './projectSet';
import { syncProjectSetPreviewControls } from './projectSetSession';
import { useSelectionStore } from './selectionStore';
import { runDiscreteHistoryStep } from './historyStore';
import { useTimelineStore } from './timelineStore';
import { type TemplateSetSettings } from './templateSetSettings';

export type SettingsScope = 'studio' | 'template-set' | 'template';
export type SettingsSection =
  | 'workspace'
  | 'export'
  | 'assistant'
  | 'plugins'
  | 'nodos'
  | 'output'
  | 'timing'
  | 'canvas'
  | 'inheritance'
  | 'background'
  | 'guides';

export const SETTINGS_SCOPE_SECTIONS: Record<SettingsScope, readonly SettingsSection[]> = {
  studio: ['workspace', 'export', 'assistant', 'plugins', 'nodos'],
  'template-set': ['output', 'timing', 'canvas', 'inheritance', 'plugins'],
  template: ['output', 'background', 'canvas', 'guides', 'plugins'],
};

export function settingsSectionForScope(scope: SettingsScope, section?: string): SettingsSection {
  const sections = SETTINGS_SCOPE_SECTIONS[scope];
  return sections.includes(section as SettingsSection)
    ? (section as SettingsSection)
    : sections[0]!;
}

/** Navigation belongs to the interface; it never changes or saves a document. */
export const useTemplateSetSettingsStore = create<{
  open: boolean;
  scope: SettingsScope;
  section: SettingsSection;
  show: (scope?: SettingsScope, section?: string) => void;
  close: () => void;
}>((set) => ({
  open: false,
  scope: 'template-set',
  section: 'output',
  show: (scope = 'template-set', section) =>
    set({ open: true, scope, section: settingsSectionForScope(scope, section) }),
  close: () => set({ open: false }),
}));

export function saveTemplateSetSettings(
  settings: TemplateSetSettings,
  inheritance: Record<string, boolean>,
) {
  return runDiscreteHistoryStep(() => {
    const session = useProjectSetStore.getState();
    if (!session.projectSet) throw new Error('Create or open a template set first.');
    const editor = useProjectStore.getState();
    const synced = session.activeTemplateId
      ? saveProjectSetTemplateEdits(session.projectSet, session.activeTemplateId, editor.project)
      : session.projectSet;
    const updated = updateProjectSetSettings(synced, settings, inheritance);
    const resolved = session.activeTemplateId
      ? resolveProjectSetTemplate(updated, session.activeTemplateId)
      : null;
    session.setProjectSet(updated);
    if (resolved) {
      const selected = useSelectionStore.getState().selectedLayerIds;
      const compositionId = editor.activeCompositionId;
      const frame = useTimelineStore.getState().currentFrame;
      useProjectStore.setState({ project: resolved });
      if (resolved.compositions.some((composition) => composition.id === compositionId))
        useProjectStore.getState().setActiveComposition(compositionId);
      useTimelineStore.getState().setCurrentFrame(frame);
      syncProjectSetPreviewControls(updated, session.activeTemplateId!, resolved);
      useSelectionStore.getState().selectMany(selected);
    }
  }, 'Update Template Set defaults');
}

export function setTemplateSettingsInheritance(templateId: string, inherit: boolean) {
  const set = useProjectSetStore.getState().projectSet;
  if (!set) throw new Error('Create or open a template set first.');
  if (!set.templates.some((template) => template.id === templateId))
    throw new Error('Template not found.');
  if (!set.settings) {
    useProjectSetStore.getState().setProjectSet({
      ...set,
      templates: set.templates.map((template) =>
        template.id === templateId ? { ...template, inheritSettings: inherit } : template,
      ),
    });
    return;
  }
  saveTemplateSetSettings(set.settings, { [templateId]: inherit });
}
