import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  colorValue?: string;
  onColorChange?: (value: string) => void;
  disabled?: boolean;
  separatorBefore?: boolean;
  title?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  ariaLabel: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, ariaLabel, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 6;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) =>
        item.colorValue && item.onColorChange ? (
          <label
            key={item.id}
            className={`context-menu-color${item.separatorBefore ? ' with-separator' : ''}`}
            role="menuitem"
            title={item.title}
          >
            <span>{item.label}</span>
            <input
              type="color"
              aria-label={item.label}
              value={item.colorValue}
              disabled={item.disabled}
              onChange={(event) => {
                item.onColorChange?.(event.target.value);
                onClose();
              }}
            />
          </label>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={item.separatorBefore ? 'with-separator' : undefined}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
