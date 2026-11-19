import { useEffect, useRef, useState } from 'react';
import { NLE_EXPORT_PROFILE, compositionForExportProfile } from '@ograf-editor/codegen';
import {
  getTotalFrames,
  projectThumbnailFrame,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { allowExportDialogPaint } from '../state/studioSetExport';

export function ExportThumbnail({
  project,
  composition,
  frame,
  nleExport,
  frozen = false,
  onFrame,
}: {
  project: Project;
  composition: Composition;
  frame: number | null;
  nleExport: boolean;
  frozen?: boolean;
  onFrame?: (frame: number | null) => void;
}) {
  const { window: owner } = useEditorWindow();
  const [completed, setCompleted] = useState<{ url: string; frame: number } | null>(null);
  const [status, setStatus] = useState<'rendering' | 'ready' | 'failed'>('rendering');
  const retainedUrl = useRef('');
  const selectedFrame = projectThumbnailFrame({
    ...project,
    mainCompositionId: composition.id,
    thumbnailFrame: frame,
  });
  const totalFrames = getTotalFrames(composition);
  useEffect(
    () => () => {
      if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current);
      retainedUrl.current = '';
    },
    [],
  );
  useEffect(() => {
    if (frozen) return;
    const controller = new AbortController();
    setStatus('rendering');
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
      .then(({ createTemplateThumbnail }) => {
        controller.signal.throwIfAborted();
        return createTemplateThumbnail(thumbnailProject, controller.signal);
      })
      .then((blob) => {
        if (!controller.signal.aborted) {
          const url = URL.createObjectURL(blob);
          if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current);
          retainedUrl.current = url;
          setCompleted({ url, frame: selectedFrame });
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed');
      });
    return () => controller.abort();
  }, [project, composition, frame, selectedFrame, nleExport, frozen, owner]);

  const image = frozen || status === 'ready' ? completed : null;
  return (
    <div className="studio-export-thumbnail">
      <div className="studio-export-thumbnail-image" aria-busy={!frozen && status === 'rendering'}>
        {image ? (
          <img src={image.url} alt={`Thumbnail at frame ${image.frame}`} />
        ) : (
          <span>
            {status === 'failed'
              ? 'Thumbnail preview unavailable.'
              : frozen
                ? 'Thumbnail preview paused during export.'
                : 'Rendering thumbnail…'}
          </span>
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
              value={frozen && image ? image.frame : selectedFrame}
              disabled={frozen}
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
              disabled={frozen}
              onChange={(event) => onFrame(event.target.checked ? null : selectedFrame)}
            />
            First OGraf step
          </label>
        </>
      )}
    </div>
  );
}
