import { rendererPluginKey, studioPluginReference } from '@ograf-editor/scene-model';
import { useRef, useState } from 'react';
import { ContextMenu } from './ContextMenu';
import { isDomElement } from '../layout/EditorWindow';
import type { InstalledApplicationGroup } from './configurationApplications';
import { pluginPanelVersion } from '../panels/pluginPanelSelection';

export function PluginCard({
  group,
  selected,
  versionKey,
  onSelect,
  onSelectVersion,
  onManage,
}: {
  group: InstalledApplicationGroup;
  selected: boolean;
  versionKey?: string;
  onSelect(): void;
  onSelectVersion(key: string): void;
  onManage?: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setMenu(null);
    nameButton.current?.focus();
  };
  const entry = pluginPanelVersion(group, versionKey);
  const key = rendererPluginKey(studioPluginReference(entry.snapshot));
  return (
    <>
      <article
        className={`plugins-panel-plugin-card${selected ? ' is-selected' : ''}`}
        aria-label={`Plugin ${group.name}`}
        title={onManage ? 'Use the gear button or right-click to manage this plugin.' : undefined}
        onContextMenu={(event) => {
          if (!onManage || (isDomElement(event.target) && event.target.closest('select'))) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (
            !onManage ||
            !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom });
        }}
      >
        <button
          ref={nameButton}
          type="button"
          className="plugins-panel-plugin-name"
          aria-pressed={selected}
          aria-description={
            onManage ? 'Right-click or press Shift+F10 to manage this plugin.' : undefined
          }
          onClick={onSelect}
        >
          {group.name}
        </button>
        {selected ? (
          <>
            {entry.bundled ? (
              <span className="plugins-panel-status" title="Included with Studio">
                Included
              </span>
            ) : null}
            {!entry.trusted || !entry.enabled ? (
              <span className="plugins-panel-status">
                {!entry.trusted ? 'Needs review' : 'Disabled'}
              </span>
            ) : null}
            <select
              aria-label={`Active version for ${group.name}`}
              value={key}
              onChange={(event) => onSelectVersion(event.target.value)}
            >
              {group.versions.map((version) => {
                const versionKey = rendererPluginKey(studioPluginReference(version.snapshot));
                const duplicate =
                  group.versions.filter(
                    (other) =>
                      other.snapshot.manifest.version === version.snapshot.manifest.version,
                  ).length > 1;
                return (
                  <option key={versionKey} value={versionKey}>
                    {version.snapshot.manifest.version}
                    {duplicate ? ` · ${version.snapshot.sha256.slice(0, 8)}` : ''}
                  </option>
                );
              })}
            </select>
          </>
        ) : null}
        {onManage ? (
          <button
            type="button"
            className="plugins-panel-plugin-settings"
            aria-label={`Settings for ${group.name}`}
            title="Plugin settings"
            onClick={() => {
              setMenu(null);
              onManage();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        ) : null}
      </article>
      {menu && onManage ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={`Manage ${group.name}`}
          items={[{ id: 'manage', label: 'Manage plugin…', onSelect: onManage }]}
          onClose={closeMenu}
        />
      ) : null}
    </>
  );
}
