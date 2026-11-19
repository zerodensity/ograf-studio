import { useState } from 'react';
import {
  getCompositionOutputRect,
  hasElementMediaPaint,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import { getPngSequenceFolderName, getUnnumberedExportFileName } from '../state/exportFolderSave';
import { useProjectSetStore } from '../state/projectSetStore';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import type { StudioExportRequest } from '../state/studioExportDialogStore';
import type { WebmExportProgress } from '../state/videoExport';
import { ExportDialogWindow } from './ExportDialogWindow';
import { ExportThumbnail } from './ExportThumbnail';

type VideoFormat = 'webm' | 'png-frames';
type SizeDraft = { width: string; height: string };

function isPixelSize(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function includesUnsupportedMedia(composition: Composition, webm: boolean): boolean {
  return (
    composition.layers.some(({ element }) => hasElementMediaPaint(element)) ||
    composition.mediaCues.some(
      (cue) =>
        webm &&
        ((cue.trigger.type !== 'timeline' && cue.trigger.type !== 'lifecycle') ||
          cue.sources.some((source) => source.kind !== 'clip' || source.mediaType !== 'audio')),
    )
  );
}

export function VideoExportDialog({ request }: { request: StudioExportRequest }) {
  const project = useProjectStore((state) => state.project);
  const composition = useActiveComposition();
  return (
    <VideoExportOptions
      key={`${project.id}:${composition.id}`}
      request={request}
      project={project}
      composition={composition}
    />
  );
}

function VideoExportOptions({
  request,
  project,
  composition,
}: {
  request: StudioExportRequest;
  project: Project;
  composition: Composition;
}) {
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const hasCurrentTemplate =
    !projectSet ||
    projectSet.templates.some(
      (member) => member.id === activeTemplateId && member.project.id === project.id,
    );
  const [format, setFormat] = useState<VideoFormat>('webm');
  const [transparent, setTransparent] = useState(true);
  const [holdDraft, setHoldDraft] = useState('3');
  const [lockAspect, setLockAspect] = useState(true);
  const [sizeDraft, setSizeDraft] = useState<SizeDraft | null>(null);
  const [bitrateDraft, setBitrateDraft] = useState('');
  const [blackFrameAtStart, setBlackFrameAtStart] = useState(false);
  const [blackFrameAtEnd, setBlackFrameAtEnd] = useState(false);
  const native = getCompositionOutputRect(composition);
  const draft = sizeDraft ?? { width: String(native.width), height: String(native.height) };
  const width = Number(draft.width);
  const height = Number(draft.height);
  const holdSeconds = Number(holdDraft);
  const webm = format === 'webm';
  const bitrate =
    webm && bitrateDraft.trim() !== '' ? Math.round(Number(bitrateDraft) * 1_000_000) : undefined;
  const invalidSize = !isPixelSize(width) || !isPixelSize(height);
  const invalidHold =
    holdDraft.trim() === '' ||
    !Number.isFinite(holdSeconds) ||
    holdSeconds < 0 ||
    holdSeconds > 600;
  const invalidBitrate =
    bitrate !== undefined && (!Number.isSafeInteger(bitrate) || bitrate < (transparent ? 2 : 1));
  const invalidSettings = invalidSize || invalidHold || invalidBitrate;
  const webmWidth = width + (width % 2);
  const webmHeight = height + (height % 2);
  const fileName = getUnnumberedExportFileName({
    format: 'webm',
    fileName: `${project.name || 'untitled'}.webm`,
  });
  const canPickFolder = typeof request.owner.showDirectoryPicker === 'function';

  /** The export settings, once nothing changed while a folder was being chosen. */
  const exportOptions = (
    signal: AbortSignal,
    reportProgress: (message: string, fraction?: number) => void,
  ) => {
    const current = useProjectStore.getState();
    const session = useProjectSetStore.getState();
    if (
      current.project.id !== project.id ||
      current.activeCompositionId !== composition.id ||
      session.projectSet?.id !== projectSet?.id ||
      session.activeTemplateId !== activeTemplateId
    ) {
      throw new Error(
        'The current template changed while choosing a folder. Export again to use it.',
      );
    }
    return {
      transparent,
      holdSeconds,
      signal,
      ...(width === native.width && height === native.height ? {} : { size: { width, height } }),
      onProgress: (progress: WebmExportProgress) => {
        if (progress.stage === 'picture') {
          reportProgress(
            `Rendering frame ${progress.frame} of ${progress.frames}…`,
            progress.frame / progress.frames,
          );
        } else if (progress.stage === 'sound') {
          reportProgress('Mixing the sound…');
        } else {
          reportProgress(webm ? 'Writing the WebM file…' : 'Saving the PNG frames…');
        }
      },
    };
  };

  const resize = (axis: keyof SizeDraft, value: string, lock = lockAspect) => {
    const size = Number(value);
    const next = { ...draft, [axis]: value };
    if (lock && isPixelSize(size)) {
      const other = axis === 'width' ? 'height' : 'width';
      next[other] = String(Math.max(1, Math.round((size * native[other]) / native[axis])));
    }
    setSizeDraft(next);
  };

  return (
    <ExportDialogWindow
      request={request}
      title="Export Video"
      subject={project.name}
      preparationMessage="Preparing the frames…"
      disabled={invalidSettings || !hasCurrentTemplate}
      {...(webm
        ? {
            prepare: async (signal, reportProgress) => {
              const options = exportOptions(signal, reportProgress);
              const { prepareWebmExportFile } = await import('../state/videoExport');
              const file = await prepareWebmExportFile(project, composition, {
                ...options,
                bitrate,
                blackFrameAtStart,
                blackFrameAtEnd,
              });
              return [{ ...file, fileName }];
            },
          }
        : {
            saveInFolder: async (folder, signal, reportProgress) => {
              const options = exportOptions(signal, reportProgress);
              const { savePngSequenceInFolder } = await import('../state/videoExport');
              return [await savePngSequenceInFolder(project, composition, options, folder)];
            },
          })}
    >
      {({ busy, clearError }) => (
        <>
          <div className="studio-export-preview">
            <p>Preview</p>
            {!busy && (
              <ExportThumbnail
                project={project}
                composition={composition}
                frame={project.thumbnailFrame ?? null}
                nleExport={transparent}
              />
            )}
          </div>
          <div className="studio-export-options">
            <label>
              Export format
              <select
                data-export-initial-focus
                value={format}
                onChange={(event) => {
                  setFormat(event.currentTarget.value as VideoFormat);
                  clearError();
                }}
              >
                <option value="webm">WebM video</option>
                {canPickFolder && <option value="png-frames">PNG image sequence</option>}
              </select>
            </label>
            {!canPickFolder && <p>PNG image sequences require folder access in Chrome or Edge.</p>}
            <div className="studio-export-dimensions">
              <label>
                Width (px)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.width}
                  aria-invalid={!isPixelSize(width)}
                  onChange={(event) => {
                    resize('width', event.currentTarget.value);
                    clearError();
                  }}
                />
              </label>
              <label>
                Height (px)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.height}
                  aria-invalid={!isPixelSize(height)}
                  onChange={(event) => {
                    resize('height', event.currentTarget.value);
                    clearError();
                  }}
                />
              </label>
            </div>
            <label className="studio-export-option">
              <input
                type="checkbox"
                checked={lockAspect}
                onChange={(event) => {
                  const lock = event.currentTarget.checked;
                  setLockAspect(lock);
                  if (lock && sizeDraft) resize('width', draft.width, lock);
                  clearError();
                }}
              />
              Lock aspect ratio
            </label>
            {invalidSize && <p role="alert">Enter positive whole-pixel dimensions.</p>}
            {!invalidSize && webm && (width !== webmWidth || height !== webmHeight) && (
              <p>
                WebM pads to {webmWidth} × {webmHeight} so both dimensions are even.
              </p>
            )}
            {webm && (
              <label>
                Video bitrate (Mb/s)
                <input
                  type="number"
                  min={0.000001}
                  step="any"
                  placeholder="Auto"
                  value={bitrateDraft}
                  aria-invalid={invalidBitrate}
                  onChange={(event) => {
                    setBitrateDraft(event.currentTarget.value);
                    clearError();
                  }}
                />
              </label>
            )}
            {invalidBitrate && (
              <p role="alert">Enter a positive video bitrate or leave it blank for Auto.</p>
            )}
            <label className="studio-export-option">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(event) => {
                  setTransparent(event.currentTarget.checked);
                  clearError();
                }}
              />
              Transparent background
            </label>
            <label>
              Hold on each step (seconds)
              <input
                type="number"
                min={0}
                max={600}
                step="any"
                value={holdDraft}
                aria-invalid={invalidHold}
                onChange={(event) => {
                  setHoldDraft(event.currentTarget.value);
                  clearError();
                }}
              />
            </label>
            {invalidHold && <p role="alert">Enter a hold between 0 and 600 seconds.</p>}
            {webm && (
              <>
                <label className="studio-export-option">
                  <input
                    type="checkbox"
                    checked={blackFrameAtStart}
                    onChange={(event) => {
                      setBlackFrameAtStart(event.currentTarget.checked);
                      clearError();
                    }}
                  />
                  Black frame at start
                </label>
                <label className="studio-export-option">
                  <input
                    type="checkbox"
                    checked={blackFrameAtEnd}
                    onChange={(event) => {
                      setBlackFrameAtEnd(event.currentTarget.checked);
                      clearError();
                    }}
                  />
                  Black frame at end
                </label>
              </>
            )}
            <p>
              {webm
                ? 'The movie includes timeline sound and pauses at each step.'
                : 'Save files… writes individual PNG frames into a new folder, including the hold at each step.'}
            </p>
            {includesUnsupportedMedia(composition, webm) && (
              <p>
                {webm
                  ? 'Video and live media, and sounds started by an operator or a custom action, are omitted.'
                  : 'Moving and live media are omitted from the image sequence.'}
              </p>
            )}
            <div className="studio-export-file-list">
              <p>{webm ? 'File to export' : 'Folder to export'}</p>
              <ul>
                <li>{webm ? fileName : getPngSequenceFolderName(project.name)}</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </ExportDialogWindow>
  );
}
