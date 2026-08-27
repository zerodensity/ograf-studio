export const AGENT_LAYER_REFERENCE_MIME = 'application/x-ograf-studio-layer-reference';

export interface AgentLayerReference {
  layerId: string;
  name: string;
  elementType: string;
  selectedProperty?: string;
  selectedKeyframeId?: string;
}

export function encodeAgentLayerReference(reference: AgentLayerReference): string {
  return JSON.stringify(reference);
}

export function decodeAgentLayerReference(value: string): AgentLayerReference | null {
  try {
    const parsed = JSON.parse(value) as Partial<AgentLayerReference>;
    if (
      typeof parsed.layerId !== 'string' ||
      !parsed.layerId ||
      typeof parsed.name !== 'string' ||
      !parsed.name ||
      typeof parsed.elementType !== 'string' ||
      !parsed.elementType
    ) {
      return null;
    }
    return {
      layerId: parsed.layerId.slice(0, 200),
      name: parsed.name.slice(0, 200),
      elementType: parsed.elementType.slice(0, 80),
      ...(typeof parsed.selectedProperty === 'string' && parsed.selectedProperty
        ? { selectedProperty: parsed.selectedProperty.slice(0, 120) }
        : {}),
      ...(typeof parsed.selectedKeyframeId === 'string' && parsed.selectedKeyframeId
        ? { selectedKeyframeId: parsed.selectedKeyframeId.slice(0, 200) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function selectedLayerReferences(
  composition: Composition,
  selectedLayerIds: string[],
  primaryLayerId: string | null,
  selectedProperty: AnimatableLayerProperty | null,
  selectedKeyframeId: string | null,
): AgentLayerReference[] {
  return selectedLayerIds.flatMap((layerId) => {
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return [];
    return [
      {
        layerId: layer.id,
        name: layer.name,
        elementType: layer.element.type,
        ...(layer.id === primaryLayerId && selectedProperty ? { selectedProperty } : {}),
        ...(layer.id === primaryLayerId && selectedKeyframeId ? { selectedKeyframeId } : {}),
      },
    ];
  });
}
import type { AnimatableLayerProperty, Composition } from '@ograf-editor/scene-model';
