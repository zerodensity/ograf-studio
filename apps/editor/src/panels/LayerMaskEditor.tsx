import { useState } from 'react';
import { maskSourceSupportsMode, type Composition, type Layer } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';

export function LayerMaskEditor({
  composition,
  layer,
}: {
  composition: Composition;
  layer: Layer;
}) {
  const setMask = useProjectStore((s) => s.setLayerMask),
    setMaskOnly = useProjectStore((s) => s.setLayerMaskOnly);
  const [error, setError] = useState('');
  const update = (mask: Layer['mask'], hideSource = false) => {
    try {
      setMask(layer.id, mask, hideSource);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const mode = layer.mask?.mode ?? 'alpha';
  const sources = composition.layers.filter(
    (source) => source.id !== layer.id && !source.isGuide && maskSourceSupportsMode(source, mode),
  );
  const consumers = composition.layers.filter((target) => target.mask?.sourceLayerId === layer.id);
  return (
    <>
      <h3 className="inspector-section">Layer mask</h3>
      <label className="inspector-row">
        <span>Mask source</span>
        <select
          aria-label="Mask source"
          disabled={layer.isLocked}
          value={layer.mask?.sourceLayerId ?? ''}
          onChange={(e) =>
            update(
              e.target.value
                ? { sourceLayerId: e.target.value, mode, inverted: layer.mask?.inverted ?? false }
                : null,
              true,
            )
          }
        >
          <option value="">None</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </label>
      {layer.mask && (
        <>
          <label className="inspector-row">
            <span>Mask mode</span>
            <select
              aria-label="Mask mode"
              disabled={layer.isLocked}
              value={mode}
              onChange={(e) => update({ ...layer.mask!, mode: e.target.value as 'alpha' | 'path' })}
            >
              <option value="alpha">Alpha transparency</option>
              <option value="path">Path geometry</option>
            </select>
          </label>
          <label className="inspector-row inspector-checkbox-row">
            <span>Invert mask</span>
            <input
              aria-label="Invert mask"
              type="checkbox"
              disabled={layer.isLocked}
              checked={layer.mask.inverted}
              onChange={(e) => update({ ...layer.mask!, inverted: e.target.checked })}
            />
          </label>
          <p className="inspector-hint">
            {mode === 'alpha'
              ? 'Uses source transparency, opacity, blur and shadows.'
              : 'Uses the source shape and fill rule; ignores its paint, opacity and effects.'}{' '}
            The source moves independently.
          </p>
        </>
      )}
      <label className="inspector-row inspector-checkbox-row">
        <span>Mask source only</span>
        <input
          aria-label="Mask source only"
          type="checkbox"
          disabled={layer.isLocked}
          checked={layer.isMaskOnly}
          onChange={(e) => setMaskOnly(layer.id, e.target.checked)}
        />
      </label>
      {(consumers.length > 0 || layer.isMaskOnly) && (
        <p className="inspector-hint">
          {layer.isMaskOnly ? 'Hidden from output; available to masks. ' : ''}
          {consumers.length ? `Used by ${consumers.map((l) => l.name).join(', ')}.` : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="inspector-hint">
          {error}
        </p>
      )}
    </>
  );
}
