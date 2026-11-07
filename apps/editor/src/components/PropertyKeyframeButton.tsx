import { useRef, useState, type MouseEvent } from 'react';
import { ContextMenu } from './ContextMenu';
import './PropertyKeyframeButton.css';

/** Three visible states: static, animated between keys, and a key at the playhead. */
export function PropertyKeyframeButton({
  label,
  timeLabel,
  animated,
  keyed,
  disabled = false,
  onToggle,
  onReset,
  canReset = animated,
}: {
  label: string;
  timeLabel: string;
  animated: boolean;
  keyed: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onReset?: () => void;
  canReset?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const action = keyed ? `Remove ${label} key` : animated ? `Add ${label} key` : `Animate ${label}`;
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`property-keyframe-button${animated ? ' is-animated' : ''}${keyed ? ' is-keyed' : ''}`}
        aria-label={`${action} at ${timeLabel}`}
        aria-pressed={keyed}
        title={`${action} at ${timeLabel}${onReset ? '. Right-click to reset this channel’s animation.' : ''}`}
        disabled={disabled}
        aria-haspopup={onReset ? 'menu' : undefined}
        aria-expanded={onReset ? menu !== null : undefined}
        aria-keyshortcuts={onReset ? 'Shift+F10' : undefined}
        onContextMenu={(event) => {
          if (!onReset) return;
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (!onReset || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')))
            return;
          event.preventDefault();
          event.stopPropagation();
          const rect = button.current?.getBoundingClientRect();
          if (rect) setMenu({ x: rect.left, y: rect.bottom });
        }}
        onClick={toggle}
      >
        <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
          <path d="M7 1 13 7 7 13 1 7Z" />
        </svg>
      </button>
      {menu && onReset && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={`${label} animation actions`}
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'reset-channel-animation',
              label: `Reset ${label} animation`,
              disabled: disabled || !canReset,
              title: `Remove this channel’s animation and keep its value at the playhead. Other channels are unchanged.`,
              onSelect: onReset,
            },
          ]}
        />
      )}
    </>
  );
}
