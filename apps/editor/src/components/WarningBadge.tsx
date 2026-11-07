import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditorWindow } from '../layout/EditorWindow';
import './WarningBadge.css';

const POPOVER_MAX_WIDTH = 280;
const EDGE = 8;

/**
 * A compact warning beside the control it concerns. Hovering or focusing shows the message;
 * clicking keeps it open until the next click elsewhere, Escape, or another click on the icon.
 */
export function WarningBadge({ message }: { message: string }) {
  const { window: owner, document } = useEditorWindow();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null);
  const open = hovered || pinned;

  const measure = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(POPOVER_MAX_WIDTH, owner.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(rect.left - 12, owner.innerWidth - width - EDGE));
    setPlace({ left, top: rect.bottom + 6, width });
  }, [owner]);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    // The popover is fixed to the window, so it follows the icon when a panel scrolls.
    owner.addEventListener('scroll', measure, true);
    owner.addEventListener('resize', measure);
    return () => {
      owner.removeEventListener('scroll', measure, true);
      owner.removeEventListener('resize', measure);
    };
  }, [open, owner, measure]);

  useEffect(() => {
    if (!pinned) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (button.current?.contains(target) || popover.current?.contains(target)) return;
      setPinned(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape);
    };
  }, [pinned, document]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`warning-badge${pinned ? ' pinned' : ''}`}
        aria-label="Warning"
        aria-describedby={id}
        aria-expanded={pinned}
        aria-description={message}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={(event) => {
          // Inside a <label> row, the click must not reach the row's control.
          event.preventDefault();
          event.stopPropagation();
          setPinned((current) => !current);
        }}
      >
        ⚠
      </button>
      {open && place
        ? createPortal(
            <span
              ref={popover}
              id={id}
              role="tooltip"
              className="warning-popover"
              style={{ left: place.left, top: place.top, maxWidth: place.width }}
            >
              {message}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/** Keeps a row's control and its warning together in the value column. */
export function WithWarning({
  message,
  children,
}: {
  message?: string | null;
  children: ReactNode;
}) {
  return (
    <span className="control-with-warning">
      {children}
      {message ? <WarningBadge message={message} /> : null}
    </span>
  );
}
