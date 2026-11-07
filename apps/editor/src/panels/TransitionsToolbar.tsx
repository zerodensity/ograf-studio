import { useState } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { saveProjectSetToFile } from '../state/fileIO';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { exportProjectSetAsZip } from '../state/projectSetExport';
import { useProjectSetStore } from '../state/projectSetStore';
import {
  applyTransitionLogicDefinition,
  transitionLogicEditorSetSnapshot,
} from '../state/transitionLogicEditing';
import { useTransitionLogicDraftStore } from '../state/transitionLogicDraftStore';

/** Export and download the coordinated set, as the Transition Logic tab's toolbar did. */
export function TransitionsToolbar({ name, ready }: { name: string; ready: boolean }) {
  const { window: ownerWindow } = useEditorWindow();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const task = async (start: string, work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage(start);
    try {
      setMessage(await work());
    } catch (cause) {
      setMessage('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const latest = () => {
    const set = useProjectSetStore.getState().projectSet;
    if (!set) throw new Error('Open a template set first.');
    return set;
  };
  const downloadSource = () =>
    task('Preparing the editable template set…', async () => {
      const result = await saveProjectSetToFile(transitionLogicEditorSetSnapshot(latest()), {
        downloadOnly: true,
        onProgress: (progress) =>
          setMessage(`${Math.floor(progress.percent)}% · ${progress.message}`),
      });
      return result.status === 'cancelled' ? '' : `Downloaded “${result.fileName}”.`;
    });
  const exportPackage = (downloadOnly: boolean) =>
    task('Certifying the coordinated package…', async () => {
      const result = await exportProjectSetAsZip(latest(), undefined, {
        downloadOnly,
        ownerWindow,
      });
      return result.saveResult === 'cancelled'
        ? 'Export cancelled.'
        : result.saveResult === 'prepared'
          ? `Certified package “${result.fileName}” is ready. Choose Save or Download.`
          : `${result.saveResult === 'saved' ? 'Exported' : 'Downloaded'} “${result.fileName}”.`;
    });
  return (
    <div className="tr-toolbar">
      <span className="tr-toolbar-title" title={name}>
        {name}
      </span>
      <button type="button" onClick={() => usePaneRequestStore.getState().reveal('export')}>
        Preview &amp; Export
      </button>
      <button
        type="button"
        disabled={!ready || busy}
        title="Download the editable template set (.ogs)"
        onClick={() => void downloadSource()}
      >
        Download .ogs
      </button>
      <button
        type="button"
        disabled={!ready || busy}
        title="Export one coordinated .ograf.zip package"
        onClick={() => void exportPackage(false)}
      >
        {busy ? 'Working…' : 'Export package…'}
      </button>
      <button
        type="button"
        disabled={!ready || busy}
        title="Certify and download the coordinated .ograf.zip"
        onClick={() => void exportPackage(true)}
      >
        Download package
      </button>
      {message && (
        <span className="tr-toolbar-status" role="status">
          {message}
        </span>
      )}
      {error && (
        <span className="tr-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Remove lanes and timings; templates and components stay, and it can be undone. */
export function TurnOffPlayout({ locked }: { locked?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="tr-checks tr-turn-off">
      {confirming ? (
        <>
          <span>
            Turn off playout? Templates and components are kept; lanes and timings are removed. You
            can undo this.
          </span>
          <span className="tr-check-actions">
            <button
              type="button"
              onClick={() => {
                try {
                  const set = useProjectSetStore.getState().projectSet;
                  applyTransitionLogicDefinition(null);
                  if (set)
                    useTransitionLogicDraftStore
                      .getState()
                      .reset(set.id, useProjectSetStore.getState().projectSet?.transitionLogic);
                  setConfirming(false);
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Turn off
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        </>
      ) : (
        <button type="button" disabled={!!locked} onClick={() => setConfirming(true)}>
          Turn off playout…
        </button>
      )}
      {error && <span className="tr-error">{error}</span>}
    </section>
  );
}
