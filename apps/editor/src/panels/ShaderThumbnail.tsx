import { useEffect, useMemo, useState } from 'react';
import type { ShaderPaint } from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  scheduleShaderThumbnail,
  shaderThumbnailKey,
  type ShaderThumbnailResult,
} from './shaderThumbnailCache';
import './ShaderThumbnail.css';

export interface ShaderThumbnailProps {
  paint: ShaderPaint;
  label: string;
}

export function ShaderThumbnail({ paint, label }: ShaderThumbnailProps) {
  const { document: ownerDocument, window: ownerWindow } = useEditorWindow();
  const key = useMemo(() => shaderThumbnailKey(paint), [paint]);
  const [snapshot, setSnapshot] = useState<{ key: string; result: ShaderThumbnailResult } | null>(
    null,
  );
  useEffect(
    () =>
      scheduleShaderThumbnail({ document: ownerDocument, window: ownerWindow }, paint, (result) =>
        setSnapshot({ key, result }),
      ),
    [key, ownerDocument, ownerWindow, paint],
  );
  const result = snapshot?.key === key ? snapshot.result : undefined;
  if (result?.kind === 'ready') {
    return (
      <span className="shader-thumbnail" title={`${label} — preview at 2 seconds`}>
        <img
          src={result.dataUrl}
          alt={`${label} shader preview`}
          width={80}
          height={45}
          draggable={false}
        />
      </span>
    );
  }
  const message =
    result?.kind === 'error'
      ? result.message.split(/\r?\n/)[0]!.slice(0, 240)
      : 'Preparing shader preview';
  return (
    <span
      className={`shader-thumbnail${result?.kind === 'error' ? ' shader-thumbnail-error' : ''}`}
      role="img"
      aria-label={`${label}: ${message}`}
      title={`${label}: ${message}`}
    >
      <span aria-hidden="true">{result?.kind === 'error' ? 'Shader error' : '…'}</span>
    </span>
  );
}
