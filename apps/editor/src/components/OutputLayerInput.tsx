import { useEffect, useId, useState } from 'react';
import { OUTPUT_LAYER_ERROR } from '@ograf-editor/scene-model';
import { parseOutputLayerInput } from './outputLayerInputValue';
import './OutputLayerInput.css';

export function OutputLayerInput({
  label,
  value,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const errorId = useId();
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(value));
    setInvalid(false);
    onValidityChange?.(true);
  }, [value, onValidityChange]);
  useEffect(() => () => onValidityChange?.(true), [onValidityChange]);
  return (
    <span className="output-layer-input">
      <input
        type="number"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        min={Number.MIN_SAFE_INTEGER}
        max={Number.MAX_SAFE_INTEGER}
        step={1}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const next = parseOutputLayerInput(nextText);
          setInvalid(next === null);
          onValidityChange?.(next !== null);
          if (next !== null) onChange(next);
        }}
        onBlur={() => {
          if (!invalid) setText(String(value));
        }}
      />
      {invalid && (
        <small id={errorId} role="alert">
          {OUTPUT_LAYER_ERROR}
        </small>
      )}
    </span>
  );
}
