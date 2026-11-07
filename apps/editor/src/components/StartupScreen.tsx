import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { openStudioDocumentFromFile } from '../state/fileIO';
import {
  listRecentDocuments,
  readRecentDocument,
  type RecentDocument,
} from '../state/recentDocuments';
import { applyOpenedStudioDocument } from '../state/openStudioDocument';
import { importEditableProjectFromOgraf } from '../state/importOgraf';
import { openStartupImportedGraphic } from '../state/startupImport';
import { useStartupScreenStore } from '../state/startupScreenStore';
import { commitStartupCreation, initialStartupSettings } from '../state/startupCreation';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { onAirFrame } from '../state/onAirFrame';
import { useMovableDialog } from './useMovableDialog';
import { OgrafLogo } from './OgrafLogo';
import { STUDIO_VERSION, STUDIO_BUILD_DATE, STUDIO_BUILD_REVISION } from '../state/buildInfo';
import {
  resolveStartupSettings,
  STARTUP_FRAME_RATES,
  STARTUP_SIZES,
  startupRateLabel,
} from './startupSettings';
import './StartupScreen.css';

const recipes = [
  ['Lower Third', 'addLowerThird'],
  ['Bug / DOG', 'addBug'],
  ['Ticker', 'addTicker'],
  ['Scoreboard', 'addScoreboard'],
  ['Clock / Timer', 'addClock'],
  ['Countdown', 'addCountdown'],
] as const;

