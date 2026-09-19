import { useEffect, useMemo, useRef, useState } from 'react';
import {
  inspectShaderSource,
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
  labelPrefix,
}: {
  definition: ShaderParameterDefinition;
  value: ShaderParameterValue;
  onChange: (value: ShaderParameterValue) => void;
  labelPrefix: string;
}) {
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
            value={value as number}
            onChange={(event) => onChange(Number(event.target.value))}
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
}: Props) {
  const [source, setSource] = useState(draftSource ?? element.fragmentSource);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
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
          onChange={(value) => {
            try {
              onChange({
                parameters: {
                  [definition.name]: normalizeShaderParameterValue(definition, value),
                },
              });
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
        Single Image pass with iTime and iResolution. Texture channels and feedback buffers are not
        supported.
      </p>
    </div>
  );
}
