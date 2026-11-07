import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './RuleEditorItem.css';

export interface RuleEditorItemProps {
  id: string;
  title: string;
  target?: string;
  summary: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  hidden?: boolean;
  status?: ReactNode;
  dirty?: boolean;
  preview?: { onClick: () => void; disabled?: boolean; label?: string };
  headerControls?: ReactNode;
  nameEditor?: ReactNode;
  /** Optional object selector, replacing the static target subtitle. */
  targetEditor?: ReactNode;
  /** Ordinary action buttons; the shell supplies their compact overflow popup. */
  menu?: ReactNode;
}

/** Shared detail editor; the caller owns list selection and rule semantics. */
export function RuleEditorItem({
  id,
  title,
  target,
  open,
  children,
  hidden = false,
  status,
  dirty = false,
  preview,
  menu,
  headerControls,
  nameEditor,
  targetEditor,
}: RuleEditorItemProps) {
  const titleId = useId();
  const menuId = useId();
  const isHidden = hidden || !open;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen || isHidden) return;
    const document = menuRef.current?.ownerDocument;
    if (!document) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && !menuRef.current?.contains(node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [menuOpen, isHidden]);
  useEffect(() => {
    if (isHidden) setMenuOpen(false);
  }, [isHidden]);
  const previewLabel = preview?.label ?? `Preview ${title}`;
  return (
    <section
      className="rule-editor-item"
      data-rule-id={id}
      hidden={isHidden}
      aria-labelledby={titleId}
    >
      <header className="rule-editor-detail-header">
        <div className="rule-editor-detail-heading">
          <h3
            id={titleId}
            title={title}
            className={nameEditor ? 'rule-editor-heading-label' : undefined}
          >
            {title}
          </h3>
          {nameEditor && <div className="rule-editor-name-editor">{nameEditor}</div>}
          {targetEditor ? (
            <div className="rule-editor-detail-target rule-editor-target-editor">
              <span>on</span>
              {targetEditor}
            </div>
          ) : target ? (
            <small className="rule-editor-detail-target" title={target}>
              on <strong>{target}</strong>
            </small>
          ) : null}
        </div>
        <div className="rule-editor-toolbar">
          {headerControls && <div className="rule-editor-header-controls">{headerControls}</div>}
          {dirty && (
            <span
              className="rule-editor-dirty"
              role="img"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            >
              ●
            </span>
          )}
          {status && <span className="rule-editor-status">{status}</span>}
          {preview && (
            <button
              type="button"
              className="rule-editor-icon-button"
              aria-label={previewLabel}
              title={previewLabel}
              disabled={preview.disabled}
              onClick={preview.onClick}
            >
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <path d="M4 2.5 11 7l-7 4.5Z" fill="currentColor" />
              </svg>
            </button>
          )}
          {menu && (
            <div className="rule-editor-overflow" ref={menuRef}>
              <button
                ref={menuButtonRef}
                type="button"
                className="rule-editor-icon-button"
                aria-label={`More actions for ${title}`}
                title="More actions"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="3" r="1" fill="currentColor" />
                  <circle cx="7" cy="7" r="1" fill="currentColor" />
                  <circle cx="7" cy="11" r="1" fill="currentColor" />
                </svg>
              </button>
              {menuOpen && (
                <div
                  className="rule-editor-menu"
                  id={menuId}
                  role="group"
                  aria-label={`${title} actions`}
                  onClick={(event) => {
                    const node = event.target as Element;
                    if (node.closest('button, a, [role="menuitem"]')) setMenuOpen(false);
                  }}
                >
                  {menu}
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <div className="rule-editor-body">{children}</div>
    </section>
  );
}

export function RuleEditorSection({
  label,
  title,
  children,
  inline = false,
}: {
  label: string;
  title: string;
  children: ReactNode;
  /** Controls sit on the heading row, beside the label; the hint becomes its tooltip. */
  inline?: boolean;
}) {
  const titleId = useId();
  const kind = label.toLowerCase();
  const copy = SECTION_COPY[kind] ?? { heading: label, hint: '' };
  return (
    <section
      className="rule-workflow-section"
      data-kind={kind}
      data-inline={inline || undefined}
      aria-labelledby={titleId}
    >
      <div className="rule-workflow-rail" aria-hidden="true">
        <span className="rule-workflow-node">{SECTION_ICONS[kind]}</span>
      </div>
      <div className="rule-workflow-main">
        <div className="rule-workflow-heading">
          <h4
            id={titleId}
            className="rule-workflow-label"
            aria-label={title}
            title={inline ? copy.hint : undefined}
          >
            {copy.heading}
          </h4>
          {inline ? (
            <div className="rule-workflow-inline-body">{children}</div>
          ) : (
            copy.hint && <span className="rule-workflow-hint">{copy.hint}</span>
          )}
        </div>
        {!inline && <div className="rule-workflow-section-body">{children}</div>}
      </div>
    </section>
  );
}

const SECTION_COPY: Record<string, { heading: string; hint: string }> = {
  when: { heading: 'When', hint: 'What starts this rule' },
  if: { heading: 'Only if', hint: 'Optional conditions' },
  then: { heading: 'Then', hint: 'Runs in order' },
};

const SECTION_ICONS: Record<string, ReactNode> = {
  when: (
    <svg viewBox="0 0 12 12" width="10" height="10">
      <path d="M7 1 2.5 7H6l-1 4 4.5-6H6Z" fill="currentColor" />
    </svg>
  ),
  if: (
    <svg viewBox="0 0 12 12" width="10" height="10">
      <path d="M1.5 2.5h9L7 6.5V10L5 9V6.5Z" fill="currentColor" />
    </svg>
  ),
  then: (
    <svg viewBox="0 0 12 12" width="10" height="10">
      <path d="M3.5 2 9.5 6l-6 4Z" fill="currentColor" />
    </svg>
  ),
};
