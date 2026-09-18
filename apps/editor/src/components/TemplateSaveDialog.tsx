import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getTotalFrames,
  projectThumbnailFrame,
  templateBaseName,
  templateThumbnailName,
  type Project,
} from '@ograf-editor/scene-model';
import { saveProjectToFile } from '../state/fileIO';
import { useEditorWindow } from '../layout/EditorWindow';
import './TemplateSaveDialog.css';

export function TemplateSaveDialog({
  project,
  onClose,
  onSaved,
  exportOptions,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (mode: 'saved' | 'downloaded', frame: number | null) => void;
  exportOptions?: {
    fileName: string;
    save: (snapshot: Project) => Promise<'saved' | 'cancelled' | 'downloaded'>;
  };
}) {
  const { document: ownerDocument } = useEditorWindow();
  const [name, setName] = useState(templateBaseName(project.name));
  const [frame, setFrame] = useState<number | null>(project.thumbnailFrame ?? null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const snapshot = useMemo(() => ({ ...project, thumbnailFrame: frame }), [project, frame]);
  const composition = snapshot.compositions.find((item) => item.id === snapshot.mainCompositionId)!;
  const selectedFrame = projectThumbnailFrame(snapshot);
  const totalFrames = getTotalFrames(composition);
  const baseName = templateBaseName(name);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setRendering(true);
    setPreview('');
    setError('');
    void import('../state/templateThumbnail')
      .then(({ createTemplateThumbnail }) => createTemplateThumbnail(snapshot))
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
        setRendering(false);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not render thumbnail.');
          setRendering(false);
        }
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [snapshot]);
  const save = async (downloadOnly = false) => {
    if (saving || rendering || !preview || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = exportOptions
        ? await exportOptions.save(snapshot)
        : await saveProjectToFile(snapshot, { baseName, downloadOnly });
      if (result !== 'cancelled') onSaved(result, frame);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : exportOptions
            ? 'Could not export template.'
            : 'Could not save template.',
      );
    } finally {
      setSaving(false);
    }
  };
  return createPortal(
    <div className="template-save-backdrop">
      <section
        className="template-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={exportOptions ? 'Export OGraf with thumbnail' : 'Save template and thumbnail'}
        ref={dialogRef}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !saving) onClose();
          if (event.key === 'Tab') {
            const controls = [
              ...(dialogRef.current?.querySelectorAll<HTMLElement>(
                'input:not(:disabled), button:not(:disabled)',
              ) ?? []),
            ];
            const current = controls.indexOf(ownerDocument.activeElement as HTMLElement);
            if (
              controls.length &&
              ((event.shiftKey && current <= 0) ||
                (!event.shiftKey && current === controls.length - 1))
            ) {
              event.preventDefault();
              (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
          }
        }}
      >
        <h2>{exportOptions ? 'Export OGraf' : 'Save template'}</h2>
        {!exportOptions && (
          <label>
            File name
            <input
              ref={inputRef}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <div className="template-thumbnail-controls">
          <div className="template-thumbnail-frame-picker">
            <label htmlFor="template-thumbnail-frame">Thumbnail frame</label>
            <div className="template-thumbnail-frame-buttons">
              <button
                type="button"
                aria-label="Previous frame"
                title="Previous frame"
                disabled={saving || selectedFrame === 0}
                onClick={() =>
                  setFrame((current) =>
                    Math.max(0, projectThumbnailFrame({ ...project, thumbnailFrame: current }) - 1),
                  )
                }
              >
                ‹
              </button>
              <input
                id="template-thumbnail-frame"
                ref={exportOptions ? inputRef : undefined}
                type="number"
                min={0}
                max={totalFrames}
                step={1}
                value={selectedFrame}
                disabled={saving}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 0 && value <= totalFrames)
                    setFrame(value);
                }}
              />
              <button
                type="button"
                aria-label="Next frame"
                title="Next frame"
                disabled={saving || selectedFrame === totalFrames}
                onClick={() =>
                  setFrame((current) =>
                    Math.min(
                      totalFrames,
                      projectThumbnailFrame({ ...project, thumbnailFrame: current }) + 1,
                    ),
                  )
                }
              >
                ›
              </button>
            </div>
          </div>
          <label className="template-thumbnail-auto">
            <input
              type="checkbox"
              checked={frame === null}
              disabled={saving}
              onChange={(event) => setFrame(event.target.checked ? null : selectedFrame)}
            />
            First OGraf step
          </label>
        </div>
        <div className="template-thumbnail-preview" aria-busy={rendering}>
          {preview ? (
            <img src={preview} alt={`Transparent template thumbnail at frame ${selectedFrame}`} />
          ) : null}
          {rendering ? <span>Rendering preview…</span> : null}
        </div>
        <small>
          {composition.name} · Frame {selectedFrame} · Transparent PNG
        </small>
        <div className="template-save-filenames">
          <span>{exportOptions ? exportOptions.fileName : `${baseName}.ogs`}</span>
          <span>
            {templateThumbnailName(snapshot)}
            {exportOptions ? ' (inside ZIP)' : ''}
          </span>
        </div>
        <p>
          {exportOptions
            ? 'Choose the thumbnail frame to include in the OGraf package.'
            : window.showDirectoryPicker
              ? 'Choose a folder to save both files together.'
              : 'Download a ZIP containing the editable template and its PNG thumbnail.'}
        </p>
        {error ? (
          <div role="alert" className="template-save-error">
            {error}
          </div>
        ) : null}
        <div className="template-save-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          {!exportOptions && window.showDirectoryPicker ? (
            <button
              type="button"
              disabled={saving || rendering || !preview || !name.trim()}
              onClick={() => void save(true)}
            >
              Download ZIP
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving || rendering || !preview || !name.trim()}
            onClick={() => void save()}
          >
            {exportOptions
              ? saving
                ? 'Testing & exporting…'
                : 'Export .ograf.zip'
              : saving
                ? 'Saving…'
                : window.showDirectoryPicker
                  ? 'Save files…'
                  : 'Download files'}
          </button>
        </div>
      </section>
    </div>,
    ownerDocument.body,
  );
}
