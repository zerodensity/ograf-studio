import { effectParameterHelp } from './propertyHelp';
import { PropertyRow } from '../components/PropertyRow';
import { useState } from 'react';
import {
  EFFECT_CATALOG,
  EFFECT_TYPES,
  MAX_EFFECTS,
  effectEnabled,
  effectParams,
  getEffectStack,
  getLayerEffectsAtFrame,
  type EffectType,
  type Layer,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import './EffectStackEditor.css';

export function EffectStackEditor({ layer, frame }: { layer: Layer; frame: number }) {
  const [type, setType] = useState<EffectType>('glow'),
    [error, setError] = useState('');
  const add = useProjectStore((s) => s.addLayerEffect),
    update = useProjectStore((s) => s.updateLayerEffect),
    remove = useProjectStore((s) => s.removeLayerEffect),
    duplicate = useProjectStore((s) => s.duplicateLayerEffect),
    reorder = useProjectStore((s) => s.reorderLayerEffects);
  const effects = getLayerEffectsAtFrame(layer, frame),
    stack = getEffectStack(effects);
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const move = (index: number, delta: number) =>
    run(() => {
      const ids = stack.map((e) => e.id);
      [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
      reorder(layer.id, ids);
    });
  return (
    <div className="effect-stack-editor">
      <h3 className="inspector-section">Effects stack</h3>
      <p className="inspector-hint">
        Effects run from top to bottom. Reorder to change the result; bypass keeps settings and
        animation.
      </p>
      <div className="effect-stack-toolbar">
        <select
          aria-label="New effect type"
          value={type}
          onChange={(e) => setType(e.target.value as EffectType)}
        >
          {EFFECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EFFECT_CATALOG[t].label}
            </option>
          ))}
        </select>
        <button
          disabled={stack.length >= MAX_EFFECTS}
          onClick={() => run(() => add(layer.id, type))}
        >
          Add effect
        </button>
      </div>
      {error && (
        <p role="alert" className="inspector-hint">
          {error}
        </p>
      )}
      {stack.map((effect, index) => {
        const params = effectParams(effect, effects),
          enabled = effectEnabled(effect, effects);
        return (
          <section
            className="effect-stack-item"
            data-effect-id={effect.id}
            aria-label={`Effect ${effect.name}`}
            key={effect.id}
          >
            <div className="effect-stack-header">
              <input
                type="checkbox"
                aria-label={`Enable ${effect.name}`}
                checked={enabled}
                onChange={(e) =>
                  run(() => update(layer.id, effect.id, { enabled: e.target.checked }, frame))
                }
              />
              <input
                aria-label={`Effect name ${index + 1}`}
                value={effect.name}
                onChange={(e) =>
                  run(() => update(layer.id, effect.id, { name: e.target.value }, frame))
                }
              />
              <span>{EFFECT_CATALOG[effect.type].label}</span>
            </div>
            <div className="effect-stack-actions">
              <button
                aria-label={`Move ${effect.name} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                aria-label={`Move ${effect.name} down`}
                disabled={index === stack.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                disabled={stack.length >= MAX_EFFECTS}
                onClick={() => run(() => duplicate(layer.id, effect.id))}
              >
                Duplicate
              </button>
              <button
                title="Remove this effect and its own animation/bindings"
                onClick={() => run(() => remove(layer.id, effect.id))}
              >
                Remove
              </button>
            </div>
            <div className={enabled ? 'effect-stack-params' : 'effect-stack-params is-bypassed'}>
              {Object.entries(EFFECT_CATALOG[effect.type].params).map(([key, spec]) => (
                <PropertyRow
                  help={effectParameterHelp(effect.type, key)}
                  className="inspector-row"
                  key={key}
                >
                  <span>{spec.label}</span>
                  <input
                    aria-label={`${effect.name} ${spec.label}`}
                    type={typeof spec.default === 'number' ? 'number' : 'color'}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step ?? 1}
                    value={
                      typeof spec.default === 'number'
                        ? Number(Number(params[key]).toFixed(4))
                        : String(params[key]).slice(0, 7)
                    }
                    onChange={(e) =>
                      run(() =>
                        update(
                          layer.id,
                          effect.id,
                          {
                            params: {
                              [key]:
                                typeof spec.default === 'number'
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          },
                          frame,
                        ),
                      )
                    }
                  />
                </PropertyRow>
              ))}
            </div>
          </section>
        );
      })}
      <p className="inspector-hint">
        Animate numeric parameters in Timeline. Brand Kit and Data bindings are available above.
      </p>
    </div>
  );
}
