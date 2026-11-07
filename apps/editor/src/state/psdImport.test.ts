import { describe, expect, it } from 'vitest';
import { initializeCanvas, readPsd, writePsd, type Psd, type PixelData } from 'ag-psd';
import { createComposition } from '@ograf-editor/scene-model';
import { compileDescriptor, packageDescriptorResources } from '@ograf-editor/codegen';
import { mapPsdLayers } from './psdImport';

const pixels = (r: number): PixelData => ({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([r, 0, 0, 255, r, 0, 0, 255, r, 0, 0, 255, r, 0, 0, 255]),
});
const png = (data: PixelData) => `data:image/png;base64,${data.data[0]}`;
describe('PSD import', () => {
  it('reads a real PSD and retains layer order, position, opacity and visibility', () => {
    initializeCanvas(
      () => ({}) as HTMLCanvasElement,
      (width, height) =>
        ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
          colorSpace: 'srgb',
        }) as ImageData,
    );
    const source: Psd = {
      width: 10,
      height: 10,
      imageData: { width: 10, height: 10, data: new Uint8ClampedArray(400) },
      children: [
        { name: 'Top', left: 3, top: 4, opacity: 0.5, imageData: pixels(100) },
        { name: 'Bottom', left: 1, top: 2, hidden: true, imageData: pixels(200) },
      ],
    };
    const parsed = readPsd(writePsd(source), { useImageData: true, skipThumbnail: true });
    const result = mapPsdLayers(parsed, createComposition(), png);
    expect(result.layers.map((layer) => layer.name)).toEqual(['Bottom', 'Top']);
    expect(result.layers[0]?.isVisible).toBe(false);
    expect(result.layers[1]?.keyframes[0]?.transform).toMatchObject({
      x: 3,
      y: 4,
      width: 2,
      height: 2,
    });
    expect(result.layers[1]?.keyframes[0]?.transform.opacity).toBeCloseTo(0.5, 2);
  });
  it('uses the merged image when masks prevent faithful layer compositing', () => {
    const source: Psd = {
      width: 10,
      height: 10,
      imageData: { width: 10, height: 10, data: new Uint8ClampedArray(400) },
      children: [{ name: 'Masked', mask: {}, imageData: pixels(100) }],
    };
    const result = mapPsdLayers(source, createComposition(), png);
    expect(result.layers[0]?.name).toBe('PSD merged image');
    expect(result.warnings.join(' ')).toMatch(/not editable/);
  });
  it('retains a missing-font text layer as pixels', () => {
    const source: Psd = {
      width: 10,
      height: 10,
      children: [
        {
          name: 'Title',
          imageData: pixels(10),
          text: {
            text: 'HELLO',
            style: {
              font: { name: 'Missing' },
              fontSize: 16,
              fillColor: { r: 255, g: 255, b: 255 },
            },
          },
        },
      ],
    };
    const result = mapPsdLayers(source, createComposition(), png);
    expect(result.layers[0]?.element.type).toBe('image');
    expect(result.warnings.join(' ')).toMatch(/font or styling/);
  });
  it('preserves children of a hidden group and reports flattening', () => {
    const source: Psd = {
      width: 10,
      height: 10,
      children: [
        {
          name: 'Outer',
          hidden: true,
          children: [{ name: 'Inner', children: [{ name: 'Pixel', imageData: pixels(10) }] }],
        },
      ],
    };
    const result = mapPsdLayers(source, createComposition(), png);
    expect(result.layers[0]?.isVisible).toBe(false);
    expect(result.layers[0]?.groupId).toBeTruthy();
    expect(result.warnings.join(' ')).toMatch(/flattened/);
  });
  it('imports supported text when its font is available', () => {
    const source: Psd = {
      width: 10,
      height: 10,
      children: [
        {
          name: 'Title',
          left: 2,
          top: 3,
          imageData: pixels(10),
          text: {
            text: 'HELLO',
            style: {
              font: { name: 'Example' },
              fontSize: 16,
              tracking: 50,
              leading: 24,
              fillColor: { r: 255, g: 128, b: 0 },
            },
          },
        },
      ],
    };
    const result = mapPsdLayers(source, createComposition(), png, () => true);
    expect(result.layers[0]?.element).toMatchObject({
      type: 'text',
      content: 'HELLO',
      fontFamily: 'Example',
      fontSize: 16,
      letterSpacing: 0.8,
      lineHeight: 1.5,
    });
    expect(result.warnings.join(' ')).toMatch(/baseline or kerning/);
  });
  it('packages imported PNG data as an OGraf resource', () => {
    const source: Psd = {
      width: 10,
      height: 10,
      children: [{ name: 'Pixel', imageData: pixels(10) }],
    };
    const composition = createComposition();
    const result = mapPsdLayers(source, composition, () => 'data:image/png;base64,AA==');
    composition.layers.push(...result.layers);
    const packaged = packageDescriptorResources(composition, compileDescriptor(composition));
    const layer = packaged.descriptor.layers[0]!;
    expect(layer.element.type).toBe('image');
    if (layer.element.type !== 'image') throw new Error('Expected image');
    expect(layer.element.src).toMatch(/^assets\/embedded-.*\.png$/);
    const sourcePath = layer.element.src;
    expect(
      packaged.resources.some(
        (resource) => resource.path === sourcePath && resource.data === 'AA==',
      ),
    ).toBe(true);
  });
});
