import { useId, useMemo, useState } from 'react';
import {
  BUILT_IN_EXPORT_PROFILES,
  getExportProfile,
  type ExportProfileMode,
} from '@ograf-editor/codegen';
import { hasElementMediaPaint } from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  downloadProjectSource,
  saveProjectSetToFile,
  saveProjectSourceToFile,
} from '../state/fileIO';
import { exportProjectAsZip } from '../state/exportPackage';
import { exportProjectSetAsZip } from '../state/projectSetExport';
import { renameProjectSet, saveProjectSetTemplateEdits } from '../state/projectSet';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import { transitionLogicEditorSetSnapshot } from '../state/transitionLogicEditing';
import { Panel } from './Panel';
import './PresenterExportPanel.css';

/** One export destination for standalone templates and complete editable template sets. */
export function PresenterExportPanel() {
  const project = useProjectStore((state) => state.project);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const { window: ownerWindow } = useEditorWindow();
  const [profileId, setProfileId] = useState<ExportProfileMode>('dual');
  const [archiveMode, setArchiveMode] = useState<'compact' | 'compatible'>('compact');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const profileInputId = useId();
  const archiveInputId = useId();
  const usesMedia = useMemo(
    () =>
      [project, ...(projectSet?.templates.map((template) => template.project) ?? [])].some(
        (source) =>
          source.compositions.some((composition) =>
            composition.layers.some(
              (layer) => hasElementMediaPaint(layer.element) || layer.element.type === 'audio',
            ),
          ),
      ),
    [project, projectSet],
  );
  const effectiveProfileId = usesMedia ? 'realtime' : profileId;
  const coordinated = Boolean(projectSet?.transitionLogic);
  const sourceName = projectSet?.name ?? project.name;

  const run = async (message: string, action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus(message);
    try {
      setStatus(await action());
    } catch (cause) {
      setStatus('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveSource = (downloadOnly: boolean) =>
    run('Preparing editable source…', async () => {
      const session = useProjectSetStore.getState();
      const current = useProjectStore.getState();
      if (session.projectSet) {
        const snapshot = transitionLogicEditorSetSnapshot(session.projectSet);
        const result = await saveProjectSetToFile(snapshot, {
          downloadOnly,
          ownerWindow,
          archiveMode,
          onProgress: (progress) =>
            setStatus(`${Math.floor(progress.percent)}% · ${progress.message}`),
        });
        if (result.status === 'cancelled') return 'Save cancelled.';
        const latest = useProjectSetStore.getState();
        // Source generation may take time. Preserve edits made while it was being saved.
        if (
          archiveMode === 'compact' &&
          latest.projectSet?.id === snapshot.id &&
          result.status === 'saved'
        )
          latest.setProjectSet(renameProjectSet(latest.projectSet, result.projectSet.name));
        return `Editable template set ${result.status}: ${result.fileName}`;
      }
      if (downloadOnly) {
        await downloadProjectSource(current.project, { ownerWindow });
        return 'Editable template downloaded.';
      }
      const result = await saveProjectSourceToFile(current.project, { ownerWindow });
      if (result.status === 'cancelled') return 'Save cancelled.';
      const latest = useProjectStore.getState();
      const latestSession = useProjectSetStore.getState();
      if (latest.project.id === result.project.id && !latestSession.projectSet)
        latest.setProjectMeta({ name: result.project.name });
      return `Editable template ${result.status}: ${result.fileName}`;
    });

  const exportPackage = (downloadOnly: boolean) =>
    run('Certifying and packaging output…', async () => {
      const session = useProjectSetStore.getState();
      const current = useProjectStore.getState();
      const profile = getExportProfile(effectiveProfileId);
      if (session.projectSet) {
        const snapshot = session.activeTemplateId
          ? saveProjectSetTemplateEdits(
              session.projectSet,
              session.activeTemplateId,
              current.project,
            )
          : session.projectSet;
        const result = await exportProjectSetAsZip(snapshot, profile, {
          downloadOnly,
          ownerWindow,
        });
        return result.saveResult === 'cancelled'
          ? 'Export cancelled.'
          : result.saveResult === 'prepared'
            ? `Certified package “${result.fileName}” is ready. Choose Save or Download.`
            : `Certified ${result.mode === 'coordinated' ? 'coordinated package' : 'template packages'} ${result.saveResult}: ${result.fileName}`;
      }
      const composition = current.project.compositions.find(
        (candidate) => candidate.id === current.project.mainCompositionId,
      );
      if (!composition) throw new Error('Select a main composition before exporting.');
      const result = await exportProjectAsZip(current.project, composition, profile, {
        downloadOnly,
        ownerWindow,
      });
      return result.saveResult === 'cancelled'
        ? 'Export cancelled.'
        : `Certified OGraf package ${result.saveResult}.`;
    });

  return (
    <Panel title="Export">
      <div className="presenter-export-panel" aria-busy={busy}>
        <header>
          <strong>{sourceName}</strong>
          <span>
            {projectSet
              ? `${projectSet.templates.length} template${projectSet.templates.length === 1 ? '' : 's'}`
              : 'Single template'}
          </span>
        </header>
        <section aria-label="Editable source">
          <h3>Editable source</h3>
          <p>
            Save the {projectSet ? 'complete template set and settings' : 'template'} as an .ogs
            document for reopening in Studio.
          </p>
          {projectSet && (
            <>
              <label htmlFor={archiveInputId}>Template set format</label>
              <select
                id={archiveInputId}
                value={archiveMode}
                disabled={busy}
                onChange={(event) => setArchiveMode(event.target.value as 'compact' | 'compatible')}
              >
                <option value="compact">Compact (recommended)</option>
                <option value="compatible">Compatible with earlier Studio</option>
              </select>
              <p>
                {archiveMode === 'compact'
                  ? 'Shares resources across templates to keep the file small.'
                  : 'Creates a larger copy for earlier Studio versions that support template sets.'}
              </p>
            </>
          )}
          <div className="presenter-export-actions">
            <button type="button" disabled={busy} onClick={() => void saveSource(false)}>
              Save .ogs…
            </button>
            <button type="button" disabled={busy} onClick={() => void saveSource(true)}>
              Download .ogs
            </button>
          </div>
        </section>
        <section aria-label="Playback package">
          <h3>Playback package</h3>
          <p>
            {coordinated
              ? 'Export one coordinated .ograf.zip package using the applied playout transitions.'
              : projectSet
                ? 'Export an .ograf-set.zip archive containing one certified .ograf.zip package per template.'
                : 'Export a certified .ograf.zip package for OGraf-compatible players.'}
          </p>
          <label htmlFor={profileInputId}>Output profile</label>
          <select
            id={profileInputId}
            value={effectiveProfileId}
            disabled={busy}
            onChange={(event) => setProfileId(event.target.value as ExportProfileMode)}
          >
            {BUILT_IN_EXPORT_PROFILES.map((profile) => (
              <option
                key={profile.id}
                value={profile.id}
                disabled={usesMedia && profile.mode !== 'realtime'}
              >
                {profile.name}
              </option>
            ))}
          </select>
          {usesMedia && <p>Media and audio require real-time output.</p>}
          <p>
            Each export runs the compatibility checks before saving. The output profile applies only
            to the package.
          </p>
          <div className="presenter-export-actions">
            <button
              type="button"
              disabled={busy || projectSet?.templates.length === 0}
              onClick={() => void exportPackage(false)}
            >
              Export package…
            </button>
            <button
              type="button"
              disabled={busy || projectSet?.templates.length === 0}
              onClick={() => void exportPackage(true)}
            >
              Download package
            </button>
          </div>
        </section>
        {status && (
          <p className="presenter-export-status" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="presenter-export-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
