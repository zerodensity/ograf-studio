import {
  createId,
  normalizeTextPropertyAnimator,
  type TextPropertyAnimator,
} from '@ograf-editor/scene-model';
import { ColorInput } from '../components/ColorInput';
import { FrameDurationControl } from './FrameDurationControl';
import './TextPropertyAnimatorsEditor.css';
const properties = [
  ['opacity', 'Opacity', 0, 0, 1, 0.05],
  ['x', 'X offset', 0, undefined, undefined, 1],
  ['y', 'Y offset', 40, undefined, undefined, 1],
  ['scale', 'Scale', 1, 0, undefined, 0.05],
  ['rotation', 'Rotation', 0, undefined, undefined, 1],
  ['blur', 'Blur', 0, 0, undefined, 0.5],
  ['tracking', 'Tracking', 0, undefined, undefined, 0.5],
] as const;
export function TextPropertyAnimatorsEditor({
  animators,
  frameRate,
  currentFrame,
  blocked,
  colorAllowed,
  gradientColor,
  onChange,
}: {
  animators: TextPropertyAnimator[];
  frameRate: number;
  currentFrame: number;
  blocked: boolean;
  colorAllowed: boolean;
  gradientColor: boolean;
  onChange: (items: TextPropertyAnimator[]) => void;
}) {
  const update = (index: number, patch: Partial<TextPropertyAnimator>) =>
    onChange(
      animators.map((item, i) =>
        i === index ? normalizeTextPropertyAnimator({ ...item, ...patch }) : item,
      ),
    );
  return (
    <section className="text-property-animators" aria-label="Text property animators">
      <div className="text-property-header">
        <strong>Property animators</strong>
        <button
          type="button"
          disabled={blocked || animators.length >= 32}
          onClick={() =>
            onChange([
              ...animators,
              normalizeTextPropertyAnimator({
                id: createId('text-animator'),
                durationFrames: Math.max(1, Math.round(frameRate)),
                properties: { y: 40, opacity: 0 },
              }),
            ])
          }
        >
          + Animator
        </button>
      </div>
      {blocked && (
        <p className="inspector-hint">
          Property animators cannot be combined with count or roll effects yet.
        </p>
      )}
      {gradientColor && animators.some((item) => item.enabled && item.properties.color) && (
        <p className="inspector-hint">
          Animated gradient colors repaint individual glyphs and can be expensive. Test playback on
          your target renderer.
        </p>
      )}
      {!colorAllowed && (
        <p className="inspector-hint">
          Animator color needs a solid fill or a gradient with parseable colors. Shader and media
          fills support the other animator properties.
        </p>
      )}
      {animators.map((a, index) => (
        <details key={a.id} open>
          <summary>
            Animator {index + 1} · {a.unit} · {a.order}
          </summary>
          <div className="text-property-body">
            <label>
              <span>Enabled</span>
              <input
                type="checkbox"
                aria-label={`Animator ${index + 1} enabled`}
                checked={a.enabled}
                onChange={(e) => update(index, { enabled: e.currentTarget.checked })}
              />
            </label>
            <label>
              <span>Unit</span>
              <select
                aria-label={`Animator ${index + 1} unit`}
                value={a.unit}
                onChange={(e) =>
                  update(index, { unit: e.currentTarget.value as TextPropertyAnimator['unit'] })
                }
              >
                <option value="character">Characters</option>
                <option value="word">Words</option>
                <option value="line">Lines</option>
              </select>
            </label>
            {(['start', 'end', 'offset'] as const).map((key) => (
              <label key={key}>
                <span>{key} %</span>
                <input
                  type="number"
                  aria-label={`Animator ${index + 1} ${key} percent`}
                  min={key === 'offset' ? -100 : 0}
                  max={100}
                  value={Math.round(a[key] * 100)}
                  onChange={(e) => update(index, { [key]: Number(e.currentTarget.value) / 100 })}
                />
              </label>
            ))}
            <label>
              <span>Shape</span>
              <select
                aria-label={`Animator ${index + 1} shape`}
                value={a.shape}
                onChange={(e) =>
                  update(index, { shape: e.currentTarget.value as TextPropertyAnimator['shape'] })
                }
              >
                {['square', 'ramp', 'triangle', 'round'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Easing</span>
              <select
                aria-label={`Animator ${index + 1} easing`}
                value={a.easing}
                onChange={(e) =>
                  update(index, { easing: e.currentTarget.value as TextPropertyAnimator['easing'] })
                }
              >
                {['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Order</span>
              <select
                aria-label={`Animator ${index + 1} order`}
                value={a.order}
                onChange={(e) =>
                  update(index, { order: e.currentTarget.value as TextPropertyAnimator['order'] })
                }
              >
                <option value="forward">Forward</option>
                <option value="reverse">Reverse</option>
                <option value="center-out">Centre out</option>
                <option value="random">Random (seeded)</option>
              </select>
            </label>
            {a.order === 'random' && (
              <label>
                <span>Seed</span>
                <input
                  type="number"
                  aria-label={`Animator ${index + 1} random seed`}
                  value={a.seed}
                  onChange={(e) => update(index, { seed: Number(e.currentTarget.value) })}
                />
              </label>
            )}
            <FrameDurationControl
              label={`Animator ${index + 1}`}
              frameRate={frameRate}
              frames={a.durationFrames}
              minFrames={1}
              onChange={(durationFrames) => update(index, { durationFrames })}
            />
            <div className="text-property-values">
              {properties.map(([key, label, initial, min, max, step]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    aria-label={`Animator ${index + 1} ${label}`}
                    placeholder="Off"
                    min={min}
                    max={max}
                    step={step}
                    value={a.properties[key] ?? ''}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      const next = { ...a.properties };
                      if (value === '') delete next[key];
                      else next[key] = Number(value);
                      update(index, { properties: next });
                    }}
                  />
                  <button
                    type="button"
                    title={`Enable ${label}`}
                    onClick={() =>
                      update(index, {
                        properties: { ...a.properties, [key]: a.properties[key] ?? initial },
                      })
                    }
                  >
                    +
                  </button>
                </label>
              ))}
              <label>
                <span>Color</span>
                {a.properties.color !== undefined ? (
                  <>
                    <ColorInput
                      label={`Animator ${index + 1} color`}
                      value={a.properties.color}
                      onChange={(color) =>
                        update(index, { properties: { ...a.properties, color } })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...a.properties };
                        delete next.color;
                        update(index, { properties: next });
                      }}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!colorAllowed}
                    onClick={() =>
                      update(index, { properties: { ...a.properties, color: '#ffffff' } })
                    }
                  >
                    + Color
                  </button>
                )}
              </label>
            </div>
            <details>
              <summary>Offset keys ({a.offsetKeyframes.length})</summary>
              <button
                type="button"
                onClick={() =>
                  update(index, {
                    offsetKeyframes: [
                      ...a.offsetKeyframes.filter((k) => k.frame !== currentFrame),
                      { frame: currentFrame, value: a.offset },
                    ].sort((x, y) => x.frame - y.frame),
                  })
                }
              >
                Key offset at current frame
              </button>
              {a.offsetKeyframes.map((key) => (
                <label key={key.frame}>
                  <span>{key.frame}f</span>
                  <input
                    type="number"
                    aria-label={`Offset at frame ${key.frame}`}
                    min={-100}
                    max={100}
                    value={Math.round(key.value * 100)}
                    onChange={(e) =>
                      update(index, {
                        offsetKeyframes: a.offsetKeyframes.map((item) =>
                          item.frame === key.frame
                            ? { ...item, value: Number(e.currentTarget.value) / 100 }
                            : item,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update(index, {
                        offsetKeyframes: a.offsetKeyframes.filter(
                          (item) => item.frame !== key.frame,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </label>
              ))}
            </details>
            <button type="button" onClick={() => onChange(animators.filter((_, i) => i !== index))}>
              Remove animator
            </button>
          </div>
        </details>
      ))}
    </section>
  );
}
