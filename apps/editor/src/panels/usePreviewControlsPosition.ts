import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { useEditorWindow } from '../layout/EditorWindow';

interface Position {
  left: number;
  top: number;
}

interface Drag {
  pointerId: number;
  handle: HTMLButtonElement;
  clientX: number;
  clientY: number;
  start: Position;
}

const KEYBOARD_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Position belongs to the preview UI, independently of its graphic or selected template. */
export function usePreviewControlsPosition(
  viewportRef: RefObject<HTMLElement | null>,
  controlsRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  const { window: ownerWindow } = useEditorWindow();
  const activeRef = useRef(active);
  activeRef.current = active;
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef<Position | null>(null);
  const pendingAnchor = useRef<Position | null>(null);
  const drag = useRef<Drag | null>(null);
  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const panel = controlsRef.current;
    if (!viewport || !panel || !viewport.clientWidth || !panel.offsetWidth) return null;
    const area = viewport.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const scaleX = area.width / viewport.offsetWidth || 1;
    const scaleY = area.height / viewport.offsetHeight || 1;
    const freeX = Math.max(0, viewport.clientWidth - box.width / scaleX);
    const freeY = Math.max(0, viewport.clientHeight - box.height / scaleY);
    const marginX = Math.min(14, freeX / 2);
    const marginY = Math.min(14, freeY / 2);
    return {
      scaleX,
      scaleY,
      left: (box.left - area.left) / scaleX - viewport.clientLeft + viewport.scrollLeft,
      top: (box.top - area.top) / scaleY - viewport.clientTop + viewport.scrollTop,
      minLeft: viewport.scrollLeft + marginX,
      maxLeft: viewport.scrollLeft + freeX - marginX,
      minTop: viewport.scrollTop + marginY,
      maxTop: viewport.scrollTop + freeY - marginY,
    };
  }, [viewportRef, controlsRef]);
  const move = useCallback(
    (next: Position) => {
      const bounds = measure();
      if (!bounds) return false;
      const clamped = {
        left: Math.round(Math.max(bounds.minLeft, Math.min(bounds.maxLeft, next.left)) * 100) / 100,
        top: Math.round(Math.max(bounds.minTop, Math.min(bounds.maxTop, next.top)) * 100) / 100,
      };
      latest.current = clamped;
      setPosition((previous) =>
        previous?.left === clamped.left && previous.top === clamped.top ? previous : clamped,
      );
      return true;
    },
    [measure],
  );
  const endDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    setDragging(false);
  }, []);
  const reset = useCallback(() => {
    endDrag();
    pendingAnchor.current = null;
    latest.current = null;
    setPosition(null);
  }, [endDrag]);

  const clientPosition = useCallback(
    (clientX: number, clientY: number): Position | null => {
      const viewport = viewportRef.current;
      if (!viewport || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      const area = viewport.getBoundingClientRect();
      const scaleX = area.width / viewport.offsetWidth || 1;
      const scaleY = area.height / viewport.offsetHeight || 1;
      return {
        left: (clientX - area.left) / scaleX - viewport.clientLeft + viewport.scrollLeft,
        top: (clientY - area.top) / scaleY - viewport.clientTop + viewport.scrollTop,
      };
    },
    [viewportRef],
  );
  const queueAnchor = useCallback(
    (anchor: Position) => {
      endDrag();
      pendingAnchor.current = anchor;
      latest.current = null;
      // Reopening an already-visible pane must not wait for a resize or active-state change.
      if (activeRef.current && move(anchor)) pendingAnchor.current = null;
      else setPosition(null);
    },
    [endDrag, move],
  );
  const openAt = useCallback(
    (clientX: number, clientY: number) => {
      const anchor = clientPosition(clientX, clientY);
      if (anchor) queueAnchor(anchor);
    },
    [clientPosition, queueAnchor],
  );

  const openBelow = useCallback(
    (button: HTMLElement | null) => {
      if (!button) return;
      const box = button.getBoundingClientRect();
      const anchor = clientPosition(box.left, box.bottom);
      if (anchor) queueAnchor({ ...anchor, top: anchor.top + 6 });
    },
    [clientPosition, queueAnchor],
  );

  useLayoutEffect(() => {
    if (!active) {
      endDrag();
      return;
    }
    const viewport = viewportRef.current;
    const panel = controlsRef.current;
    if (!viewport || !panel) return;
    const fit = () => {
      const bounds = measure();
      if (bounds) {
        move(pendingAnchor.current ?? latest.current ?? bounds);
        pendingAnchor.current = null;
      }
    };
    fit();
    const observer = new ownerWindow.ResizeObserver(fit);
    observer.observe(viewport);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      endDrag();
    };
  }, [active, viewportRef, controlsRef, measure, move, endDrag, ownerWindow]);

  return {
    openAt,
    openBelow,
    style:
      active && position
        ? ({
            left: position.left,
            top: position.top,
            right: 'auto',
            bottom: 'auto',
          } satisfies CSSProperties)
        : undefined,
    dragging,
    handleProps: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (!active || event.button !== 0 || !event.isPrimary) return;
        const bounds = measure();
        if (!bounds) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          handle: event.currentTarget,
          clientX: event.clientX,
          clientY: event.clientY,
          start: { left: bounds.left, top: bounds.top },
        };
        move(bounds);
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = drag.current;
        const bounds = measure();
        if (!current || current.pointerId !== event.pointerId || !bounds) return;
        event.preventDefault();
        move({
          left: current.start.left + (event.clientX - current.clientX) / bounds.scaleX,
          top: current.start.top + (event.clientY - current.clientY) / bounds.scaleY,
        });
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        if (drag.current?.pointerId === event.pointerId) endDrag();
      },
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onDoubleClick: reset,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Home') {
          event.preventDefault();
          event.stopPropagation();
          reset();
          return;
        }
        const delta = KEYBOARD_DIRECTIONS[event.key];
        const bounds = measure();
        if (!delta || !bounds) return;
        event.preventDefault();
        event.stopPropagation();
        const distance = event.shiftKey ? 40 : 10;
        move({ left: bounds.left + delta[0]! * distance, top: bounds.top + delta[1]! * distance });
      },
    },
  };
}
