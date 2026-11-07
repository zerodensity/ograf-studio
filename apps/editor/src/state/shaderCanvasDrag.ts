import {
  validateRendererPluginReference,
  type Project,
  type StudioPluginReference,
} from '@ograf-editor/scene-model';
import { SHADER_RESOURCE_MIME } from './shaderDrag';

export const SHADER_PLUGIN_PRESET_MIME = 'application/x-ograf-shader-plugin-preset';
const MAX_PAYLOAD_BYTES = 4096;
const MAX_IDENTIFIER_LENGTH = 256;

export interface ShaderPluginPresetDragReference {
  reference: StudioPluginReference;
  presetId: string;
}

export type ShaderCanvasDragData = {
  kind: 'resource' | 'plugin';
  payload: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_IDENTIFIER_LENGTH && value.trim().length > 0
  );
}

function assertPayloadSize(payload: string): void {
  if (
    typeof payload !== 'string' ||
    payload.length > MAX_PAYLOAD_BYTES ||
    new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES
  ) {
    throw new Error('Shader plugin drag data exceeds its 4096-byte limit.');
  }
}

function validateReference(
  value: unknown,
): ShaderPluginPresetDragReference & { projectId: string } {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !['kind', 'projectId', 'reference', 'presetId'].includes(key),
    ) ||
    value.kind !== 'shader-pack' ||
    !identifier(value.projectId) ||
    !identifier(value.presetId) ||
    !record(value.reference) ||
    Object.keys(value.reference).some((key) => !['id', 'version', 'sha256'].includes(key)) ||
    !identifier(value.reference.id) ||
    !identifier(value.reference.version) ||
    validateRendererPluginReference(value.reference).length > 0
  ) {
    throw new Error('Invalid shader plugin preset drag reference.');
  }
  return {
    projectId: value.projectId,
    reference: {
      id: value.reference.id,
      version: value.reference.version,
      sha256: value.reference.sha256 as string,
    },
    presetId: value.presetId,
  };
}

/** Drag identities only. The drop transaction must resolve and recheck the exact installed bytes. */
export function encodeShaderPluginPresetDrag(
  projectId: string,
  reference: StudioPluginReference,
  presetId: string,
): string {
  const validated = validateReference({ kind: 'shader-pack', projectId, reference, presetId });
  const payload = JSON.stringify({ kind: 'shader-pack', ...validated });
  assertPayloadSize(payload);
  return payload;
}

/** Pure payload validation, not authorization to install, trust or execute a plugin. */
export function decodeShaderPluginPresetDrag(
  project: Project,
  payload: string,
): ShaderPluginPresetDragReference {
  assertPayloadSize(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Invalid shader plugin preset drag JSON.');
  }
  const { projectId, ...reference } = validateReference(parsed);
  if (projectId !== project.id)
    throw new Error('This shader preset drag belongs to a different project.');
  return reference;
}

/** Files never win over an explicit shader identity, including drags from detached editor panes. */
export function hasShaderCanvasDrag(types: readonly string[]): boolean {
  return types.includes(SHADER_RESOURCE_MIME) || types.includes(SHADER_PLUGIN_PRESET_MIME);
}

export function shaderCanvasDragData(
  transfer: Pick<DataTransfer, 'types' | 'getData'>,
): ShaderCanvasDragData | null {
  if (transfer.types.includes(SHADER_RESOURCE_MIME))
    return { kind: 'resource', payload: transfer.getData(SHADER_RESOURCE_MIME) };
  if (transfer.types.includes(SHADER_PLUGIN_PRESET_MIME))
    return { kind: 'plugin', payload: transfer.getData(SHADER_PLUGIN_PRESET_MIME) };
  return null;
}
