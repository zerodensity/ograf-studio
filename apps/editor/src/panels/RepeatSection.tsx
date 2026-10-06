import { useEffect, useState, type MouseEvent } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PropertyRow } from '../components/PropertyRow';
import { useProjectStore } from '../state/projectStore';
import { useRepeatPreviewStore } from '../state/repeatPreviewStore';
import { useSelectionStore } from '../state/selectionStore';
import {
  MAX_REPEAT_COUNT,
  MIN_REPEAT_COUNT,
  clampRepeatCount,
  type RepeatDirection,
} from './repeaterLayout';
import './RepeatSection.css';

/** Properties section that turns the selection into a data-driven row or column of copies. */
export function RepeatSection() {
  const [countText, setCountText] = useState('3');
  const [direction, setDirection] = useState<RepeatDirection>('horizontal');
  const [gap, setGap] = useState(24);
  const [previewing, setPreviewing] = useState(false);
  const addRepeater = useProjectStore((s) => s.addRepeater);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const setPreview = useRepeatPreviewStore((s) => s.setPreview);
  const count = clampRepeatCount(Number(countText));

  useEffect(() => {
    setPreview(previewing ? { count, direction, gap } : null);
  }, [count, direction, gap, previewing, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  if (selectedLayerIds.length === 0) return null;

  const createRepeater = (event: MouseEvent<HTMLButtonElement>) => {
    const repeater = addRepeater(selectedLayerIds, count, direction, Math.max(0, gap));
    if (!repeater) return;
    // The new selection spans every copy, so stop previewing until the user comes back.
    setPreviewing(false);
    (event.currentTarget.ownerDocument.activeElement as HTMLElement | null)?.blur();
    selectMany(repeater.items.flatMap((item) => Object.values(item.layers)));
  };

  return (
    <CollapsibleSection sectionId="properties.repeat" title="Repeat" defaultOpen={false}>
      <div
        className="repeat-section"
        onMouseEnter={() => setPreviewing(true)}
        onMouseLeave={(event) => {
          const focused = event.currentTarget.ownerDocument.activeElement;
          if (!event.currentTarget.contains(focused)) setPreviewing(false);
        }}
        onFocus={() => setPreviewing(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPreviewing(false);
          }
        }}
      >
        <p className="inspector-hint">
          Copies the selection into a row or column. Each copy gets its own data fields (Item 1,
          Item 2…) for playout. Hover here to preview the copies on the canvas.
        </p>
        <PropertyRow
          className="inspector-row"
          help={`How many items the repeater holds in total, including the original (${MIN_REPEAT_COUNT}–${MAX_REPEAT_COUNT}).`}
        >
          <span>Copies</span>
          <input
            type="number"
            min={MIN_REPEAT_COUNT}
            max={MAX_REPEAT_COUNT}
            value={countText}
            onChange={(event) => setCountText(event.target.value)}
            onBlur={() => setCountText(String(count))}
          />
        </PropertyRow>
        <PropertyRow
          as="div"
          className="inspector-row"
          help="Lay the copies out to the right of the original or below it."
        >
          <span>Direction</span>
          <div className="repeat-segmented" role="radiogroup" aria-label="Direction">
            {(['horizontal', 'vertical'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={direction === option}
                onClick={() => setDirection(option)}
              >
                {option === 'horizontal' ? '→ Horizontal' : '↓ Vertical'}
              </button>
            ))}
          </div>
        </PropertyRow>
        <PropertyRow className="inspector-row" help="Space between copies, in pixels.">
          <span>Gap (px)</span>
          <input
            type="number"
            min={0}
            value={gap}
            onChange={(event) =>
              setGap(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
            }
          />
        </PropertyRow>
        <button type="button" className="repeat-create" onClick={createRepeater}>
          Create repeater
        </button>
      </div>
    </CollapsibleSection>
  );
}
