import { useEffect, useMemo, useState } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import {
  transitionLogicDraftChanged,
  transitionLogicFingerprint,
  useTransitionLogicDraftStore,
} from '../state/transitionLogicDraftStore';
import {
  transitionLogicEditorComponents,
  transitionLogicEditorErrors,
  transitionLogicEditorSetSnapshot,
} from '../state/transitionLogicEditing';
import {
  attachLivePlayoutViewport,
  loadLivePlayout,
  runLivePlayoutCommand,
  unloadLivePlayout,
  useLivePlayoutStore,
} from '../state/livePlayoutStore';
import { exportProjectSetAsZip } from '../state/projectSetExport';
import { Panel } from './Panel';
import { CoordinatedPreviewSurface } from './CoordinatedPreviewSurface';
import { CoordinatedDraftPreview } from './CoordinatedDraftPreview';
import { PlayoutOperatorControls } from './PlayoutOperatorControls';
import './LivePlayoutPanel.css';

export function LivePlayoutPanel() {
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const currentProject = useProjectStore((state) => state.project);
  const draft = useTransitionLogicDraftStore((state) =>
    projectSet ? state.drafts[projectSet.id] : undefined,
  );
  const sync = useTransitionLogicDraftStore((state) => state.sync);
  const liveRunning = useLivePlayoutStore((state) => !!state.sessionId);
  const [sourceChoice, setSource] = useState<'live' | 'draft' | null>(null);
  const dirty = !!draft && transitionLogicDraftChanged(draft);
  const definition = dirty ? draft.definition : (projectSet?.transitionLogic ?? null);
  const source = sourceChoice ?? (!projectSet?.transitionLogic && definition ? 'draft' : 'live');
  const hasDraftSource = !!projectSet && (!!definition || dirty);
  const conflict =
    !!projectSet &&
    !!draft &&
    dirty &&
    draft.baseline !== transitionLogicFingerprint(projectSet.transitionLogic);
  useEffect(() => {
    if (projectSet) sync(projectSet.id, projectSet.transitionLogic);
  }, [projectSet, sync]);
  useEffect(() => {
    setSource(null);
  }, [projectSet?.id]);
  const draftPreview = useMemo(() => {
    if (source !== 'draft' || !projectSet) return { set: null, errors: [] };
    if (!definition)
      return {
        set: null,
        errors: ['This draft has no playout transitions. Add them in Transitions.'],
      };
    try {
      const set = transitionLogicEditorSetSnapshot(projectSet, currentProject);
      const errors = transitionLogicEditorErrors(
        set,
        definition,
        transitionLogicEditorComponents(set, currentProject),
      );
      return { set: errors.length ? null : set, errors };
    } catch (cause) {
      return { set: null, errors: [cause instanceof Error ? cause.message : String(cause)] };
    }
  }, [source, projectSet, currentProject, definition]);
  return (
    <Panel title="Preview & Export">
      <div className="live-playout-panel preview-export-panel">
        {hasDraftSource && (
          <div
            className="playout-source-choice"
            role="group"
            aria-label="Coordinated preview source"
          >
            <button
              type="button"
              aria-pressed={source === 'live'}
              onClick={() => setSource('live')}
            >
              Live playout
            </button>
            <button
              type="button"
              aria-pressed={source === 'draft'}
              onClick={() => setSource('draft')}
            >
              Draft preview
            </button>
          </div>
        )}
        {source === 'draft' && projectSet ? (
          <>
            <div className="playout-draft-context">
              <span>
                {dirty ? 'Unapplied draft' : 'Applied definition'} · {projectSet.name}
                {liveRunning ? ' · Live output continues' : ''}
              </span>
              <button type="button" onClick={() => setSource('live')}>
                Return to live playout
              </button>
            </div>
            {dirty && (
              <p className="playout-source-notice">
                Previewing unapplied playout transition changes. Apply them in Transitions to use
                them in live playout or export.
                {conflict &&
                  ' The applied definition has also changed since this draft was opened.'}
              </p>
            )}
            {!!draftPreview.errors.length && (
              <div className="playout-error" role="alert">
                <p>Resolve these draft issues before previewing:</p>
                <ul>
                  {draftPreview.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => usePaneRequestStore.getState().reveal('transitions')}
                >
                  Edit transitions
                </button>
              </div>
            )}
            {draftPreview.set && definition && (
              <CoordinatedDraftPreview projectSet={draftPreview.set} definition={definition} />
            )}
          </>
        ) : (
          <LivePlayoutSession />
        )}
      </div>
    </Panel>
  );
}

