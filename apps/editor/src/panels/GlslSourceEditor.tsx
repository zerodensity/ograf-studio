import { useLayoutEffect, useMemo, useRef } from 'react';
import { tokenizeGlsl } from './glslHighlight';
import './GlslSourceEditor.css';

/** A native editable textarea over a non-interactive, highlighted copy of its exact text. */
export function GlslSourceEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const highlighted = useRef<HTMLElement>(null);
  const tokens = useMemo(() => tokenizeGlsl(value), [value]);
  const synchronizeScroll = () => {
    if (input.current && highlighted.current)
      highlighted.current.style.transform = `translate(${-input.current.scrollLeft}px, ${-input.current.scrollTop}px)`;
  };
  useLayoutEffect(synchronizeScroll, [value]);
  useLayoutEffect(() => {
    if (!input.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(synchronizeScroll);
    observer.observe(input.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="glsl-source-editor">
      <pre className="glsl-source-highlight" aria-hidden="true">
        <code className="glsl-source-text" ref={highlighted}>
          {tokens.map((token, index) =>
            token.kind ? (
              <span key={index} className={`glsl-token-${token.kind}`}>
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
          {'\n'}
        </code>
      </pre>
      <textarea
        ref={input}
        className="glsl-source-input"
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        wrap="off"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onScroll={synchronizeScroll}
      />
    </div>
  );
}
