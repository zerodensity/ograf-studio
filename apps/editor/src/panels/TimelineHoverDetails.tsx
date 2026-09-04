import { useEditorWindow, isDomElement } from '../layout/EditorWindow';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function TimelineHoverDetails({ panelRef }: { panelRef: RefObject<HTMLDivElement | null> }) {
  const { window, document } = useEditorWindow();
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const hovered = useRef<{ element: HTMLElement; x: number; y: number } | null>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const show = () => {
      const current = hovered.current;
      if (!current?.element.isConnected) {
        setTip(null);
        return;
      }
      const text = current.element.dataset.timelineTooltip;
      setTip(
        text
          ? {
              text,
              x: Math.max(8, Math.min(current.x + 12, window.innerWidth - 368)),
              y: Math.max(8, Math.min(current.y + 16, window.innerHeight - 100)),
            }
          : null,
      );
    };
    const clear = () => {
      hovered.current = null;
      setTip(null);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons || !isDomElement(event.target)) {
        clear();
        return;
      }
      const element = event.target.closest<HTMLElement>('[data-timeline-tooltip]');
      hovered.current =
        element && panel.contains(element) ? { element, x: event.clientX, y: event.clientY } : null;
      if (event.altKey) show();
      else setTip(null);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') show();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || !event.altKey) setTip(null);
    };
    panel.addEventListener('pointermove', move);
    panel.addEventListener('pointerleave', clear);
    panel.addEventListener('pointerdown', clear, true);
    panel.addEventListener('scroll', clear, true);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clear);
    return () => {
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerleave', clear);
      panel.removeEventListener('pointerdown', clear, true);
      panel.removeEventListener('scroll', clear, true);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clear);
    };
  }, [panelRef, window]);
  return tip
    ? createPortal(
        <div role="tooltip" className="timeline-hover-details" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}
