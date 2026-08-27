import { describe, expect, it } from 'vitest';
import {
  createAnimationTracksFromLegacyLayer,
  createAsset,
  createComposition,
  createLayerKeyframe,
  createLayerOfKind,
  createDefaultTransform,
} from '@ograf-editor/scene-model';
import { resolveSourceOverlayGeometry } from './sourceOverlay';

function svgDataUri(source: string): string {
  return `data:image/svg+xml;base64,${btoa(source)}`;
}

describe('source overlay geometry', () => {
  it('uses the authored first-Step bounds for an image asset layer', () => {
    const asset = createAsset({ id: 'plate', dataUri: 'data:image/png;base64,QUJD' });
    const composition = createComposition({ assets: [asset] });
    const layer = createLayerOfKind('image');
    if (layer.element.type !== 'image') throw new Error('Expected image layer.');
    layer.element.src = 'asset:plate';
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: -500, y: 824, width: 1066, height: 130 })),
      createLayerKeyframe(12, createDefaultTransform({ x: 138, y: 824, width: 1066, height: 130 })),
    ];
    layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
    composition.layers = [layer];

    expect(resolveSourceOverlayGeometry(composition, asset)).toMatchObject({
      x: 138,
      y: 824,
      width: 1066,
      height: 130,
      source: 'authored-layer',
    });
  });

  it('infers a Photoshop SVG bundle offset from its embedded authored plate', () => {
    const plate = createAsset({ id: 'plate', dataUri: 'data:image/png;base64,QUJD' });
    const source = createAsset({
      id: 'source',
      mimeType: 'image/svg+xml',
      dataUri: svgDataUri(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1107px" height="194px"><image x="0" y="0" width="1066" height="130" href="data:img/png;base64,QUJD"/></svg>',
      ),
    });
    const composition = createComposition({ assets: [source, plate] });
    const layer = createLayerOfKind('image');
    if (layer.element.type !== 'image') throw new Error('Expected image layer.');
    layer.element.src = 'asset:plate';
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: -500, y: 824, width: 1066, height: 130 })),
      createLayerKeyframe(12, createDefaultTransform({ x: 138, y: 824, width: 1066, height: 130 })),
    ];
    layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
    composition.layers = [layer];

    expect(resolveSourceOverlayGeometry(composition, source)).toMatchObject({
      x: 138,
      y: 824,
      width: 1107,
      height: 194,
      source: 'svg-bundle',
    });
  });

  it('falls back to intrinsic SVG dimensions when no authored placement exists', () => {
    const source = createAsset({
      mimeType: 'image/svg+xml',
      dataUri: svgDataUri('<svg viewBox="0 0 640 180"></svg>'),
    });
    expect(resolveSourceOverlayGeometry(createComposition(), source)).toMatchObject({
      x: 0,
      y: 0,
      width: 640,
      height: 180,
      source: 'intrinsic',
    });
  });
});
