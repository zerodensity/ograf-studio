import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface StageBox {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  disabledReason?: string;
}

export interface StageBoxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Dragging a corner holds the opposite corner in place, as in design tools. */
export const OPPOSITE_ANCHOR: Record<Corner, readonly [number, number]> = {
  nw: [1, 1],
  ne: [0, 1],
  sw: [1, 0],
  se: [0, 0],
};

/**
 * Draggable outlines over the stage, in composition pixels. Move mode drags a box; resize mode drags
 * a corner and keeps `anchor` (0..1 fractions of the box) fixed, so the preview matches what an
 * anchored resize stores. Changes commit once, on release.
 */
export function StageHandles({
  width,
  height,
  boxes,
  mode,
  anchor,
  selectedKey,
  disabled,
  onSelect,
  onCommit,
}: {
  width: number;
  height: number;
  boxes: StageBox[];
  mode: 'move' | 'resize';
  anchor?: readonly [number, number];
  selectedKey?: string;
  disabled?: boolean;
  onSelect?: (key: string) => void;
  /** Fixed point for resizing; omitted holds the corner opposite the one being dragged. */
  onCommit: (key: string, geometry: StageBoxGeometry, held: readonly [number, number]) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ key: string; geometry: StageBoxGeometry } | null>(null);
  const scale = () => width / Math.max(1, layer.current?.clientWidth ?? width);

  const begin = (event: ReactPointerEvent<HTMLElement>, box: StageBox, corner?: Corner) => {
    if (disabled || box.disabledReason) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(box.key);
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; the drag still works.
    }
    const origin = { x: event.clientX, y: event.clientY };
    const factor = scale();
    let current: StageBoxGeometry = { x: box.x, y: box.y, width: box.width, height: box.height };
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - origin.x) * factor;
      const dy = (moveEvent.clientY - origin.y) * factor;
      if (!corner) {
        current = { ...current, x: Math.round(box.x + dx), y: Math.round(box.y + dy) };
      } else {
        const held = anchor ?? OPPOSITE_ANCHOR[corner];
        const nextWidth = Math.max(1, Math.round(box.width + (corner.endsWith('e') ? dx : -dx)));
        const nextHeight = Math.max(
          1,
          Math.round(box.height + (corner.startsWith('s') ? dy : -dy)),
        );
        current = {
          width: nextWidth,
          height: nextHeight,
          x: box.x + (box.width - nextWidth) * held[0],
          y: box.y + (box.height - nextHeight) * held[1],
        };
      }
      setDraft({ key: box.key, geometry: current });
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setDraft(null);
      if (
        current.x !== box.x ||
        current.y !== box.y ||
        current.width !== box.width ||
        current.height !== box.height
      )
        onCommit(box.key, current, corner ? (anchor ?? OPPOSITE_ANCHOR[corner]) : [0, 0]);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  return (
    <div className="tr-handles" ref={layer}>
      {boxes.map((box) => {
        const live = draft?.key === box.key ? draft.geometry : box;
        const selected = box.key === selectedKey;
        return (
          <div
            key={box.key}
            className={`tr-handle-box${selected ? ' is-selected' : ''}${
              box.disabledReason ? ' is-disabled' : ''
            }${mode === 'move' ? ' is-movable' : ''}`}
            style={{
              left: pct(live.x, width),
              top: pct(live.y, height),
              width: pct(live.width, width),
              height: pct(live.height, height),
            }}
            title={box.disabledReason ?? box.label}
            onPointerDown={(event) =>
              mode === 'move' ? begin(event, box) : (onSelect?.(box.key), event.stopPropagation())
            }
          >
            <span className="tr-handle-label">
              {box.label.split(' / ').at(-1)}
              {draft?.key === box.key &&
                ` · ${Math.round(live.width)}×${Math.round(live.height)} @ ${Math.round(live.x)},${Math.round(live.y)}`}
            </span>
            {mode === 'resize' &&
              selected &&
              !box.disabledReason &&
              (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <span
                  key={corner}
                  className={`tr-handle-corner is-${corner}`}
                  aria-hidden="true"
                  onPointerDown={(event) => begin(event, box, corner)}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
