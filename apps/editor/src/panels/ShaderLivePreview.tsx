import { useLayoutEffect, useRef, useState } from 'react';
import type { ShaderPaint } from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { ShaderLivePreviewController } from './shaderLivePreviewController';
import './ShaderLivePreview.css';

export interface ShaderLivePreviewProps {
  paint: ShaderPaint;
  label: string;
}

export function ShaderLivePreview({ paint, label }: ShaderLivePreviewProps) {
  const { document: ownerDocument, window: ownerWindow } = useEditorWindow();
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ShaderLivePreviewController | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!host.current) return;
    const preview = new ShaderLivePreviewController(
      host.current,
      { document: ownerDocument, window: ownerWindow },
      setError,
    );
    controller.current = preview;
    return () => {
      if (controller.current === preview) controller.current = null;
      preview.dispose();
    };
  }, [ownerDocument, ownerWindow]);
  useLayoutEffect(() => {
    controller.current?.update(paint);
  }, [ownerDocument, ownerWindow, paint]);
  const summary = error?.split(/\r?\n/)[0]?.slice(0, 180);
  return (
    <div className="shader-live-preview">
      <div
        className="shader-live-preview-surface"
        ref={host}
        role="img"
        aria-label={`${label} animated shader preview`}
      />
      {error && (
        <div className="shader-live-preview-error" role="alert" title={error}>
          <strong>Preview unavailable</strong>
          <span>{summary}</span>
        </div>
      )}
    </div>
  );
}