export function StartupScreen() {
  const visible = useStartupScreenStore((state) => state.visible);
  const request = useStartupScreenStore((state) => state.request);
  const showWelcomeOnStartup = useWorkspaceStore(
    (state) => state.editorPreferences.showWelcomeOnStartup,
  );
  const workspaceStorageError = useWorkspaceStore((state) => state.storageError);
  const close = () => useStartupScreenStore.getState().close();
  const [size, setSize] = useState('1920x1080');
  const [rate, setRate] = useState('50');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [customRate, setCustomRate] = useState('50');
  const [error, setError] = useState('');
  const [preferenceTouched, setPreferenceTouched] = useState(false);
  const [recent, setRecent] = useState<RecentDocument[]>([]);
  const firstButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const movable = useMovableDialog(dialog, { enabled: visible });
  useEffect(() => {
    if (!visible || !request) return;
    const initial = initialStartupSettings(request);
    const sizeKey = `${initial.width}x${initial.height}`;
    setSize(
      STARTUP_SIZES.some((preset) => `${preset.width}x${preset.height}` === sizeKey)
        ? sizeKey
        : 'custom',
    );
    setWidth(String(initial.width));
    setHeight(String(initial.height));
    setRate(STARTUP_FRAME_RATES.includes(initial.frameRate) ? String(initial.frameRate) : 'custom');
    setCustomRate(String(initial.frameRate));
    setError('');
    setPreferenceTouched(false);
  }, [visible, request]);
  useEffect(() => {
    if (visible) firstButton.current?.focus();
  }, [visible]);
  useEffect(() => {
    if (visible) void listRecentDocuments().then(setRecent);
  }, [visible]);
  useEffect(() => {
    if (!visible || request?.kind !== 'startup') return;
    const initialProject = useProjectStore.getState().project;
    return useProjectStore.subscribe((state) => {
      if (state.project !== initialProject) useStartupScreenStore.getState().setVisible(false);
    });
  }, [visible, request?.kind]);
  if (!visible || !request) return null;
  const isStartup = request.kind === 'startup';
  const isNewSet = request.kind === 'new-set';
  const title = isStartup ? 'Start creating' : isNewSet ? 'New template set' : 'New template';
  const dismiss = () => {
    if (isStartup) {
      const startup = useStartupScreenStore.getState();
      if (startup.bootCreatedProject === useProjectStore.getState().project)
        startup.setPristineStartupProject(startup.bootCreatedProject);
    }
    close();
  };
  const prepare = () => {
    const settings = resolveStartupSettings(width, height, rate === 'custom' ? customRate : rate);
    if (!settings) {
      setError('Enter a positive whole-number canvas width and height, and a positive frame rate.');
      return false;
    }
    try {
      const ownerWindow = dialog.current?.ownerDocument.defaultView ?? window;
      const created = commitStartupCreation(settings, (message) => ownerWindow.confirm(message));
      if (created) setError('');
      return created;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the document.');
      return false;
    }
  };
  const open = async () => {
    try {
      const document = await openStudioDocumentFromFile(window);
      if (document) {
        applyOpenedStudioDocument(document);
        close();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importPackage = async () => {
    try {
      const imported = await importEditableProjectFromOgraf();
      if (!imported) return;
      openStartupImportedGraphic(imported);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const openRecent = async (item: RecentDocument) => {
    try {
      const opened = await readRecentDocument(item);
      const owner = dialog.current?.ownerDocument.defaultView ?? window;
      if (
        !owner.confirm(
          'Open this recent document? Unsaved changes in the current document will be lost.',
        )
      )
        return;
      applyOpenedStudioDocument(opened);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="startup-screen-backdrop">
      <section
        ref={dialog}
        {...movable.dialogProps}
        className="startup-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-title"
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [data-movable-dialog-handle]',
            ) ?? []),
          ];
          if (!focusable.length) return;
          const first = focusable[0]!;
          const last = focusable.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header {...movable.handleProps} className="startup-screen-header">
          <div className="startup-screen-header-row">
            <span className="startup-screen-grip" aria-hidden="true">
              ⠿
            </span>
            <h1 id="startup-title">{title}</h1>
            <button
              type="button"
              className="startup-screen-close"
              aria-label={isStartup ? 'Close welcome screen' : 'Close without creating'}
              onClick={dismiss}
            >
              <span aria-hidden="true">×</span> Close
            </button>
          </div>
          <p>
            {isNewSet
              ? 'Create a set from the current template and choose its shared output settings.'
              : 'Choose a starting point for your graphic.'}
          </p>
        </header>
        <div className="startup-screen-settings">
          <label>
            Canvas size{' '}
            <select
              value={size}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSize(value);
                if (value !== 'custom') {
                  const chosen = STARTUP_SIZES.find(
                    (preset) => `${preset.width}x${preset.height}` === value,
                  );
                  if (chosen) {
                    setWidth(String(chosen.width));
                    setHeight(String(chosen.height));
                  }
                }
              }}
            >
              {STARTUP_SIZES.map((preset) => (
                <option
                  key={`${preset.width}x${preset.height}`}
                  value={`${preset.width}x${preset.height}`}
                >
                  {preset.width} × {preset.height}
                  {preset.width * 16 === preset.height * 9 ? ' · 9:16' : ''}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {size === 'custom' && (
            <>
              <label>
                Width (px)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={width}
                  onChange={(event) => setWidth(event.currentTarget.value)}
                />
              </label>
              <label>
                Height (px)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={height}
                  onChange={(event) => setHeight(event.currentTarget.value)}
                />
              </label>
            </>
          )}
          <label>
            Frame rate{' '}
            <select
              value={rate}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value !== 'custom') setCustomRate(value);
                setRate(value);
              }}
            >
              {STARTUP_FRAME_RATES.map((fps) => (
                <option key={fps} value={String(fps)}>
                  {startupRateLabel(fps)} fps
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {rate === 'custom' && (
            <label>
              Custom frame rate (fps)
              <input
                type="number"
                min="0"
                step="any"
                value={customRate}
                onChange={(event) => setCustomRate(event.currentTarget.value)}
              />
            </label>
          )}
          <button
            ref={firstButton}
            type="button"
            onClick={() => {
              if (prepare()) close();
            }}
          >
            {isNewSet ? 'Create set from current template' : 'Blank template'}
          </button>
          {!isStartup && (
            <button type="button" onClick={close}>
              Cancel
            </button>
          )}
        </div>
        {!isNewSet && <h2>New from a recipe</h2>}
        {!isNewSet && (
          <div className="startup-screen-recipes">
            {recipes.map(([name, method]) => (
              <button
                type="button"
                key={method}
                onClick={() => {
                  if (!prepare()) return;
                  let ids: string[] = [];
                  runDiscreteHistoryStep(() => {
                    ids = Object.values(useProjectStore.getState()[method]().layers);
                  }, `Add ${name}`);
                  useSelectionStore.getState().selectMany([...new Set(ids)]);
                  const state = useProjectStore.getState();
                  const composition = state.project.compositions.find(
                    (item) => item.id === state.activeCompositionId,
                  );
                  if (composition) {
                    const frame = onAirFrame(composition);
                    useTimelineStore.getState().controller?.seek(frame);
                    useTimelineStore.getState().setCurrentFrame(frame);
                  }
                  close();
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {isStartup && (
          <div className="startup-screen-open">
            <button type="button" onClick={() => void open()}>
              Open .ogs or template set…
            </button>
            <button type="button" onClick={() => void importPackage()}>
              Import .ograf.zip…
            </button>
          </div>
        )}
        {isStartup && recent.length > 0 && (
          <>
            <h2>Recent</h2>
            <div className="startup-screen-recents">
              {recent.map((item) => (
                <button type="button" key={item.id} onClick={() => void openRecent(item)}>
                  {item.name}
                </button>
              ))}
            </div>
          </>
        )}
        {isStartup && (
          <label
            className="startup-screen-startup-preference"
            title="Turn this back on in Settings & Preferences → Workspace & windows."
          >
            <input
              type="checkbox"
              checked={showWelcomeOnStartup === false}
              onChange={(event) => {
                const hidden = event.currentTarget.checked;
                setPreferenceTouched(true);
                useWorkspaceStore.getState().updateEditorPreferences({
                  showWelcomeOnStartup: !hidden,
                });
                const startup = useStartupScreenStore.getState();
                startup.setPristineStartupProject(hidden ? startup.bootCreatedProject : null);
              }}
            />
            Don’t show on startup
          </label>
        )}
        {isStartup && preferenceTouched && workspaceStorageError && (
          <p role="status">{workspaceStorageError}</p>
        )}
        {error && <p role="alert">{error}</p>}
        <footer className="startup-screen-branding">
          <div className="startup-screen-brand">
            <OgrafLogo section /> <strong>Studio</strong>
          </div>
          <div className="startup-screen-build">
            <span>Version {STUDIO_VERSION}</span>
            <span>Build {STUDIO_BUILD_REVISION}</span>
            <time dateTime={STUDIO_BUILD_DATE}>Built {STUDIO_BUILD_DATE}</time>
            <a
              href="https://github.com/zerodensity/ograf-studio"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </footer>
      </section>
    </div>
  );
}
