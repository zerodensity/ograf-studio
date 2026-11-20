import { useEffect, useState } from 'react';
import { initialStartupSettings, type StartupSettings } from '../state/startupCreation';
import type { StartupRequest } from '../state/startupScreenStore';
import {
  resolveStartupSettings,
  STARTUP_FRAME_RATES,
  STARTUP_SIZES,
  startupRateLabel,
} from './startupSettings';

export interface StartupSettingsDraft {
  size: string;
  rate: string;
  width: string;
  height: string;
  customRate: string;
  setSize(value: string): void;
  setRate(value: string): void;
  setWidth(value: string): void;
  setHeight(value: string): void;
  setCustomRate(value: string): void;
  /** The typed values as settings, or `null` while they are not a valid canvas and frame rate. */
  resolve(): StartupSettings | null;
}

/** The canvas size and frame rate being chosen for a new document, reset for each request. */
export function useStartupSettingsDraft(
  request: StartupRequest | null,
  visible: boolean,
): StartupSettingsDraft {
  const [size, setSizeValue] = useState('1920x1080');
  const [rate, setRateValue] = useState('50');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [customRate, setCustomRate] = useState('50');
  useEffect(() => {
    if (!visible || !request) return;
    const initial = initialStartupSettings(request);
    const sizeKey = `${initial.width}x${initial.height}`;
    setSizeValue(
      STARTUP_SIZES.some((preset) => `${preset.width}x${preset.height}` === sizeKey)
        ? sizeKey
        : 'custom',
    );
    setWidth(String(initial.width));
    setHeight(String(initial.height));
    setRateValue(
      STARTUP_FRAME_RATES.includes(initial.frameRate) ? String(initial.frameRate) : 'custom',
    );
    setCustomRate(String(initial.frameRate));
  }, [visible, request]);
  return {
    size,
    rate,
    width,
    height,
    customRate,
    setSize: (value) => {
      setSizeValue(value);
      if (value === 'custom') return;
      const chosen = STARTUP_SIZES.find((preset) => `${preset.width}x${preset.height}` === value);
      if (chosen) {
        setWidth(String(chosen.width));
        setHeight(String(chosen.height));
      }
    },
    setRate: (value) => {
      if (value !== 'custom') setCustomRate(value);
      setRateValue(value);
    },
    setWidth,
    setHeight,
    setCustomRate,
    resolve: () => resolveStartupSettings(width, height, rate === 'custom' ? customRate : rate),
  };
}

/** Canvas size and frame rate pickers, shared by every window that creates a document. */
export function StartupSettingsFields({ draft }: { draft: StartupSettingsDraft }) {
  return (
    <>
      <label>
        Canvas size{' '}
        <select value={draft.size} onChange={(event) => draft.setSize(event.currentTarget.value)}>
          {STARTUP_SIZES.map((preset) => (
            <option
              key={`${preset.width}x${preset.height}`}
              value={`${preset.width}x${preset.height}`}
            >
              {preset.width} × {preset.height}
              {preset.width * 16 === preset.height * 9 ? ' · 9:16' : ''}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {draft.size === 'custom' && (
        <>
          <label>
            Width (px)
            <input
              type="number"
              min="1"
              step="1"
              value={draft.width}
              onChange={(event) => draft.setWidth(event.currentTarget.value)}
            />
          </label>
          <label>
            Height (px)
            <input
              type="number"
              min="1"
              step="1"
              value={draft.height}
              onChange={(event) => draft.setHeight(event.currentTarget.value)}
            />
          </label>
        </>
      )}
      <label>
        Frame rate{' '}
        <select value={draft.rate} onChange={(event) => draft.setRate(event.currentTarget.value)}>
          {STARTUP_FRAME_RATES.map((fps) => (
            <option key={fps} value={String(fps)}>
              {startupRateLabel(fps)} fps
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {draft.rate === 'custom' && (
        <label>
          Custom frame rate (fps)
          <input
            type="number"
            min="0"
            step="any"
            value={draft.customRate}
            onChange={(event) => draft.setCustomRate(event.currentTarget.value)}
          />
        </label>
      )}
    </>
  );
}
