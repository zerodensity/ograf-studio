import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createImageLayer,
  type Asset,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';

vi.hoisted(() => vi.stubGlobal('HTMLElement', class {}));
afterAll(() => vi.unstubAllGlobals());
import { resolveCaptureElement } from './agentCapture';

describe('capture image bindings', () => {
  const assets: Asset[] = [
    {
      id: 'default-image',
      name: 'Default',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,ZGVmYXVsdA==',
    },
    {
      id: 'bound-image',
      name: 'Bound',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,Ym91bmQ=',
    },
  ];
  function fixture() {
    const composition = createComposition({ assets });
    const layer = createImageLayer();
    if (layer.element.type !== 'image') throw Error('Expected image');
    layer.element.src = 'asset:default-image';
    const field = createFieldDefinition('image-url', {
      key: 'programmeImage',
      defaultValue: 'asset:bound-image',
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'src' }];
    composition.layers = [layer];
    composition.dataFields = [field];
    return { composition, layer: compileDescriptor(composition).layers[0]! };
  }
  it('resolves an embedded image supplied by a data binding after resolving the base element', () => {
    const { composition, layer } = fixture();
    expect(layer.element).toHaveProperty('src', assets[0]!.dataUri);
    expect(
      resolveCaptureElement(layer, { programmeImage: 'asset:bound-image' }, composition),
    ).toHaveProperty('src', assets[1]!.dataUri);
    expect(composition.dataFields[0]!.defaultValue).toBe('asset:bound-image');
    expect(composition.layers[0]!.element).toHaveProperty('src', 'asset:default-image');
  });
  it('preserves direct image URLs and reports missing embedded assets explicitly', () => {
    const { composition, layer } = fixture();
    expect(
      resolveCaptureElement(
        layer,
        { programmeImage: 'https://example.test/image.png' },
        composition,
      ),
    ).toHaveProperty('src', 'https://example.test/image.png');
    expect(() =>
      resolveCaptureElement(layer, { programmeImage: 'asset:missing' }, composition),
    ).toThrow('unknown asset');
  });
});