function LivePlayoutSession() {
  const { window: ownerWindow } = useEditorWindow();
  const live = useLivePlayoutStore();
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const [localError, setLocalError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const action = (operation: () => Promise<unknown>) => {
    setLocalError('');
    void operation().catch((cause) =>
      setLocalError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const exportSet = () => {
    if (!projectSet || exporting) return;
    setExporting(true);
    setExportStatus('');
    action(async () => {
      try {
        const result = await exportProjectSetAsZip(projectSet, undefined, { ownerWindow });
        setExportStatus(
          result.saveResult === 'cancelled'
            ? 'Export cancelled.'
            : result.saveResult === 'prepared'
              ? `Certified package “${result.fileName}” is ready. Choose Save or Download.`
              : `${result.fileName} ${result.saveResult}.`,
        );
      } finally {
        setExporting(false);
      }
    });
  };
  const controls = live.definition ? (
    <PlayoutOperatorControls
      key={live.sessionId}
      definition={live.definition}
      templates={live.templates}
      snapshot={live.snapshot}
      onCommand={runLivePlayoutCommand}
      disabled={!live.snapshot?.loaded}
    />
  ) : null;
  return (
    <div className="live-playout-panel">
      <div className="playout-session-title">
        <strong>{live.sourceSetName || projectSet?.name || 'Live template set'}</strong>
        {live.sessionId && (
          <span>
            {live.width} × {live.height} · {live.snapshot?.frameRate ?? 0} fps
          </span>
        )}
      </div>
      <div className="playout-session-actions">
        <button
          type="button"
          disabled={live.loading || !projectSet?.transitionLogic}
          onClick={() => action(() => loadLivePlayout())}
        >
          {live.loading ? 'Loading…' : live.sessionId ? 'Reload changes' : 'Load set'}
        </button>
        <button
          type="button"
          disabled={!live.sessionId}
          onClick={() => action(() => runLivePlayoutCommand({ type: 'clear' }))}
        >
          Clear all
        </button>
        <button
          type="button"
          disabled={!live.loading && !live.sessionId}
          onClick={() => action(() => unloadLivePlayout())}
        >
          Unload
        </button>
        <button type="button" onClick={() => usePaneRequestStore.getState().reveal('transitions')}>
          Edit transitions
        </button>
      </div>
      {live.sourceChanged && (
        <p className="playout-source-notice">
          The open set has changed. Live output is using its loaded snapshot. Reload changes starts
          a new session with every slot off air.
        </p>
      )}
      {!live.sessionId && (
        <p className="playout-note">
          Load the applied playout transitions, then Prepare or Take a state in each slot. Editing a
          template or closing this pane does not stop live output.
        </p>
      )}
      {(localError || live.error || live.snapshot?.error) && (
        <p className="playout-error" role="alert">
          {localError || live.error || live.snapshot?.error}
        </p>
      )}
      <CoordinatedPreviewSurface
        width={live.width || 1920}
        height={live.height || 1080}
        attach={attachLivePlayoutViewport}
        registerPresentation
        controls={controls}
        emptyMessage={
          live.sessionId
            ? undefined
            : live.loading
              ? 'Loading template set…'
              : 'Load a template set to start coordinated playout.'
        }
      />
      {live.sessionId && (
        <p className="playout-note">
          Focus a slot: P prepares, T or Space takes, U updates, O takes out. Shortcuts are inactive
          while entering data. Preview in the menu bar opens fullscreen.
        </p>
      )}
      {!!live.recentCommands.length && (
        <details className="playout-activity">
          <summary>Command activity ({live.recentCommands.length})</summary>
          <ol>
            {live.recentCommands.map((command) => (
              <li key={command.requestId} className={command.error ? 'playout-error' : undefined}>
                {command.operation}
                {command.slotId
                  ? ` · ${live.definition?.slots.find((slot) => slot.id === command.slotId)?.name ?? command.slotId}`
                  : ''}{' '}
                · {command.status}
                {command.error ? `: ${command.error}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="playout-session-actions">
        <button
          type="button"
          disabled={!projectSet?.transitionLogic || exporting}
          onClick={exportSet}
        >
          {exporting ? 'Exporting…' : 'Export coordinated package…'}
        </button>
      </div>
      {exportStatus && (
        <p className="playout-note" role="status">
          {exportStatus}
        </p>
      )}
      {live.sessionId && (
        <p className="playout-note">
          Package export uses the open set’s applied definition and current template edits.
        </p>
      )}
    </div>
  );
}
