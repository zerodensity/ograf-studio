import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import './CollapsibleSection.css';

interface CollapsibleSectionProps {
  sectionId: string;
  title: ReactNode;
  ariaLabel?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** A new request opens this section, scrolls it into view, and focuses its heading. */
  revealRequest?: number;
  className?: string;
  contentClassName?: string;
}

const STORAGE_PREFIX = 'ograf-studio:section:';

function initialOpen(sectionId: string, defaultOpen: boolean): boolean {
  if (typeof window === 'undefined') return defaultOpen;
  try {
    const saved = window.localStorage.getItem(`${STORAGE_PREFIX}${sectionId}`);
    return saved === null ? defaultOpen : saved === 'open';
  } catch {
    return defaultOpen;
  }
}

export function CollapsibleSection({
  sectionId,
  title,
  ariaLabel,
  actions,
  defaultOpen = true,
  revealRequest,
  className = '',
  contentClassName = '',
  children,
}: PropsWithChildren<CollapsibleSectionProps>) {
  const [open, setOpen] = useState(() => initialOpen(sectionId, defaultOpen));
  const sectionRef = useRef<HTMLDetailsElement>(null);
  const revealedRequest = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (revealRequest !== undefined && revealedRequest.current !== revealRequest) setOpen(true);
  }, [revealRequest]);
  // A dock pane attaches its portal host in a parent layout effect, after child layout effects.
  useEffect(() => {
    if (!open || revealRequest === undefined || revealedRequest.current === revealRequest) return;
    revealedRequest.current = revealRequest;
    const section = sectionRef.current;
    section?.querySelector('summary')?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'start' });
  }, [open, revealRequest]);
  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${sectionId}`, next ? 'open' : 'closed');
      } catch {
        // Disclosure still works when storage is blocked by the browser.
      }
      return next;
    });
  };

  return (
    <details
      ref={sectionRef}
      className={`collapsible-section${className ? ` ${className}` : ''}`}
      open={open}
    >
      <summary
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        onClick={(event) => {
          event.preventDefault();
          toggle();
        }}
      >
        <span className="collapsible-section-title">{title}</span>
        {actions ? (
          <span
            className="collapsible-section-actions"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
      </summary>
      <div
        className={`collapsible-section-content${contentClassName ? ` ${contentClassName}` : ''}`}
      >
        {children}
      </div>
    </details>
  );
}
