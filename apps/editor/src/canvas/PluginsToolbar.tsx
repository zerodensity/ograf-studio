import { useMemo } from 'react';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { useDetachedWindows } from '../layout/detachedWindowContext';
import { groupPluginTools, safePluginIcon, type PluginToolGroup } from './pluginTools';
import './PluginsToolbar.css';

function ChartToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3v18h18" />
      <rect x="6" y="12" width="3" height="6" />
      <rect x="11" y="8" width="3" height="10" />
      <rect x="16" y="5" width="3" height="13" />
    </svg>
  );
}

function AnimationToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h8m-3-3 3 3-3 3" />
      <rect x="13" y="6" width="8" height="12" rx="1" />
      <path d="m15 2 .7 2L18 5l-2.3 1-.7 2-.7-2L12 5l2.3-1Z" />
    </svg>
  );
}

function ShaderToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="1" />
      <path d="M3 16c5-15 7 9 12-4s5 3 7-4M3 20c5-12 7 5 12-4s5 3 7-2" />
    </svg>
  );
}

export function PluginToolButtons({
  groups,
  onOpen,
}: {
  groups: readonly PluginToolGroup[];
  onOpen(id: string): void;
}) {
  return (
    <>
      <span className="plugins-toolbar-label">Plugins</span>
      <div className="plugins-toolbar-scroll">
        {groups.length === 0 ? (
          <span className="plugins-toolbar-empty">
            No plugins enabled. Use Plugins → Add plugin.
          </span>
        ) : null}
        {groups.map((group) => {
          const icon = safePluginIcon(group.preferred.snapshot.manifest.icon);
          return (
            <button
              key={group.id}
              type="button"
              className="plugin-tool-button"
              aria-label={
                group.kind === 'chart'
                  ? `Add chart with ${group.label}`
                  : group.kind === 'shader-pack'
                    ? `Apply shader from ${group.label}`
                    : `Apply animation from ${group.label}`
              }
              title={`Open ${group.label} in Plugins`}
              onClick={() => onOpen(group.id)}
            >
              {icon ? (
                <img src={icon} alt="" draggable={false} />
              ) : group.kind === 'chart' ? (
                <ChartToolIcon />
              ) : group.kind === 'shader-pack' ? (
                <ShaderToolIcon />
              ) : (
                <AnimationToolIcon />
              )}
              <span>{group.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Toolbar shortcuts select the relevant application in the single dockable Plugins pane. */
export function PluginsToolbar() {
  const settings = useRendererPluginSettingsStore();
  const detached = useDetachedWindows();
  const groups = useMemo(
    () => groupPluginTools(settings.installed, settings.defaultProvider),
    [settings.installed, settings.defaultProvider],
  );
  const focusDetached = () => {
    if (detached.windows.plugins) detached.open('plugins');
  };
  const open = (id: string) => {
    const latest = useRendererPluginSettingsStore.getState();
    const group = groupPluginTools(latest.installed, latest.defaultProvider).find(
      (entry) => entry.id === id,
    );
    if (!group) return;
    useConfigurationRequestStore.getState().open(group.id, group.kind);
    focusDetached();
  };
  return (
    <div className="plugins-toolbar" role="toolbar" aria-label="Plugins">
      <PluginToolButtons groups={groups} onOpen={open} />
    </div>
  );
}
