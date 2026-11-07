import { create } from 'zustand';
import type { StudioPluginSnapshot } from '@ograf-editor/scene-model';
import { usePaneRequestStore } from './paneRequestStore';
import { useTemplateSetSettingsStore } from './templateSetSettingsStore';

export interface PluginPanelSelection {
  id: string;
  kind?: StudioPluginSnapshot['manifest']['kind'];
}

/** Templates use the dockable browser; application management uses Studio preferences. */
export const useConfigurationRequestStore = create<{
  requestId: number;
  selection: PluginPanelSelection | null;
  view: 'templates' | 'settings';
  category: StudioPluginSnapshot['manifest']['kind'];
  versionKeys: Record<string, string>;
  settingsRequestId: number;
  settingsSelection: PluginPanelSelection | null;
  settingsVersionKey: string | undefined;
  settingsAddRequestId: number;
  open(pluginId?: string, kind?: StudioPluginSnapshot['manifest']['kind']): void;
  openSettings(
    pluginId?: string,
    kind?: StudioPluginSnapshot['manifest']['kind'],
    versionKey?: string,
    add?: boolean,
  ): void;
}>((set) => ({
  requestId: 0,
  selection: null,
  view: 'templates',
  category: 'animation-presets',
  versionKeys: {},
  settingsRequestId: 0,
  settingsSelection: null,
  settingsVersionKey: undefined,
  settingsAddRequestId: 0,
  open: (pluginId, kind) => {
    if (!pluginId) {
      useConfigurationRequestStore.getState().openSettings();
      return;
    }
    set((state) => ({
      requestId: state.requestId + 1,
      selection: pluginId ? { id: pluginId, ...(kind ? { kind } : {}) } : state.selection,
      view: 'templates',
      category: kind ?? state.selection?.kind ?? state.category,
    }));
    usePaneRequestStore.getState().reveal('plugins');
  },
  openSettings: (pluginId, kind, versionKey, add = false) => {
    set((state) => ({
      settingsRequestId: state.settingsRequestId + 1,
      settingsSelection: pluginId ? { id: pluginId, ...(kind ? { kind } : {}) } : null,
      settingsVersionKey: versionKey,
      settingsAddRequestId: add ? state.settingsRequestId + 1 : 0,
    }));
    useTemplateSetSettingsStore.getState().show('studio', 'plugins');
  },
}));
