import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BUILT_IN_EXPORT_PROFILES,
  NLE_EXPORT_PROFILE,
  compositionForExportProfile,
  getExportProfile,
  getOfflinePreviewFileName,
  type ExportProfileMode,
} from '@ograf-editor/codegen';
import {
  getTotalFrames,
  hasElementMediaPaint,
  projectThumbnailFrame,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import { EditorWindowContext, useEditorWindow } from '../layout/EditorWindow';
import {
  defaultTemplateExportProfile,
  hasEnabledExternalFeed,
} from '../panels/templateExportProfile';
import {
  downloadExportFiles,
  getUnnumberedExportFileName,
  saveExportFilesInFolder,
} from '../state/exportFolderSave';
import { OGrafExportCertificationError, prepareProjectExportFiles } from '../state/exportPackage';
import type { ExportFile, ExportFileFormat } from '../state/offlinePreviewPackage';
import {
  getProjectSetExportZipName,
  prepareProjectSetExportFiles,
  snapshotProjectSetForExport,
} from '../state/projectSetExport';
import { useProjectSetStore } from '../state/projectSetStore';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import {
  useStudioExportDialogStore,
  type StudioExportRequest,
} from '../state/studioExportDialogStore';
import { allowExportDialogPaint } from '../state/studioSetExport';
import { normalizeStudioExportDefaults } from '../state/workspaceModel';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useMovableDialog } from './useMovableDialog';
import './WorkspaceDialogs.css';
import './ExportDialog.css';

type ExportActivity = 'choosing' | 'preparing' | 'cancelling' | 'saving';
type ExportCompletion =
  { delivery: 'saved'; names: string[] } | { delivery: 'download'; files: ExportFile[] };

const preparationMessages: Record<string, string> = {
  compilation: 'Building the graphic…',
  thumbnail: 'Rendering the export thumbnail…',
  certification: 'Checking OGraf compatibility…',
  packaging: 'Assembling the export files…',
};

function compositionUsesMedia(composition: Composition): boolean {
  return (
    composition.mediaCues.length > 0 ||
    composition.layers.some(
      ({ element }) => element.type === 'audio' || hasElementMediaPaint(element),
    )
  );
}

export function ExportDialogHost() {
  const request = useStudioExportDialogStore((state) => state.request);
  useEffect(() => {
    if (!request) return;
    const close = () => useStudioExportDialogStore.getState().close(request);
    if (request.owner.closed) {
      close();
      return;
    }
    request.owner.addEventListener('pagehide', close);
    return () => request.owner.removeEventListener('pagehide', close);
  }, [request]);
  if (!request || request.owner.closed) return null;
  return createPortal(
    <EditorWindowContext.Provider value={request.owner}>
      <ExportDialog request={request} />
    </EditorWindowContext.Provider>,
    request.owner.document.body,
  );
}

