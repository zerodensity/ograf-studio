import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const STORAGE_KEY = 'ograf-editor:panel-sizes';

function loadStoredSizes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function persistSize(key: string, value: number): void {
  try {
    const sizes = loadStoredSizes();
    sizes[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Layout persistence is a convenience — ignore quota/availability errors.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type ResizeAxis = 'col' | 'row';

interface UseResizableOptions {
  /** Unique key for persisting this pane's size across reloads. */
  key: string;
  defaultSize: number;
  min: number;
  max: number;
  /** 'col' = handle is dragged left/right to change a width; 'row' = dragged up/down to change a height. */
  axis: ResizeAxis;
  /** Set when the handle sits on the pane's leading edge, so dragging toward the pane shrinks it. */
  invert?: boolean;
  /** Workspace-owned size; legacy callers can keep using this hook's local persistence. */
  value?: number;
  onSizeChange?: (size: number) => void;
}

interface UseResizableResult {
  size: number;
  startDrag: (e: ReactPointerEvent) => void;
}

export function useResizable({
  key,
  defaultSize,
  min,
  max,
  axis,
  invert = false,
  value,
  onSizeChange,
}: UseResizableOptions): UseResizableResult {
  const [storedSize, setSize] = useState(() => {
    const stored = loadStoredSizes()[key];
    return stored !== undefined ? clamp(stored, min, max) : defaultSize;
  });
  const size = clamp(value ?? storedSize, min, max);
  const latest = useRef({ value, onSizeChange, size });
  latest.current = { value, onSizeChange, size };
  const dragStart = useRef<{ pos: number; size: number } | null>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragStart.current) return;
      const pos = axis === 'col' ? e.clientX : e.clientY;
      const delta = pos - dragStart.current.pos;
      const next = clamp(dragStart.current.size + (invert ? -delta : delta), min, max);
      if (latest.current.value === undefined) setSize(next);
      latest.current.onSizeChange?.(next);
    },
    [axis, invert, min, max],
  );

  const handlePointerUp = useCallback(() => {
    dragStart.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    document.body.classList.remove('is-resizing');
    if (latest.current.value === undefined) persistSize(key, latest.current.size);
  }, [handlePointerMove, key]);

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      dragStart.current = { pos: axis === 'col' ? e.clientX : e.clientY, size };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      document.body.classList.add('is-resizing');
      document.body.dataset.resizeAxis = axis;
    },
    [axis, size, handlePointerMove, handlePointerUp],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (dragStart.current) document.body.classList.remove('is-resizing');
      dragStart.current = null;
    },
    [handlePointerMove, handlePointerUp],
  );

  return { size, startDrag };
}
