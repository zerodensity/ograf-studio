import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  patternRows,
  patternRowOffset,
  tilingSvgContent,
  type TilingPattern,
} from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import './PatternPreview.css';

export interface PatternPreviewProps {
  pattern: TilingPattern;
  frameRate: number;
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  showControls?: boolean;
  className?: string;
}

/** Small, local SVG preview. Its clock never changes the scene, playhead, or undo history. */
export function PatternPreview({
  pattern,
  frameRate,
  playing,
  onPlayingChange,
  showControls = false,
  className = '',
}: PatternPreviewProps) {
  const { window: ownerWindow, document: ownerDocument } = useEditorWindow();
  const id = `pattern-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const svg = useRef<SVGSVGElement>(null);
  const elapsedMs = useRef(0);
  const resetGeneration = useRef(0);
  const previousPatternId = useRef(pattern.id);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [reset, setReset] = useState(0);
  const active = playing ?? localPlaying;
  const preview = useMemo(() => {
    try {
      const symbols = new Map(pattern.symbols.map((symbol) => [symbol.key, symbol]));
      const complexity =
        pattern.sequence.reduce(
          (total, entry) => total + (symbols.get(entry.symbolKey)?.d.length ?? 0),
          0,
        ) * pattern.rows;
      if (pattern.rows > 32 || pattern.sequence.length > 64 || complexity > 1_000_000)
        throw new Error('This pattern is too detailed for a small preview.');
      const rows = patternRows(pattern);
      return {
        rows,
        error: '',
        markup: tilingSvgContent(
          {
            type: 'pattern',
            patternId: pattern.id,
            definition: pattern,
            fill: '#a6bbff',
            strokeColor: 'none',
            strokeWidth: 0,
          },
          id,
        ),
      };
    } catch (error) {
      return {
        rows: [],
        markup: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [id, pattern]);
  const moving = preview.rows.some((row) => row.cycles > 0);
  useLayoutEffect(() => {
    if (previousPatternId.current !== pattern.id) {
      elapsedMs.current = 0;
      previousPatternId.current = pattern.id;
    }
    const origin = ownerWindow.performance.now();
    const start = elapsedMs.current;
    const generation = resetGeneration.current;
    let request = 0,
      lastDraw = -Infinity;
    const update = (now: number) => {
      const elapsed = start + (active && moving ? Math.max(0, now - origin) : 0);
      if (now - lastDraw >= 1000 / 30) {
        const frame = (elapsed * frameRate) / 1000;
        for (const row of preview.rows)
          svg.current
            ?.querySelector(`[data-ograf-pattern-row="${row.row}"]`)
            ?.setAttribute('x', String(patternRowOffset(pattern, row, frame)));
        lastDraw = now;
      }
      if (active && moving && ownerDocument.visibilityState !== 'hidden')
        request = ownerWindow.requestAnimationFrame(update);
    };
    const resume = () => {
      ownerWindow.cancelAnimationFrame(request);
      update(ownerWindow.performance.now());
    };
    const preserveElapsedUnlessReset = () => {
      if (generation === resetGeneration.current && active && moving)
        elapsedMs.current = start + Math.max(0, ownerWindow.performance.now() - origin);
    };
    update(origin);
    ownerDocument.addEventListener('visibilitychange', resume);
    return () => {
      ownerWindow.cancelAnimationFrame(request);
      ownerDocument.removeEventListener('visibilitychange', resume);
      preserveElapsedUnlessReset();
    };
  }, [active, moving, pattern, frameRate, ownerWindow, ownerDocument, preview.rows, reset]);
  const setPlaying = (next: boolean) => {
    if (playing === undefined) setLocalPlaying(next);
    onPlayingChange?.(next);
  };
  return (
    <div className={`pattern-preview ${className}`}>
      {preview.error ? (
        <div
          className="pattern-preview-error"
          role="img"
          aria-label={`Pattern preview unavailable: ${preview.error}`}
        >
          {preview.error}
        </div>
      ) : (
        <svg
          ref={svg}
          viewBox={`0 0 ${pattern.width} ${pattern.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${pattern.name} pattern preview`}
          dangerouslySetInnerHTML={{ __html: preview.markup }}
        />
      )}
      {showControls && (
        <div className="pattern-preview-controls">
          <button
            type="button"
            onClick={() => setPlaying(!active)}
            disabled={!moving || !!preview.error}
            title={!moving ? 'Enable Animate in the pattern editor to add motion.' : undefined}
          >
            {active && moving ? 'Pause preview' : 'Play preview'}
          </button>
          <button
            type="button"
            onClick={() => {
              resetGeneration.current++;
              elapsedMs.current = 0;
              setReset((value) => value + 1);
            }}
            aria-label="Reset pattern preview"
          >
            Reset
          </button>
          <span>{moving ? 'Preview only' : 'Static pattern'}</span>
        </div>
      )}
    </div>
  );
}
