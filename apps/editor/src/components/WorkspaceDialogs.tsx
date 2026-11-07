import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMovableDialog } from './useMovableDialog';
import { EditorWindowContext, useEditorWindow, type EditorWindow } from '../layout/EditorWindow';
import { useDetachedWindows } from '../layout/detachedWindowContext';
import { useWorkspaceStore } from '../state/workspaceStore';
import { MAX_WORKSPACE_IMPORT_BYTES } from '../state/workspaceModel';
import './WorkspaceDialogs.css';

type WorkspaceDialogMode = 'save' | 'manage';
interface WorkspaceDialogRequest {
  mode: WorkspaceDialogMode;
  owner: EditorWindow;
}
let request: WorkspaceDialogRequest | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const closeWorkspaceDialog = () => {
  request = null;
  notify();
};
export function openWorkspaceDialog(mode: WorkspaceDialogMode, owner: EditorWindow = window) {
  if (owner.closed) return;
  request = { mode, owner };
  notify();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function WorkspaceDialogHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
  if (!current || current.owner.closed) return null;
  return (
    <EditorWindowContext.Provider value={current.owner}>
      <WorkspaceDialog key={current.mode} mode={current.mode} />
    </EditorWindowContext.Provider>
  );
}

function WorkspaceDialog({ mode }: { mode: WorkspaceDialogMode }) {
  const { window: owner, document } = useEditorWindow();
  const detached = useDetachedWindows();
  const presets = useWorkspaceStore((state) => state.presets);
  const activePresetId = useWorkspaceStore((state) => state.activePresetId);
  const modified = useWorkspaceStore((state) => state.modified);
  const storageError = useWorkspaceStore((state) => state.storageError);
  const active = presets.find((preset) => preset.id === activePresetId);
  const [name, setName] = useState(() => {
    const base = (active?.name ?? 'Workspace').slice(0, 75);
    let candidate = `${base} copy`;
    let suffix = 2;
    while (
      presets.some((preset) => preset.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())
    ) {
      const tail = ` copy ${suffix++}`;
      candidate = base.slice(0, 80 - tail.length) + tail;
    }
    return candidate;
  });
  const [selectedId, setSelectedId] = useState(activePresetId ?? presets[0]?.id ?? '');
  const selected = presets.find((preset) => preset.id === selectedId);
  const [rename, setRename] = useState(selected?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const movable = useMovableDialog(dialog);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target =
      mode === 'save' ? dialog.current?.querySelector<HTMLInputElement>('input') : null;
    (target ?? dialog.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    target?.select();
    owner.addEventListener('pagehide', closeWorkspaceDialog);
    return () => {
      owner.removeEventListener('pagehide', closeWorkspaceDialog);
      if (previous?.isConnected) previous.focus();
    };
  }, [document, mode, owner]);
  useEffect(() => {
    setRename(selected?.name ?? '');
    setConfirmDelete(false);
  }, [selectedId, selected?.name]);

  const run = (action: () => void, message?: string) => {
    try {
      action();
      setError('');
      setStatus(message ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the workspace.');
      setStatus('');
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    run(() => {
      detached.capture();
      useWorkspaceStore.getState().saveAs(name);
      closeWorkspaceDialog();
    });
  };
  const exportPresets = () =>
    run(() => {
      const store = useWorkspaceStore.getState();
      store.flush();
      const blob = new Blob([JSON.stringify(store.exportPresets(), null, 2)], {
        type: 'application/json',
      });
      const url = owner.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'OGraf Studio Workspaces.json';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      owner.setTimeout(() => owner.URL.revokeObjectURL(url), 1000);
    }, 'Workspace presets exported.');
  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > MAX_WORKSPACE_IMPORT_BYTES)
        throw new Error('Choose a workspace file smaller than 2 MB.');
      const data: unknown = JSON.parse(await file.text());
      useWorkspaceStore.getState().importPresets(data);
      setError('');
      setStatus('Workspace presets imported.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import workspace presets.');
      setStatus('');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return createPortal(
    <div className="workspace-dialog-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <section
        ref={dialog}
        {...movable.dialogProps}
        className={`workspace-dialog ${mode === 'save' ? 'workspace-save-dialog' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            closeWorkspaceDialog();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), [data-movable-dialog-handle]',
              ) ?? []),
            ].filter((element) => element.getClientRects().length > 0);
            const index = controls.indexOf(document.activeElement as HTMLElement);
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
            <h2 id="workspace-dialog-title">
              {mode === 'save' ? 'Save Workspace As' : 'Manage Workspaces'}
            </h2>
            <p>Panel positions, sizes and detached windows for this Studio installation.</p>
          </div>
          <button type="button" aria-label="Close workspace dialog" onClick={closeWorkspaceDialog}>
            ×
          </button>
        </header>
        {mode === 'save' ? (
          <form onSubmit={save}>
            <div className="workspace-dialog-content">
              <label>
                Workspace name
                <input
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <p>Your current arrangement will be saved as a new preset.</p>
            </div>
            {error || storageError ? (
              <p role="alert" className="workspace-dialog-error">
                {error || storageError}
              </p>
            ) : null}
            <footer>
              <button type="button" onClick={closeWorkspaceDialog}>
                Cancel
              </button>
              <button type="submit" className="workspace-primary-action" disabled={!name.trim()}>
                Save Workspace
              </button>
            </footer>
          </form>
        ) : (
          <>
            <div className="workspace-manager-body">
              <nav aria-label="Workspace presets">
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    aria-current={selectedId === preset.id ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(preset.id);
                      setError('');
                      setStatus('');
                    }}
                  >
                    <span>{preset.name}</span>
                    <small>
                      {preset.id === activePresetId
                        ? `Current${modified ? ' · modified' : ''}`
                        : preset.builtin
                          ? 'Built-in'
                          : 'Saved'}
                    </small>
                  </button>
                ))}
              </nav>
              <div className="workspace-dialog-content">
                {selected ? (
                  <>
                    <h3>{selected.name}</h3>
                    <p>
                      {selected.builtin
                        ? 'Built-in presets can be applied or saved as a custom workspace.'
                        : 'This saved arrangement can be renamed or removed.'}
                    </p>
                    <div className="workspace-dialog-actions">
                      <button
                        type="button"
                        onClick={() =>
                          run(() => {
                            useWorkspaceStore.getState().applyPreset(selected.id);
                            detached.restore();
                          }, `Applied ${selected.name}.`)
                        }
                      >
                        Apply Workspace
                      </button>
                      <button type="button" onClick={() => openWorkspaceDialog('save', owner)}>
                        Save Current As…
                      </button>
                    </div>
                    {!selected.builtin ? (
                      <>
                        <label>
                          Workspace name
                          <input
                            value={rename}
                            maxLength={80}
                            onChange={(event) => setRename(event.target.value)}
                            autoComplete="off"
                          />
                        </label>
                        <div className="workspace-dialog-actions">
                          <button
                            type="button"
                            disabled={!rename.trim() || rename.trim() === selected.name}
                            onClick={() =>
                              run(() => {
                                useWorkspaceStore.getState().renamePreset(selected.id, rename);
                              }, 'Workspace renamed.')
                            }
                          >
                            Rename
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(true)}>
                            Delete…
                          </button>
                        </div>
                        {confirmDelete ? (
                          <div className="workspace-delete-confirmation">
                            <p>
                              Delete “{selected.name}”? Your current panel arrangement will remain
                              open.
                            </p>
                            <div className="workspace-dialog-actions">
                              <button type="button" onClick={() => setConfirmDelete(false)}>
                                Keep Workspace
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  run(() => {
                                    useWorkspaceStore.getState().deletePreset(selected.id);
                                    setSelectedId(
                                      useWorkspaceStore.getState().activePresetId ??
                                        presets[0]?.id ??
                                        '',
                                    );
                                  }, 'Workspace deleted.')
                                }
                              >
                                Delete Workspace
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : (
                  <p>Select a workspace.</p>
                )}
                {detached.pending.length ? (
                  <p className="workspace-pending-windows">
                    {detached.pending.length} detached{' '}
                    {detached.pending.length === 1 ? 'window awaits' : 'windows await'} restoration.
                    <button type="button" onClick={() => run(() => detached.restore())}>
                      Restore Detached Windows
                    </button>
                  </p>
                ) : null}
              </div>
            </div>
            {error || storageError ? (
              <p role="alert" className="workspace-dialog-error">
                {error || storageError}
              </p>
            ) : null}
            {status ? (
              <p role="status" className="workspace-dialog-status">
                {status}
              </p>
            ) : null}
            <footer>
              <input
                ref={fileInput}
                hidden
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  void importFile(event.target.files?.[0]);
                }}
              />
              <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
                {busy ? 'Importing…' : 'Import…'}
              </button>
              <button type="button" onClick={exportPresets}>
                Export…
              </button>
              <span />
              <button type="button" onClick={closeWorkspaceDialog}>
                Done
              </button>
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** Application preferences apply immediately, independently of template-set defaults. */
export function WorkspacePreferences() {
  const { window: owner } = useEditorWindow();
  const presets = useWorkspaceStore((state) => state.presets);
  const startup = useWorkspaceStore((state) => state.startup);
  const editorPreferences = useWorkspaceStore((state) => state.editorPreferences);
  const storageError = useWorkspaceStore((state) => state.storageError);
  const detached = useDetachedWindows();
  const [error, setError] = useState('');
  const update = (patch: Partial<typeof startup>) => {
    try {
      useWorkspaceStore.getState().updateStartup(patch);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save workspace preferences.');
    }
  };
  return (
    <>
      <h3>Workspace</h3>
      <p>Choose the window and panel arrangement to use when Studio starts.</p>
      <label>
        On startup
        <select
          value={startup.mode}
          onChange={(event) => update({ mode: event.target.value as 'last' | 'preset' })}
        >
          <option value="last">Restore the last workspace</option>
          <option value="preset">Use a saved workspace</option>
        </select>
      </label>
      {startup.mode === 'preset' ? (
        <label>
          Startup workspace
          <select
            value={startup.presetId ?? presets[0]?.id ?? ''}
            onChange={(event) => update({ presetId: event.target.value })}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="template-settings-check">
        <input
          type="checkbox"
          checked={startup.restoreDetached}
          onChange={(event) => update({ restoreDetached: event.target.checked })}
        />
        Restore detached windows on startup
      </label>
      <label className="template-settings-check">
        <input
          type="checkbox"
          checked={editorPreferences.showWelcomeOnStartup !== false}
          onChange={(event) =>
            useWorkspaceStore
              .getState()
              .updateEditorPreferences({ showWelcomeOnStartup: event.target.checked })
          }
        />
        Show welcome screen on startup
      </label>
      <p>
        Browsers may require a click to reopen detached windows. Unavailable windows stay accessible
        in Studio.
      </p>
      <div className="workspace-dialog-actions">
        <button type="button" onClick={() => openWorkspaceDialog('manage', owner)}>
          Manage Workspaces…
        </button>
        {detached.pending.length ? (
          <button type="button" onClick={() => detached.restore()}>
            Restore Detached Windows
          </button>
        ) : null}
      </div>
      <p>
        Workspace preferences are saved automatically for this user. You can export presets to use
        them on another installation.
      </p>
      <h3>Preview</h3>
      <label className="template-settings-check">
        <input
          type="checkbox"
          checked={editorPreferences.syncEditorPreview}
          onChange={(event) =>
            useWorkspaceStore
              .getState()
              .updateEditorPreferences({ syncEditorPreview: event.target.checked })
          }
        />
        Sync editor and preview
      </label>
      <p>
        Show the editor’s current frame in preview and fullscreen, including timeline scrubbing.
        This preference applies to Studio and is saved automatically for this user.
      </p>
      <h3>Timeline durations</h3>
      <label className="template-settings-field">
        <span>Display durations as</span>
        <select
          value={editorPreferences.durationUnit ?? 'seconds'}
          onChange={(event) =>
            useWorkspaceStore.getState().updateEditorPreferences({
              durationUnit: event.currentTarget.value as 'seconds' | 'frames' | 'timecode',
            })
          }
        >
          <option value="seconds">Seconds</option>
          <option value="frames">Frames</option>
          <option value="timecode">Timecode (non-drop)</option>
        </select>
      </label>
      {error || storageError ? (
        <p role="alert" className="workspace-preferences-error">
          {error || storageError}
        </p>
      ) : null}
    </>
  );
}
