import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tickFramePlayers } from '@ograf-editor/ograf-runtime';
import { useProjectFonts } from '../state/useProjectFonts';
import { DOCK_PANE_IDS, DOCK_PANE_LABELS, type DockPaneId } from './dockModel';
import { EditorWindowContext, type EditorWindow } from './EditorWindow';
import { NumericScrubController } from '../components/NumericScrubController';
import { installEditorShortcuts } from '../state/editorShortcuts';
import { suppressBrowserContextMenu } from '../state/browserContextMenu';
import { registerWebcamPreviewAdapter } from '../state/webcamPreview';
import { useWorkspaceStore } from '../state/workspaceStore';
import { requestPreviewPresentation } from '../state/previewPresentationStore';
import type { DetachedPanePlacement } from '../state/workspaceModel';
import {
  captureDetachedPlacement,
  constrainDetachedPlacement,
  initialDetachedPlacement,
  permittedScreenDetails,
  sameDetachedPlacement,
  type AvailableScreenDetails,
} from './detachedWindowGeometry';
import './DetachedWindows.css';
import {
  DetachedWindowContext,
  useDetachedWindows,
  type WindowRegistry,
} from './detachedWindowContext';

export function DetachedWindowsProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowRegistry['windows']>({});
  const entries = useRef<WindowRegistry['windows']>({});
  const cleanups = useRef(new Map<DockPaneId, () => void>());
  const geometrySuspendedUntil = useRef(new Map<DockPaneId, number>());
  const screenDetails = useRef<AvailableScreenDetails | null>(null);
  const shuttingDown = useRef(false);
  const [error, setError] = useState('');
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const instance = useRef(crypto.randomUUID());
  const desired = useWorkspaceStore((state) => state.current.detached);
  const applyRevision = useWorkspaceStore((state) => state.applyRevision);
  const pending = DOCK_PANE_IDS.filter((pane) => desired[pane] && !windows[pane]);

  const recordPlacement = useCallback((pane: DockPaneId, force = false) => {
    const entry = entries.current[pane];
    const state = useWorkspaceStore.getState();
    if (!entry || entry.window.closed || !state.current.detached[pane]) return;
    if (!force && Date.now() < (geometrySuspendedUntil.current.get(pane) ?? 0)) return;
    const placement = captureDetachedPlacement(entry.window);
    if (!sameDetachedPlacement(state.current.detached[pane], placement)) {
      state.updateDetached(pane, placement);
    }
  }, []);

  const capture = useCallback(() => {
    for (const pane of DOCK_PANE_IDS) recordPlacement(pane, true);
    useWorkspaceStore.getState().flush();
  }, [recordPlacement]);

  // Closing a window for a workspace switch, page shutdown, or React cleanup is
  // separate from the user's decision to dock it and remove its saved intent.
  const release = useCallback((pane: DockPaneId, closeWindow: boolean) => {
    const entry = entries.current[pane];
    if (!entry) return;
    delete entries.current[pane];
    cleanups.current.get(pane)?.();
    cleanups.current.delete(pane);
    geometrySuspendedUntil.current.delete(pane);
    setWindows({ ...entries.current });
    // React moves the stable pane host home before the old document disappears.
    if (closeWindow)
      window.setTimeout(() => {
        if (!entry.window.closed) entry.window.close();
      }, 0);
  }, []);

  const dock = useCallback(
    (pane: DockPaneId) => {
      recordPlacement(pane, true);
      useWorkspaceStore.getState().updateDetached(pane, null);
      release(pane, true);
    },
    [recordPlacement, release],
  );

  const positionWindow = useCallback(
    (pane: DockPaneId, popup: Window, saved: DetachedPanePlacement) => {
      const placement = constrainDetachedPlacement(saved, window, screenDetails.current);
      geometrySuspendedUntil.current.set(pane, Date.now() + 350);
      try {
        // resizeTo uses the outer dimensions that capture records; window.open's
        // width/height are content dimensions and otherwise grow on every restore.
        popup.resizeTo(placement.width, placement.height);
        popup.moveTo(placement.left, placement.top);
      } catch {
        // Some browser hosts do not permit moving native windows. The saved preset
        // survives and its pane remains usable at the position allowed by the host.
      }
    },
    [],
  );

  const openPane = useCallback(
    (pane: DockPaneId): string | null => {
      const state = useWorkspaceStore.getState();
      const saved =
        state.current.detached[pane] ??
        state.lastDetached[pane] ??
        initialDetachedPlacement(pane, window);
      if (!state.current.detached[pane]) state.updateDetached(pane, saved);
      const existing = entries.current[pane];
      if (existing && !existing.window.closed) {
        existing.window.focus();
        return null;
      }
      if (existing) release(pane, false);
      const placement = constrainDetachedPlacement(saved, window, screenDetails.current);
      let popup: EditorWindow | null;
      try {
        popup = window.open(
          '',
          `ograf-pane-${instance.current}-${pane}`,
          `popup,left=${placement.left},top=${placement.top},width=${placement.width},height=${placement.height}`,
        ) as EditorWindow | null;
      } catch {
        return 'This browser cannot open detached windows. Their saved positions are retained; try Restore Windows in a regular Edge or Chrome window.';
      }
      if (!popup) {
        return 'The browser blocked a detached window. Allow popups for Studio, then select Restore Windows.';
      }
      let disconnectOpeningObserver: (() => void) | undefined;
      try {
        positionWindow(pane, popup, saved);
        registerWebcamPreviewAdapter(popup.customElements, popup.HTMLElement);
        const doc = popup.document;
        doc.title = `${DOCK_PANE_LABELS[pane]} — OGraf Studio`;
        const base = doc.createElement('base');
        base.href = document.baseURI;
        doc.head.append(base);
        const copyStyles = () => {
          doc.head.querySelectorAll('[data-studio-style]').forEach((node) => node.remove());
          document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
            const copy = node.cloneNode(true) as HTMLElement;
            copy.setAttribute('data-studio-style', '');
            doc.head.append(copy);
          });
        };
        copyStyles();
        const observer = new MutationObserver(copyStyles);
        observer.observe(document.head, { childList: true, subtree: true, characterData: true });
        disconnectOpeningObserver = () => observer.disconnect();
        const container = doc.createElement('div');
        container.className = 'detached-shell';
        doc.body.append(container);
        const entry = { window: popup, container };
        entries.current[pane] = entry;
        setWindows({ ...entries.current });
        const close = () => {
          // The main page gets a chance to enter shutdown before a child pagehide
          // is interpreted as an intentional close of just that detached pane.
          window.setTimeout(() => {
            if (shuttingDown.current || entries.current[pane] !== entry) return;
            useWorkspaceStore.getState().updateDetached(pane, null);
            release(pane, false);
          }, 0);
        };
        const resized = () => recordPlacement(pane);
        const captureBeforeClose = () => {
          if (!shuttingDown.current) recordPlacement(pane, true);
        };
        popup.addEventListener('beforeunload', captureBeforeClose);
        popup.addEventListener('pagehide', close);
        popup.addEventListener('resize', resized);
        const poll = window.setInterval(() => {
          if (popup.closed) close();
          else recordPlacement(pane);
        }, 500);
        let uninstallShortcuts: (() => void) | undefined;
        let restoreBrowserContextMenu: (() => void) | undefined;
        let pulse = 0;
        cleanups.current.set(pane, () => {
          observer.disconnect();
          window.clearInterval(poll);
          popup.removeEventListener('beforeunload', captureBeforeClose);
          popup.removeEventListener('pagehide', close);
          popup.removeEventListener('resize', resized);
          popup.cancelAnimationFrame(pulse);
          uninstallShortcuts?.();
          restoreBrowserContextMenu?.();
        });
        restoreBrowserContextMenu = suppressBrowserContextMenu(doc);
        uninstallShortcuts = installEditorShortcuts(popup);
        const tick = () => {
          if (
            document.hidden &&
            Object.values(entries.current).find(
              (item) => item && !item.window.closed && !item.window.document.hidden,
            )?.window === popup
          )
            tickFramePlayers();
          pulse = popup.requestAnimationFrame(tick);
        };
        pulse = popup.requestAnimationFrame(tick);
        popup.focus();
        return null;
      } catch {
        disconnectOpeningObserver?.();
        release(pane, false);
        popup.close();
        return 'This browser cannot detach the pane. Its saved position is retained. Open Studio in a regular Edge or Chrome window and select Restore Windows.';
      }
    },
    [positionWindow, recordPlacement, release],
  );

  const open = useCallback(
    (pane: DockPaneId) => {
      setNoticeDismissed(false);
      setError(openPane(pane) ?? '');
    },
    [openPane],
  );

  const restore = useCallback(() => {
    setNoticeDismissed(false);
    const placements = useWorkspaceStore.getState().current.detached;
    let failure = '';
    for (const pane of DOCK_PANE_IDS) {
      const placement = placements[pane];
      const entry = entries.current[pane];
      if (!placement) {
        if (entry) release(pane, true);
        continue;
      }
      if (entry && !entry.window.closed) positionWindow(pane, entry.window, placement);
      else failure = openPane(pane) ?? failure;
    }
    setError(failure);
  }, [openPane, positionWindow, release]);

  useEffect(() => {
    const placements = useWorkspaceStore.getState().current.detached;
    for (const pane of DOCK_PANE_IDS) {
      const entry = entries.current[pane];
      if (!entry) continue;
      const placement = placements[pane];
      if (!placement) release(pane, true);
      else if (!entry.window.closed) positionWindow(pane, entry.window, placement);
    }
    setNoticeDismissed(false);
    // New windows are opened by restore() within the preset menu's click. A
    // passive effect must never reopen a window the user has just closed.
  }, [applyRevision, positionWindow, release]);

  useEffect(() => {
    // Closing a pane can update the layout without applying a new preset.
    for (const pane of DOCK_PANE_IDS) {
      if (entries.current[pane] && !desired[pane]) release(pane, true);
    }
  }, [desired, release]);

  useEffect(() => {
    shuttingDown.current = false;
    let active = true;
    let detailsCleanup: (() => void) | undefined;
    void permittedScreenDetails(window).then((details) => {
      if (!active || !details) return;
      screenDetails.current = details;
      const screenChanged = () => {
        const placements = useWorkspaceStore.getState().current.detached;
        for (const pane of DOCK_PANE_IDS) {
          const entry = entries.current[pane];
          const placement = placements[pane];
          if (entry && !entry.window.closed && placement) {
            positionWindow(pane, entry.window, placement);
          }
        }
      };
      details.addEventListener('screenschange', screenChanged);
      detailsCleanup = () => details.removeEventListener('screenschange', screenChanged);
      screenChanged();
    });
    const startup = window.setTimeout(() => {
      if (useWorkspaceStore.getState().startup.restoreDetached) restore();
    }, 0);
    const closeAll = () => {
      shuttingDown.current = true;
      capture();
      for (const cleanup of cleanups.current.values()) cleanup();
      cleanups.current.clear();
      for (const entry of Object.values(entries.current)) entry?.window.close();
      entries.current = {};
      setWindows({});
    };
    const beforeUnload = () => {
      shuttingDown.current = true;
      capture();
      // A separate unsaved-document prompt may cancel navigation.
      window.setTimeout(() => {
        if (active) shuttingDown.current = false;
      }, 0);
    };
    const pageShown = (event: PageTransitionEvent) => {
      shuttingDown.current = false;
      setWindows({ ...entries.current });
      if (event.persisted && useWorkspaceStore.getState().startup.restoreDetached) restore();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('ograf-workspace-capture', capture);
    window.addEventListener('pagehide', closeAll);
    window.addEventListener('pageshow', pageShown);
    return () => {
      active = false;
      window.clearTimeout(startup);
      detailsCleanup?.();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('ograf-workspace-capture', capture);
      window.removeEventListener('pagehide', closeAll);
      window.removeEventListener('pageshow', pageShown);
      closeAll();
    };
  }, [capture, positionWindow, restore]);
  return (
    <DetachedWindowContext.Provider value={{ windows, open, dock, restore, capture, pending }}>
      {children}
      {!noticeDismissed && (error || pending.length > 0) && (
        <div role={error ? 'alert' : 'status'} className="detached-window-error">
          <span>
            {error ||
              `${pending.length} saved detached ${pending.length === 1 ? 'window is' : 'windows are'} available to restore. Panes remain available in Studio until restored.`}
          </span>
          {pending.length > 0 && <button onClick={restore}>Restore Windows</button>}
          <button onClick={() => setNoticeDismissed(true)} aria-label="Dismiss window message">
            ×
          </button>
        </div>
      )}
    </DetachedWindowContext.Provider>
  );
}

