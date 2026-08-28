import { describe, expect, it } from 'vitest';
import { arrangeSelectedLayers, moveLayerToZOrder } from './layerZOrder';

describe('layer Z order', () => {
  const layerIds = ['back', 'middle', 'front'];

  it('moves a layer to the back at Z order 1', () => {
    expect(moveLayerToZOrder(layerIds, 'front', 1)).toEqual(['front', 'back', 'middle']);
  });

  it('moves a layer to the front at the highest Z order', () => {
    expect(moveLayerToZOrder(layerIds, 'back', 3)).toEqual(['middle', 'front', 'back']);
  });

  it('rounds and clamps values to the available paint-order range', () => {
    expect(moveLayerToZOrder(layerIds, 'middle', -20)).toEqual(['middle', 'back', 'front']);
    expect(moveLayerToZOrder(layerIds, 'middle', 99)).toEqual(['back', 'front', 'middle']);
    expect(moveLayerToZOrder(layerIds, 'back', 2.6)).toEqual(['middle', 'front', 'back']);
  });

  it('leaves the order unchanged when the layer does not exist', () => {
    expect(moveLayerToZOrder(layerIds, 'missing', 1)).toEqual(layerIds);
  });
});

describe('layer arrangement', () => {
  const layerIds = ['back', 'lower', 'upper', 'front'];

  it('sends a multi-selection to the back while preserving its relative order', () => {
    expect(arrangeSelectedLayers(layerIds, ['lower', 'front'], 'send-to-back')).toEqual([
      'lower',
      'front',
      'back',
      'upper',
    ]);
  });

  it('brings a multi-selection to the front while preserving its relative order', () => {
    expect(arrangeSelectedLayers(layerIds, ['back', 'upper'], 'bring-to-front')).toEqual([
      'lower',
      'front',
      'back',
      'upper',
    ]);
  });

  it('sends each selected run backward by one unselected layer', () => {
    expect(arrangeSelectedLayers(layerIds, ['lower', 'upper'], 'send-backward')).toEqual([
      'lower',
      'upper',
      'back',
      'front',
    ]);
  });

  it('brings each selected run forward by one unselected layer', () => {
    expect(arrangeSelectedLayers(layerIds, ['lower', 'upper'], 'bring-forward')).toEqual([
      'back',
      'front',
      'lower',
      'upper',
    ]);
  });

  it('ignores unknown selections and preserves an already terminal selection', () => {
    expect(arrangeSelectedLayers(layerIds, ['missing'], 'bring-to-front')).toEqual(layerIds);
    expect(arrangeSelectedLayers(layerIds, ['front'], 'bring-forward')).toEqual(layerIds);
  });
});
