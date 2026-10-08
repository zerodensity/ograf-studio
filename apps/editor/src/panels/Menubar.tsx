import { OgrafLogo } from '../components/OgrafLogo';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { openProjectFromFile, openProjectFromUrl } from '../state/fileIO';
import { TemplateSaveDialog } from '../components/TemplateSaveDialog';
import {
  getHistorySnapshot,
  redo,
  resetHistory,
  subscribeHistory,
  undo,
} from '../state/historyStore';
import { useAgentBridgeStatus } from '../state/agentBridge';
import { importEditableProjectFromOgraf, type OgrafImportResult } from '../state/importOgraf';
import { DOCK_PANE_IDS, DOCK_PANE_LABELS, type DockPaneId } from '../layout/dockModel';
import { selectableLayerIds } from '../state/selectAllLayers';
import './Menubar.css';
import { ProjectNameField } from './ProjectNameField';
import { useDetachedWindows } from '../layout/detachedWindowContext';
import { duplicateSelectedLayers } from '../state/editorShortcuts';
import { STUDIO_BUILD_DATE, STUDIO_VERSION } from '../state/buildInfo';
import {
  canGroupLayers,
  canUngroupLayers,
  copyLayers,
  cutLayers,
  deleteLayers,
  groupLayers,
  pasteLayers,
  ungroupLayers,
} from '../state/layerCommands';
import { useLayerClipboardStore } from '../state/layerClipboardStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { KeyboardShortcutsDialog } from '../components/KeyboardShortcutsDialog';

const USER_GUIDE_URL = 'https://github.com/zerodensity/ograf-studio/blob/stable/docs/USER_GUIDE.md';
const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

const historyTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function Menubar({
  style,
  closedDockPanes = [],
  onToggleDockPane,
}: {
  style?: CSSProperties;
  closedDockPanes?: DockPaneId[];
  onToggleDockPane?: (pane: DockPaneId) => void;
}) {
  const detached = useDetachedWindows();
  const newProject = useProjectStore((s) => s.newProject);
  const loadProject = useProjectStore((s) => s.loadProject);
  const project = useProjectStore((s) => s.project);
  const activeCompositionId = useProjectStore((s) => s.activeCompositionId);
  const select = useSelectionStore((s) => s.select);
  const deselectAll = useSelectionStore((s) => s.deselectAll);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const [status, setStatus] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [importReport, setImportReport] = useState<OgrafImportResult | null>(null);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const windowMenuRef = useRef<HTMLDivElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const clipboardCount = useLayerClipboardStore((state) => state.layers.length);
  const revealPane = usePaneRequestStore((state) => state.reveal);
  const resetLayout = usePaneRequestStore((state) => state.resetLayout);
  const closeMenus = () => {
    setEditMenuOpen(false);
    setWindowMenuOpen(false);
    setHelpMenuOpen(false);
  };
  const history = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
  const agentConnected = useAgentBridgeStatus((state) => state.connected);
  const agentActivity = useAgentBridgeStatus((state) => state.activity);

  useEffect(() => {
    if (!editMenuOpen && !windowMenuOpen && !helpMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        editMenuRef.current?.contains(target) ||
        windowMenuRef.current?.contains(target) ||
        helpMenuRef.current?.contains(target)
      )
        return;
      setEditMenuOpen(false);
      setWindowMenuOpen(false);
      setHelpMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setEditMenuOpen(false);
      setWindowMenuOpen(false);
      setHelpMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [editMenuOpen, windowMenuOpen, helpMenuOpen]);

  const applyUndo = (steps = 1) => {
    const label = history.past.at(-1)?.label;
    undo(steps);
    setEditMenuOpen(false);
    setStatus(steps === 1 && label ? `Undid: ${label}` : `Undid ${steps} changes`);
  };

  const applyRedo = (steps = 1) => {
    const label = history.future[0]?.label;
    redo(steps);
    setEditMenuOpen(false);
    setStatus(steps === 1 && label ? `Redid: ${label}` : `Redid ${steps} changes`);
  };

  const selectAllLayers = () => {
    const composition = project.compositions.find(
      (candidate) => candidate.id === activeCompositionId,
    );
    const layerIds = composition ? selectableLayerIds(composition) : [];
    window.getSelection()?.removeAllRanges();
    selectMany(layerIds);
    setEditMenuOpen(false);
    setStatus(`Selected ${layerIds.length} layer${layerIds.length === 1 ? '' : 's'}`);
  };

  const handleDuplicate = () => {
    const duplicatedIds = duplicateSelectedLayers();
    setEditMenuOpen(false);
    if (duplicatedIds.length > 0) {
      setStatus(`Duplicated ${duplicatedIds.length} layer${duplicatedIds.length === 1 ? '' : 's'}`);
    }
  };

  const plural = (count: number) => `${count} layer${count === 1 ? '' : 's'}`;
  const runLayerCommand = (command: () => string) => {
    setEditMenuOpen(false);
    setStatus(command());
  };

  const handleDeselect = () => {
    deselectAll();
    setEditMenuOpen(false);
    setStatus('Selection cleared');
  };

  const handleNew = () => {
    if (!confirm('Start a new project? Unsaved changes in the current project will be lost.'))
      return;
    newProject();
    resetHistory();
    select(null);
    setStatus('New project created');
  };

  const handleOpen = async () => {
    try {
      const opened = await openProjectFromFile();
      if (opened) {
        loadProject(opened);
        resetHistory();
        select(null);
        setStatus(`Opened "${opened.name}"`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to open project');
    }
  };

  const handleImportOgraf = async () => {
    if (
      !confirm(
        'Import an OGraf package as an editable project? Unsaved changes in the current project will be lost after a package is selected.',
      )
    )
      return;
    setStatus('Reading OGraf package…');
    try {
      const imported = await importEditableProjectFromOgraf();
      if (!imported) {
        setStatus('Import cancelled');
        return;
      }
      loadProject(imported.project);
      resetHistory();
      select(null);
      setImportReport(imported);
      setStatus(
        imported.mode === 'compiled-descriptor'
          ? `Imported "${imported.project.name}" with editable layers`
          : imported.mode === 'embedded-project'
            ? `Opened embedded editable source for "${imported.project.name}"`
            : `Imported manifest metadata for "${imported.project.name}"`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to import OGraf package');
    }
  };

  const handleOpenUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remoteUrl.trim() || remoteBusy) return;
    setRemoteBusy(true);
    setStatus('Downloading remote project…');
    try {
      const opened = await openProjectFromUrl(remoteUrl);
      if (
        !confirm(
          `Open remote project "${opened.name}"? Unsaved changes in the current project will be lost.`,
        )
      ) {
        setStatus('Remote project open cancelled');
        return;
      }
      loadProject(opened);
      resetHistory();
      select(null);
      setRemoteDialogOpen(false);
      setStatus(`Opened remote project "${opened.name}"`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to open remote project');
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleSave = () => setSaveDialogOpen(true);

  return (
    <header className="menubar" style={style}>
      {saveDialogOpen ? (
        <TemplateSaveDialog
          project={project}
          onClose={() => setSaveDialogOpen(false)}
          onSaved={(mode, frame) => {
            const current = useProjectStore.getState();
            if (
              current.project.id === project.id &&
              (current.project.thumbnailFrame ?? null) !== frame
            )
              current.setProjectMeta({ thumbnailFrame: frame });
            setSaveDialogOpen(false);
            setStatus(
              mode === 'saved'
                ? 'Template + PNG saved (certified)'
                : 'Template + PNG ZIP downloaded',
            );
          }}
        />
      ) : null}
      <span className="menubar-brand" aria-label="OGraf Studio">
        <OgrafLogo />
        Studio
      </span>
      <ProjectNameField />
      <nav className="menubar-actions">
        <button type="button" onClick={handleNew}>
          New
        </button>
        <button type="button" onClick={handleOpen}>
          Open
        </button>
        <button type="button" onClick={() => setRemoteDialogOpen(true)}>
          Open URL
        </button>
        <button
          type="button"
          onClick={handleImportOgraf}
          title="Best-effort conversion from an OGraf .zip package or *.ograf.json manifest."
        >
          Import OGraf
        </button>
        <button
          type="button"
          onClick={handleSave}
          title="Save editable .ogs source with a transparent PNG thumbnail."
        >
          Save Project
        </button>
        <button
          type="button"
          onClick={() => revealPane('export')}
          title="Open Preview & Export to test and export the .ograf.zip package."
        >
          Export…
        </button>
        <div className="menubar-edit-control" ref={editMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={editMenuOpen}
            onClick={() => {
              setEditMenuOpen((open) => !open);
              setWindowMenuOpen(false);
              setHelpMenuOpen(false);
            }}
          >
            Edit
          </button>
          {editMenuOpen ? (
            <div className="menubar-edit-menu" role="menu" aria-label="Edit and history">
              <button
                type="button"
                role="menuitem"
                disabled={!history.canUndo}
                onClick={() => applyUndo()}
              >
                <span>{history.canUndo ? `Undo ${history.past.at(-1)?.label}` : 'Undo'}</span>
                <kbd>Ctrl+Z</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!history.canRedo}
                onClick={() => applyRedo()}
              >
                <span>{history.canRedo ? `Redo ${history.future[0]?.label}` : 'Redo'}</span>
                <kbd>Ctrl+Y</kbd>
              </button>
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={() => runLayerCommand(() => `Cut ${plural(cutLayers())}`)}
              >
                <span>Cut</span>
                <kbd>{MOD}+X</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={() => runLayerCommand(() => `Copied ${plural(copyLayers())}`)}
              >
                <span>Copy</span>
                <kbd>{MOD}+C</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={clipboardCount === 0}
                onClick={() => runLayerCommand(() => `Pasted ${plural(pasteLayers().length)}`)}
              >
                <span>Paste</span>
                <kbd>{MOD}+V</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={handleDuplicate}
              >
                <span>Duplicate</span>
                <kbd>{MOD}+Shift+D</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={() => runLayerCommand(() => `Deleted ${plural(deleteLayers())}`)}
              >
                <span>Delete</span>
                <kbd>Del</kbd>
              </button>
              <div className="menubar-menu-separator" role="separator" />
              {canUngroupLayers() ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    runLayerCommand(() => (ungroupLayers() ? 'Ungrouped' : 'Nothing to ungroup'))
                  }
                >
                  <span>Ungroup</span>
                  <kbd>{MOD}+Shift+G</kbd>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canGroupLayers()}
                  onClick={() =>
                    runLayerCommand(() =>
                      groupLayers() ? `Grouped ${plural(selectedLayerIds.length)}` : 'Not grouped',
                    )
                  }
                >
                  <span>Group</span>
                  <kbd>{MOD}+G</kbd>
                </button>
              )}
              <div className="menubar-menu-separator" role="separator" />
              <button type="button" role="menuitem" onClick={selectAllLayers}>
                <span>Select all layers</span>
                <kbd>Ctrl+A</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={handleDeselect}
              >
                <span>Deselect all</span>
                <kbd>Ctrl+D</kbd>
              </button>
              <div className="menubar-history-heading" role="presentation">
                History
                <span>{history.past.length + history.future.length} actions</span>
              </div>
              <div className="menubar-history-list" role="group" aria-label="Recent history">
                {[...history.past].reverse().map((item, index) => (
                  <button
                    key={`undo-${item.id}`}
                    type="button"
                    className="menubar-history-item"
                    role="menuitem"
                    title={`Undo ${index + 1} ${index === 0 ? 'action' : 'actions'}`}
                    onClick={() => applyUndo(index + 1)}
                  >
                    <span aria-hidden="true">↶</span>
                    <span>{item.label}</span>
                    <time>{historyTime(item.timestamp)}</time>
                  </button>
                ))}
                <div className="menubar-history-current" aria-current="step">
                  <span aria-hidden="true">●</span>
                  <span>Current state</span>
                </div>
                {history.future.map((item, index) => (
                  <button
                    key={`redo-${item.id}`}
                    type="button"
                    className="menubar-history-item is-future"
                    role="menuitem"
                    title={`Redo ${index + 1} ${index === 0 ? 'action' : 'actions'}`}
                    onClick={() => applyRedo(index + 1)}
                  >
                    <span aria-hidden="true">↷</span>
                    <span>{item.label}</span>
                    <time>{historyTime(item.timestamp)}</time>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="menubar-window-control" ref={windowMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={windowMenuOpen}
            onClick={() => {
              setWindowMenuOpen((open) => !open);
              setEditMenuOpen(false);
              setHelpMenuOpen(false);
            }}
          >
            Window
          </button>
          {windowMenuOpen ? (
            <div className="menubar-window-menu" role="menu" aria-label="Window panes">
              {DOCK_PANE_IDS.map((pane) => {
                const open = !closedDockPanes.includes(pane);
                return (
                  <button
                    key={pane}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={open}
                    onClick={() => {
                      if (detached.windows[pane]) detached.open(pane);
                      else onToggleDockPane?.(pane);
                      setWindowMenuOpen(false);
                    }}
                  >
                    <span aria-hidden="true">{open ? '✓' : ''}</span>
                    {DOCK_PANE_LABELS[pane]}
                    {detached.windows[pane] ? ' ↗' : ''}
                  </button>
                );
              })}
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  resetLayout();
                  setWindowMenuOpen(false);
                  setStatus('Panes back in their original places');
                }}
              >
                <span aria-hidden="true" />
                Reset layout
              </button>
            </div>
          ) : null}
        </div>
        <div className="menubar-window-control" ref={helpMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={helpMenuOpen}
            onClick={() => {
              setHelpMenuOpen((open) => !open);
              setEditMenuOpen(false);
              setWindowMenuOpen(false);
            }}
          >
            Help
          </button>
          {helpMenuOpen ? (
            <div className="menubar-window-menu" role="menu" aria-label="Help">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShortcutsOpen(true);
                  closeMenus();
                }}
              >
                <span aria-hidden="true" />
                Keyboard shortcuts
              </button>
              <a
                href={USER_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                className="menubar-menu-link"
                onClick={closeMenus}
              >
                <span aria-hidden="true" />
                User guide ↗
              </a>
              <div className="menubar-build-info" role="presentation">
                <a
                  href="https://github.com/zerodensity/ograf-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                >
                  OGraf Studio v{STUDIO_VERSION}
                </a>
                <time dateTime={STUDIO_BUILD_DATE}>Build {STUDIO_BUILD_DATE}</time>
              </div>
            </div>
          ) : null}
        </div>
      </nav>
      <span
        className={`menubar-agent-status${agentConnected ? ' is-connected' : ''}`}
        title={agentActivity}
      >
        <span className="menubar-agent-dot" />
        {agentActivity}
      </span>
      {status && <span className="menubar-status">{status}</span>}
      {shortcutsOpen ? <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {remoteDialogOpen && (
        <section
          className="ograf-import-report remote-project-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remote-project-dialog-title"
        >
          <form onSubmit={(event) => void handleOpenUrl(event)}>
            <div className="ograf-import-report-header">
              <div>
                <strong id="remote-project-dialog-title">Open project from URL</strong>
                <span>Download editable .ogs source over HTTP(S)</span>
              </div>
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => setRemoteDialogOpen(false)}
                aria-label="Close remote project dialog"
              >
                ×
              </button>
            </div>
            <p>
              The server must allow browser CORS access. The project is downloaded and validated
              before you confirm replacing the current project; credentials are never sent.
            </p>
            <label className="remote-project-url-field">
              <span>Project URL</span>
              <input
                autoFocus
                type="url"
                inputMode="url"
                required
                placeholder="https://raw.githubusercontent.com/owner/repo/main/news.ogs"
                value={remoteUrl}
                disabled={remoteBusy}
                onChange={(event) => setRemoteUrl(event.target.value)}
              />
            </label>
            <div className="ograf-import-report-actions">
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => setRemoteDialogOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" disabled={remoteBusy || !remoteUrl.trim()}>
                {remoteBusy ? 'Downloading…' : 'Open and replace'}
              </button>
            </div>
          </form>
        </section>
      )}
      {importReport && (
        <section
          className="ograf-import-report"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ograf-import-report-title"
        >
          <div className="ograf-import-report-header">
            <div>
              <strong id="ograf-import-report-title">OGraf import report</strong>
              <span>{importReport.project.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportReport(null)}
              aria-label="Close import report"
            >
              ×
            </button>
          </div>
          <p>
            {importReport.mode === 'embedded-project'
              ? 'Exact embedded editor source was recovered.'
              : importReport.mode === 'compiled-descriptor'
                ? 'Compiled layers and timelines were reconstructed as editable content.'
                : 'Only manifest-level information could be reconstructed from the opaque runtime.'}
          </p>
          <dl>
            <div>
              <dt>Manifest</dt>
              <dd>{importReport.manifestFileName}</dd>
            </div>
            <div>
              <dt>Layers</dt>
              <dd>{importReport.project.compositions[0]?.layers.length ?? 0}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{importReport.warnings.length}</dd>
            </div>
          </dl>
          {importReport.warnings.length > 0 && (
            <ul>
              {importReport.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="ograf-import-report-actions">
            <button type="button" onClick={() => setImportReport(null)}>
              Continue editing
            </button>
          </div>
        </section>
      )}
    </header>
  );
}
