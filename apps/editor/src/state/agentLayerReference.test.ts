import { describe, expect, it } from 'vitest';
import {
  decodeAgentLayerReference,
  encodeAgentLayerReference,
  selectedLayerReferences,
  type AgentLayerReference,
} from './agentLayerReference';
import { createComposition, createLayerOfKind } from '@ograf-editor/scene-model';

describe('agent layer drag reference', () => {
  it('round-trips a layer reference', () => {
    const reference: AgentLayerReference = {
      layerId: 'layer-headline',
      name: 'Headline',
      elementType: 'text',
      selectedProperty: 'fill',
      selectedKeyframeId: 'key-12',
    };
    expect(decodeAgentLayerReference(encodeAgentLayerReference(reference))).toEqual(reference);
  });

  it('rejects malformed and incomplete drag payloads', () => {
    expect(decodeAgentLayerReference('{broken')).toBeNull();
    expect(decodeAgentLayerReference(JSON.stringify({ layerId: 'layer-1' }))).toBeNull();
  });

  it('maps single and multi-selection to references with primary timeline detail', () => {
    const first = createLayerOfKind('rectangle');
    const second = createLayerOfKind('text');
    first.name = 'Panel';
    second.name = 'Headline';
    const composition = createComposition({ layers: [first, second] });
    expect(
      selectedLayerReferences(
        composition,
        [first.id, second.id, 'missing'],
        second.id,
        'strokeWidth',
        'headline-key',
      ),
    ).toEqual([
      { layerId: first.id, name: 'Panel', elementType: 'rectangle' },
      {
        layerId: second.id,
        name: 'Headline',
        elementType: 'text',
        selectedProperty: 'strokeWidth',
        selectedKeyframeId: 'headline-key',
      },
    ]);
  });
});
