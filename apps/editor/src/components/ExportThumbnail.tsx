import { useEffect, useState } from 'react';
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
