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
import { useExportPreparationStore, type ExportPreparation } from '../state/exportPreparationStore';
import './WorkspaceDialogs.css';

type ExportDialogView =
  ExportPreparation | { phase: 'ready'; snapshot: CertifiedCoordinatedSaveSnapshot };

/** Show preparation immediately, then ask for a fresh Save gesture once the export is verified. */
export function CertifiedPackageSaveDialogHost() {
  const snapshot = useSyncExternalStore(
    subscribeCertifiedCoordinatedSave,
    getCertifiedCoordinatedSaveSnapshot,
    () => null,
  );
  const preparation = useExportPreparationStore((state) => state.preparation);
  const previousPromptRevision = preparation?.previousPromptRevision;
  const [dismissed, setDismissed] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (previousPromptRevision) {
      setDismissed((revision) => Math.max(revision, previousPromptRevision));
    }
  }, [previousPromptRevision]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const pending = snapshot?.needsSave && snapshot.promptRevision > dismissed ? snapshot : null;
  const view = preparation ?? (pending ? { phase: 'ready' as const, snapshot: pending } : null);
  const requestedOwner = preparation?.ownerWindow ?? snapshot?.ownerWindow;
  const owner = requestedOwner && !requestedOwner.closed ? requestedOwner : window;
  return createPortal(
    <EditorWindowContext.Provider value={owner as EditorWindow}>
      {view && (
        <ExportDialog
          view={view}
          owner={owner}
          onClose={() => {
            if (view.phase === 'preparing') {
              useExportPreparationStore.getState().cancel(view.id);
            } else if (view.phase === 'failed') {
              useExportPreparationStore.getState().finish(view.id);
            } else if (view.phase === 'ready') {
              setDismissed((revision) => Math.max(revision, view.snapshot.promptRevision));
            }
          }}
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

function ExportDialog({
  view,
  owner,
  onClose,
  onComplete,
}: {
  view: ExportDialogView;
  owner: Window;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const handle = useRef<HTMLElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const movable = useMovableDialog(dialog);
  const [savingRevision, setSavingRevision] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<{ revision: number; message: string } | null>(null);
  const snapshot = view.phase === 'ready' ? view.snapshot : null;
  const preparing = view.phase === 'preparing';
  const cancelling = view.phase === 'cancelling';
  const format = snapshot?.format === 'html' ? 'HTML' : 'ZIP';
  const moreFiles = (snapshot?.pendingFileCount ?? 0) > 1;
  const promptRevision = snapshot?.promptRevision;
  const busy = promptRevision === savingRevision;
  const canClose = !busy && !cancelling;
  const error = saveError && saveError.revision === promptRevision ? saveError.message : undefined;
  const title = snapshot
    ? moreFiles
      ? 'Export files ready'
      : `${format} export ready`
    : cancelling
      ? 'Cancelling export'
      : preparing
        ? 'Preparing export'
        : 'Export could not be prepared';
  const description = snapshot
    ? `Choose how to save this verified ${format} file.`
    : cancelling
      ? 'Studio is stopping the export.'
      : preparing
        ? 'Studio is preparing and verifying the export files.'
        : 'Check the error below and try exporting again.';
  useEffect(() => {
    const previous = owner.document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [owner]);
  useEffect(() => {
    const target = primaryButton.current?.disabled ? handle.current : primaryButton.current;
    (target ?? handle.current)?.focus({ preventScroll: true });
  }, [owner, view.phase, promptRevision]);
  const save = async (downloadOnly: boolean) => {
    if (!snapshot) return;
    setSavingRevision(snapshot.promptRevision);
    setSaveError(null);
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
      setSaveError({
        revision: snapshot.promptRevision,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSavingRevision((revision) => (revision === snapshot.promptRevision ? null : revision));
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
        aria-describedby="certified-package-description"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            if (canClose) onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [data-movable-dialog-handle]',
              ) ?? []),
            ].filter((element) => element.getClientRects().length > 0);
            const index = controls.indexOf(owner.document.activeElement as HTMLElement);
            if (
              index < 0 ||
              (event.shiftKey && index === 0) ||
              (!event.shiftKey && index === controls.length - 1)
            ) {
              event.preventDefault();
              (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
          }
        }}
      >
        <header ref={handle} {...movable.handleProps}>
          <div>
            <h2 id="certified-package-title">{title}</h2>
            <p id="certified-package-description">{description}</p>
          </div>
          <button
            type="button"
            aria-label={preparing ? 'Cancel export preparation' : 'Close export save window'}
            disabled={!canClose}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {view.phase === 'ready' ? (
          <>
            <div className="workspace-dialog-content">
              <strong style={{ overflowWrap: 'anywhere' }}>{view.snapshot.fileName}</strong>
              <p>
                {(view.snapshot.byteLength / 1024 / 1024).toFixed(2)} MB ·{' '}
                {view.snapshot.templateCount}{' '}
                {view.snapshot.templateCount === 1 ? 'template' : 'templates'}
              </p>
              <p>
                {moreFiles
                  ? 'Studio will offer the next file after this one. Each file is saved separately.'
                  : 'Use Save Certified Export in Preview & Export to save this file later.'}
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
                Download {format}
              </button>
              <button
                ref={primaryButton}
                type="button"
                className="workspace-primary-action"
                disabled={busy}
                onClick={() => void save(false)}
              >
                {busy ? 'Saving…' : `Save ${format}…`}
              </button>
            </footer>
          </>
        ) : (
          <>
            <div className="workspace-dialog-content">
              <strong style={{ overflowWrap: 'anywhere' }}>{view.name}</strong>
              {preparing || cancelling ? (
                <>
                  <p>
                    {view.templateCount} {view.templateCount === 1 ? 'template' : 'templates'}
                  </p>
                  <progress aria-label="Export preparation" style={{ width: '100%' }} />
                  <p role="status">{view.message}</p>
                </>
              ) : (
                <p role="alert" className="workspace-dialog-error">
                  {view.message}
                </p>
              )}
            </div>
            <footer>
              <button
                ref={primaryButton}
                type="button"
                disabled={cancelling}
                className={view.phase === 'failed' ? 'workspace-primary-action' : undefined}
                onClick={onClose}
              >
                {cancelling ? 'Cancelling…' : preparing ? 'Cancel' : 'Close'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
