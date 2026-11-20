import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BUILT_IN_EXPORT_PROFILES,
  NLE_EXPORT_PROFILE,
  getExportProfile,
  getOfflinePreviewFileName,
  type ExportProfileMode,
} from '@ograf-editor/codegen';
import { hasElementMediaPaint, type Composition } from '@ograf-editor/scene-model';
import { EditorWindowContext } from '../layout/EditorWindow';
import {
  defaultTemplateExportProfile,
  hasEnabledExternalFeed,
} from '../panels/templateExportProfile';
import { getUnnumberedExportFileName } from '../state/exportFolderSave';
import { OGrafExportCertificationError, prepareProjectExportFiles } from '../state/exportPackage';
import type { ExportFileFormat } from '../state/offlinePreviewPackage';
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
import { normalizeStudioExportDefaults } from '../state/workspaceModel';
import { useWorkspaceStore } from '../state/workspaceStore';
import { ExportDialogWindow } from './ExportDialogWindow';
import { ExportThumbnail } from './ExportThumbnail';
import { VideoExportDialog } from './VideoExportDialog';

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
      {request.kind === 'video' ? (
        <VideoExportDialog request={request} />
      ) : (
        <ExportDialog request={request} />
      )}
    </EditorWindowContext.Provider>,
    request.owner.document.body,
  );
}

function ExportDialog({ request }: { request: StudioExportRequest }) {
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
  return (
    <ExportDialogWindow
      request={request}
      title="Export OGraf"
      subject={set?.name ?? project.name}
      preparationMessage="Preparing and certifying the export…"
      disabled={Boolean(set && !set.templates.length)}
      prepare={(signal, reportProgress) => {
        if (!set)
          return prepareProjectExportFiles(
            { ...project, mainCompositionId: composition.id, thumbnailFrame: frame },
            composition,
            profile,
            { format, signal },
          );
        const session = useProjectSetStore.getState();
        // A detached export can outlive changes in the main editor during folder selection.
        if (
          session.projectSet?.id !== set.id ||
          session.activeTemplateId !== activeTemplateId ||
          useProjectStore.getState().project.id !== project.id
        ) {
          throw new Error(
            'The template set changed while choosing a folder. Export again to use its current state.',
          );
        }
        return prepareProjectSetExportFiles(snapshotProjectSetForExport(set, project), profile, {
          format,
          signal,
          onProgress: (stage) =>
            reportProgress(preparationMessages[stage] ?? `Certifying ${stage}…`),
        });
      }}
      onDelivered={() => {
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
      }}
      getError={(cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        const canUseRealTime =
          !set &&
          !nleExport &&
          mode !== 'realtime' &&
          project.supportsRealTime &&
          cause instanceof OGrafExportCertificationError &&
          cause.nonRealtimeReplayFailed;
        return {
          message: nleExport ? `NLE Export requires non-real-time playback. ${message}` : message,
          ...(canUseRealTime
            ? {
                action: {
                  label: 'Use Real-time playout',
                  run: () => setTemplateProfile({ project: project.id, mode: 'realtime' }),
                },
              }
            : {}),
        };
      }}
    >
      {({ busy, clearError }) => (
        <>
          <div className="studio-export-preview">
            <p>Thumbnail</p>
            {!busy && previewComposition && (!set || previewMember) && (
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
                    clearError();
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
                data-export-initial-focus
                value={format}
                onChange={(event) => {
                  setFormat(event.target.value as ExportFileFormat);
                  clearError();
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
                  clearError();
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
                  clearError();
                }}
              />
              NLE Export (for DaVinci Resolve etc.)
            </label>
            {nleExport && (
              <p>
                Uses non-real-time playback and clears the composition background in the export.
              </p>
            )}
            {independent && <p>This set exports one OGraf package per template in a single ZIP.</p>}
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
        </>
      )}
    </ExportDialogWindow>
  );
}
