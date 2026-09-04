import { useEditorWindow, isSelectElement } from '../layout/EditorWindow';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import './PropertyRow.css';

const DEFAULT_PERCENT = 42;
const MIN_PERCENT = 15;
const MAX_PERCENT = 75;
const bounded = (value: number) => Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
const ColumnContext = createContext<{
  percent: number;
  setPercent: (value: number) => void;
} | null>(null);

/** Layout preferences belong to the pane, never the project or undo history. */
export function PropertyColumnProvider({ pane, children }: { pane: string; children: ReactNode }) {
  const key = `ograf-studio:property-columns:v1:${pane}`;
  const [percent, setPercent] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      const value = stored === null ? NaN : Number(stored);
      return Number.isFinite(value) ? bounded(value) : DEFAULT_PERCENT;
    } catch {
      return DEFAULT_PERCENT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(percent));
    } catch {
      /* Optional local preference. */
    }
  }, [key, percent]);
  return (
    <ColumnContext.Provider value={{ percent, setPercent }}>{children}</ColumnContext.Provider>
  );
}

interface PropertyRowProps extends HTMLAttributes<HTMLElement> {
  help: string;
  as?: 'label' | 'div';
  htmlFor?: string;
  resizable?: boolean;
}

/** Every divider in a pane adjusts that pane's shared label/value split. */
export function PropertyRow({
  help,
  as: Tag = 'label',
  resizable = true,
  className = '',
  children,
  style,
  ...props
}: PropertyRowProps) {
  const { document } = useEditorWindow();
  const columns = useContext(ColumnContext);
  const row = useRef<HTMLElement | null>(null);
  const drag = useRef<{ id: number; x: number; width: number; start: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const enabled = resizable && columns !== null;
  useEffect(() => {
    const controls = row.current?.querySelectorAll<HTMLElement>('input, select, textarea, button');
    const previous = Array.from(
      controls ?? [],
      (control) => [control, control.getAttribute('aria-description')] as const,
    );
    for (const [control, description] of previous) {
      if (!description) control.setAttribute('aria-description', help);
    }
    return () => {
      for (const [control, description] of previous) {
        if (description === null) control.removeAttribute('aria-description');
        else control.setAttribute('aria-description', description);
      }
    };
  }, [help]);
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('is-resizing');
    document.body.dataset.resizeAxis = 'col';
    return () => {
      document.body.classList.remove('is-resizing');
    };
  }, [dragging, document]);
  const finish = () => {
    drag.current = null;
    setDragging(false);
  };
  const content = (
    <Tag
      {...props}
      ref={(element: HTMLElement | null) => {
        row.current = element;
      }}
      className={`${className}${enabled ? ' property-row-resizable' : ''}`}
      data-property-help={help}
      style={style}
      onMouseOver={(event) => {
        props.onMouseOver?.(event);
        const target = event.target as HTMLElement;
        if (isSelectElement(target)) target.title = target.selectedOptions[0]?.text ?? '';
      }}
    >
      {Children.toArray(children).map((child, index) =>
        index === 0 && isValidElement<{ title?: string }>(child)
          ? cloneElement(child, { title: help })
          : child,
      )}
    </Tag>
  );
  if (!enabled) return content;
  return (
    <div
      className="property-row-frame"
      style={{ '--property-label-percent': `${columns.percent}%` } as CSSProperties}
    >
      {content}
      <span
        className={`property-column-divider${dragging ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize label and value columns"
        aria-valuemin={MIN_PERCENT}
        aria-valuemax={MAX_PERCENT}
        aria-valuenow={Math.round(columns.percent)}
        aria-valuetext={`${Math.round(columns.percent)} percent for labels`}
        tabIndex={0}
        title="Drag to resize columns. Double-click to reset. Arrow keys adjust; Shift moves faster."
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          columns.setPercent(DEFAULT_PERCENT);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !row.current) return;
          event.preventDefault();
          event.stopPropagation();
          const bounds = row.current.getBoundingClientRect();
          const labelWidth = row.current.firstElementChild?.getBoundingClientRect().width ?? 0;
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            width: bounds.width,
            start: (labelWidth / bounds.width) * 100,
          };
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId || current.width <= 0) return;
          columns.setPercent(
            bounded(current.start + ((event.clientX - current.x) / current.width) * 100),
          );
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 5 : 1;
          const next =
            event.key === 'ArrowLeft'
              ? columns.percent - step
              : event.key === 'ArrowRight'
                ? columns.percent + step
                : event.key === 'Home'
                  ? MIN_PERCENT
                  : event.key === 'End'
                    ? MAX_PERCENT
                    : event.key === 'Enter'
                      ? DEFAULT_PERCENT
                      : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          columns.setPercent(bounded(next));
        }}
      />
    </div>
  );
}
