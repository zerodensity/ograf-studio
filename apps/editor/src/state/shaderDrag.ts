import type { Project, ShaderPaint } from '@ograf-editor/scene-model';
import { resolveShaderResource, type ShaderResourceTarget } from './shaderResources';

export const SHADER_RESOURCE_MIME = 'application/x-ograf-shader-resource';
const MAX_PAYLOAD_BYTES = 4096;
const MAX_IDENTIFIER_LENGTH = 256;

interface ShaderResourceDragReference {
  projectId: string;
  target: ShaderResourceTarget;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_IDENTIFIER_LENGTH && value.trim().length > 0
  );
}

function validateReference(value: unknown): ShaderResourceDragReference {
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== 'projectId' && key !== 'target') ||
    !identifier(value.projectId) ||
    !record(value.target)
  ) {
    throw new Error('Invalid shader resource drag reference.');
  }
  const target = value.target;
  if (
    Object.keys(target).some(
      (key) => !['compositionId', 'layerId', 'slot', 'componentId'].includes(key),
    ) ||
    !identifier(target.compositionId) ||
    !identifier(target.layerId) ||
    (target.slot !== 'fill' && target.slot !== 'stroke') ||
    ('componentId' in target && !identifier(target.componentId))
  ) {
    throw new Error('Invalid shader resource drag target.');
  }
  return {
    projectId: value.projectId,
    target: {
      compositionId: target.compositionId,
      layerId: target.layerId,
      slot: target.slot,
      ...(typeof target.componentId === 'string' ? { componentId: target.componentId } : {}),
    },
  };
}

function assertPayloadSize(payload: string): void {
  if (
    typeof payload !== 'string' ||
    payload.length > MAX_PAYLOAD_BYTES ||
    new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES
  ) {
    throw new Error('Shader resource drag data exceeds its 4096-byte limit.');
  }
}

/** Transfer only canonical identity; dropping resolves the latest source rather than a stale paint. */
export function encodeShaderResourceDrag(projectId: string, target: ShaderResourceTarget): string {
  const reference = validateReference({
    projectId,
    target: {
      compositionId: target.compositionId,
      layerId: target.layerId,
      slot: target.slot,
      ...(target.componentId !== undefined ? { componentId: target.componentId } : {}),
    },
  });
  const payload = JSON.stringify(reference);
  assertPayloadSize(payload);
  return payload;
}

/** A locked source remains copyable; modifying the target is governed by the target's own lock. */
export function shaderPaintFromResourceDrag(project: Project, payload: string): ShaderPaint {
  assertPayloadSize(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Invalid shader resource drag JSON.');
  }
  const reference = validateReference(parsed);
  if (reference.projectId !== project.id)
    throw new Error('This shader resource belongs to a different project.');
  return structuredClone(resolveShaderResource(project, reference.target).paint);
}
