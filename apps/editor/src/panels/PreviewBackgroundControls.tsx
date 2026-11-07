import { useRef, useState } from 'react';
import { WebcamPreviewControls } from '../components/WebcamPreviewControls';
import { usePresentationBackgroundStore } from '../state/presentationBackgroundStore';
import { useProgramMonitorStore } from '../state/programMonitorStore';
import { stopWebcamPresentation } from '../state/webcamPreview';
import {
  choosePresentationBackground,
  presentationBackgroundChoice,
  PRESENTATION_BACKGROUND_OPTIONS,
} from '../state/presentationBackgroundSelection';
import './PreviewBackgroundControls.css';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** One operator-selected local background for the document, independent of Take/Out. */
export function PreviewBackgroundControls({
  initiallyOpen = false,
  compact = false,
}: { initiallyOpen?: boolean; compact?: boolean } = {}) {
  const ownerKey = usePresentationBackgroundStore((state) => state.ownerKey);
  const settings = usePresentationBackgroundStore((state) => state.settings);
  const storageError = usePresentationBackgroundStore((state) => state.storageError);
  const storageStatus = usePresentationBackgroundStore((state) => state.storageStatus);
  const update = usePresentationBackgroundStore((state) => state.update);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const program = useProgramMonitorStore();
  const importRequest = useRef(0);
  const [imageError, setImageError] = useState<{ ownerKey: string | null; message: string } | null>(
    null,
  );
  const embeddedImage = settings.imageSource.startsWith('data:image/');
  const error = imageError?.ownerKey === ownerKey ? imageError.message : '';

  const cancelImport = () => {
    importRequest.current += 1;
    setImageError(null);
  };
  const importImage = async (file: File | undefined) => {
    if (!file || !ownerKey) return;
    cancelImport();
    const request = importRequest.current;
    const sourceOwner = ownerKey;
    const report = (message: string) => {
      if (request === importRequest.current) setImageError({ ownerKey: sourceOwner, message });
    };
    if (!file.type.startsWith('image/')) {
      report('Choose a supported image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      report('The presentation image must be 10 MB or smaller.');
      return;
    }
    // Explicit selection wins over a pending saved-state read before the asynchronous file read.
    if (!update({ mode: 'still-image' }, sourceOwner)) return;
    const sourceSettings = usePresentationBackgroundStore.getState().settings;
    try {
      const imageSource = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read the image.'));
        reader.onabort = () => reject(new Error('Image import was cancelled.'));
        reader.readAsDataURL(file);
      });
      if (
        request !== importRequest.current ||
        usePresentationBackgroundStore.getState().settings !== sourceSettings
      )
        return;
      update({ mode: 'still-image', imageSource, imageName: file.name }, sourceOwner);
    } catch (cause) {
      report(cause instanceof Error ? cause.message : 'Failed to read the selected image.');
    }
  };

  return (
    <details className="preview-background-controls" open={initiallyOpen || undefined}>
      <summary>Background</summary>
      {!compact && (
        <label className="preview-background-controls-row">
          <span>Source</span>
          <select
            aria-label="Presentation background"
            value={presentationBackgroundChoice(settings.mode, program.background)}
            disabled={!ownerKey}
            onChange={(event) => {
              cancelImport();
              choosePresentationBackground(
                event.target.value,
                ownerKey,
                settings,
                update,
                program.setBackground,
                stopWebcamPresentation,
              );
            }}
          >
            {PRESENTATION_BACKGROUND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {program.background === 'video' && (
        <div className="preview-background-controls-actions">
          <button type="button" onClick={() => videoInput.current?.click()}>
            Choose local video…
          </button>
          <input
            ref={videoInput}
            type="file"
            accept="video/*"
            hidden
            aria-label="Choose program video"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file?.type.startsWith('video/')) program.setVideo(file);
            }}
          />
          <span>
            {program.videoName ? `${program.videoName} · this session` : 'No video selected'}
          </span>
        </div>
      )}
      {program.background === 'document' && settings.mode === 'webcam' ? (
        <WebcamPreviewControls
          presentation
          disabled={!ownerKey}
          onBeforeStart={() => update({ mode: 'webcam' }, ownerKey)}
        />
      ) : null}
      {program.background === 'document' && settings.mode === 'big-buck-bunny' ? (
        <p className="playout-controls-note">
          Big Buck Bunny © 2008 Blender Foundation,{' '}
          <a href="https://peach.blender.org/about/" target="_blank" rel="noreferrer">
            CC BY 3.0
          </a>
          .
        </p>
      ) : null}
      {program.background === 'document' && settings.mode === 'still-image' ? (
        <>
          <label className="preview-background-controls-row">
            <span>Image URL</span>
            <input
              type="url"
              aria-label="Presentation image URL"
              value={embeddedImage ? '' : settings.imageSource}
              placeholder="https://example.com/background.jpg"
              disabled={!ownerKey}
              onChange={(event) => {
                cancelImport();
                update({ imageSource: event.target.value, imageName: '' }, ownerKey);
              }}
            />
          </label>
          <div className="preview-background-controls-actions">
            <button type="button" disabled={!ownerKey} onClick={() => fileInput.current?.click()}>
              Choose local image…
            </button>
            {settings.imageSource ? (
              <button
                type="button"
                disabled={!ownerKey}
                onClick={() => {
                  cancelImport();
                  update({ imageSource: '', imageName: '' }, ownerKey);
                }}
              >
                Clear
              </button>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="Choose presentation image"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void importImage(file);
              }}
            />
          </div>
          <p className="playout-controls-note">
            {embeddedImage
              ? settings.imageName || 'Local image'
              : settings.imageSource
                ? 'Using the image URL above.'
                : 'Choose an image or enter its URL. Local files can be up to 10 MB.'}
          </p>
          {error ? <p role="alert">{error}</p> : null}
        </>
      ) : null}
      {!compact && (
        <>
          <div className="preview-background-controls-row">
            <span>Program guides</span>
            <span>
              <label>
                <input
                  type="checkbox"
                  checked={program.titleSafe}
                  onChange={(event) =>
                    program.setGuides({ titleSafe: event.currentTarget.checked })
                  }
                />{' '}
                Title safe
              </label>{' '}
              <label>
                <input
                  type="checkbox"
                  checked={program.actionSafe}
                  onChange={(event) =>
                    program.setGuides({ actionSafe: event.currentTarget.checked })
                  }
                />{' '}
                Action safe
              </label>
            </span>
          </div>
          <label className="preview-background-controls-row">
            <span>Aspect guide</span>
            <select
              aria-label="Program aspect guide"
              value={program.aspectGuide}
              onChange={(event) =>
                program.setGuides({
                  aspectGuide: event.currentTarget.value as typeof program.aspectGuide,
                })
              }
            >
              <option value="none">Off</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="9:16">9:16</option>
            </select>
          </label>
        </>
      )}
      <p className="playout-controls-note">
        Shared by this document in the editor and preview. Visible through transparent graphics;
        never included in exports.
      </p>
      <p className="playout-controls-note" role="status">
        {storageStatus === 'saving'
          ? 'Saving background locally…'
          : storageStatus === 'loading'
            ? 'Loading saved background…'
            : storageStatus === 'saved'
              ? 'Saved in this browser.'
              : 'Local preview preference; the template is unchanged.'}
      </p>
      {storageError ? <p role="alert">{storageError}</p> : null}
    </details>
  );
}
