import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { readColor } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { isColorSamplingTargetCurrent, type ColorSamplingTarget } from './colorSamplingTarget';
import { formatColor, hsvToRgb, rgbToHsv, type RGB } from './colorMath';
import { parseColorHexDraft } from './colorHex';
import './ColorInput.css';

const RECENT_KEY = 'ograf-recent-colors';
function recentColors(doc: Document): string[] {
  try {
    const data = JSON.parse(doc.defaultView?.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(data)
      ? data.filter((v): v is string => typeof v === 'string' && !!readColor(v)).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
function rememberColor(doc: Document, color: string): string[] {
  const next = [color, ...recentColors(doc).filter((item) => item !== color)].slice(0, 12);
  try {
    doc.defaultView?.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* local storage may be disabled */
  }
  return next;
}
function samplingTarget(root: HTMLElement | null) {
  const state = useProjectStore.getState();
  return {
    root,
    project: state.project,
    compositionId: state.activeCompositionId,
    selection: useSelectionStore.getState(),
  };
}
/** A single keyboard-accessible color editor used by Studio's color properties. */
export function ColorInput({
  value,
  onChange,
  label,
  alpha,
  disabled = false,
  onTokenSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  alpha?: boolean;
  disabled?: boolean;
  onTokenSelect?: (tokenId: string) => void;
}) {
  const root = useRef<HTMLSpanElement>(null),
    popup = useRef<HTMLDivElement>(null),
    hexInput = useRef<HTMLInputElement>(null),
    square = useRef<HTMLDivElement>(null);
  const parsed = readColor(value);
  const rgb: RGB = parsed ? [parsed.rgb[0]!, parsed.rgb[1]!, parsed.rgb[2]!] : [0, 0, 0];
  const opacity = Number.isFinite(parsed?.alpha) ? Math.max(0, Math.min(1, parsed!.alpha)) : 1;
  const alphaEnabled =
    alpha === true || /^#[\da-f]{4}$|^#[\da-f]{8}$/i.test(value.trim()) || opacity < 1;
  const allowAlpha = alpha !== false || alphaEnabled;
  const [hue, setHue] = useState(rgbToHsv(rgb)[0]);
  const hsv = rgbToHsv(rgb);
  if (hsv[1] === 0) hsv[0] = hue;
  const [draft, setDraft] = useState(value),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 }),
    [recent, setRecent] = useState<string[]>([]),
    [sampling, setSampling] = useState(false);
  useEffect(() => {
    setDraft(value);
    setError('');
    const parsedValue = readColor(value);
    if (parsedValue) {
      const h = rgbToHsv([parsedValue.rgb[0]!, parsedValue.rgb[1]!, parsedValue.rgb[2]!]);
      if (h[1] > 0) setHue(h[0]);
    }
  }, [value]);
  useEffect(() => {
    if (!open) return;
    const doc = root.current?.ownerDocument,
      win = doc?.defaultView;
    if (!doc || !win) return;
    const close = (event: PointerEvent) => {
      if (
        !sampling &&
        !root.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      ) {
        // Commit a focused hex edit before the portal is unmounted. Unmounting an
        // input does not reliably dispatch its blur event in every browser.
        if (doc.activeElement === hexInput.current) hexInput.current?.blur();
        setOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        setSampling(false);
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    doc.addEventListener('pointerdown', close, true);
    doc.addEventListener('keydown', key, true);
    return () => {
      doc.removeEventListener('pointerdown', close, true);
      doc.removeEventListener('keydown', key, true);
    };
  }, [open, sampling]);
  const recentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (recentTimer.current) clearTimeout(recentTimer.current);
    },
    [],
  );
  const publish = (next: string) => {
    setDraft(next);
    setError('');
    onChange(next);
    const doc = root.current?.ownerDocument;
    if (recentTimer.current) clearTimeout(recentTimer.current);
    if (doc) recentTimer.current = setTimeout(() => setRecent(rememberColor(doc, next)), 350);
  };
  const choose = (nextRgb: RGB, nextOpacity = opacity, forceAlpha = alphaEnabled) => {
    const chosenOpacity = allowAlpha ? nextOpacity : 1;
    publish(
      formatColor(nextRgb, chosenOpacity, allowAlpha && (forceAlpha || chosenOpacity < 1), value),
    );
  };
  const sampleTarget = useRef<ColorSamplingTarget | null>(null);
  const sampleColor = useRef<(pixels: Uint8ClampedArray) => void>(() => {});
  sampleColor.current = (pixels) =>
    choose([pixels[0]!, pixels[1]!, pixels[2]!], pixels[3]! / 255, allowAlpha && pixels[3]! < 255);
  const setHsv = (h: number, s: number, v: number) => {
    setHue(h);
    choose(hsvToRgb([h, s, v]));
  };
  const commitHex = () => {
    if (draft === value) {
      setError('');
      return;
    }
    const next = parseColorHexDraft(draft, allowAlpha, alphaEnabled, opacity);
    if (next === null) {
      setError(allowAlpha ? 'Use #RRGGBB or #RRGGBBAA.' : 'Use #RRGGBB.');
      return;
    }
    publish(next);
  };
  const show = () => {
    const el = root.current;
    if (!el) return;
    const rect = el.getBoundingClientRect(),
      win = el.ownerDocument.defaultView!;
    setPosition({
      left: Math.max(6, Math.min(rect.left, win.innerWidth - 290)),
      top: Math.max(6, Math.min(rect.bottom + 4, win.innerHeight - 430)),
    });
    setRecent(recentColors(el.ownerDocument));
    setDraft(value);
    setError('');
    setOpen(true);
  };
  const handleSquare = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHsv(
      hsv[0],
      Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    );
  };

  const pickScreen = async () => {
    const initialTarget = samplingTarget(root.current);
    const doc = root.current?.ownerDocument,
      win = doc?.defaultView;
    if (!doc || !win) return;
    const ctor = (
      win as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    if (ctor) {
      try {
        const picked = await new ctor().open();
        const c = readColor(picked.sRGBHex);
        if (c && isColorSamplingTargetCurrent(initialTarget, samplingTarget(root.current)))
          choose([c.rgb[0]!, c.rgb[1]!, c.rgb[2]!]);
      } catch {
        /* cancelled */
      }
      return;
    }
    sampleTarget.current = initialTarget;
    setSampling(true);
  };
  useEffect(() => {
    if (!sampling) return;
    const doc = root.current?.ownerDocument;
    if (!doc) return;
    const handler = async (event: PointerEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setSampling(false);
      const initialTarget = sampleTarget.current;
      sampleTarget.current = null;
      if (
        !initialTarget ||
        !isColorSamplingTargetCurrent(initialTarget, samplingTarget(root.current))
      )
        return;
      const stage = doc.querySelector<HTMLElement>('.canvas-stage-frame');
      const rect = stage?.getBoundingClientRect();
      if (
        !stage ||
        !rect ||
        event.clientX < rect.left ||
        event.clientX >= rect.right ||
        event.clientY < rect.top ||
        event.clientY >= rect.bottom
      ) {
        setError('Click inside the Studio canvas to sample a color.');
        return;
      }
      if (stage.querySelector('video, [data-ograf-media-canvas]')) {
        setError('Live or video media cannot be sampled reliably. Use the system eyedropper.');
        return;
      }
      try {
        if (stage.querySelector('[data-ograf-shader-canvas]')) {
          const { sampleLiveShaderStage } = await import('./sampleLiveShaderStage');
          const state = useProjectStore.getState();
          const composition = state.project.compositions.find(
            (item) => item.id === state.activeCompositionId,
          );
          const pixel = await sampleLiveShaderStage(
            stage,
            event.clientX,
            event.clientY,
            composition?.assets ?? [],
          );
          if (isColorSamplingTargetCurrent(initialTarget, samplingTarget(root.current)))
            sampleColor.current(pixel);
          return;
        }
        const { toCanvas } = await import('html-to-image');
        const canvas = await toCanvas(stage, { pixelRatio: 1 });
        const data = canvas
          .getContext('2d')!
          .getImageData(
            Math.floor(((event.clientX - rect.left) * canvas.width) / rect.width),
            Math.floor(((event.clientY - rect.top) * canvas.height) / rect.height),
            1,
            1,
          ).data;
        if (isColorSamplingTargetCurrent(initialTarget, samplingTarget(root.current)))
          sampleColor.current(data);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Cannot sample this canvas; try the system eyedropper.',
        );
      }
    };
    doc.addEventListener('pointerdown', handler, true);
    return () => doc.removeEventListener('pointerdown', handler, true);
  }, [sampling]);
  const doc = root.current?.ownerDocument;
  const state = useProjectStore.getState?.();
  const composition = state?.project?.compositions?.find((c) => c.id === state.activeCompositionId);
  const swatches = (composition?.designSystem?.tokens ?? []).filter(
    (t) => t.type === 'color' && typeof t.value === 'string' && !!readColor(t.value),
  );
  return (
    <span className="color-input" ref={root} role="group" aria-label={label}>
      <button
        type="button"
        className="color-input-picker"
        aria-label={`Choose ${label}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span style={{ background: value }} />
      </button>
      {open &&
        doc &&
        createPortal(
          <div
            ref={popup}
            className="color-input-popover"
            role="dialog"
            aria-label={`${label} color picker`}
            style={{ left: position.left, top: position.top }}
          >
            <label className="color-input-hex-row">
              Hex
              <input
                ref={hexInput}
                className="color-input-hex"
                type="text"
                aria-label={`${label} hex`}
                aria-invalid={!!error}
                title={error || 'Hex color'}
                value={draft}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  setError('');
                }}
                onBlur={commitHex}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    commitHex();
                  }
                }}
              />
            </label>
            {error && (
              <small className="color-input-error" role="alert">
                {error}
              </small>
            )}
            <div
              className="color-input-sv"
              ref={square}
              role="slider"
              tabIndex={0}
              aria-label="Saturation and brightness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv[1] * 100)}
              aria-valuetext={`${Math.round(hsv[1] * 100)}% saturation, ${Math.round(hsv[2] * 100)}% brightness`}
              style={{ backgroundColor: `hsl(${hsv[0]} 100% 50%)` }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                handleSquare(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) handleSquare(e);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.1 : 0.01;
                if (e.key === 'ArrowLeft') setHsv(hsv[0], Math.max(0, hsv[1] - step), hsv[2]);
                else if (e.key === 'ArrowRight') setHsv(hsv[0], Math.min(1, hsv[1] + step), hsv[2]);
                else if (e.key === 'ArrowUp') setHsv(hsv[0], hsv[1], Math.min(1, hsv[2] + step));
                else if (e.key === 'ArrowDown') setHsv(hsv[0], hsv[1], Math.max(0, hsv[2] - step));
                else return;
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <span
                className="color-input-sv-cursor"
                style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }}
              />
            </div>
            <label>
              Hue{' '}
              <input
                aria-label="Hue"
                type="range"
                min={0}
                max={359}
                value={Math.round(hsv[0])}
                onChange={(e) => setHsv(Number(e.currentTarget.value), hsv[1], hsv[2])}
              />
            </label>
            {allowAlpha && (
              <label>
                Opacity{' '}
                <input
                  aria-label={`${label} opacity`}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => choose(rgb, Number(e.currentTarget.value) / 100, true)}
                />
                <output>{Math.round(opacity * 100)}%</output>
              </label>
            )}
            <div className="color-input-fields">
              {rgb.map((n, i) => (
                <label key={i}>
                  {['R', 'G', 'B'][i]}
                  <input
                    aria-label={['Red', 'Green', 'Blue'][i]}
                    type="number"
                    min={0}
                    max={255}
                    value={Math.round(n)}
                    onChange={(e) => {
                      const c = [...rgb] as RGB;
                      c[i] = Math.max(0, Math.min(255, Number(e.currentTarget.value)));
                      choose(c);
                    }}
                  />
                </label>
              ))}
              {hsv.map((n, i) => (
                <label key={i}>
                  {['H', 'S', 'B'][i]}
                  <input
                    aria-label={['Hue degrees', 'Saturation percent', 'Brightness percent'][i]}
                    type="number"
                    min={0}
                    max={i === 0 ? 359 : 100}
                    value={Math.round(i === 0 ? n : n * 100)}
                    onChange={(e) => {
                      const next = [...hsv];
                      next[i] = Number(e.currentTarget.value) / (i === 0 ? 1 : 100);
                      setHsv(next[0]!, next[1]!, next[2]!);
                    }}
                  />
                </label>
              ))}
            </div>
            <button type="button" onClick={() => void pickScreen()}>
              {sampling ? 'Click the canvas…' : 'Eyedropper'}
            </button>
            {swatches.length > 0 && (
              <>
                <small>Brand Kit{onTokenSelect ? ' · links token' : ''}</small>
                <div className="color-input-swatches">
                  {swatches.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      title={t.name}
                      aria-label={`Brand color ${t.name}`}
                      style={{ background: String(t.value) }}
                      onClick={() => {
                        if (onTokenSelect) onTokenSelect(t.id);
                        else {
                          const c = readColor(t.value);
                          if (c)
                            choose(
                              [c.rgb[0]!, c.rgb[1]!, c.rgb[2]!],
                              c.alpha,
                              alphaEnabled || c.alpha < 1,
                            );
                        }
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {recent.length > 0 && (
              <>
                <small>Recent</small>
                <div className="color-input-swatches">
                  {recent.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-label={`Recent color ${c}`}
                      style={{ background: c }}
                      onClick={() => {
                        const x = readColor(c);
                        if (x)
                          choose(
                            [x.rgb[0]!, x.rgb[1]!, x.rgb[2]!],
                            x.alpha,
                            alphaEnabled || x.alpha < 1,
                          );
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>,
          doc.fullscreenElement ?? doc.body,
        )}
    </span>
  );
}
