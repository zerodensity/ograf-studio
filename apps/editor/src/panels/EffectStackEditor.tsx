import { effectParameterHelp } from './propertyHelp';
import { PropertyRow } from '../components/PropertyRow';
import { useState } from 'react';
import {
  EFFECT_CATALOG,
  EFFECT_BLEND_MODES,
  type EffectBlendMode,
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
import { shaderPaintWithPatch } from '../state/shaderResources';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import './EffectStackEditor.css';

const blendLabel = (mode: EffectBlendMode) =>
  mode === 'add' ? 'Add' : mode[0]!.toUpperCase() + mode.slice(1);

/** Interactive controls inside a <summary> must not also toggle the disclosure. */
const swallow = {
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

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
  const full = stack.length >= MAX_EFFECTS;
  return (
    <div className="effect-stack-editor">
      <h3
        className="inspector-section"
        title="Effects run top to bottom. Reorder to change the result; bypass keeps settings and animation. Animate numeric parameters in Timeline."
      >
        Effects stack
        {stack.length > 0 && <span className="effect-stack-count">{stack.length}</span>}
      </h3>
      <div className="effect-stack-add">
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
          disabled={full}
          title={full ? `Limit of ${MAX_EFFECTS} effects reached` : 'Add this effect to the stack'}
          onClick={() => run(() => add(layer.id, type))}
        >
          Add
        </button>
      </div>
      {error && (
        <p role="alert" className="effect-stack-error">
          {error}
        </p>
      )}
      {stack.map((effect, index) => {
        const params = effectParams(effect, effects),
          enabled = effectEnabled(effect, effects),
          catalog = EFFECT_CATALOG[effect.type];
        return (
          <details
            className={`effect-stack-item${enabled ? '' : ' is-bypassed'}`}
            data-effect-id={effect.id}
            key={effect.id}
            open
          >
            <summary aria-label={`Effect ${effect.name}`}>
              <input
                className="effect-stack-name"
                aria-label={`Effect name ${index + 1}`}
                value={effect.name}
                title={`${catalog.label} effect`}
                {...swallow}
                onChange={(e) =>
                  run(() => update(layer.id, effect.id, { name: e.target.value }, frame))
                }
              />
              {/* The type only earns space once the name no longer says it. */}
              {effect.name !== catalog.label && (
                <span className="effect-stack-type">{catalog.label}</span>
              )}
              {!enabled && <span className="effect-stack-badge">bypassed</span>}
              <span className="effect-stack-actions" {...swallow}>
                <button
                  aria-label={`Move ${effect.name} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${effect.name} down`}
                  title="Move down"
                  disabled={index === stack.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  aria-label={`Duplicate ${effect.name}`}
                  title={full ? `Limit of ${MAX_EFFECTS} effects reached` : 'Duplicate'}
                  disabled={full}
                  onClick={() => run(() => duplicate(layer.id, effect.id))}
                >
                  ⧉
                </button>
                <button
                  aria-label={`Remove ${effect.name}`}
                  title="Remove this effect and its own animation/bindings"
                  onClick={() => run(() => remove(layer.id, effect.id))}
                >
                  ✕
                </button>
              </span>
            </summary>
            <PropertyRow
              className="inspector-row effect-stack-blend"
              help="Bypass skips this effect. A blend mode activates it and combines its result with the incoming image, at the opacity beside it."
            >
              <span>Blend</span>
              <span className="effect-stack-blend-controls">
                <select
                  aria-label={`${effect.name} blend mode`}
                  value={enabled ? (effect.blendMode ?? 'normal') : 'bypass'}
                  onChange={(event) =>
                    run(() =>
                      update(
                        layer.id,
                        effect.id,
                        event.target.value === 'bypass'
                          ? { enabled: false }
                          : { enabled: true, blendMode: event.target.value as EffectBlendMode },
                        frame,
                      ),
                    )
                  }
                >
                  <option value="bypass">Bypass</option>
                  {EFFECT_BLEND_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {blendLabel(mode)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  aria-label={`${effect.name} blend opacity`}
                  title="Effect opacity: mix this effect's blended result with its input; zero contributes nothing."
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((effect.blendOpacity ?? 1) * 100)}
                  onChange={(event) =>
                    run(() =>
                      update(
                        layer.id,
                        effect.id,
                        {
                          blendOpacity:
                            Math.max(0, Math.min(100, Number(event.target.value))) / 100,
                        },
                        frame,
                      ),
                    )
                  }
                />
              </span>
            </PropertyRow>
            {effect.type === 'shader' && effect.shader && (
              <div className="effect-stack-shader">
                <p className="inspector-hint">
                  iChannel0 is the result of every preceding effect in this stack.
                </p>
                <ShaderSourceEditor
                  element={effect.shader}
                  labelPrefix={`${effect.name} shader`}
                  allowImageInput={false}
                  onChange={(patch) =>
                    run(() =>
                      update(
                        layer.id,
                        effect.id,
                        {
                          shader: shaderPaintWithPatch(effect.shader!, patch, {
                            channel0Provided: true,
                          }),
                        },
                        frame,
                      ),
                    )
                  }
                />
              </div>
            )}
            {Object.entries(catalog.params).map(([key, spec]) => (
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
          </details>
        );
      })}
    </div>
  );
}
