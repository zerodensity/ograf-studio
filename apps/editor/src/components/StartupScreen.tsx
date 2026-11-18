import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ProjectExplorer } from '../explorer/ProjectExplorer';
import { commitStartupCreation } from '../state/startupCreation';
import { useStartupScreenStore } from '../state/startupScreenStore';
import { useMovableDialog } from './useMovableDialog';
import { OgrafLogo } from './OgrafLogo';
import { STUDIO_VERSION, STUDIO_BUILD_DATE, STUDIO_BUILD_REVISION } from '../state/buildInfo';
import { StartupSettingsFields, useStartupSettingsDraft } from './StartupSettingsFields';
import './StartupScreen.css';

/** The window that starts a document: the project explorer, or the settings of a new template set. */
export function StartupScreen() {
  const visible = useStartupScreenStore((state) => state.visible);
  const request = useStartupScreenStore((state) => state.request);
  if (!visible || !request) return null;
  return request.kind === 'new-set' ? (
    <NewTemplateSetDialog />
  ) : (
    <ProjectExplorer request={request} />
  );
}

function NewTemplateSetDialog() {
  const request = useStartupScreenStore((state) => state.request);
  const close = () => useStartupScreenStore.getState().close();
  const draft = useStartupSettingsDraft(request, true);
  const [error, setError] = useState('');
  const firstButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const movable = useMovableDialog(dialog, { enabled: true });
  useEffect(() => {
    firstButton.current?.focus();
  }, []);
  const create = () => {
    const settings = draft.resolve();
    if (!settings) {
      setError('Enter a positive whole-number canvas width and height, and a positive frame rate.');
      return;
    }
    try {
      const ownerWindow = dialog.current?.ownerDocument.defaultView ?? window;
      if (commitStartupCreation(settings, (message) => ownerWindow.confirm(message))) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the document.');
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
            close();
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
            <h1 id="startup-title">New template set</h1>
            <button
              type="button"
              className="startup-screen-close"
              aria-label="Close without creating"
              onClick={close}
            >
              <span aria-hidden="true">×</span> Close
            </button>
          </div>
          <p>Create a set from the current template and choose its shared output settings.</p>
        </header>
        <div className="startup-screen-settings">
          <StartupSettingsFields draft={draft} />
          <button ref={firstButton} type="button" onClick={create}>
            Create set from current template
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
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
