import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMovableDialog } from './useMovableDialog';
import { isDomElement, useEditorWindow } from '../layout/EditorWindow';
import {
  applyWebcamSettings,
  getWebcamPreviewState,
  resetWebcamSettings,
  WEBCAM_IMAGE_CONTROL_LABELS,
  WEBCAM_MANUAL_CONTROL_MODES,
  type WebcamActualSettings,
  type WebcamCameraCapabilities,
  type WebcamCaptureSettings,
  type WebcamImageControl,
} from '../state/webcamPreview';
import {
  cameraCaptureSummary,
  cameraFrameRateChoice,
  cameraFrameRateChoices,
  cameraResolutionChoice,
  cameraResolutionChoices,
} from './webcamCameraSettingsUi';
import './WebcamCameraSettingsDialog.css';

function modeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
}

type CameraSettingsFieldsProps = {
  draft: WebcamCaptureSettings;
  actual: WebcamActualSettings | null;
  capabilities: WebcamCameraCapabilities | null;
  disabled: boolean;
  resolutionChoice: string;
  frameRateChoice: string;
  onChange: (settings: WebcamCaptureSettings) => void;
  onResolutionChoice: (choice: string) => void;
  onFrameRateChoice: (choice: string) => void;
};

export function CameraSettingsFields({
  draft,
  actual,
  capabilities,
  disabled,
  resolutionChoice,
  frameRateChoice,
  onChange,
  onResolutionChoice,
  onFrameRateChoice,
}: CameraSettingsFieldsProps) {
  const fieldId = useId();
  const controls = actual && capabilities ? Object.entries(capabilities.controls) : [];
  const setControl = (key: WebcamImageControl, value: number | string | boolean) => {
    const next = { ...draft.controls, [key]: value };
    if (value !== 'manual') {
      for (const [dependent, mode] of Object.entries(WEBCAM_MANUAL_CONTROL_MODES)) {
        if (mode === key) delete next[dependent as WebcamImageControl];
      }
    }
    onChange({ ...draft, controls: next });
  };
  return (
    <>
      <fieldset disabled={disabled} className="webcam-camera-capture-fields">
        <legend>Capture preferences</legend>
        <label className="webcam-camera-setting-row">
          <span>Resolution</span>
          <select value={resolutionChoice} onChange={(e) => onResolutionChoice(e.target.value)}>
            <option value="auto">Automatic</option>
            {cameraResolutionChoices(capabilities).map(([width, height]) => (
              <option key={width} value={`${width}x${height}`}>
                {width} × {height}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        {resolutionChoice === 'custom' ? (
          <div className="webcam-camera-custom-size">
            <label>
              Width
              <input
                type="number"
                min={Math.max(1, capabilities?.width?.min ?? 1)}
                max={capabilities?.width?.max}
                step={capabilities?.width?.step ?? 1}
                value={draft.width ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    width: e.target.value === '' ? undefined : e.target.valueAsNumber,
                  })
                }
              />
            </label>
            <span aria-hidden="true">×</span>
            <label>
              Height
              <input
                type="number"
                min={Math.max(1, capabilities?.height?.min ?? 1)}
                max={capabilities?.height?.max}
                step={capabilities?.height?.step ?? 1}
                value={draft.height ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    height: e.target.value === '' ? undefined : e.target.valueAsNumber,
                  })
                }
              />
            </label>
          </div>
        ) : null}
        <label className="webcam-camera-setting-row">
          <span>Frame rate</span>
          <select value={frameRateChoice} onChange={(e) => onFrameRateChoice(e.target.value)}>
            <option value="auto">Automatic</option>
            {cameraFrameRateChoices(capabilities).map((value) => (
              <option key={value} value={value}>
                {value} FPS
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        {frameRateChoice === 'custom' ? (
          <label className="webcam-camera-setting-row">
            <span>FPS</span>
            <input
              type="number"
              min={Math.max(0.01, capabilities?.frameRate?.min ?? 0.01)}
              max={capabilities?.frameRate?.max}
              step={capabilities?.frameRate?.step ?? 'any'}
              value={draft.frameRate ?? ''}
              onChange={(e) =>
                onChange({
                  ...draft,
                  frameRate: e.target.value === '' ? undefined : e.target.valueAsNumber,
                })
              }
            />
          </label>
        ) : null}
        <p className="webcam-camera-help">
          Preferred values; the camera may use another supported combination. Actual capture is
          shown above.
        </p>
      </fieldset>
      <fieldset disabled={disabled || !actual} className="webcam-camera-image-fields">
        <legend>Image controls</legend>
        {controls.length ? (
          controls.map(([name, capability]) => {
            if (!capability) return null;
            const key = name as WebcamImageControl;
            const value = draft.controls[key] ?? actual?.controls[key];
            const id = `${fieldId}-${key}`;
            const label = WEBCAM_IMAGE_CONTROL_LABELS[key];
            const mode =
              WEBCAM_MANUAL_CONTROL_MODES[key as keyof typeof WEBCAM_MANUAL_CONTROL_MODES];
            const modeCapability = mode ? capabilities?.controls[mode] : undefined;
            const needsManual =
              mode &&
              modeCapability &&
              (draft.controls[mode] ?? actual?.controls[mode]) !== 'manual';
            const manualHint =
              needsManual && mode
                ? modeCapability?.type === 'mode' && !modeCapability.values.includes('manual')
                  ? `${WEBCAM_IMAGE_CONTROL_LABELS[mode]} does not support Manual on this camera.`
                  : `Select Manual for ${WEBCAM_IMAGE_CONTROL_LABELS[mode]}`
                : undefined;
            return (
              <div key={key} className="webcam-camera-setting-row webcam-camera-image-row">
                <label
                  htmlFor={id}
                  title={
                    actual?.controls[key] === undefined
                      ? undefined
                      : `Actual: ${actual.controls[key]}`
                  }
                >
                  {label}
                </label>
                {capability.type === 'number' ? (
                  <div className="webcam-camera-number-control">
                    <input
                      type="range"
                      aria-label={`${label} slider`}
                      min={capability.min}
                      max={capability.max}
                      step={capability.step ?? 'any'}
                      value={typeof value === 'number' ? value : capability.min}
                      disabled={
                        !!needsManual ||
                        capability.min === capability.max ||
                        typeof value !== 'number'
                      }
                      onChange={(e) => setControl(key, e.target.valueAsNumber)}
                    />
                    <input
                      id={id}
                      type="number"
                      min={capability.min}
                      max={capability.max}
                      step={capability.step ?? 'any'}
                      value={typeof value === 'number' ? value : ''}
                      placeholder="Default"
                      disabled={!!needsManual || capability.min === capability.max}
                      title={manualHint}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          const next = { ...draft.controls };
                          delete next[key];
                          onChange({ ...draft, controls: next });
                        } else setControl(key, e.target.valueAsNumber);
                      }}
                    />
                  </div>
                ) : capability.type === 'mode' ? (
                  <select
                    id={id}
                    value={typeof value === 'string' ? value : ''}
                    disabled={capability.values.length < 2}
                    onChange={(e) => setControl(key, e.target.value)}
                  >
                    {!capability.values.includes(String(value)) ? (
                      <option value="">Device default</option>
                    ) : null}
                    {capability.values.map((entry) => (
                      <option key={entry} value={entry}>
                        {modeLabel(entry)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    disabled={capability.values.length < 2}
                    onChange={(e) => setControl(key, e.target.checked)}
                  />
                )}
              </div>
            );
          })
        ) : (
          <p className="webcam-camera-help">
            {actual
              ? 'This camera does not expose image controls in this browser.'
              : 'Start the webcam to discover its supported image controls.'}
          </p>
        )}
      </fieldset>
    </>
  );
}

export function WebcamCameraSettingsDialog({
  cameraName,
  cameraSettings,
  starting,
  disabled,
  onClose,
}: {
  cameraName: string;
  cameraSettings: ReturnType<typeof getWebcamPreviewState>['cameraSettings'];
  starting: boolean;
  disabled: boolean;
  onClose: () => void;
}) {
  const { document } = useEditorWindow();
  const dialog = useRef<HTMLDialogElement>(null);
  const move = useMovableDialog(dialog);
  const titleId = useId();
  const [draft, setDraft] = useState<WebcamCaptureSettings>(() => ({
    ...cameraSettings.requested,
    controls: { ...cameraSettings.requested.controls },
  }));
  const [resolutionChoice, setResolutionChoice] = useState(() =>
    cameraResolutionChoice(cameraSettings.requested, cameraSettings.capabilities),
  );
  const [frameRateChoice, setFrameRateChoice] = useState(() =>
    cameraFrameRateChoice(cameraSettings.requested, cameraSettings.capabilities),
  );
  const [feedback, setFeedback] = useState('');
  const busy = disabled || starting || cameraSettings.status === 'applying';
  const syncDraft = () => {
    const settings = getWebcamPreviewState().cameraSettings;
    setDraft({ ...settings.requested, controls: { ...settings.requested.controls } });
    setResolutionChoice(cameraResolutionChoice(settings.requested, settings.capabilities));
    setFrameRateChoice(cameraFrameRateChoice(settings.requested, settings.capabilities));
  };
  useEffect(() => {
    const node = dialog.current!;
    const previousFocus = document.activeElement;
    node.showModal();
    node.querySelector<HTMLSelectElement>('select')?.focus();
    return () => {
      node.close();
      if (isDomElement(previousFocus) && previousFocus.isConnected) previousFocus.focus();
    };
  }, [document]);
  return createPortal(
    <dialog
      ref={dialog}
      className="webcam-camera-settings"
      {...move.dialogProps}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setFeedback('');
          if (await applyWebcamSettings(draft)) {
            syncDraft();
            setFeedback(
              cameraSettings.actual
                ? 'Camera settings applied.'
                : 'Settings saved for the next Start webcam.',
            );
          }
        }}
      >
        <header {...move.handleProps}>
          <h2 id={titleId}>Camera Settings</h2>
          <button type="button" aria-label="Close Camera Settings" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="webcam-camera-readback">
          <strong>{cameraName}</strong>
          <span>Actual: {cameraCaptureSummary(cameraSettings.actual)}</span>
        </div>
        <CameraSettingsFields
          draft={draft}
          actual={cameraSettings.actual}
          capabilities={cameraSettings.capabilities}
          disabled={busy}
          resolutionChoice={resolutionChoice}
          frameRateChoice={frameRateChoice}
          onChange={(settings) => {
            setDraft(settings);
            setFeedback('');
          }}
          onResolutionChoice={(choice) => {
            setResolutionChoice(choice);
            setFeedback('');
            if (choice === 'auto') setDraft({ ...draft, width: undefined, height: undefined });
            else if (choice === 'custom')
              setDraft({
                ...draft,
                width: draft.width ?? cameraSettings.actual?.width ?? 1280,
                height: draft.height ?? cameraSettings.actual?.height ?? 720,
              });
            else {
              const [width, height] = choice.split('x').map(Number);
              setDraft({ ...draft, width, height });
            }
          }}
          onFrameRateChoice={(choice) => {
            setFrameRateChoice(choice);
            setFeedback('');
            setDraft({
              ...draft,
              frameRate:
                choice === 'auto'
                  ? undefined
                  : choice === 'custom'
                    ? (draft.frameRate ?? cameraSettings.actual?.frameRate ?? 30)
                    : Number(choice),
            });
          }}
        />
        <p className="webcam-camera-help">
          {cameraSettings.actual
            ? 'Changes affect all previews using this camera.'
            : 'The camera stays off until you press Start webcam.'}{' '}
          Settings stay in this session and are not exported.
        </p>
        {cameraSettings.error ? <p role="alert">{cameraSettings.error}</p> : null}
        {feedback ? <p role="status">{feedback}</p> : null}
        <footer>
          <button
            type="button"
            disabled={busy}
            title="Clear capture preferences and restore this camera’s image settings from when it started."
            onClick={async () => {
              setFeedback('');
              if (await resetWebcamSettings()) {
                syncDraft();
                setFeedback(
                  cameraSettings.actual
                    ? 'Capture preferences reset; image controls restored to startup settings.'
                    : 'Camera preferences reset.',
                );
              }
            }}
          >
            Reset
          </button>
          <span />
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {cameraSettings.status === 'applying'
              ? 'Applying…'
              : cameraSettings.actual
                ? 'Apply'
                : 'Save settings'}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
