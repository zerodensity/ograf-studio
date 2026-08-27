import { createDefaultGradient, type GradientPaint, type Paint } from '@ograf-editor/scene-model';

interface PaintEditorProps {
  value: Paint;
  onChange: (value: Paint) => void;
}

const asColor = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000');

export function PaintEditor({ value, onChange }: PaintEditorProps) {
  const kind = typeof value === 'string' ? 'solid' : value.type;
  const gradient = typeof value === 'string' ? null : value;
  const updateGradient = (patch: Partial<GradientPaint>) => {
    if (gradient) onChange({ ...gradient, ...patch });
  };

  return (
    <div className="paint-editor">
      <label className="inspector-row">
        <span>Fill</span>
        <select
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next === 'solid' ? '#3b3f4a' : createDefaultGradient(next as GradientPaint['type']),
            );
          }}
        >
          <option value="solid">Solid</option>
          <option value="linear">Linear gradient</option>
          <option value="radial">Radial gradient</option>
          <option value="conic">Conic gradient</option>
        </select>
      </label>
      {typeof value === 'string' ? (
        <label className="inspector-row">
          <span>Color</span>
          <input
            type="color"
            value={asColor(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      ) : (
        <>
          {value.type !== 'radial' && (
            <label className="inspector-row">
              <span>Angle</span>
              <input
                type="number"
                value={value.angle}
                onChange={(event) => updateGradient({ angle: Number(event.target.value) })}
              />
            </label>
          )}
          <div className="paint-stops">
            {value.stops.map((stop, index) => (
              <div className="paint-stop" key={index}>
                <input
                  aria-label={`Stop ${index + 1} color`}
                  type="color"
                  value={asColor(stop.color)}
                  onChange={(event) =>
                    updateGradient({
                      stops: value.stops.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, color: event.target.value } : item,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Stop ${index + 1} offset`}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(stop.offset * 100)}
                  onChange={(event) =>
                    updateGradient({
                      stops: value.stops.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              offset: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                            }
                          : item,
                      ),
                    })
                  }
                />
                <span>%</span>
                <input
                  aria-label={`Stop ${index + 1} opacity`}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(stop.opacity * 100)}
                  onChange={(event) =>
                    updateGradient({
                      stops: value.stops.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                            }
                          : item,
                      ),
                    })
                  }
                />
                <span>% alpha</span>
                <button
                  type="button"
                  disabled={value.stops.length <= 2}
                  onClick={() =>
                    updateGradient({
                      stops: value.stops.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updateGradient({
                  stops: [...value.stops, { offset: 0.5, color: '#ffffff', opacity: 1 }].sort(
                    (a, b) => a.offset - b.offset,
                  ),
                })
              }
            >
              + Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
}
