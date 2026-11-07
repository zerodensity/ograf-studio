import { describe, expect, it } from 'vitest';
import { createImageLayer, createLayerKeyframe, createProject } from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import { assembleManifest } from './assembleManifest';
import { validateProject } from '@ograf-editor/validation';
import { renderCompositionFrameSvg } from '@ograf-editor/authoring-core';

describe('crop compilation and output', () => {
  it('exports the crop viewport while preserving authored canvas coordinates, source, and animation', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createImageLayer();
    const pose = {
      x: 80,
      y: 120,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    };
    layer.keyframes = [createLayerKeyframe(0, pose), createLayerKeyframe(12, { ...pose, x: 180 })];
    if (layer.element.type !== 'image') throw new Error('Expected image');
    layer.element.src =
      'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22200%22%20height=%22100%22/%3E';
    layer.element.crop = { x: 0.25, y: 0, width: 0.5, height: 1, sourceAspectRatio: 2 };
    composition.layers.push(layer);
    composition.crop = { x: 100, y: 50, width: 800, height: 600 };
    const originalKeys = structuredClone(layer.keyframes);
    const descriptor = compileDescriptor(composition);
    expect(descriptor.width).toBe(composition.width);
    expect(descriptor.height).toBe(composition.height);
    expect(descriptor.crop).toEqual(composition.crop);
    expect(descriptor.layers[0]!.element).toMatchObject({
      src: layer.element.src,
      crop: layer.element.crop,
    });
    const manifest = assembleManifest(project, composition, descriptor);
    expect(manifest.renderRequirements![0]!.resolution).toEqual({
      width: { exact: 800 },
      height: { exact: 600 },
    });
    expect(layer.keyframes).toEqual(originalKeys);
    const frame = renderCompositionFrameSvg(project);
    expect(frame.svg).toContain('width="800" height="600" viewBox="100 50 800 600"');
    expect(frame.svg).toContain('source-crop');
  });

  it('blocks invalid source and canvas crops during export validation', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createImageLayer();
    if (layer.element.type !== 'image') throw new Error('Expected image');
    layer.element.crop = { x: 0.9, y: 0, width: 0.5, height: 1 };
    composition.layers.push(layer);
    composition.crop = { x: 0, y: 0, width: 0, height: 100 };
    expect(validateProject(project).errors.filter((error) => error.includes('crop'))).toHaveLength(
      2,
    );
  });
});
