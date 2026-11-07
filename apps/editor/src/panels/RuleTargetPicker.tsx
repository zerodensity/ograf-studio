import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEditorWindow } from '../layout/EditorWindow';
import './RuleTargetPicker.css';

export interface RuleTargetOption {
  value: string;
  label: string;
  kind: 'object' | 'group';
  /** Secondary text, such as a group's member count. */
  detail?: string;
  disabled?: boolean;
}

interface PickerPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/**
 * A select-like list whose rows say whether the target is one object or a group of them. Native
 * selects can't colour part of an option, so this is a small listbox with the usual keyboard use.
 */
export function RuleTargetPicker({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  options: RuleTargetOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { document: editorDocument } = useEditorWindow();
  const ownerDocument = rootRef.current?.ownerDocument ?? editorDocument;
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const activeOption = options[active];
  const optionId = (index: number) => `${listId}-option-${index}`;
  const visible = open && !disabled;
  const positioned = position !== null;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!visible) return;
    if (!activeOption || activeOption.disabled) {
      setActive(options.findIndex((option) => !option.disabled));
    }
  }, [visible, activeOption, options]);

  useLayoutEffect(() => {
    if (!visible) return;
    const owner = ownerDocument.defaultView;
    if (!owner) return;
    const measure = () => {
      const button = buttonRef.current;
      const list = listRef.current;
      if (!button || !list) return;
      const rect = button.getBoundingClientRect();
      if (button.matches(':disabled') || !rect.width || !rect.height) {
        setOpen(false);
        return;
      }
      const edge = 6;
      const gap = 2;
      const viewportWidth = owner.innerWidth;
      const viewportHeight = owner.innerHeight;
      const width = Math.min(rect.width, Math.max(0, viewportWidth - edge * 2));
      const below = Math.max(0, viewportHeight - rect.bottom - edge - gap);
      const above = Math.max(0, rect.top - edge - gap);
      const desiredHeight = Math.min(240, list.scrollHeight + 2);
      const flipped = below < desiredHeight && above > below;
      const maxHeight = Math.min(240, flipped ? above : below);
      const height = Math.min(desiredHeight, maxHeight);
      const next = {
        left: Math.max(edge, Math.min(rect.left, viewportWidth - width - edge)),
        top: Math.max(edge, flipped ? rect.top - gap - height : rect.bottom + gap),
        width,
        maxHeight,
      };
      setPosition((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };
    measure();
    // A docked pane may move without resizing its button. Follow the anchor while its list is open.
    let frame = 0;
    const followAnchor = () => {
      measure();
      frame = owner.requestAnimationFrame(followAnchor);
    };
    frame = owner.requestAnimationFrame(followAnchor);
    owner.addEventListener('resize', measure);
    ownerDocument.addEventListener('scroll', measure, true);
    const close = () => setOpen(false);
    ownerDocument.addEventListener('fullscreenchange', close);
    owner.addEventListener('blur', close);
    return () => {
      owner.cancelAnimationFrame(frame);
      owner.removeEventListener('resize', measure);
      ownerDocument.removeEventListener('scroll', measure, true);
      ownerDocument.removeEventListener('fullscreenchange', close);
      owner.removeEventListener('blur', close);
    };
  }, [visible, ownerDocument]);

  useLayoutEffect(() => {
    if (!visible || !positioned) return;
    listRef.current?.focus({ preventScroll: true });
  }, [visible, positioned]);

  useLayoutEffect(() => {
    if (!visible || active < 0) return;
    const list = listRef.current;
    const row = list?.children[active] as HTMLElement | undefined;
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [visible, active, position]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    ownerDocument.addEventListener('pointerdown', outside, true);
    return () => ownerDocument.removeEventListener('pointerdown', outside, true);
  }, [visible, ownerDocument]);

  const show = (edge?: 'first' | 'last') => {
    if (disabled || buttonRef.current?.matches(':disabled')) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    const enabledIndexes = options.flatMap((option, index) => (option.disabled ? [] : [index]));
    setActive(
      edge === 'last'
        ? (enabledIndexes.at(-1) ?? -1)
        : edge === 'first' || selectedIndex < 0
          ? (enabledIndexes[0] ?? -1)
          : selectedIndex,
    );
    setPosition(null);
    setOpen(true);
  };
  const choose = (option: RuleTargetOption | undefined) => {
    if (!option || option.disabled || disabled || buttonRef.current?.matches(':disabled')) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement | HTMLUListElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!visible) return show(step === 1 ? 'first' : 'last');
      if (!options.length) return;
      for (let distance = 1; distance <= options.length; distance += 1) {
        const index = (active + step * distance + options.length * 2) % options.length;
        if (!options[index]?.disabled) {
          setActive(index);
          break;
        }
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      const edge = event.key === 'Home' ? 'first' : 'last';
      if (!visible) return show(edge);
      const enabledIndexes = options.flatMap((option, index) => (option.disabled ? [] : [index]));
      setActive((edge === 'first' ? enabledIndexes[0] : enabledIndexes.at(-1)) ?? -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (visible) choose(activeOption);
      else show();
    } else if (event.key === 'Escape' && visible) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    } else if (event.key === 'Tab' && visible) {
      // Let Tab continue from the select button in the document's normal focus order.
      buttonRef.current?.focus({ preventScroll: true });
      setOpen(false);
    }
  };

  return (
    <div className="rule-target-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="rule-target-button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        disabled={disabled}
        onClick={() => (visible ? setOpen(false) : show())}
        onKeyDown={keyDown}
        title={selected?.label ?? (value ? `Missing target: ${value}` : undefined)}
      >
        <span className="rule-target-label">
          {selected?.label ?? (value ? 'Missing target' : 'Choose target')}
        </span>
        {selected && (
          <span className={`rule-target-kind is-${selected.kind}`}>{selected.kind}</span>
        )}
        <span className="rule-target-chevron" aria-hidden="true" />
      </button>
      {visible &&
        createPortal(
          <ul
            ref={listRef}
            className="rule-target-list"
            role="listbox"
            id={listId}
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-activedescendant={
              activeOption && !activeOption.disabled ? optionId(active) : undefined
            }
            style={position ? position : { visibility: 'hidden' }}
            onKeyDown={keyDown}
            onBlur={(event) => {
              const target = event.relatedTarget;
              if (!rootRef.current?.contains(target) && !listRef.current?.contains(target))
                setOpen(false);
            }}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                role="option"
                id={optionId(index)}
                aria-selected={option.value === selected?.value}
                aria-disabled={option.disabled || undefined}
                className={index === active ? 'is-active' : undefined}
                onPointerEnter={() => {
                  if (!option.disabled) setActive(index);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                <span className="rule-target-label">
                  {option.label}
                  {option.detail && <small>{option.detail}</small>}
                </span>
                <span className={`rule-target-kind is-${option.kind}`}>{option.kind}</span>
              </li>
            ))}
            {!options.length && (
              <li className="rule-target-empty" role="presentation">
                No targets available
              </li>
            )}
          </ul>,
          ownerDocument.fullscreenElement ?? ownerDocument.body,
        )}
    </div>
  );
}
