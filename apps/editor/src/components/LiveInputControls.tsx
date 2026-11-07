import { useEffect, useId, useState } from 'react';
import { validLiveMediaInputName } from '../state/liveMediaInputs';
import { WebcamPreviewControls } from './WebcamPreviewControls';
import './LiveInputControls.css';

/** Source-first routing: a named input and the webcam preview share one destination. */
export function LiveInputControls({
  inputNames,
  initialName,
  currentName,
  destination,
  disabled = false,
  onUse,
}: {
  inputNames: string[];
  initialName: string;
  currentName?: string;
  destination?: string;
  disabled?: boolean;
  onUse: (name: string) => boolean;
}) {
  const [name, setName] = useState(currentName || initialName);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  useEffect(() => {
    setName(currentName || initialName);
    setCustom(false);
    setError('');
  }, [currentName, initialName, destination]);
  const choices = [...new Set([...inputNames, initialName, ...(currentName ? [currentName] : [])])];
  const valid = validLiveMediaInputName(name);
  const usingHere = !!destination && currentName === name.trim();
  const apply = () => {
    if (disabled || !valid) return false;
    const applied = onUse(name.trim());
    setError(applied ? '' : 'Select an unlocked object to use this input.');
    return applied;
  };

  return (
    <section className="live-input-controls" aria-label="Live input routing">
      <strong>Live input</strong>
      <label htmlFor={id}>Input</label>
      <div className="live-input-controls-row">
        <select
          id={id}
          value={custom ? '' : name}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setCustom(next === '');
            setError('');
            if (next !== '') setName(next);
          }}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
          <option value="">Other input…</option>
        </select>
        <button type="button" disabled={disabled || !valid || usingHere} onClick={apply}>
          {usingHere ? 'Using input here' : 'Use input here'}
        </button>
      </div>
      {custom && (
        <label className="live-input-name">
          Input name
          <input
            value={name}
            disabled={disabled}
            aria-invalid={!valid}
            placeholder="TextureInput1"
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
          />
        </label>
      )}
      {!valid && (
        <small role="alert">Use an input name without spaces, such as TextureInput1.</small>
      )}
      {error && <small role="alert">{error}</small>}
      <p role="status">
        {!destination
          ? 'Select one object to use a live input.'
          : usingHere
            ? `${name.trim()} → ${destination}`
            : `Use ${name.trim() || 'an input'} on ${destination}.`}
      </p>
      <small>
        Connect a texture input with this exact name in Nodos. Input names are case-sensitive.
      </small>
      <WebcamPreviewControls
        tag={name.trim()}
        disabled={disabled || !valid}
        onBeforeStart={apply}
      />
    </section>
  );
}
