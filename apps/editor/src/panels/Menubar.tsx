import { useState, type CSSProperties } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { openProjectFromFile, saveProjectToFile } from '../state/fileIO';
import { resetHistory } from '../state/historyStore';
import { useAgentBridgeStatus } from '../state/agentBridge';
import { importEditableProjectFromOgraf, type OgrafImportResult } from '../state/importOgraf';
import './Menubar.css';

export function Menubar({ style }: { style?: CSSProperties }) {
  const projectName = useProjectStore((s) => s.project.name);
  const newProject = useProjectStore((s) => s.newProject);
  const loadProject = useProjectStore((s) => s.loadProject);
  const project = useProjectStore((s) => s.project);
  const select = useSelectionStore((s) => s.select);
  const [status, setStatus] = useState('');
  const [importReport, setImportReport] = useState<OgrafImportResult | null>(null);
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
          title="Save editable .ogeproj source. Use Export .ograf.zip for a playout package."
        >
          Save Project
        </button>
      </nav>
      <span
        className={`menubar-agent-status${agentConnected ? ' is-connected' : ''}`}
        title={agentActivity}
      >
        <span className="menubar-agent-dot" />
        {agentActivity}
      </span>
      {status && <span className="menubar-status">{status}</span>}
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
