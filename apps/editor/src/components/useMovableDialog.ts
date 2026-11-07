import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { isDomElement, useEditorWindow, type EditorWindow } from '../layout/EditorWindow';
import './useMovableDialog.css';

interface DialogOffset {
  x: number;
  y: number;
}

interface DialogGesture {
  pointerId: number;
  handle: HTMLElement;
  clientX: number;
  clientY: number;
  offset: DialogOffset;
}

const INTERACTIVE =
  'button, input, select, textarea, a, label, summary, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])';
const POSITIONED = 'data-movable-dialog-positioned';
const DRAGGING = 'data-movable-dialog-dragging';
const X_OFFSET = '--movable-dialog-x';
const Y_OFFSET = '--movable-dialog-y';

function interactiveTarget(target: EventTarget | null, handle: HTMLElement): boolean {
  if (!isDomElement(target)) return false;
  const interactive = target.closest(INTERACTIVE);
  return Boolean(interactive && handle.contains(interactive));
}

function clampOffset(node: HTMLElement, offset: DialogOffset): DialogOffset {
  const owner = node.ownerDocument.defaultView;
  if (!owner) return offset;
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) return offset;
  const currentX = Number.parseFloat(node.style.getPropertyValue(X_OFFSET)) || 0;
  const currentY = Number.parseFloat(node.style.getPropertyValue(Y_OFFSET)) || 0;
  const viewport = node.ownerDocument.documentElement;
  const width = viewport.clientWidth || owner.innerWidth;
  const height = viewport.clientHeight || owner.innerHeight;
  const margin = Math.min(8, width / 4, height / 4);
  const handle = node.querySelector<HTMLElement>('[data-movable-dialog-handle]');
  const handleHeight = Math.min(64, Math.max(24, handle?.getBoundingClientRect().height ?? 32));
  const visibleWidth = Math.min(160, rect.width, Math.max(1, width - margin * 2));
  const minLeft = rect.width + margin * 2 <= width ? margin : margin - rect.width + visibleWidth;
  const maxLeft =
    rect.width + margin * 2 <= width ? width - rect.width - margin : width - visibleWidth - margin;
  const maxTop = Math.max(
    margin,
    height - (rect.height + margin * 2 <= height ? rect.height : handleHeight) - margin,
  );
  const left = Math.min(maxLeft, Math.max(minLeft, rect.left - currentX + offset.x));
  const top = Math.min(maxTop, Math.max(margin, rect.top - currentY + offset.y));
  return {
    x: left - rect.left + currentX,
    y: top - rect.top + currentY,
  };
}

