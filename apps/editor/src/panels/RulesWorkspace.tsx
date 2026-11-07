import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useEditorWindow } from '../layout/EditorWindow';

const STORAGE_KEY = 'ograf-editor:rules-workspace-split';
const WIDE_MIN_WIDTH = 640;
const DIVIDER_SIZE = 6;

interface SplitPreferences {
  width: number | null;
  height: number | null;
}

interface WorkspaceSize {
  width: number;
  height: number;
}

interface SplitDrag {
  handle: HTMLDivElement;
  pointerId: number;
  wide: boolean;
  coordinate: number;
  size: number;
  scale: number;
  restore: () => void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function splitBounds(area: WorkspaceSize, wide: boolean) {
  const available = Math.max(0, (wide ? area.width : area.height) - DIVIDER_SIZE);
  const minimum = wide ? Math.min(200, available * 0.4) : Math.min(104, available * 0.3);
  const detailMinimum = wide ? Math.min(300, available * 0.55) : Math.min(180, available * 0.55);
  const maximum = Math.max(minimum, available - detailMinimum);
  const initial = wide ? clamp(area.width * 0.32, 240, 320) : Math.min(240, area.height * 0.4);
  return { minimum, maximum, initial: clamp(initial, minimum, maximum) };
}

function readPreferences(storage: Storage): SplitPreferences {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const stored = value as Partial<SplitPreferences>;
      const valid = (size: unknown): size is number =>
        typeof size === 'number' && Number.isFinite(size) && size > 0;
      return {
        width: valid(stored.width) ? stored.width : null,
        height: valid(stored.height) ? stored.height : null,
      };
    }
  } catch {
    // Browser storage may be unavailable; resizing remains a local UI preference.
  }
  return { width: null, height: null };
}

/** Split position is an editor preference; it never changes the template document. */
export function RulesWorkspace({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const { window: editorWindow } = useEditorWindow();
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef<SplitDrag | null>(null);
  const latest = useRef<SplitPreferences>({ width: null, height: null });
  const [preferences, setPreferences] = useState(latest.current);
  const [area, setArea] = useState<WorkspaceSize>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const wide = area.width >= WIDE_MIN_WIDTH;
  const bounds = splitBounds(area, wide);
  const sidebarSize = clamp(
    (wide ? preferences.width : preferences.height) ?? bounds.initial,
    bounds.minimum,
    bounds.maximum,
  );

  const persist = useCallback(() => {
    const ownerWindow = workspace.current?.ownerDocument.defaultView;
    try {
      ownerWindow?.localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current));
    } catch {
      // Ignore unavailable storage without interrupting the editor.
    }
  }, []);

  const finishDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    current.restore();
    if (current.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    setDragging(false);
    persist();
  }, [persist]);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const ownerWindow = element.ownerDocument.defaultView ?? editorWindow;
    try {
      latest.current = readPreferences(ownerWindow.localStorage);
      setPreferences(latest.current);
    } catch {
      // A detached editor can still resize when local storage is unavailable.
    }
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setArea((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };
    measure();
    const observer = new ownerWindow.ResizeObserver(measure);
    observer.observe(element);
    ownerWindow.addEventListener('blur', finishDrag);
    return () => {
      observer.disconnect();
      ownerWindow.removeEventListener('blur', finishDrag);
      finishDrag();
    };
  }, [editorWindow, finishDrag]);

  useLayoutEffect(() => {
    if (drag.current && drag.current.wide !== wide) finishDrag();
  }, [wide, finishDrag]);

  const resize = (next: number) => {
    const element = workspace.current;
    if (!element) return;
    const currentBounds = splitBounds(
      { width: element.clientWidth, height: element.clientHeight },
      wide,
    );
    latest.current = {
      ...latest.current,
      [wide ? 'width' : 'height']: Math.round(
        clamp(next, currentBounds.minimum, currentBounds.maximum),
      ),
    };
    setPreferences(latest.current);
  };

  const reset = () => {
    finishDrag();
    latest.current = { ...latest.current, [wide ? 'width' : 'height']: null };
    setPreferences(latest.current);
    persist();
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const element = workspace.current;
    if (!element || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag();
    const handle = event.currentTarget;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    const body = element.ownerDocument.body;
    const previousCursor = body.style.cursor;
    const previousSelect = body.style.userSelect;
    const cursor = wide ? 'col-resize' : 'row-resize';
    body.style.cursor = cursor;
    body.style.userSelect = 'none';
    const box = element.getBoundingClientRect();
    drag.current = {
      handle,
      pointerId: event.pointerId,
      wide,
      coordinate: wide ? event.clientX : event.clientY,
      size: sidebarSize,
      scale: (wide ? box.width / element.offsetWidth : box.height / element.offsetHeight) || 1,
      restore: () => {
        if (body.style.cursor === cursor) body.style.cursor = previousCursor;
        if (body.style.userSelect === 'none') body.style.userSelect = previousSelect;
      },
    };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const coordinate = current.wide ? event.clientX : event.clientY;
    resize(current.size + (coordinate - current.coordinate) / current.scale);
  };

  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    if (event.key === 'Home') next = bounds.minimum;
    else if (event.key === 'End') next = bounds.maximum;
    else if (event.key === (wide ? 'ArrowLeft' : 'ArrowUp'))
      next = sidebarSize - (event.shiftKey ? 40 : 10);
    else if (event.key === (wide ? 'ArrowRight' : 'ArrowDown'))
      next = sidebarSize + (event.shiftKey ? 40 : 10);
    else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      reset();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    resize(next);
    persist();
  };

  return (
    <div
      ref={workspace}
      className="rules-workspace"
      data-layout={wide ? 'columns' : 'rows'}
      data-resizing={dragging || undefined}
      style={{ '--rules-sidebar-size': `${sidebarSize}px` } as CSSProperties}
    >
      <div className="rules-workspace-sidebar">{sidebar}</div>
      <div
        className="rules-workspace-divider"
        role="separator"
        tabIndex={0}
        aria-label="Resize rule list"
        aria-orientation={wide ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(bounds.minimum)}
        aria-valuemax={Math.round(bounds.maximum)}
        aria-valuenow={Math.round(sidebarSize)}
        aria-valuetext={`${Math.round(sidebarSize)} pixels ${wide ? 'wide' : 'high'}`}
        title="Drag to resize the rule list. Arrow keys resize; Home/End set limits. Double-click or Enter resets."
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) finishDrag();
        }}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onDoubleClick={reset}
        onKeyDown={keyResize}
      />
      {children}
    </div>
  );
}
