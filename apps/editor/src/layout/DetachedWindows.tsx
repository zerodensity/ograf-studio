import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { useActiveComposition } from '../state/projectStore';
import { DOCK_PANE_LABELS, type DockPaneId } from './dockModel';
import { EditorWindowContext, type EditorWindow } from './EditorWindow';
import { NumericScrubController } from '../components/NumericScrubController';
import { installEditorShortcuts } from '../state/editorShortcuts';
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
  const [error, setError] = useState('');
  const instance = useRef(crypto.randomUUID());
  const dock = useCallback((pane: DockPaneId) => {
    const entry = entries.current[pane];
    if (!entry) return;
    delete entries.current[pane];
    cleanups.current.get(pane)?.();
    cleanups.current.delete(pane);
    setWindows({ ...entries.current });
    // React moves the stable pane host home before the old document disappears.
    setTimeout(() => {
      if (!entry.window.closed) entry.window.close();
    }, 0);
  }, []);
  const open = (pane: DockPaneId) => {
    const existing = entries.current[pane];
    if (existing && !existing.window.closed) {
      existing.window.focus();
      return;
    }
    const popup = window.open(
      '',
      `ograf-pane-${instance.current}-${pane}`,
      `popup,width=${pane === 'timeline' ? 1100 : pane === 'export' ? 1000 : 480},height=760`,
    ) as EditorWindow | null;
    if (!popup) {
      setError('The browser blocked this window. Allow popups for Studio, then try again.');
      return;
    }
    try {
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
      const container = doc.createElement('div');
      container.className = 'detached-shell';
      doc.body.append(container);
      const entry = { window: popup, container };
      entries.current[pane] = entry;
      setWindows({ ...entries.current });
      setError('');
      const close = () => dock(pane);
      popup.addEventListener('pagehide', close);
      const poll = window.setInterval(() => {
        if (popup.closed) close();
      }, 500);
      const uninstallShortcuts = installEditorShortcuts(popup);
      let pulse = 0;
      const tick = () => {
        if (
          document.hidden &&
          Object.values(entries.current).find(
            (item) => item && !item.window.closed && !item.window.document.hidden,
          )?.window === popup
        )
          gsap.ticker.tick();
        pulse = popup.requestAnimationFrame(tick);
      };
      pulse = popup.requestAnimationFrame(tick);
      cleanups.current.set(pane, () => {
        observer.disconnect();
        window.clearInterval(poll);
        popup.removeEventListener('pagehide', close);
        popup.cancelAnimationFrame(pulse);
        uninstallShortcuts();
      });
      popup.focus();
    } catch {
      popup.close();
      setError(
        'This browser cannot detach the pane. Open Studio in a regular Edge or Chrome window and try again.',
      );
    }
  };
  useEffect(() => {
    const closeAll = () => {
      for (const cleanup of cleanups.current.values()) cleanup();
      cleanups.current.clear();
      for (const entry of Object.values(entries.current)) entry?.window.close();
      entries.current = {};
    };
    window.addEventListener('pagehide', closeAll);
    const restore = () => setWindows({ ...entries.current });
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', closeAll);
      window.removeEventListener('pageshow', restore);
      closeAll();
    };
  }, []);
  return (
    <DetachedWindowContext.Provider value={{ windows, open, dock }}>
      {children}
      {error && (
        <div role="alert" className="detached-window-error">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss window message">
            ×
          </button>
        </div>
      )}
    </DetachedWindowContext.Provider>
  );
}

function DetachedFonts({ owner }: { owner: EditorWindow }) {
  const assets = useActiveComposition().assets;
  useEffect(() => {
    let cancelled = false;
    const loaded: FontFace[] = [];
    for (const asset of assets.filter((asset) => asset.kind === 'font')) {
      const face = new owner.FontFace(
        asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
        `url(${asset.dataUri})`,
        { weight: asset.fontWeight || '100 900', style: asset.fontStyle || 'normal' },
      );
      void face
        .load()
        .then((font) => {
          if (!cancelled) {
            owner.document.fonts.add(font);
            loaded.push(font);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      for (const font of loaded) owner.document.fonts.delete(font);
    };
  }, [assets, owner]);
  return null;
}

/** Keep the React subtree and its form drafts mounted while moving its DOM host. */
export function DetachablePane({ pane, children }: { pane: DockPaneId; children: ReactNode }) {
  const registry = useDetachedWindows();
  const { dock } = registry;
  const entry = registry.windows[pane];
  const home = useRef<HTMLDivElement>(null);
  const remote = useRef<HTMLDivElement>(null);
  const [pictureOnly, setPictureOnly] = useState(false);
  const [host] = useState(() => {
    const node = document.createElement('div');
    node.className = 'detachable-pane-host';
    return node;
  });
  useLayoutEffect(() => {
    const target = entry ? remote.current : home.current;
    target?.append(host);
    return () => {
      host.remove();
    };
  }, [entry, host]);
  useEffect(() => () => dock(pane), [pane, dock]);
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
                <button onClick={() => setPictureOnly((value) => !value)}>
                  {pictureOnly ? 'Show controls' : 'Picture only'}
                </button>
              )}
              <button onClick={() => registry.dock(pane)}>Dock back</button>
            </header>
            <div
              ref={remote}
              className={`detached-pane-body${pictureOnly ? ' picture-only' : ''}`}
            />
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
