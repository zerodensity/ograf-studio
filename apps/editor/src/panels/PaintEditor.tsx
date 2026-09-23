import { PropertyRow } from '../components/PropertyRow';
import { useState } from 'react';
import {
  createDefaultGradient,
  createShaderPaint,
  isGradientPaint,
  isShaderPaint,
  type GradientPaint,
  type Paint,
  type ShaderParameterValue,
} from '@ograf-editor/scene-model';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import { shaderPaintWithPatch } from '../state/shaderResources';
import { SHADER_RESOURCE_MIME, shaderPaintFromResourceDrag } from '../state/shaderDrag';
import { useProjectStore } from '../state/projectStore';
import './PaintEditor.css';

interface PaintEditorProps {
  value: Paint | undefined;
  onChange: (value: Paint | undefined) => void;
  /** Media keeps its original pixels until a shader fill is chosen. */
  media?: boolean;
  allowShader?: boolean;
  allowGradient?: boolean;
  label?: string;
  disabled?: boolean;
  onShaderParameterChange?: (name: string, value: ShaderParameterValue) => void;
  onShaderParameterPreview?: (name: string, value: ShaderParameterValue) => void;
  shaderAnimationActive?: boolean;
}

const asColor = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000');

export function PaintEditor({
  value,
  onChange,
  media = false,
  allowShader = true,
  allowGradient = true,
  label = 'Fill',
  disabled = false,
  onShaderParameterChange,
  onShaderParameterPreview,
  shaderAnimationActive = false,
}: PaintEditorProps) {
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const kind = value === undefined ? 'original' : typeof value === 'string' ? 'solid' : value.type;
  const gradient = isGradientPaint(value) ? value : null;
  const updateGradient = (patch: Partial<GradientPaint>) => {
    if (gradient) onChange({ ...gradient, ...patch });
  };

  return (
    <div className="paint-editor">
      <div
        className={`paint-shader-drop${dragOver ? ' is-drag-over' : ''}`}
        data-shader-drop-slot={allowShader ? label.toLowerCase() : undefined}
        onDragEnter={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragOver(!disabled);
        }}
        onDragOver={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragOver(!disabled);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          if (disabled) return;
          try {
            const paint = shaderPaintFromResourceDrag(
              useProjectStore.getState().project,
              event.dataTransfer.getData(SHADER_RESOURCE_MIME),
            );
            onChange(paint);
            setDropError(null);
          } catch (cause) {
            setDropError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <PropertyRow
          help={
            label === 'Outline'
              ? 'Choose the text outline paint. Its shader follows editable characters and uses the Stroke Width below. Drop a shader from Resources onto this row to replace it.'
              : 'Choose the object fill. Drop a shader from Resources onto this row to apply it. Shader controls are declared with #pragma ograf.'
          }
          className="inspector-row"
        >
          <span>{label}</span>
          <select
            value={kind}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              onChange(
                next === 'original'
                  ? undefined
                  : next === 'shader'
                    ? createShaderPaint()
                    : next === 'solid'
                      ? '#3b3f4a'
                      : createDefaultGradient(next as GradientPaint['type']),
              );
            }}
          >
            {media && <option value="original">Original pixels</option>}
            {!media && (
              <>
                <option value="solid">Solid</option>
                {allowGradient && (
                  <>
                    <option value="linear">Linear gradient</option>
                    <option value="radial">Radial gradient</option>
                    <option value="conic">Conic gradient</option>
                  </>
                )}
              </>
            )}
            {allowShader && <option value="shader">Shader</option>}
          </select>
        </PropertyRow>
      </div>
      {dropError && (
        <p className="shader-source-error" role="alert">
          {dropError}
        </p>
      )}
      {isShaderPaint(value) ? (
        <>
          {shaderAnimationActive && (
            <p className="inspector-hint">
              Keyframed controls follow Timeline. Use Auto-keyframe for playhead edits, or edit
              repeating values in the loop editor.
            </p>
          )}
          <ShaderSourceEditor
            element={value}
            labelPrefix={label === 'Fill' ? 'Shader' : `${label} shader`}
            onChange={(patch) => onChange(shaderPaintWithPatch(value, patch))}
            onParameterChange={onShaderParameterChange}
            onParameterPreview={onShaderParameterPreview}
          />
        </>
      ) : typeof value === 'string' ? (
        <PropertyRow
          help={
            'Solid fill color inside the shape. For multiple colors or moving highlights, switch the fill type to a gradient.'
          }
          className="inspector-row"
        >
          <span>Color</span>
          <input
            type="color"
            value={asColor(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </PropertyRow>
      ) : isGradientPaint(value) ? (
        <>
          {value.type !== 'radial' && (
            <PropertyRow
              help={
                'Gradient direction or rotation in degrees. Changing the angle moves the color transition around the shape without changing its outline.'
              }
              className="inspector-row"
            >
              <span>Angle</span>
              <input
                type="number"
                value={value.angle}
                onChange={(event) => updateGradient({ angle: Number(event.target.value) })}
              />
            </PropertyRow>
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
      ) : null}
    </div>
  );
}
