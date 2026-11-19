import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadExportFiles, saveExportFilesInFolder } from '../state/exportFolderSave';
import type { ExportFile } from '../state/offlinePreviewPackage';
import {
  useStudioExportDialogStore,
  type StudioExportRequest,
} from '../state/studioExportDialogStore';
import { allowExportDialogPaint } from '../state/studioSetExport';
import { useMovableDialog } from './useMovableDialog';
import './WorkspaceDialogs.css';
import './ExportDialog.css';

type ExportActivity = 'choosing' | 'preparing' | 'cancelling' | 'saving';
type ExportCompletion =
  { delivery: 'saved'; names: string[] } | { delivery: 'download'; files: ExportFile[] };
type ExportError = {
  message: string;
  action?: { label: string; run: () => void };
};

const downloadLabels: Record<ExportFile['format'], string> = {
  zip: 'Download ZIP',
  html: 'Download HTML',
  webm: 'Download WebM',
  'png-sequence': 'Download PNG sequence',
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function ExportDialogWindow({
  request,
  title,
  subject,
  preparationMessage,
  disabled,
  prepare,
  onDelivered,
  getError,
  children,
}: {
  request: StudioExportRequest;
  title: string;
  subject: string;
  preparationMessage: string;
  disabled?: boolean;
  prepare: (
    signal: AbortSignal,
    reportProgress: (message: string, fraction?: number) => void,
  ) => Promise<ExportFile[]>;
  onDelivered?: () => void;
  getError?: (cause: unknown) => ExportError;
  children: (state: { busy: boolean; clearError: () => void }) => ReactNode;
}) {
  const { owner, trigger } = request;
  const [activity, setActivity] = useState<ExportActivity | null>(null);
  const [progress, setProgress] = useState('');
  const [progressFraction, setProgressFraction] = useState<number | null>(null);
  const [error, setError] = useState<ExportError | null>(null);
  const [completion, setCompletion] = useState<ExportCompletion | null>(null);
  const operation = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const movable = useMovableDialog(dialogRef);
  const canPickFolder = typeof owner.showDirectoryPicker === 'function';
  const canCancel = activity !== 'choosing' && activity !== 'saving' && activity !== 'cancelling';
  const busy = activity !== null;
  const clearError = () => setError(null);
  const close = () => useStudioExportDialogStore.getState().close(request);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-export-initial-focus]')?.focus();
    return () => {
      operation.current?.abort();
      if (trigger.isConnected && !owner.closed) trigger.focus({ preventScroll: true });
    };
  }, [owner, trigger]);
  useEffect(() => {
    if (activity === 'preparing') cancelRef.current?.focus({ preventScroll: true });
  }, [activity]);
  useEffect(() => {
    if (completion) closeRef.current?.focus({ preventScroll: true });
  }, [completion]);

  const cancel = () => {
    if (!canCancel) return;
    if (operation.current) {
      setActivity('cancelling');
      operation.current.abort();
    } else {
      close();
    }
  };

  const start = async (downloadOnly: boolean) => {
    if (operation.current || disabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    clearError();
    setProgressFraction(null);
    try {
      let folder: FileSystemDirectoryHandle | undefined;
      if (!downloadOnly && owner.showDirectoryPicker) {
        setActivity('choosing');
        try {
          folder = await owner.showDirectoryPicker({ mode: 'readwrite', id: 'ograf-exports' });
        } catch (cause) {
          if ((cause as { name?: string })?.name === 'AbortError') return;
          throw cause;
        }
      }
      signal.throwIfAborted();
      setActivity('preparing');
      setProgress(preparationMessage);
      await allowExportDialogPaint(owner, signal);
      signal.throwIfAborted();
      const files = await prepare(signal, (message, fraction) => {
        if (signal.aborted) return;
        setProgress(message);
        setProgressFraction(fraction ?? null);
      });
      signal.throwIfAborted();
      setActivity('saving');
      let result: ExportCompletion;
      if (folder) {
        const names = await saveExportFilesInFolder(folder, files, signal);
        result = { delivery: 'saved', names };
      } else {
        await downloadExportFiles(owner, files);
        result = { delivery: 'download', files };
      }
      signal.throwIfAborted();
      onDelivered?.();
      setCompletion(result);
    } catch (cause) {
      if (!signal.aborted) setError(getError?.(cause) ?? { message: errorMessage(cause) });
    } finally {
      operation.current = null;
      if (useStudioExportDialogStore.getState().request === request) setActivity(null);
    }
  };

  return (
    <div className="workspace-dialog-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <section
        className="workspace-dialog studio-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-export-title"
        ref={dialogRef}
        {...movable.dialogProps}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [data-movable-dialog-handle]',
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0);
          const index = controls.indexOf(owner.document.activeElement as HTMLElement);
          if (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
            event.preventDefault();
            (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
          }
        }}
      >
        <header {...movable.handleProps}>
          <div>
            <h2 id="studio-export-title">{title}</h2>
            <p>{subject}</p>
          </div>
        </header>
        <div className="workspace-dialog-content studio-export-content">
          {!completion && <fieldset disabled={busy}>{children({ busy, clearError })}</fieldset>}
          {completion?.delivery === 'saved' && (
            <p role="status" className="studio-export-completion">
              Saved {completion.names.join(', ')}.
            </p>
          )}
          {completion?.delivery === 'download' && (
            <div className="studio-export-completion">
              <p role="status">Download requested. Check your browser downloads.</p>
              <ul className="studio-export-downloads">
                {completion.files.map((file) => (
                  <li key={file.fileName}>
                    <span>{file.fileName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        clearError();
                        void downloadExportFiles(owner, [file]).catch((cause) =>
                          setError({ message: errorMessage(cause) }),
                        );
                      }}
                    >
                      {downloadLabels[file.format]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {activity && activity !== 'choosing' && (
            <div className="studio-export-progress">
              <progress
                aria-label="Export preparation"
                {...(activity === 'preparing' && progressFraction !== null
                  ? { value: progressFraction, max: 1 }
                  : {})}
              />
              <p role="status">
                {activity === 'cancelling'
                  ? 'Cancelling export…'
                  : activity === 'saving'
                    ? 'Writing export files…'
                    : progress}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="workspace-dialog-error">
              {error.message}
            </p>
          )}
        </div>
        <footer>
          {completion ? (
            <button
              type="button"
              ref={closeRef}
              className="workspace-primary-action"
              onClick={close}
            >
              Close
            </button>
          ) : (
            <>
              <button type="button" ref={cancelRef} onClick={cancel} disabled={!canCancel}>
                Cancel
              </button>
              {error?.action && (
                <button
                  type="button"
                  onClick={() => {
                    error.action?.run();
                    clearError();
                  }}
                >
                  {error.action.label}
                </button>
              )}
              {canPickFolder && (
                <button type="button" disabled={busy || disabled} onClick={() => void start(true)}>
                  Download instead
                </button>
              )}
              <button
                type="button"
                className="workspace-primary-action"
                disabled={busy || disabled}
                onClick={() => void start(!canPickFolder)}
              >
                {canPickFolder ? 'Save files…' : 'Download files'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
