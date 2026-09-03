import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createLayerOfKind,
  createLayerKeyframe,
  createLayerLoopClip,
  createDefaultTransform,
  createProject,
  PROJECT_DOCUMENT_VERSION,
} from './factory';
import { layerMaskErrors, relativeTransformMatrix, assertMaskSourcesRemovable } from './masking';
import { buildComponentDefinition, instantiateComponentDefinition } from './components';
import { migrateProject } from './migrations';
import {
  getLayerAnimatableProperties,
  getPaintAtFrame,
  pruneInvalidGradientStopTracks,
} from './layerAnimation';
import { layerMaskSvg } from './svgMask';
import { svgMaskSourceContent } from './svgPaint';
import type { GradientPaint } from './types';

function scene() {
  const composition = createComposition();
  const target = createLayerOfKind('rectangle'),
    source = createLayerOfKind('path');
  target.name = 'Paint';
  source.name = 'Matte';
  for (const layer of [target, source])
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 })),
    ];
  composition.layers = [target, source];
  target.mask = { sourceLayerId: source.id, mode: 'alpha', inverted: false };
  source.isMaskOnly = true;
  return { composition, target, source };
}

describe('layer masks', () => {
  it('allows a mask-only source but rejects missing, cyclic, guide and unsupported geometry sources', () => {
    const { composition, target, source } = scene();
    expect(layerMaskErrors(composition)).toEqual([]);
    source.mask = { sourceLayerId: target.id, mode: 'alpha', inverted: false };
    expect(layerMaskErrors(composition).join(' ')).toContain('cyclic');
    source.mask = null;
    source.isGuide = true;
    expect(layerMaskErrors(composition).join(' ')).toContain('guide');
    source.isGuide = false;
    target.mask!.sourceLayerId = 'missing';
    expect(layerMaskErrors(composition).join(' ')).toContain('missing');
    target.mask!.sourceLayerId = source.id;
    target.mask!.mode = 'path';
    source.element = { type: 'image', src: null };
    expect(layerMaskErrors(composition).join(' ')).toContain('does not support image');
  });
  it('prevents references crossing a runtime collection boundary', () => {
    const { composition, target, source } = scene();
    composition.runtimeCollections = [
      {
        id: 'cells',
        name: 'Cells',
        fieldId: 'items',
        prototypeLayerIds: [source.id],
        offsetPerItem: { x: 100, y: 0 },
        capacity: 2,
        overflow: 'truncate',
      },
    ];
    expect(layerMaskErrors(composition).join(' ')).toContain('same runtime collection');
    composition.runtimeCollections[0]!.prototypeLayerIds.push(target.id);
    expect(layerMaskErrors(composition)).toEqual([]);
  });
  it('refuses deletion that would reveal masked content, while allowing consumers and sources together', () => {
    const { composition, target, source } = scene();
    expect(() => assertMaskSourcesRemovable(composition, new Set([source.id]))).toThrow(
      'Detach masks',
    );
    expect(() =>
      assertMaskSourcesRemovable(composition, new Set([target.id, source.id])),
    ).not.toThrow();
  });
  it('requires portable component sources and remaps them per instance', () => {
    const { composition, target, source } = scene();
    expect(() => buildComponentDefinition(composition, [target.id], 'Incomplete')).toThrow(
      'Include the mask source',
    );
    const component = buildComponentDefinition(composition, [target.id, source.id], 'Masked');
    const a = instantiateComponentDefinition(composition, component),
      b = instantiateComponentDefinition(composition, component);
    expect(a.layers[0]!.mask!.sourceLayerId).toBe(a.layers[1]!.id);
    expect(a.layers[0]!.mask!.sourceLayerId).not.toBe(b.layers[0]!.mask!.sourceLayerId);
    expect(a.layers[1]!.isMaskOnly).toBe(true);
  });
  it('expresses a rotating source in the independent target coordinate system', () => {
    const source = createDefaultTransform({
      x: 100,
      y: 50,
      width: 100,
      height: 100,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    const target = createDefaultTransform({ x: 20, y: 10, width: 200, height: 100, rotation: 0 });
    const matrix = relativeTransformMatrix(source, target);
    expect(matrix[0]).toBeCloseTo(0);
    expect(matrix[1]).toBeCloseTo(1);
    expect(matrix[2]).toBeCloseTo(-1);
    expect(matrix[3]).toBeCloseTo(0);
    expect(matrix.slice(4)).toEqual([80, 40]);
    expect(relativeTransformMatrix(source, source).map((n) => Math.round(n))).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
  });
  it('uses alpha independently of source colour, and ignores opacity/effects in path mode', () => {
    const { composition, target, source } = scene();
    source.element = { type: 'image', src: 'data:image/png;base64,alpha' };
    source.effects.blur = 8;
    const layers = new Map(composition.layers.map((l) => [l.id, l]));
    const states = new Map(
      composition.layers.map((l) => [
        l.id,
        {
          transform: { ...l.keyframes[0]!.transform, opacity: 0.4 },
          effects: l.effects,
          paintTracks: {},
          paintFrame: 0,
        },
      ]),
    );
    const alpha = layerMaskSvg(target.id, layers, states, 'test-mask');
    expect(alpha).toContain('mask-type:alpha');
    expect(alpha).toContain('opacity="0.4"');
    expect(alpha).toContain('feGaussianBlur');
    expect(alpha).toContain('data:image/png;base64,alpha');
    target.mask!.inverted = true;
    expect(layerMaskSvg(target.id, layers, states, 'test-mask')).toContain('mask-type:luminance');
    source.element = createLayerOfKind('path').element;
    target.mask!.mode = 'path';
    const path = layerMaskSvg(target.id, layers, states, 'test-mask');
    expect(path).not.toContain('feGaussianBlur');
    expect(path).not.toContain('opacity="0.4"');
  });
});

describe('path paint migration and animation', () => {
  const fill: GradientPaint = {
    type: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color: '#000', opacity: 0 },
      { offset: 1, color: '#fff', opacity: 1 },
    ],
  };
  it('migrates old paths and component snapshots without changing their keys or solid paint', () => {
    const project = createProject(),
      path = createLayerOfKind('path');
    path.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    project.compositions[0]!.layers = [path];
    project.compositions[0]!.components = [
      { id: 'component', name: 'Legacy path', layers: [structuredClone(path)], dataFields: [] },
    ];
    const legacy = JSON.parse(JSON.stringify(project));
    legacy.documentVersion = 25;
    for (const layer of [
      legacy.compositions[0].layers[0],
      legacy.compositions[0].components[0].layers[0],
    ]) {
      delete layer.mask;
      delete layer.isMaskOnly;
      delete layer.element.fillRule;
    }
    const result = migrateProject(legacy);
    expect(result.documentVersion).toBe(PROJECT_DOCUMENT_VERSION);
    for (const layer of [
      result.compositions[0]!.layers[0]!,
      result.compositions[0]!.components[0]!.layers[0]!,
    ]) {
      expect(layer.mask).toBeNull();
      expect(layer.isMaskOnly).toBe(false);
      expect(layer.element).toMatchObject({ fill: '#3b3f4a', fillRule: 'nonzero' });
      expect(layer.keyframes[0]!.transform).toEqual(path.keyframes[0]!.transform);
    }
  });
  it('samples path gradient stop keys and removes obsolete keys from base and local loops', () => {
    const path = createLayerOfKind('path');
    if (path.element.type !== 'path') throw Error();
    path.element.fill = fill;
    path.animationTracks = {
      'fill.stops[1].offset': [
        { id: 'a', frame: 0, value: 0, easing: 'linear' },
        { id: 'b', frame: 10, value: 1, easing: 'linear' },
      ],
    };
    path.loop = createLayerLoopClip({ tracks: structuredClone(path.animationTracks) });
    expect(getLayerAnimatableProperties(path)).toContain('fill.stops[1].offset');
    expect(getPaintAtFrame(fill, path.animationTracks, 5)).toMatchObject({
      stops: [{}, { offset: 0.5 }],
    });
    path.element.fill = '#fff';
    pruneInvalidGradientStopTracks(path);
    expect(path.animationTracks['fill.stops[1].offset']).toBeUndefined();
    expect(path.loop.tracks['fill.stops[1].offset']).toBeUndefined();
  });
  it('maps path paints to the rendered box, preserving even-odd holes with nonuniform sizing', () => {
    const source = createLayerOfKind('path');
    if (source.element.type !== 'path') throw Error();
    const svg = svgMaskSourceContent(
      { ...source.element, fill, fillRule: 'evenodd' },
      400,
      100,
      'wide',
    );
    expect(svg).toContain('scale(4 1)');
    expect(svg).toContain('clip-rule="evenodd"');
    expect(svg).toContain('width="400" height="100"');
    expect(svg).toContain('x2="400"');
  });
});
