import { useState } from 'react';
import type { Composition, Layer, LayerTextPath } from '@ograf-editor/scene-model';
import { PropertyRow } from '../components/PropertyRow';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useProjectStore } from '../state/projectStore';

export function TextPathEditor({ layer, composition }: { layer: Layer; composition: Composition }) {
  const setTextPath = useProjectStore((state) => state.setLayerTextPath);
  const [error, setError] = useState('');
  const paths = composition.layers.filter(
    (candidate) => candidate.element.type === 'path' && !candidate.isGuide,
  );
  const link = layer.textPath;
  const apply = (next: LayerTextPath | null) => {
    try {
      runDiscreteHistoryStep(() => setTextPath(layer.id, next), 'Change text path');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div>
      <PropertyRow
        className="inspector-row"
        help="Choose a path layer in this template as the text baseline."
      >
        <span>Path</span>
        <select
          aria-label="Text path"
          value={link?.sourceLayerId ?? ''}
          disabled={layer.isLocked}
          onChange={(event) =>
            apply(
              event.target.value
                ? {
                    sourceLayerId: event.target.value,
                    startOffset: link?.startOffset ?? 0,
                    alignment: link?.alignment ?? 'start',
                  }
                : null,
            )
          }
        >
          <option value="">None</option>
          {paths.map((path) => (
            <option key={path.id} value={path.id}>
              {path.name}
            </option>
          ))}
        </select>
      </PropertyRow>
      {link && (
        <>
          <PropertyRow
            className="inspector-row"
            help="Distance along the path, in composition pixels."
          >
            <span>Offset</span>
            <input
              aria-label="Text path offset"
              type="number"
              value={link.startOffset}
              disabled={layer.isLocked}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) apply({ ...link, startOffset: value });
              }}
            />
          </PropertyRow>
          <PropertyRow
            className="inspector-row"
            help="Align the text along the available path length."
          >
            <span>Alignment</span>
            <select
              aria-label="Text path alignment"
              value={link.alignment}
              disabled={layer.isLocked}
              onChange={(event) =>
                apply({ ...link, alignment: event.target.value as LayerTextPath['alignment'] })
              }
            >
              <option value="start">Start</option>
              <option value="center">Center</option>
              <option value="end">End</option>
            </select>
          </PropertyRow>
        </>
      )}
      <p className="inspector-hint">
        Draw a path first. Use a mask-only path to keep its line off air.
      </p>
      <p className="inspector-hint">
        Single-contour, left-to-right text supports most text effects and opacity, position, scale,
        rotation and solid-color animators. Transform presets require grapheme splitting. Word
        Reveal places each word as one unit, and its shader and Media fills do not yet support
        animators. Clocks, crawls, automatic fitting, negative tracking, non-solid color animators,
        shader strokes, nine-slice paths and text beyond 512 graphemes are not yet supported. Arabic
        and Devanagari are supported only for simple solid-fill Word Reveal without mixed scripts,
        digits, punctuation, styled runs or property animators. Other contextual scripts remain
        unsupported.
      </p>
      {error && (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
