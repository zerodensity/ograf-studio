import { useEffect, useMemo, useRef, useState } from 'react';
import {
  inspectShaderSource,
  MAX_SHADER_IMAGE_BYTES,
  MAX_SHADER_SOURCE_BYTES,
  normalizeShaderParameterValue,
  resolveShaderParameters,
  type ShaderPaint,
  type ShaderParameterDefinition,
  type ShaderParameterValue,
} from '@ograf-editor/scene-model';
import { PropertyRow } from '../components/PropertyRow';
import './ShaderSourceEditor.css';

interface Props {
  element: ShaderPaint;
  labelPrefix?: string;
  draftSource?: string;
  onDraftSourceChange?: (source: string) => void;
  applyLabel?: string;
  onParameterChange?: (name: string, value: ShaderParameterValue) => void;
  onParameterPreview?: (name: string, value: ShaderParameterValue) => void;
  allowImageInput?: boolean;
  onChange: (patch: Partial<Omit<ShaderPaint, 'type'>>) => void;
}
function parameterLabel(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function colorHex(value: number[]): string {
  return (
    '#' +
    value
      .slice(0, 3)
      .map((part) =>
        Math.round(Math.max(0, Math.min(1, part)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function ShaderControl({
  definition,
  value,
  onChange,
  onPreview,
  labelPrefix,
}: {
  definition: ShaderParameterDefinition;
  value: ShaderParameterValue;
  onChange: (value: ShaderParameterValue) => void;
  onPreview?: (value: ShaderParameterValue) => void;
  labelPrefix: string;
}) {
  const [sliderValue, setSliderValue] = useState(() => Number(value));
  const pendingSliderValue = useRef<number | null>(null);
  useEffect(() => {
    if (pendingSliderValue.current === null) setSliderValue(Number(value));
  }, [value]);
  const previewSlider = (next: number) => {
    setSliderValue(next);
    if (onPreview) {
      pendingSliderValue.current = next;
      onPreview(next);
    } else {
      onChange(next);
    }
  };
  const commitSlider = () => {
    const next = pendingSliderValue.current;
    if (next === null) return;
    pendingSliderValue.current = null;
    onChange(next);
  };
  const label = parameterLabel(definition.name);
  const help = `Shader parameter ${definition.name}. Its control and range come from #pragma ograf and are exported as an OGraf data field.`;
  if (definition.control === 'toggle')
    return (
      <PropertyRow help={help} className="inspector-row">
        <span>{label}</span>
        <input
          aria-label={`${labelPrefix} ${definition.name}`}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </PropertyRow>
    );
  if (definition.control === 'color') {
    const vector = value as number[];
    return (
      <>
        <PropertyRow help={help} className="inspector-row">
          <span>{label}</span>
          <input
            aria-label={`${labelPrefix} ${definition.name}`}
            type="color"
            value={colorHex(vector)}
            onChange={(event) => {
              const hex = event.target.value;
              const rgb = [1, 3, 5].map(
                (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
              );
              onChange(definition.glslType === 'vec4' ? [...rgb, vector[3] ?? 1] : rgb);
            }}
          />
        </PropertyRow>
        {definition.glslType === 'vec4' && (
          <PropertyRow
            help="Shader color alpha, from transparent to opaque."
            className="inspector-row"
          >
            <span>{label} alpha</span>
            <input
              aria-label={`${labelPrefix} ${definition.name} alpha`}
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={vector[3] ?? 1}
              onChange={(event) => onChange([...vector.slice(0, 3), Number(event.target.value)])}
            />
          </PropertyRow>
        )}
      </>
    );
  }
  if (definition.control === 'vector2')
    return (
      <>
        {['x', 'y'].map((axis, index) => (
          <PropertyRow key={axis} help={help} className="inspector-row">
            <span>
              {label} {axis.toUpperCase()}
            </span>
            <input
              aria-label={`${labelPrefix} ${definition.name} ${axis}`}
              type="number"
              min={definition.min}
              max={definition.max}
              step={definition.step ?? 'any'}
              value={(value as number[])[index]}
              onChange={(event) => {
                const next = [...(value as number[])];
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
          </PropertyRow>
        ))}
      </>
    );
  return (
    <PropertyRow help={help} className="inspector-row">
      <span>{label}</span>
      <div className="shader-number-control">
        {definition.min !== undefined && definition.max !== undefined && (
          <input
            aria-label={`${labelPrefix} ${definition.name} slider`}
            type="range"
            min={definition.min}
            max={definition.max}
            step={definition.step ?? (definition.glslType === 'int' ? 1 : 'any')}
            value={sliderValue}
            onChange={(event) => previewSlider(Number(event.currentTarget.value))}
            onPointerUp={commitSlider}
            onPointerCancel={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
          />
        )}
        <input
          aria-label={`${labelPrefix} ${definition.name}`}
          type="number"
          min={definition.min}
          max={definition.max}
          step={definition.step ?? (definition.glslType === 'int' ? 1 : 'any')}
          value={value as number}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </PropertyRow>
  );
}

/** Source declares public controls; draft code is only compiled after Apply. */
export function ShaderSourceEditor({
  element,
  onChange,
  labelPrefix = 'Shader',
  draftSource,
  onDraftSourceChange,
  applyLabel = 'Apply shader',
  onParameterChange,
  onParameterPreview,
  allowImageInput = true,
}: Props) {
  const [source, setSource] = useState(draftSource ?? element.fragmentSource);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const inspection = useMemo(
    () => inspectShaderSource(element.fragmentSource),
    [element.fragmentSource],
  );
  const resolved = useMemo(() => {
    try {
      return resolveShaderParameters(element);
    } catch {
      return {};
    }
  }, [element]);
  useEffect(() => {
    setSource(draftSource ?? element.fragmentSource);
    setError(null);
  }, [element.fragmentSource, draftSource]);
  const changeSource = (next: string) => {
    setSource(next);
    onDraftSourceChange?.(next);
    setError(null);
  };
  const apply = () => {
    const nextInspection = inspectShaderSource(source);
    if (!nextInspection.valid) {
      setError(nextInspection.errors.join('\n'));
      return;
    }
    try {
      onChange({ fragmentSource: source });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="shader-source-editor">
      {inspection.parameters.map((definition) => (
        <ShaderControl
          key={definition.name}
          definition={definition}
          labelPrefix={labelPrefix}
          value={resolved[definition.name] ?? definition.defaultValue}
          onPreview={
            onParameterPreview
              ? (value) => {
                  try {
                    onParameterPreview(
                      definition.name,
                      normalizeShaderParameterValue(definition, value),
                    );
                    setError(null);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                  }
                }
              : undefined
          }
          onChange={(value) => {
            try {
              const normalized = normalizeShaderParameterValue(definition, value);
              if (onParameterChange) onParameterChange(definition.name, normalized);
              else onChange({ parameters: { [definition.name]: normalized } });
              setError(null);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        />
      ))}
      {inspection.parameters.length === 0 && (
        <p className="inspector-hint">
          No exposed parameters. Add #pragma ograf declarations to create controls and OGraf fields.
        </p>
      )}
      <details className="shader-render-settings">
        <summary>Rendering</summary>
        {allowImageInput && (
          <PropertyRow
            help="Portable static texture exposed to Shadertoy Image code as sampler2D iChannel0. PNG and JPEG files are embedded into the shader."
            className="inspector-row"
          >
            <span>Image input</span>
            <div className="shader-image-input-actions">
              <button type="button" onClick={() => imageInput.current?.click()}>
                {element.inputImage ? 'Replace…' : 'Choose…'}
              </button>
              {element.inputImage && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      onChange({ inputImage: undefined });
                      setError(null);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </PropertyRow>
        )}
        {allowImageInput && element.inputImage && (
          <div className="shader-image-input">
            <img src={element.inputImage.source} alt="iChannel0 input" />
            <span title={element.inputImage.name}>
              {element.inputImage.name ?? 'Embedded image'}
            </span>
            <PropertyRow
              help="Repeat tiles the image outside 0–1 UV coordinates; Clamp holds its edge pixels."
              className="inspector-row"
            >
              <span>Wrap</span>
              <select
                value={element.inputImage.wrap}
                onChange={(event) =>
                  onChange({
                    inputImage: {
                      ...element.inputImage!,
                      wrap: event.target.value as 'clamp' | 'repeat',
                    },
                  })
                }
              >
                <option value="repeat">Repeat</option>
                <option value="clamp">Clamp</option>
              </select>
            </PropertyRow>
            <PropertyRow
              help="Linear smooths sampled pixels; Nearest preserves hard texel edges."
              className="inspector-row"
            >
              <span>Filter</span>
              <select
                value={element.inputImage.filter}
                onChange={(event) =>
                  onChange({
                    inputImage: {
                      ...element.inputImage!,
                      filter: event.target.value as 'linear' | 'nearest',
                    },
                  })
                }
              >
                <option value="linear">Linear</option>
                <option value="nearest">Nearest</option>
              </select>
            </PropertyRow>
          </div>
        )}
        <PropertyRow
          help="Resolution relative to the layer size. Lower values reduce GPU work."
          className="inspector-row"
        >
          <span>Render scale</span>
          <input
            aria-label={`${labelPrefix} render scale`}
            type="number"
            min={0.25}
            max={1}
            step={0.25}
            value={element.resolutionScale}
            onChange={(event) =>
              onChange({ resolutionScale: Math.min(1, Math.max(0.25, Number(event.target.value))) })
            }
          />
        </PropertyRow>
      </details>
      <div className="shader-source-actions">
        <button type="button" onClick={() => input.current?.click()}>
          Load GLSL…
        </button>
        <button type="button" onClick={apply} disabled={source === element.fragmentSource}>
          {applyLabel}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".glsl,.frag,.txt,text/plain"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (file.size > MAX_SHADER_SOURCE_BYTES) {
            setError('Shader source exceeds the 256 KB limit.');
            return;
          }
          void file.text().then(
            (text) => {
              changeSource(text.replace(/^\uFEFF/, ''));
            },
            (reason: unknown) => {
              setError(reason instanceof Error ? reason.message : String(reason));
            },
          );
        }}
      />
      {allowImageInput && (
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          hidden
          aria-label={`${labelPrefix} iChannel0 image`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (!['image/png', 'image/jpeg'].includes(file.type)) {
              setError('Shader input must be a PNG or JPEG image.');
              return;
            }
            if (file.size > MAX_SHADER_IMAGE_BYTES) {
              setError('Shader input image exceeds the 10 MB limit.');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result !== 'string') {
                setError('Shader input image could not be read.');
                return;
              }
              try {
                onChange({
                  inputImage: {
                    source: reader.result,
                    name: file.name,
                    wrap: 'repeat',
                    filter: 'linear',
                  },
                });
                setError(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            };
            reader.onerror = () => setError('Shader input image could not be read.');
            reader.readAsDataURL(file);
          }}
        />
      )}
      <label className="shader-source-label">
        Fragment source
        <textarea
          aria-label={`${labelPrefix} fragment source`}
          spellCheck={false}
          value={source}
          onChange={(event) => {
            changeSource(event.target.value);
          }}
        />
      </label>
      {source !== element.fragmentSource && (
        <p className="inspector-hint">Source has unapplied changes.</p>
      )}
      {error && (
        <p className="shader-source-error" role="alert">
          {error}
        </p>
      )}
      {!inspection.valid && (
        <p className="shader-source-error" role="alert">
          {inspection.errors.join('\n')}
        </p>
      )}
      <p className="inspector-hint">
        Example: #pragma ograf intensity slider min(0.0) max(5.0) step(0.1)
      </p>
      <p className="inspector-hint">
        Single Image pass with iTime, iResolution, optional iChannel0 and iChannelResolution. Video,
        audio, feedback buffers and additional channels are not supported.
      </p>
    </div>
  );
}
