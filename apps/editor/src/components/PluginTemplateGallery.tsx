import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  PLUGIN_TEMPLATE_DETAIL_STORAGE_KEY,
  DEFAULT_TEMPLATE_DETAIL_WIDTH,
  TEMPLATE_STACK_WIDTH,
  clampTemplateDetailWidth,
  draggedTemplateDetailWidth,
  keyedTemplateDetailWidth,
  storedTemplateDetailWidth,
  templateDetailBounds,
} from './pluginTemplateResize';
import './PluginTemplateGallery.css';

export interface PluginTemplateItem {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

/** One template card contract for every plugin kind; previews belong in the detail pane. */
export function PluginTemplateGallery({
  items,
  selected,
  onSelect,
  onDragStart,
  label,
  className = '',
}: {
  items: readonly PluginTemplateItem[];
  selected?: string;
  onSelect(id: string): void;
  onDragStart?(id: string, event: DragEvent<HTMLButtonElement>): void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`plugin-template-gallery ${className}`.trim()} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`plugin-template-card${selected === item.id ? ' is-selected' : ''}${item.icon ? '' : ' is-text-only'}`}
          aria-pressed={selected === item.id}
          disabled={item.disabled}
          title={item.disabledReason || item.description || item.name}
          onClick={() => onSelect(item.id)}
          draggable={Boolean(onDragStart && !item.disabled)}
          onDragStart={
            onDragStart && !item.disabled ? (event) => onDragStart(item.id, event) : undefined
          }
        >
          {item.icon ? (
            <span className="plugin-template-icon" aria-hidden="true">
              {item.icon}
            </span>
          ) : null}
          <span className="plugin-template-name">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

interface WorkspaceProps {
  browserHeader?: ReactNode;
  gallery: ReactNode;
  details?: ReactNode;
  detailsLabel?: string;
  className?: string;
}

function WorkspaceLayout({
  browserHeader,
  gallery,
  details,
  detailsLabel,
  className = '',
  detailWidth = DEFAULT_TEMPLATE_DETAIL_WIDTH,
  containerWidth,
  rootRef,
  splitterProps,
}: WorkspaceProps & {
  detailWidth?: number;
  containerWidth?: number;
  rootRef?: Ref<HTMLDivElement>;
  splitterProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const stacked =
    containerWidth !== undefined && containerWidth > 0 && containerWidth <= TEMPLATE_STACK_WIDTH;
  const bounds = templateDetailBounds(containerWidth);
  return (
    <div
      ref={rootRef}
      className={`plugin-template-workspace${details ? '' : ' is-gallery-only'}${stacked ? ' is-stacked' : ''}${containerWidth !== undefined ? ' is-measured' : ''} ${className}`.trim()}
      style={{ '--plugin-template-detail-width': `${detailWidth}px` } as CSSProperties}
    >
      <section className="plugin-template-browser" aria-label="Plugin templates">
        {browserHeader ? (
          <div className="plugin-template-browser-header">{browserHeader}</div>
        ) : null}
        <div className="plugin-template-browser-content">{gallery}</div>
      </section>
      {details ? (
        <div
          className="plugin-template-splitter"
          role="separator"
          aria-label={`Resize templates and ${detailsLabel || 'details'}`}
          aria-orientation="vertical"
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={detailWidth}
          aria-valuetext={`${detailWidth} pixels for ${detailsLabel || 'details'}`}
          tabIndex={stacked ? -1 : 0}
          title="Drag to resize. Arrow keys adjust width; Shift adjusts faster. Double-click to reset."
          {...splitterProps}
        />
      ) : null}
      {details ? (
        <aside className="plugin-template-detail" aria-label={detailsLabel}>
          {detailsLabel ? <h3>{detailsLabel}</h3> : null}
          {details}
        </aside>
      ) : null}
    </div>
  );
}

function ResizableTemplateWorkspace(props: WorkspaceProps) {
  const { window: ownerWindow, document: ownerDocument } = useEditorWindow();
  const root = useRef<HTMLDivElement>(null);
  const finishDrag = useRef<(() => void) | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      return storedTemplateDetailWidth(
        ownerWindow.localStorage.getItem(PLUGIN_TEMPLATE_DETAIL_STORAGE_KEY),
      );
    } catch {
      return DEFAULT_TEMPLATE_DETAIL_WIDTH;
    }
  });
  const [containerWidth, setContainerWidth] = useState<number>();
  const width = clampTemplateDetailWidth(preferredWidth, containerWidth);
  const persist = (next: number) => {
    try {
      ownerWindow.localStorage.setItem(PLUGIN_TEMPLATE_DETAIL_STORAGE_KEY, String(next));
    } catch {
      /* Optional local layout preference; never part of project data or undo. */
    }
  };
  useEffect(() => {
    const measure = () => {
      const next = root.current?.getBoundingClientRect().width;
      if (next && Number.isFinite(next)) {
        if (next <= TEMPLATE_STACK_WIDTH) finishDrag.current?.();
        setContainerWidth(next);
      }
    };
    measure();
    const Observer = ownerWindow.ResizeObserver;
    const observer = typeof Observer === 'function' ? new Observer(measure) : undefined;
    if (root.current) observer?.observe(root.current);
    ownerWindow.addEventListener('resize', measure);
    const sync = (event: StorageEvent) => {
      if (event.key === PLUGIN_TEMPLATE_DETAIL_STORAGE_KEY)
        setPreferredWidth(storedTemplateDetailWidth(event.newValue));
    };
    ownerWindow.addEventListener('storage', sync);
    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener('resize', measure);
      ownerWindow.removeEventListener('storage', sync);
      finishDrag.current?.();
    };
  }, [ownerWindow]);
  return (
    <WorkspaceLayout
      {...props}
      rootRef={root}
      containerWidth={containerWidth}
      detailWidth={width}
      splitterProps={{
        onPointerDown: (event) => {
          if (
            event.button !== 0 ||
            (containerWidth !== undefined && containerWidth <= TEMPLATE_STACK_WIDTH)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          finishDrag.current?.();
          const pointerId = event.pointerId;
          const startX = event.clientX;
          const startWidth = width;
          let lastWidth = width;
          let finished = false;
          const body = ownerDocument.body;
          const hadClass = body.classList.contains('is-resizing-plugin-template');
          body.classList.add('is-resizing-plugin-template');
          const move = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            next.preventDefault();
            lastWidth = draggedTemplateDetailWidth(
              startWidth,
              next.clientX - startX,
              root.current?.getBoundingClientRect().width,
            );
            setPreferredWidth(lastWidth);
          };
          const cleanup = () => {
            if (finished) return;
            finished = true;
            ownerWindow.removeEventListener('pointermove', move);
            ownerWindow.removeEventListener('pointerup', stop);
            ownerWindow.removeEventListener('pointercancel', stop);
            ownerWindow.removeEventListener('blur', cleanup);
            if (!hadClass) body.classList.remove('is-resizing-plugin-template');
            if (finishDrag.current === cleanup) finishDrag.current = null;
            persist(lastWidth);
          };
          const stop = (next: PointerEvent) => {
            if (next.pointerId === pointerId) cleanup();
          };
          finishDrag.current = cleanup;
          ownerWindow.addEventListener('pointermove', move, { passive: false });
          ownerWindow.addEventListener('pointerup', stop);
          ownerWindow.addEventListener('pointercancel', stop);
          ownerWindow.addEventListener('blur', cleanup);
        },
        onKeyDown: (event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const next = keyedTemplateDetailWidth(
            width,
            event.key,
            event.shiftKey,
            root.current?.getBoundingClientRect().width,
          );
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          setPreferredWidth(next);
          persist(next);
        },
        onDoubleClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          finishDrag.current?.();
          setPreferredWidth(DEFAULT_TEMPLATE_DETAIL_WIDTH);
          persist(DEFAULT_TEMPLATE_DETAIL_WIDTH);
        },
      }}
    />
  );
}

/** One saved split width, shared across plugin kinds and their owner-window documents. */
export function PluginTemplateWorkspace(props: WorkspaceProps) {
  // Windowless SSR remains pure and produces the same accessible separator without DOM work.
  if (!props.details || typeof window === 'undefined') return <WorkspaceLayout {...props} />;
  return <ResizableTemplateWorkspace {...props} />;
}
