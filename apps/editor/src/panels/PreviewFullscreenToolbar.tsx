import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useEditorWindow } from '../layout/EditorWindow';

const REVEAL_HEIGHT = 56;
const EDGE_MARGIN = 8;

/** The preview toolbar follows the pointer across the top until its controls are in use. */
export function PreviewFullscreenToolbar({
  viewportRef,
  active,
  expanded,
  children,
}: {
  viewportRef: RefObject<HTMLElement | null>;
  active: boolean;
  expanded: boolean;
  children: ReactNode;
}) {
  const { window: ownerWindow, document: ownerDocument } = useEditorWindow();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef(expanded);
  const pointerInside = useRef(false);
  const latestLeft = useRef<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  expandedRef.current = expanded;

  const move = useCallback(
    (requestedLeft?: number) => {
      const viewport = viewportRef.current;
      const toolbar = toolbarRef.current;
      if (!viewport || !toolbar) return;
      const free = Math.max(0, viewport.clientWidth - toolbar.offsetWidth);
      const margin = Math.min(EDGE_MARGIN, free / 2);
      const nextLeft = Math.round(
        Math.max(
          margin,
          Math.min(free - margin, requestedLeft ?? latestLeft.current ?? free - margin),
        ),
      );
      latestLeft.current = nextLeft;
      setLeft((previous) => (previous === nextLeft ? previous : nextLeft));
    },
    [viewportRef],
  );

  useLayoutEffect(() => {
    if (!active) {
      pointerInside.current = false;
      setRevealed(false);
      setFocused(false);
      return;
    }
    const viewport = viewportRef.current;
    const toolbar = toolbarRef.current;
    if (!viewport || !toolbar) return;
    const hasKeyboardFocus = () =>
      toolbar.contains(ownerDocument.activeElement) &&
      toolbar.querySelector(':focus-visible') !== null;
    const pointerMove = (event: PointerEvent) => {
      if (pointerInside.current || toolbar.contains(event.target as Node | null)) {
        setRevealed(true);
        return;
      }
      if (expandedRef.current || hasKeyboardFocus()) return;
      const bounds = viewport.getBoundingClientRect();
      const scaleX = bounds.width / viewport.offsetWidth || 1;
      const scaleY = bounds.height / viewport.offsetHeight || 1;
      const x = (event.clientX - bounds.left) / scaleX;
      const y = (event.clientY - bounds.top) / scaleY;
      const inBand = x >= 0 && x <= viewport.clientWidth && y >= 0 && y <= REVEAL_HEIGHT;
      setRevealed(inBand);
      if (inBand) move(x - toolbar.offsetWidth / 2);
    };
    const pointerLeave = () => {
      pointerInside.current = false;
      if (!expandedRef.current && !hasKeyboardFocus()) setRevealed(false);
    };
    const fit = () => move();
    fit();
    setFocused(hasKeyboardFocus());
    const observer = new ownerWindow.ResizeObserver(fit);
    observer.observe(viewport);
    observer.observe(toolbar);
    viewport.addEventListener('pointermove', pointerMove);
    viewport.addEventListener('pointerleave', pointerLeave);
    return () => {
      observer.disconnect();
      viewport.removeEventListener('pointermove', pointerMove);
      viewport.removeEventListener('pointerleave', pointerLeave);
    };
  }, [active, viewportRef, move, ownerWindow, ownerDocument]);

  const visible = active && (revealed || focused || expanded);
  return (
    <div
      className="preview-fullscreen-hotspot"
      data-preview-controls
      style={{ pointerEvents: 'none' }}
    >
      <div
        ref={toolbarRef}
        className={`preview-fullscreen-toolbar${visible ? ' is-visible' : ''}`}
        style={left === null ? { right: EDGE_MARGIN } : { left, right: 'auto' }}
        onPointerEnter={() => {
          pointerInside.current = true;
          setRevealed(true);
        }}
        onPointerLeave={() => {
          pointerInside.current = false;
        }}
        onFocusCapture={(event) =>
          setFocused(event.currentTarget.querySelector(':focus-visible') !== null)
        }
        onPointerDownCapture={() => setFocused(false)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