function DetachedFonts({ owner }: { owner: EditorWindow }) {
  useProjectFonts(owner);
  return null;
}

/** Keep the React subtree and its form drafts mounted while moving its DOM host. */
export function DetachablePane({ pane, children }: { pane: DockPaneId; children: ReactNode }) {
  const registry = useDetachedWindows();
  const entry = registry.windows[pane];
  const home = useRef<HTMLDivElement>(null);
  const remote = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const node = document.createElement('div');
    node.className = 'detachable-pane-host';
    return node;
  });
  const [previewError, setPreviewError] = useState('');
  useLayoutEffect(() => {
    const target = entry ? remote.current : home.current;
    target?.append(host);
    return () => {
      host.remove();
    };
  }, [entry, host]);
  return (
    <>
      <div ref={home} className="detachable-pane-home" />
      {entry &&
        createPortal(
          <>
            <header className="detached-pane-toolbar">
              <strong>{DOCK_PANE_LABELS[pane]}</strong>
              <span>Shared Studio session</span>
              {pane === 'export' && (
                <button
                  title="Show the graphic fullscreen on this display"
                  onClick={(event) => {
                    setPreviewError('');
                    void requestPreviewPresentation(event.currentTarget).catch((error: unknown) =>
                      setPreviewError(
                        error instanceof Error ? error.message : 'Unable to open preview.',
                      ),
                    );
                  }}
                >
                  Preview
                </button>
              )}
              <button onClick={() => registry.dock(pane)}>Dock back</button>
            </header>
            {previewError && (
              <p role="alert" className="preview-fullscreen-error">
                {previewError}
              </p>
            )}
            <div ref={remote} className="detached-pane-body" />
            <EditorWindowContext.Provider value={entry.window}>
              <NumericScrubController />
              <DetachedFonts owner={entry.window} />
            </EditorWindowContext.Provider>
          </>,
          entry.container,
        )}
      {createPortal(
        <EditorWindowContext.Provider value={entry?.window ?? window}>
          {children}
        </EditorWindowContext.Provider>,
        host,
      )}
    </>
  );
}
