import { useState, type CSSProperties, type FormEvent } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { openProjectFromFile, openProjectFromUrl, saveProjectToFile } from '../state/fileIO';
import { resetHistory } from '../state/historyStore';
import { useAgentBridgeStatus } from '../state/agentBridge';
import { importEditableProjectFromOgraf, type OgrafImportResult } from '../state/importOgraf';
import { DOCK_PANE_IDS, DOCK_PANE_LABELS, type DockPaneId } from '../layout/dockModel';
import './Menubar.css';

export function Menubar({
  style,
  closedDockPanes = [],
  onToggleDockPane,
}: {
  style?: CSSProperties;
  closedDockPanes?: DockPaneId[];
  onToggleDockPane?: (pane: DockPaneId) => void;
}) {
  const projectName = useProjectStore((s) => s.project.name);
  const newProject = useProjectStore((s) => s.newProject);
  const loadProject = useProjectStore((s) => s.loadProject);
  const project = useProjectStore((s) => s.project);
  const select = useSelectionStore((s) => s.select);
  const [status, setStatus] = useState('');
  const [importReport, setImportReport] = useState<OgrafImportResult | null>(null);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const agentConnected = useAgentBridgeStatus((state) => state.connected);
  const agentActivity = useAgentBridgeStatus((state) => state.activity);

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

  const handleSave = async () => {
    setStatus('Running OGraf compatibility tests…');
    try {
      const result = await saveProjectToFile(project);
      setStatus(
        result === 'saved'
          ? 'Project source saved — OGraf certified'
          : result === 'downloaded'
            ? 'Project source downloaded — OGraf certified'
            : 'Save cancelled',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Save blocked by compatibility gate');
    }
  };

  return (
    <header className="menubar" style={style}>
      <span className="menubar-brand">OGraf Studio</span>
      <span className="menubar-project-name">{projectName}</span>
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
          title="Save editable .ogs source. Use Export .ograf.zip for a playout package."
        >
          Save Project
        </button>
        <div className="menubar-window-control">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={windowMenuOpen}
            onClick={() => setWindowMenuOpen((open) => !open)}
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
                      onToggleDockPane?.(pane);
                      setWindowMenuOpen(false);
                    }}
                  >
                    <span aria-hidden="true">{open ? '✓' : ''}</span>
                    {DOCK_PANE_LABELS[pane]}
                  </button>
                );
              })}
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
