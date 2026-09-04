import { PropertyRow } from '../components/PropertyRow';
import { useState } from 'react';
import type { Composition, Layer } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';

export function LayerLightingEditor({
  layer,
  composition,
}: {
  layer: Layer;
  composition: Composition;
}) {
  const setLink = useProjectStore((s) => s.setLayerLighting);
  const [error, setError] = useState('');
  const patterns = composition.patterns.filter((p) => p.lighting);
  const link = layer.lighting;
  const update = (next: Layer['lighting']) => {
    try {
      setLink(layer.id, next ?? null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (!patterns.length && !link) return null;
  return (
    <div>
      <h3 className="inspector-section">Shared lighting</h3>
      <PropertyRow
        help={
          'Shared lighting controller for this layer. It can synchronize sweep timing, intensity and softness with other linked lights. None removes the link.'
        }
        className="inspector-row"
      >
        <span>Controller</span>
        <select
          aria-label="Layer lighting controller"
          disabled={layer.isLocked}
          value={link?.patternId ?? ''}
          onChange={(e) =>
            update(
              e.target.value
                ? {
                    patternId: e.target.value,
                    role: link?.role ?? 'light',
                    phaseOffset: link?.phaseOffset ?? 0,
                    gain: link?.gain ?? 1,
                    cyclesPerLoop: link?.cyclesPerLoop ?? 1,
                  }
                : null,
            )
          }
        >
          <option value="">None</option>
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.lighting?.enabled ? '' : ' (bypassed)'}
            </option>
          ))}
        </select>
      </PropertyRow>
      {link && (
        <>
          <PropertyRow
            help={
              "Light follows the shared intensity. Glow also follows the controller's Glow strength, allowing halos to be tuned separately from highlights."
            }
            className="inspector-row"
          >
            <span>Role</span>
            <select
              aria-label="Layer lighting role"
              disabled={layer.isLocked}
              value={link.role}
              onChange={(e) => update({ ...link, role: e.target.value as 'light' | 'glow' })}
            >
              <option value="light">Light</option>
              <option value="glow">Glow</option>
            </select>
          </PropertyRow>
          <PropertyRow
            help={
              'Additional timing offset for this light, from 0 to 1 of a shared cycle. Use it to stagger reflections instead of having them peak together.'
            }
            className="inspector-row"
          >
            <span>Phase offset</span>
            <input
              aria-label="Layer light phase offset"
              type="number"
              min={0}
              max={1}
              step={0.01}
              disabled={layer.isLocked}
              value={link.phaseOffset}
              onChange={(e) => update({ ...link, phaseOffset: Number(e.target.value) })}
            />
          </PropertyRow>
          <PropertyRow
            help={
              "Strength multiplier for this individual light. 1 keeps its authored strength; it combines with the controller's intensity."
            }
            className="inspector-row"
          >
            <span>Strength</span>
            <input
              aria-label="Layer light strength"
              type="number"
              min={0}
              max={4}
              step={0.05}
              disabled={layer.isLocked}
              value={link.gain}
              onChange={(e) => update({ ...link, gain: Number(e.target.value) })}
            />
          </PropertyRow>
          <PropertyRow
            help={
              'Number of full sweeps this layer completes in one shared lighting cycle. Whole-number sweeps allow different speeds while keeping the loop seamless.'
            }
            className="inspector-row"
          >
            <span>Sweeps per cycle</span>
            <input
              aria-label="Layer light sweeps per cycle"
              type="number"
              min={1}
              max={64}
              step={1}
              disabled={layer.isLocked}
              value={link.cyclesPerLoop}
              onChange={(e) => update({ ...link, cyclesPerLoop: Number(e.target.value) })}
            />
          </PropertyRow>
          <p className="inspector-hint">
            Shared timing samples this layer’s original loop curves. Colors stay linked to Brand Kit
            and OGraf data.
          </p>
        </>
      )}
      {error && (
        <p className="inspector-hint" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
