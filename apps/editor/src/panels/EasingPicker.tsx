import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  cubicBezierProgress,
  easedProgress,
  type CubicBezierCurve,
  type EasingPreset,
} from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { EasingCurveEditor } from './EasingCurveEditor';
import { EASING_OPTION_GROUPS, easingLabel } from './easingOptions';
import { LAYER_MOTION_FEELS } from './layerMotionFeels';
import './EasingPicker.css';

type Direction = 'in' | 'out' | 'in-out';

export function feelPreset(
  feel: (typeof LAYER_MOTION_FEELS)[number],
  direction: Direction,
): EasingPreset {
  if (feel.label === 'Linear') return 'linear';
  const family = feel.in.replace(/-(?:in|out|in-out)$/, '');
  return `${family}-${direction}` as EasingPreset;
}

function directionOf(value: EasingPreset): Direction {
  return value.endsWith('-in-out') ? 'in-out' : value.endsWith('-in') ? 'in' : 'out';
}

export function easingThumbnail(value: EasingPreset, curve?: CubicBezierCurve): string {
  return Array.from({ length: 25 }, (_, index) => {
    const x = index / 24;
    const y = Math.max(
      -0.2,
      Math.min(1.2, curve ? cubicBezierProgress(x, curve) : easedProgress(x, value)),
    );
    return `${index ? 'L' : 'M'} ${(2 + x * 36).toFixed(2)} ${(24 - y * 20).toFixed(2)}`;
  }).join(' ');
}

export function EasingPicker({
  value,
  onChange,
  label,
  disabled = false,
  curve,
  onCurveChange,
}: {
  value: EasingPreset;
  onChange: (value: EasingPreset) => void;
  label: string;
  disabled?: boolean;
  curve?: CubicBezierCurve;
  onCurveChange?: (curve: CubicBezierCurve | null) => void;
}) {
  const { document, window } = useEditorWindow();
  const anchor = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>(() => directionOf(value));
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [advanced, setAdvanced] = useState(false);
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
          top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 320)),
        });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !popover.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        anchor.current?.focus();
      }
    };
    place();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, document, window]);
  const feel = LAYER_MOTION_FEELS.find(
    (item) => item.in === value || item.out === value || feelPreset(item, 'in-out') === value,
  );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="easing-picker-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setDirection(directionOf(value));
          setOpen(!open);
        }}
      >
        <svg viewBox="0 0 40 28" aria-hidden="true">
          <path d={easingThumbnail(value, curve)} />
        </svg>
        <span>{curve ? 'Custom' : (feel?.label ?? easingLabel(value))}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popover}
            role="dialog"
            aria-label={`${label} picker`}
            className="easing-picker-popover"
            style={position}
          >
            <div className="easing-picker-direction" role="group" aria-label="Easing direction">
              {(['in', 'out', 'in-out'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={direction === item}
                  onClick={() => setDirection(item)}
                >
                  {item === 'in-out' ? 'In / Out' : item === 'in' ? 'In' : 'Out'}
                </button>
              ))}
            </div>
            <div className="easing-picker-feels">
              {LAYER_MOTION_FEELS.map((item) => {
                const preset = feelPreset(item, direction);
                return (
                  <button
                    key={item.label}
                    type="button"
                    aria-label={`${item.label} ${direction}`}
                    aria-pressed={preset === value}
                    onClick={() => {
                      onChange(preset);
                      setOpen(false);
                    }}
                  >
                    <svg viewBox="0 0 40 28" aria-hidden="true">
                      <path d={easingThumbnail(preset)} />
                    </svg>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="easing-picker-more"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
            >
              More curves {advanced ? '▴' : '▾'}
            </button>
            {advanced && (
              <select
                aria-label={`${label} more curves`}
                value={value}
                onChange={(event) => {
                  onChange(event.currentTarget.value as EasingPreset);
                }}
              >
                {EASING_OPTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            {onCurveChange && (
              <>
                <button
                  type="button"
                  className="easing-picker-more"
                  aria-expanded={custom}
                  onClick={() => setCustom(!custom)}
                >
                  Custom…
                </button>
                {custom && (
                  <EasingCurveEditor easing={value} curve={curve} onChange={onCurveChange} />
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