function ExportDialog({ request }: { request: StudioExportRequest }) {
  const { owner, trigger } = request;
  const project = useProjectStore((state) => state.project);
  const composition = useActiveComposition();
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const [defaults] = useState(() =>
    normalizeStudioExportDefaults(useWorkspaceStore.getState().editorPreferences.exportDefaults),
  );
  const [scope, setScope] = useState(defaults.scope);
  const [requestedFormat, setFormat] = useState<ExportFileFormat>(defaults.format);
  const [setProfile, setSetProfile] = useState<ExportProfileMode | 'authored'>('authored');
  const [templateProfile, setTemplateProfile] = useState<{
    project: string;
    mode: ExportProfileMode;
  } | null>(null);
  const [thumbnail, setThumbnail] = useState<{
    projectId: string;
    compositionId: string;
    frame: number | null;
  } | null>(null);
  const [nleExport, setNleExport] = useState(false);
  const [activity, setActivity] = useState<ExportActivity | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<{ message: string; canUseRealTime: boolean } | null>(null);
  const [completion, setCompletion] = useState<ExportCompletion | null>(null);
  const operation = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const movable = useMovableDialog(dialogRef);

  const activeMember = projectSet?.templates.find((item) => item.id === activeTemplateId);
  const hasCurrentTemplate = !projectSet || activeMember?.project.id === project.id;
  const set = scope === 'set' || !hasCurrentTemplate ? projectSet : null;
  const independent = Boolean(set && !set.transitionLogic);
  const format = independent ? 'zip' : requestedFormat;
  const usesMedia = set
    ? set.templates.some((member) =>
        (member === activeMember && hasCurrentTemplate
          ? project
          : member.project
        ).compositions.some(compositionUsesMedia),
      )
    : compositionUsesMedia(composition);
  const hasExternalFeed = !set && hasEnabledExternalFeed(composition);
  const templateMode =
    templateProfile?.project === project.id
      ? templateProfile.mode
      : defaultTemplateExportProfile(project, hasExternalFeed);
  const requestedMode = set ? setProfile : templateMode;
  const mode = nleExport
    ? 'non-realtime'
    : usesMedia && requestedMode !== 'authored'
      ? 'realtime'
      : requestedMode;
  const profile = nleExport
    ? NLE_EXPORT_PROFILE
    : mode === 'authored'
      ? undefined
      : getExportProfile(mode);
  const suffix = profile?.fileNameSuffix ?? '';
  const frame =
    thumbnail?.projectId === project.id && thumbnail.compositionId === composition.id
      ? thumbnail.frame
      : (project.thumbnailFrame ?? null);
  const expectedFiles = [
    ...(format === 'html'
      ? []
      : [
          getUnnumberedExportFileName({
            format: 'zip',
            fileName: set
              ? getProjectSetExportZipName(set, profile)
              : `${project.name || 'untitled'}${suffix}.ograf.zip`,
          }),
        ]),
    ...(format === 'zip'
      ? []
      : [
          getUnnumberedExportFileName({
            format: 'html',
            fileName: getOfflinePreviewFileName({
              manifest: { name: `${set?.name ?? project.name}${suffix}` },
            }),
          }),
        ]),
  ];
  const referencedTemplates = set?.transitionLogic
    ? new Set(set.transitionLogic.states.map(({ templateId }) => templateId))
    : null;
  const omitted = referencedTemplates
    ? set?.templates.filter(({ id }) => !referencedTemplates.has(id))
    : undefined;
  const previewableTemplates = set?.templates.filter(
    ({ id }) => !referencedTemplates || referencedTemplates.has(id),
  );
  const previewMember =
    previewableTemplates?.find(({ id }) => id === activeTemplateId) ?? previewableTemplates?.[0];
  const previewProject =
    previewMember && (!hasCurrentTemplate || previewMember !== activeMember)
      ? previewMember.project
      : project;
  const previewComposition = set
    ? previewProject.compositions.find(({ id }) => id === previewProject.mainCompositionId)
    : composition;
  const canPickFolder = typeof owner.showDirectoryPicker === 'function';
  const canCancel = activity !== 'choosing' && activity !== 'saving' && activity !== 'cancelling';
  const close = () => useStudioExportDialogStore.getState().close(request);

  useEffect(() => {
    formatRef.current?.focus();
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
    if (operation.current || (set && !set.templates.length)) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    setError(null);
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
      setProgress('Preparing and certifying the export…');
      await allowExportDialogPaint(owner, signal);
      signal.throwIfAborted();
      let files;
      if (set) {
        const session = useProjectSetStore.getState();
        // A detached export can outlive changes in the main editor while the folder chooser is open.
        if (
          session.projectSet?.id !== set.id ||
          session.activeTemplateId !== activeTemplateId ||
          useProjectStore.getState().project.id !== project.id
        ) {
          throw new Error(
            'The template set changed while choosing a folder. Export again to use its current state.',
          );
        }
        files = await prepareProjectSetExportFiles(
          snapshotProjectSetForExport(set, project),
          profile,
          {
            format,
            signal,
            onProgress: (stage) => {
              if (!signal.aborted)
                setProgress(preparationMessages[stage] ?? `Certifying ${stage}…`);
            },
          },
        );
      } else {
        files = await prepareProjectExportFiles(
          { ...project, mainCompositionId: composition.id, thumbnailFrame: frame },
          composition,
          profile,
          { format, signal },
        );
      }
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
      const current = useProjectStore.getState();
      if (
        !set &&
        current.project.id === project.id &&
        current.activeCompositionId === composition.id &&
        current.project.thumbnailFrame === project.thumbnailFrame &&
        (project.thumbnailFrame ?? null) !== frame
      ) {
        current.setProjectMeta({ thumbnailFrame: frame });
      }
      setCompletion(result);
    } catch (cause) {
      if (!signal.aborted) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError({
          message: nleExport ? `NLE Export requires non-real-time playback. ${message}` : message,
          canUseRealTime:
            !set &&
            !nleExport &&
            mode !== 'realtime' &&
            project.supportsRealTime &&
            cause instanceof OGrafExportCertificationError &&
            cause.nonRealtimeReplayFailed,
        });
      }
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
            <h2 id="studio-export-title">Export</h2>
            <p>{set?.name ?? project.name}</p>
          </div>
        </header>
        <div className="workspace-dialog-content studio-export-content">
          <fieldset hidden={completion !== null} disabled={activity !== null}>
            <div className="studio-export-preview">
              <p>Thumbnail</p>
              {!activity && !completion && previewComposition && (!set || previewMember) && (
                <ExportThumbnail
                  project={previewProject}
                  composition={previewComposition}
                  frame={set ? (previewProject.thumbnailFrame ?? null) : frame}
                  nleExport={nleExport}
                  onFrame={
                    set
                      ? undefined
                      : (next) =>
                          setThumbnail({
                            projectId: project.id,
                            compositionId: composition.id,
                            frame: next,
                          })
                  }
                />
              )}
              {set && (
                <p className="studio-export-thumbnail-note">
                  {previewMember ? `Previewing ${previewMember.name}. ` : ''}
                  {independent
                    ? 'Each template uses its saved thumbnail frame.'
                    : 'Studio captures the coordinated thumbnail during export.'}
                </p>
              )}
            </div>
            <div className="studio-export-options">
              {projectSet && (
                <label>
                  Export scope
                  <select
                    value={set ? 'set' : 'template'}
                    disabled={!hasCurrentTemplate}
                    onChange={(event) => {
                      setScope(event.target.value as typeof scope);
                      setError(null);
                    }}
                  >
                    <option value="template">Current template</option>
                    <option value="set">Template set</option>
                  </select>
                </label>
              )}
              <label>
                Export format
                <select
                  ref={formatRef}
                  value={format}
                  onChange={(event) => {
                    setFormat(event.target.value as ExportFileFormat);
                    setError(null);
                  }}
                >
                  <option value="zip">OGraf ZIP</option>
                  <option value="html" disabled={independent}>
                    Standalone HTML
                  </option>
                  <option value="both" disabled={independent}>
                    Both files
                  </option>
                </select>
              </label>
              <label>
                Playout mode
                <select
                  value={mode}
                  disabled={nleExport}
                  onChange={(event) => {
                    const value = event.target.value as ExportProfileMode | 'authored';
                    if (set) setSetProfile(value);
                    else if (value !== 'authored')
                      setTemplateProfile({ project: project.id, mode: value });
                    setError(null);
                  }}
                >
                  {set && <option value="authored">As authored</option>}
                  {BUILT_IN_EXPORT_PROFILES.map((profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
                      disabled={!nleExport && usesMedia && profile.mode !== 'realtime'}
                    >
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="studio-export-option">
                <input
                  type="checkbox"
                  checked={nleExport}
                  onChange={(event) => {
                    setNleExport(event.currentTarget.checked);
                    setError(null);
                  }}
                />
                NLE Export (for DaVinci Resolve etc.)
              </label>
              {nleExport && (
                <p>
                  Uses non-real-time playback and clears the composition background in the export.
                </p>
              )}
              {independent && (
                <p>This set exports one OGraf package per template in a single ZIP.</p>
              )}
              {omitted && omitted.length > 0 && (
                <div className="studio-export-file-list">
                  <p>Templates without a transition state are omitted.</p>
                  <ul>
                    {omitted.map(({ id, name }) => (
                      <li key={id}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
              {usesMedia && (
                <p>
                  {nleExport
                    ? 'Remove media and audio layers or media cues before exporting for an NLE.'
                    : 'Media and audio require real-time playout.'}
                </p>
              )}
              {!nleExport && hasExternalFeed && project.supportsRealTime && !usesMedia && (
                <p>
                  Real-time playout is recommended for live data. Dual mode also certifies offline
                  rendering.
                </p>
              )}
              <div className="studio-export-file-list">
                <p>Files to export</p>
                <ul>
                  {expectedFiles.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            </div>
          </fieldset>
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
                        setError(null);
                        void downloadExportFiles(owner, [file]).catch((cause) =>
                          setError({
                            message: cause instanceof Error ? cause.message : String(cause),
                            canUseRealTime: false,
                          }),
                        );
                      }}
                    >
                      {file.format === 'zip' ? 'Download ZIP' : 'Download HTML'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {activity && activity !== 'choosing' && (
            <div className="studio-export-progress">
              <progress aria-label="Export preparation" />
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
              {error?.canUseRealTime && (
                <button
                  type="button"
                  onClick={() => {
                    setTemplateProfile({ project: project.id, mode: 'realtime' });
                    setError(null);
                  }}
                >
                  Use Real-time playout
                </button>
              )}
              {canPickFolder && (
                <button
                  type="button"
                  disabled={!!activity || Boolean(set && !set.templates.length)}
                  onClick={() => void start(true)}
                >
                  Download instead
                </button>
              )}
              <button
                type="button"
                className="workspace-primary-action"
                disabled={!!activity || Boolean(set && !set.templates.length)}
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

function ExportThumbnail({
  project,
  composition,
  frame,
  nleExport,
  onFrame,
}: {
  project: Project;
  composition: Composition;
  frame: number | null;
  nleExport: boolean;
  onFrame?: (frame: number | null) => void;
}) {
  const { window: owner } = useEditorWindow();
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  const selectedFrame = projectThumbnailFrame({
    ...project,
    mainCompositionId: composition.id,
    thumbnailFrame: frame,
  });
  const totalFrames = getTotalFrames(composition);
  useEffect(() => {
    const controller = new AbortController();
    let url = '';
    setImage('');
    setFailed(false);
    const thumbnailProject = {
      ...project,
      mainCompositionId: composition.id,
      thumbnailFrame: frame,
      compositions: [
        compositionForExportProfile(composition, nleExport ? NLE_EXPORT_PROFILE : undefined),
      ],
    };
    void allowExportDialogPaint(owner, controller.signal)
      .then(() => import('../state/templateThumbnail'))
      .then(({ createTemplateThumbnail }) =>
        createTemplateThumbnail(thumbnailProject, controller.signal),
      )
      .then((blob) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob);
          setImage(url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [project, composition, frame, nleExport, owner]);

  return (
    <div className="studio-export-thumbnail">
      <div className="studio-export-thumbnail-image" aria-busy={!image && !failed}>
        {image ? (
          <img src={image} alt={`Thumbnail at frame ${selectedFrame}`} />
        ) : (
          <span>{failed ? 'Thumbnail preview unavailable.' : 'Rendering thumbnail…'}</span>
        )}
      </div>
      {onFrame && (
        <>
          <label>
            Thumbnail frame
            <input
              type="number"
              min={0}
              max={totalFrames}
              value={selectedFrame}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (Number.isInteger(next) && next >= 0 && next <= totalFrames) onFrame(next);
              }}
            />
          </label>
          <label className="studio-export-thumbnail-auto">
            <input
              type="checkbox"
              checked={frame === null}
              onChange={(event) => onFrame(event.target.checked ? null : selectedFrame)}
            />
            First OGraf step
          </label>
        </>
      )}
    </div>
  );
}
