import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerEffects,
  createShaderPaint,
  createTextElement,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { resolveLayerBindingElement } from './runtimeBindings';

const fragmentSource = `#pragma ograf amount slider min(0) max(10)
const float amount = 1.;
void mainImage(out vec4 c, in vec2 p) { c = vec4(amount); }`;
function layer(): CompiledLayer {
  return {
    id: 'bound',
    isVisible: true,
    element: createTextElement({ content: 'Before', fill: createShaderPaint({ fragmentSource }) }),
    effects: createLayerEffects(),
    keyframes: [{ id: 'start', frame: 0, transform: createDefaultTransform(), easing: 'linear' }],
    animationTracks: {},
    bindings: [],
  };
}

describe('ordered runtime binding batches', () => {
  it('retains value maps, source paths, missing values, item indices and repeated writes', () => {
    const bound = layer();
    bound.bindings = [
      { dataKey: 'level', targetProperty: 'fill.parameters.amount', valueMap: { high: 4 } },
      { dataKey: 'missing', targetProperty: 'fill.parameters.amount' },
      { dataKey: 'rows', itemIndex: 1, sourcePath: ['name'], targetProperty: 'content' },
      { dataKey: 'last', targetProperty: 'fill.parameters.amount' },
    ];
    expect(
      resolveLayerBindingElement(bound, {
        level: 'high',
        rows: [{ name: 'Wrong' }, { name: 'Shown' }],
        last: 7,
      }),
    ).toMatchObject({
      content: 'Shown',
      fill: { parameters: { amount: 7 } },
    });
    expect(bound.element).toMatchObject({ content: 'Before', fill: { parameters: {} } });
  });

  it('does not read later bindings after an earlier invalid shader value', () => {
    const bound = layer();
    const later = () => {
      throw new Error('Later binding must not be read.');
    };
    bound.bindings = [
      { dataKey: 'invalid', targetProperty: 'fill.parameters.amount' },
      { dataKey: 'later', targetProperty: 'content' },
    ];
    const data = {
      invalid: 'not-a-number',
      get later() {
        return later();
      },
    };
    expect(() => resolveLayerBindingElement(bound, data)).toThrow('amount');
    expect(() => resolveLayerBindingElement(bound, data)).not.toThrow('Later binding');
  });
});
