import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
} from '@ograf-editor/scene-model';
import { renderCompositionFrameSvg } from './renderFrame';

describe('renderCompositionFrameSvg', () => {
  it('renders the evaluated layer pose as a self-contained SVG preview', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected a text layer.');
    layer.element.content = 'Agent preview';
    layer.keyframes = [
      createLayerKeyframe(0, {
        x: 120,
        y: 240,
        width: 600,
        height: 100,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    composition.layers.push(layer);

    const result = renderCompositionFrameSvg(project, composition.id, 0);

    expect(result.svg).toContain('Agent preview');
    expect(result.svg).toContain('translate(120 240)');
    expect(result.svg).toContain('width="1920"');
  });

  it('renders sampled text stroke behind the SVG glyph fill', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected a text layer.');
    layer.element.content = 'Outlined';
    layer.element.strokeColor = '#101820';
    layer.element.strokeWidth = 0;
    layer.keyframes = [
      createLayerKeyframe(0, {
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    layer.animationTracks.strokeWidth = [
      createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
      createLayerPropertyKeyframe(10, 8, { easing: 'linear' }),
    ];
    composition.layers.push(layer);

    const { svg } = renderCompositionFrameSvg(project, composition.id, 5);

    expect(svg).toContain('stroke="#101820"');
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('paint-order="stroke fill"');
  });

  it('samples image sequences from the composition clock and clamps the frame range', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('image-sequence');
    if (layer.element.type !== 'image-sequence') throw new Error('Expected an image sequence.');
    layer.element.frames = ['/first.png', '/second.png'];
    layer.element.fps = composition.frameRate;
    layer.keyframes = [
      createLayerKeyframe(0, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    composition.layers.push(layer);

    expect(renderCompositionFrameSvg(project, composition.id, 1).svg).toContain('/second.png');
    expect(renderCompositionFrameSvg(project, composition.id, 999).frame).toBe(24);
  });

  it('renders gradient fills and rounded clip-parent masks', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const parent = createLayerOfKind('rectangle');
    const child = createLayerOfKind('rectangle');
    parent.clipChildren = true;
    child.parentId = parent.id;
    child.blendMode = 'multiply';
    if (parent.element.type !== 'rectangle' || child.element.type !== 'rectangle') {
      throw new Error('Expected rectangle layers.');
    }
    parent.element.borderRadius = 6;
    child.element.fill = {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 0.34 },
        { offset: 1, color: '#00133f', opacity: 0.42 },
      ],
    };
    child.animationTracks['fill.stops[0].offset'] = [
      createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
      createLayerPropertyKeyframe(10, 0.5, { easing: 'linear' }),
    ];
    parent.keyframes = [
      createLayerKeyframe(0, {
        x: 20,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    child.keyframes = [
      createLayerKeyframe(0, {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    composition.layers.push(parent, child);

    const { svg } = renderCompositionFrameSvg(project, composition.id, 5);

    expect(svg).toContain('linear-gradient(90deg');
    expect(svg).toContain('25%');
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('<path d="M');
    expect(svg).toContain(' Q ');
    expect(svg).toContain('style="isolation:isolate"');
    expect(svg).toContain('style="mix-blend-mode:multiply"');
  });

  it('renders default runtime collection items with item-relative bindings and offsets', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('array', {
      key: 'leaderboard',
      constraints: { minItems: 0, maxItems: 4 },
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [createFieldDefinition('text', { key: 'name' })],
        defaultValue: { name: '' },
      }),
      defaultValue: [{ name: 'Ada' }, { name: 'Lin' }],
    });
    const layer = createLayerOfKind('text');
    layer.groupId = 'row';
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    layer.keyframes = [
      createLayerKeyframe(0, {
        x: 100,
        y: 50,
        width: 300,
        height: 64,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    composition.layers = [layer];
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'rows',
        name: 'Rows',
        fieldId: field.id,
        prototypeLayerIds: [layer.id],
        offsetPerItem: { x: 0, y: 72 },
        capacity: 4,
        overflow: 'truncate',
      },
    ];

    const { svg } = renderCompositionFrameSvg(project, composition.id, 0);
    expect(svg).toContain('Ada');
    expect(svg).toContain('Lin');
    expect(svg).toContain('translate(100 50)');
    expect(svg).toContain('translate(100 122)');
  });
});
