import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { EditorWindowContext, type EditorWindow } from '../layout/EditorWindow';
import {
  getCertifiedCoordinatedSaveSnapshot,
  retryCertifiedCoordinatedSave,
  subscribeCertifiedCoordinatedSave,
  type CertifiedCoordinatedSaveSnapshot,
} from '../state/projectSetExport';
import { useMovableDialog } from './useMovableDialog';
import { CoordinatedExportError } from '../state/certifiedArtifactSave';
import './WorkspaceDialogs.css';

/** A fresh Save gesture is requested only after the exact certified ZIP is ready. */
export function CertifiedPackageSaveDialogHost() {
  const snapshot = useSyncExternalStore(
    subscribeCertifiedCoordinatedSave,
    getCertifiedCoordinatedSaveSnapshot,
    () => null,
  );
  const [dismissed, setDismissed] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const owner =
    snapshot?.ownerWindow && !snapshot.ownerWindow.closed ? snapshot.ownerWindow : window;
  return createPortal(
    <EditorWindowContext.Provider value={owner as EditorWindow}>
      {snapshot?.needsSave && snapshot.promptRevision > dismissed && (
        <ReadyPackageDialog
          key={snapshot.promptRevision}
          snapshot={snapshot}
          owner={owner}
          onClose={() => setDismissed(snapshot.promptRevision)}
          onComplete={setNotice}
        />
      )}
      {notice && (
        <div className="app-first-use-notice" role="status">
          {notice}
        </div>
      )}
    </EditorWindowContext.Provider>,
    owner.document.body,
  );
}

function ReadyPackageDialog({
  snapshot,
  owner,
  onClose,
  onComplete,
}: {
  snapshot: CertifiedCoordinatedSaveSnapshot;
  owner: Window;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const movable = useMovableDialog(dialog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = owner.document.activeElement as HTMLElement | null;
    saveButton.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [owner]);
  const save = async (downloadOnly: boolean) => {
    setBusy(true);
    setError('');
    try {
      const result = await retryCertifiedCoordinatedSave({ downloadOnly, ownerWindow: owner });
      onComplete(
        result.saveResult === 'saved'
          ? `Saved and verified “${result.fileName}”.`
          : `Download requested for “${result.fileName}”. Check browser downloads.`,
      );
      onClose();
    } catch (cause) {
      if (cause instanceof CoordinatedExportError && cause.outcome === 'user-cancelled') return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="workspace-dialog-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <section
        ref={dialog}
        {...movable.dialogProps}
        className="workspace-dialog workspace-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="certified-package-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!busy) onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [data-movable-dialog-handle]',
              ) ?? []),
            ].filter((element) => element.getClientRects().length > 0);
            const index = controls.indexOf(owner.document.activeElement as HTMLElement);
            if (
              (event.shiftKey && index <= 0) ||
              (!event.shiftKey && index === controls.length - 1)
            ) {
              event.preventDefault();
              (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
          }
        }}
      >
        <header {...movable.handleProps}>
          <div>
            <h2 id="certified-package-title">Coordinated package ready</h2>
            <p>Choose how to save your verified export.</p>
          </div>
          <button
            type="button"
            aria-label="Close export save window"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="workspace-dialog-content">
          <strong style={{ overflowWrap: 'anywhere' }}>{snapshot.fileName}</strong>
          <p>
            {(snapshot.byteLength / 1024 / 1024).toFixed(2)} MB · {snapshot.templateCount}{' '}
            {snapshot.templateCount === 1 ? 'template' : 'templates'}
          </p>
          <p>
            The complete package is ready. You can save it again from the File menu while Studio
            remains open.
          </p>
          {error && (
            <p role="alert" className="workspace-dialog-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Later
          </button>
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            Download
          </button>
          <button
            ref={saveButton}
            type="button"
            className="workspace-primary-action"
            disabled={busy}
            onClick={() => void save(false)}
          >
            {busy ? 'Saving…' : 'Save…'}
          </button>
        </footer>
      </section>
    </div>
  );
}
