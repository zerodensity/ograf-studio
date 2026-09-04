import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createComposition,
  getLayerTransformAtFrame,
} from '@ograf-editor/scene-model';
import { placeImages, type PreparedImage } from './imageImport';

function image(width = 800, height = 400): PreparedImage {
  return {
    asset: createAsset({
      name: 'Brand mark.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,YQ==',
    }),
    width,
    height,
    companions: [],
  };
}

describe('image placement', () => {
  it('names a centered, proportional layer and keeps it visible throughout the lifecycle', () => {
    const c = createComposition();
    c.layers = [];
    const [id] = placeImages(c, [image()]);
    const layer = c.layers.find((l) => l.id === id)!;
    expect(layer.name).toBe('Brand mark');
    expect(layer.element).toEqual({ type: 'image', src: `asset:${c.assets[0]!.id}` });
    for (const key of layer.keyframes)
      expect(key.transform).toMatchObject({
        width: 800,
        height: 400,
        x: (c.width - 800) / 2,
        y: (c.height - 400) / 2,
        opacity: 1,
      });
  });
  it('fits a large portrait into the canvas and centers it on a drop position', () => {
    const c = createComposition();
    const [id] = placeImages(c, [image(2000, 4000)], { position: { x: 350, y: 460 } });
    const pose = getLayerTransformAtFrame(
      c.layers.find((l) => l.id === id)!,
      0,
    );
    expect(pose.height).toBeCloseTo(c.height * 0.8);
    expect(pose.width / pose.height).toBeCloseTo(0.5);
    expect(pose.x + pose.width / 2).toBeCloseTo(350);
    expect(pose.y + pose.height / 2).toBeCloseTo(460);
  });
  it('reuses one resource for multiple layers and offsets a batch for easy selection', () => {
    const c = createComposition();
    const source = image();
    const ids = placeImages(c, [source, source]);
    expect(c.assets.filter((a) => a.dataUri === source.asset.dataUri)).toHaveLength(1);
    const layers = ids.map((id) => c.layers.find((l) => l.id === id)!);
    expect(layers[1]!.keyframes[0]!.transform.x - layers[0]!.keyframes[0]!.transform.x).toBe(24);
  });
  it('replacement preserves every authored property apart from the source', () => {
    const c = createComposition();
    const [id] = placeImages(c, [image()]);
    const layer = c.layers.find((l) => l.id === id)!;
    layer.keyframes[0]!.transform.rotation = 18;
    layer.bindings = [{ fieldId: 'field', targetProperty: 'src' }];
    const before = structuredClone(layer);
    const replacement = image(400, 1200);
    replacement.asset.dataUri = 'data:image/png;base64,Yg==';
    placeImages(c, [replacement], { replaceLayerId: id });
    expect(layer).toEqual({
      ...before,
      element: { type: 'image', src: `asset:${replacement.asset.id}` },
    });
    expect(c.assets).toHaveLength(2);
  });
  it('rejects locked targets and invalid batches before changing resources', () => {
    const c = createComposition();
    const [id] = placeImages(c, [image()]);
    c.layers.find((l) => l.id === id)!.isLocked = true;
    const before = structuredClone(c);
    expect(() => placeImages(c, [image()], { replaceLayerId: id })).toThrow('unlocked');
    expect(() => placeImages(c, [image(), image(0, 0)])).toThrow('dimensions');
    expect(c).toEqual(before);
  });
});
