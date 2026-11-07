import { useEffect, useState, useSyncExternalStore } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  getWebcamPreviewState,
  startWebcamPreview,
  startWebcamPresentation,
  stopLiveWebcamPreview,
  stopWebcamPresentation,
  subscribeWebcamPreview,
} from '../state/webcamPreview';
import './WebcamPreviewControls.css';
import { WebcamCameraSettingsDialog } from './WebcamCameraSettingsDialog';

export function WebcamPreviewControls({
  tag,
  presentation = false,
  disabled = false,
  onBeforeStart,
}: {
  tag?: string;
  presentation?: boolean;
  disabled?: boolean;
  /** Commit an output selection before asynchronous capture begins. */
  onBeforeStart?: () => boolean;
}) {
  const { window } = useEditorWindow();
  const webcam = useSyncExternalStore(subscribeWebcamPreview, getWebcamPreviewState);
  const [deviceId, setDeviceId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => setDeviceId(webcam.deviceId), [webcam.deviceId]);
  const activeHere =
    webcam.status === 'running' &&
    (presentation ? webcam.presentation : webcam.tag === (tag ?? '').trim());
  const canStop = activeHere && webcam.deviceId === deviceId;
  const settingsBusy = webcam.cameraSettings.status === 'applying';
  const cameraName =
    webcam.cameraSettings.deviceLabel ??
    webcam.devices.find(
      (device) => device.deviceId === (webcam.status === 'running' ? webcam.deviceId : deviceId),
    )?.label ??
    'Default camera';

  return (
    <div className="webcam-preview-controls">
      <span>Webcam preview · local only, video muted</span>
      <div className="webcam-preview-controls-row">
        {webcam.devices.length > 1 ? (
          <select
            aria-label="Preview camera"
            value={deviceId}
            disabled={disabled || webcam.status === 'starting' || settingsBusy}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">Default camera</option>
            {webcam.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          disabled={
            disabled ||
            (!presentation && !tag?.trim()) ||
            webcam.status === 'starting' ||
            (settingsBusy && !canStop)
          }
          onClick={() => {
            if (canStop) {
              if (presentation) stopWebcamPresentation();
              else stopLiveWebcamPreview();
            } else if (onBeforeStart?.() !== false) {
              if (presentation) void startWebcamPresentation(deviceId, window);
              else void startWebcamPreview(tag ?? '', deviceId, window);
            }
          }}
        >
          {webcam.status === 'starting'
            ? 'Starting camera…'
            : canStop
              ? presentation
                ? 'Stop background webcam'
                : 'Stop live webcam'
              : activeHere
                ? 'Switch camera'
                : webcam.status === 'running'
                  ? 'Use webcam here'
                  : 'Start webcam'}
        </button>
        <button
          type="button"
          disabled={disabled || webcam.status === 'starting' || settingsBusy}
          onClick={() => setSettingsOpen(true)}
        >
          Camera Settings
        </button>
      </div>
      {webcam.status === 'running' && !activeHere ? (
        <small>
          Webcam is currently previewing{' '}
          {webcam.tag ? `live tag “${webcam.tag}”` : 'the presentation background'}.
        </small>
      ) : null}
      {webcam.error ? <small role="alert">{webcam.error}</small> : null}
      <small>
        Camera permission is requested only when you press Start. Video stays local and is not saved
        or exported.
      </small>
      {settingsOpen ? (
        <WebcamCameraSettingsDialog
          key={webcam.deviceId}
          cameraName={cameraName}
          cameraSettings={webcam.cameraSettings}
          starting={webcam.status === 'starting'}
          disabled={disabled}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
