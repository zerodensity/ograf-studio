import { useEffect, useRef, useState } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useDetachedWindows } from '../layout/detachedWindowContext';
import { screenBounds, type AvailableScreenDetails } from '../layout/detachedWindowGeometry';
import { useWorkspaceStore } from '../state/workspaceStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { usePlayoutControlsStore } from '../state/playoutControlsStore';
import { installPreviewShortcuts } from '../state/previewPresentation';
import { Panel } from './Panel';
import { PreviewPlayoutControls } from './PreviewPlayoutControls';
import { PreviewBackgroundControls } from './PreviewBackgroundControls';
import './PlayoutControlsPanel.css';

export function PlayoutControlsPanel() {
  const session = usePlayoutControlsStore((state) => state.session);
  const detached = useDetachedWindows();
  const { document, window } = useEditorWindow();
  const [screens, setScreens] = useState<AvailableScreenDetails['screens']>([]);
  const [screenStatus, setScreenStatus] = useState('');
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !session) return;
    return installPreviewShortcuts(
      document,
      controls,
      controls,
      (delta) => session.play({ delta }),
      session.canNavigate,
      { onArrow: session.navigate },
    );
  }, [document, session]);

  return (
    <Panel title="Playout Controls">
      <div className="playout-controls-panel" ref={controlsRef} tabIndex={-1}>
        <button
          type="button"
          onClick={() => {
            usePaneRequestStore.getState().reveal('export');
            detached.open('export');
          }}
          title="Open the preview in a separate window. Move it to a display, then use Fullscreen."
        >
          Open Program Monitor
        </button>
        <button
          type="button"
          onClick={() => {
            const getDetails = (
              window as Window & { getScreenDetails?: () => Promise<AvailableScreenDetails> }
            ).getScreenDetails;
            if (!getDetails) {
              setScreenStatus(
                'Display selection is unavailable in this browser. Drag the Program Monitor to your other screen.',
              );
              return;
            }
            void getDetails
              .call(window)
              .then((details) => {
                setScreens(details.screens);
                setScreenStatus(
                  details.screens.length
                    ? 'Choose a display, then use Fullscreen in the Program Monitor.'
                    : 'No displays were returned. Drag the Program Monitor to your other screen.',
                );
              })
              .catch(() =>
                setScreenStatus(
                  'Display access was not granted. Drag the Program Monitor to your other screen.',
                ),
              );
          }}
        >
          Choose display…
        </button>
        {screens.length > 0 && (
          <label>
            Program display{' '}
            <select
              defaultValue=""
              onChange={(event) => {
                const target = screens[Number(event.currentTarget.value)];
                if (!target) return;
                const bounds = screenBounds(target);
                useWorkspaceStore.getState().updateDetached('export', {
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height,
                  screen: bounds,
                });
                const existing = detached.windows.export?.window;
                if (existing && !existing.closed) {
                  try {
                    existing.moveTo(bounds.left, bounds.top);
                    existing.resizeTo(bounds.width, bounds.height);
                    existing.focus();
                  } catch {
                    setScreenStatus(
                      'The browser could not move this window. Drag it to the chosen display.',
                    );
                  }
                } else {
                  usePaneRequestStore.getState().reveal('export');
                  detached.open('export');
                }
              }}
            >
              <option value="" disabled>
                Choose display
              </option>
              {screens.map((screen, index) => (
                <option key={index} value={String(index)}>
                  {(screen as Screen & { label?: string }).label || `Display ${index + 1}`} ·{' '}
                  {screen.width} × {screen.height}
                </option>
              ))}
            </select>
          </label>
        )}
        {screenStatus && (
          <p className="playout-controls-note" role="status">
            {screenStatus}
          </p>
        )}
        <p className="playout-controls-note">Program shortcuts: T Take, U Update, O Out.</p>
        {session ? (
          <PreviewPlayoutControls session={session} showStatus />
        ) : (
          <div className="playout-controls-empty">
            <p>
              Open Preview &amp; Export to control its output here, including fullscreen on another
              monitor.
            </p>
            <button type="button" onClick={() => usePaneRequestStore.getState().reveal('export')}>
              Open Preview &amp; Export
            </button>
            <PreviewBackgroundControls />
          </div>
        )}
      </div>
    </Panel>
  );
}