/** Move an opted-in dialog without changing its existing modal, layout or docking behavior. */
export function useMovableDialog<T extends HTMLElement>(
  dialogRef: RefObject<T | null>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { window: ownerWindow } = useEditorWindow();
  const offset = useRef<DialogOffset>({ x: 0, y: 0 });
  const gesture = useRef<DialogGesture | null>(null);
  const moved = useRef(false);
  const [hasMoved, setHasMoved] = useState(false);

  const stopGesture = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    dialogRef.current?.removeAttribute(DRAGGING);
    if (!current) return;
    try {
      if (current.handle.hasPointerCapture(current.pointerId))
        current.handle.releasePointerCapture(current.pointerId);
    } catch {
      // Closing a native modal can release capture before React unmounts its header.
    }
  }, [dialogRef]);

  const resetPosition = useCallback(() => {
    stopGesture();
    offset.current = { x: 0, y: 0 };
    const node = dialogRef.current;
    node?.style.removeProperty(X_OFFSET);
    node?.style.removeProperty(Y_OFFSET);
    node?.removeAttribute(POSITIONED);
    if (moved.current) {
      moved.current = false;
      setHasMoved(false);
    }
  }, [dialogRef, stopGesture]);

  const move = useCallback(
    (requested: DialogOffset) => {
      const node = dialogRef.current;
      if (!node) return;
      const next = clampOffset(node, requested);
      if (next.x === offset.current.x && next.y === offset.current.y) return;
      offset.current = next;
      node.style.setProperty(X_OFFSET, `${next.x}px`);
      node.style.setProperty(Y_OFFSET, `${next.y}px`);
      node.setAttribute(POSITIONED, '');
      if (!moved.current) {
        moved.current = true;
        setHasMoved(true);
      }
    },
    [dialogRef],
  );

  useEffect(() => {
    if (!enabled) {
      resetPosition();
      return;
    }
    const node = dialogRef.current;
    if (!node) return;
    const owner = (node.ownerDocument.defaultView ?? ownerWindow) as EditorWindow;
    const pointerMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      move({
        x: current.offset.x + event.clientX - current.clientX,
        y: current.offset.y + event.clientY - current.clientY,
      });
    };
    const pointerEnd = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) stopGesture();
    };
    const constrain = () => {
      if (moved.current) move(offset.current);
    };
    owner.addEventListener('pointermove', pointerMove, { passive: false });
    owner.addEventListener('pointerup', pointerEnd);
    owner.addEventListener('pointercancel', pointerEnd);
    owner.addEventListener('blur', stopGesture);
    owner.addEventListener('resize', constrain);
    owner.visualViewport?.addEventListener('resize', constrain);
    const observer = new owner.ResizeObserver(constrain);
    observer.observe(node);
    return () => {
      stopGesture();
      owner.removeEventListener('pointermove', pointerMove);
      owner.removeEventListener('pointerup', pointerEnd);
      owner.removeEventListener('pointercancel', pointerEnd);
      owner.removeEventListener('blur', stopGesture);
      owner.removeEventListener('resize', constrain);
      owner.visualViewport?.removeEventListener('resize', constrain);
      observer.disconnect();
      node.style.removeProperty(X_OFFSET);
      node.style.removeProperty(Y_OFFSET);
      node.removeAttribute(POSITIONED);
      node.removeAttribute(DRAGGING);
    };
  }, [enabled, dialogRef, ownerWindow, move, resetPosition, stopGesture]);

  const pointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        !enabled ||
        event.button !== 0 ||
        !event.isPrimary ||
        interactiveTarget(event.target, event.currentTarget)
      )
        return;
      stopGesture();
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      handle.focus({ preventScroll: true });
      gesture.current = {
        pointerId: event.pointerId,
        handle,
        clientX: event.clientX,
        clientY: event.clientY,
        offset: { ...offset.current },
      };
      dialogRef.current?.setAttribute(DRAGGING, '');
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners retain the drag when capture is unavailable.
      }
    },
    [enabled, dialogRef, stopGesture],
  );

  const keyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (
        !enabled ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        interactiveTarget(event.target, event.currentTarget)
      )
        return;
      const distance = event.shiftKey ? 50 : 10;
      const direction: Record<string, DialogOffset> = {
        ArrowLeft: { x: -distance, y: 0 },
        ArrowRight: { x: distance, y: 0 },
        ArrowUp: { x: 0, y: -distance },
        ArrowDown: { x: 0, y: distance },
      };
      if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        resetPosition();
      } else if (direction[event.key]) {
        event.preventDefault();
        event.stopPropagation();
        const delta = direction[event.key]!;
        move({ x: offset.current.x + delta.x, y: offset.current.y + delta.y });
      }
    },
    [enabled, move, resetPosition],
  );

  const doubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled || interactiveTarget(event.target, event.currentTarget)) return;
      event.preventDefault();
      event.stopPropagation();
      resetPosition();
    },
    [enabled, resetPosition],
  );

  const lostCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (gesture.current?.pointerId === event.pointerId) stopGesture();
    },
    [stopGesture],
  );

  return {
    dialogProps: enabled ? { 'data-movable-dialog': '' } : {},
    handleProps: enabled
      ? {
          'data-movable-dialog-handle': '',
          tabIndex: 0,
          title: 'Drag to move. Arrow keys move; Shift moves faster. Home or double-click resets.',
          onPointerDown: pointerDown,
          onLostPointerCapture: lostCapture,
          onKeyDown: keyDown,
          onDoubleClick: doubleClick,
        }
      : {},
    hasMoved: enabled && hasMoved,
    resetPosition,
  };
}
