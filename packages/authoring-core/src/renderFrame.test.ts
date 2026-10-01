import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createDefaultTransform,
  createCornerRadii,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
} from '@ograf-editor/scene-model';
import { renderCompositionFrameSvg } from './renderFrame';

describe('renderCompositionFrameSvg', () => {
  it('supports time sampling and local shape bounds in SVG expressions', () => {
    const project = createProject();
    const comp = project.compositions[0]!;
    comp.frameRate = 25;
    const layer = createLayerOfKind('rectangle');
    layer.name = 'Title';
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 0, y: 0, width: 100, opacity: 1 })),
      createLayerKeyframe(10, createDefaultTransform({ x: 100, y: 0, width: 200, opacity: 1 })),
    ];
    layer.animationTracks.x = [
      { id: 'x0', frame: 0, value: 0, easing: 'linear' },
      { id: 'x1', frame: 10, value: 100, easing: 'linear' },
    ];
    layer.animationTracks.width = [
      { id: 'w0', frame: 0, value: 100, easing: 'linear' },
      { id: 'w1', frame: 10, value: 200, easing: 'linear' },
    ];
    layer.expressions = { x: 'valueAtTime(0.2)', y: 'layer("Title").sourceRectAtTime(0.2).width' };
    comp.layers = [layer];
    expect(renderCompositionFrameSvg(project, comp.id, 0).svg).toContain('translate(50 150)');
  });

  it('uses structured data defaults and property metadata in snapshots', () => {
    const project = createProject();
    const comp = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x: 10, y: 0, opacity: 1 }))];
    layer.expressions = {
      x: 'thisProperty.name === "x" && thisProperty.layerId === thisLayer.id && data.visible === true ? value + data.layout.padding : 0',
    };
    comp.layers = [layer];
    comp.dataFields = [
      createFieldDefinition('boolean', { key: 'visible', defaultValue: true }),
      createFieldDefinition('object', { key: 'layout', defaultValue: { padding: 15 } }),
    ];
    expect(renderCompositionFrameSvg(project, comp.id).svg).toContain('translate(25 0)');
  });

  it('evaluates collection expressions after item offsets and scopes sibling references', () => {
    const project = createProject();
    const comp = project.compositions[0]!;
    const a = createLayerOfKind('rectangle');
    const b = createLayerOfKind('rectangle');
    a.name = 'A';
    b.name = 'B';
    for (const layer of [a, b])
      layer.keyframes = [
        createLayerKeyframe(0, createDefaultTransform({ x: 10, y: 0, opacity: 1 })),
      ];
    a.expressions = { x: 'thisLayer.x * 2' };
    b.expressions = { x: 'layer("A").x + 5' };
    comp.layers = [a, b];
    const field = createFieldDefinition('array', { key: 'rows', defaultValue: [{}, {}] });
    comp.dataFields = [field];
    comp.runtimeCollections = [
      {
        id: 'rows',
        name: 'Rows',
        fieldId: field.id,
        prototypeLayerIds: [a.id, b.id],
        offsetPerItem: { x: 100, y: 0 },
        capacity: 2,
        overflow: 'truncate',
      },
    ];
    const svg = renderCompositionFrameSvg(project, comp.id).svg;
    for (const x of [20, 25, 220, 225]) expect(svg).toContain(`translate(${x} 0)`);
    comp.scripting = {
      enabled: true,
      modules: [],
      source: `layerById(${JSON.stringify(`rows::1::${a.id}`)}).x = 999;`,
    };
    expect(renderCompositionFrameSvg(project, comp.id).svg).toContain('translate(999 0)');
  });

  it('starts each SVG snapshot with fresh module state', () => {
    const project = createProject();
    const comp = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.name = 'Title';
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ y: 0, opacity: 1 }))];
    comp.layers = [layer];
    comp.scripting = {
      enabled: true,
      source: 'layer("Title").x = counter.next();',
      modules: [{ fileName: 'counter.js', source: 'let n = 0; export const next = () => ++n;' }],
    };
    for (let i = 0; i < 2; i++)
      expect(renderCompositionFrameSvg(project, comp.id).svg).toContain('translate(1 0)');
  });

  it('renders composition scripts and embedded libraries without property expressions', () => {
    const project = createProject();
    const comp = project.compositions[0]!;
    const rectangle = createLayerOfKind('rectangle');
    rectangle.name = 'Rectangle';
    rectangle.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    comp.layers = [rectangle];
    comp.scripting = {
      enabled: true,
      modules: [{ fileName: 'helpers.js', source: 'export const offset = x => x + 20;' }],
      source: 'layer("Rectangle").x = helpers.offset(100); layer("Rectangle").y = 30;',
    };
    const before = JSON.stringify(project);
    expect(renderCompositionFrameSvg(project, comp.id, 0).svg).toContain('translate(120 30)');
    expect(JSON.stringify(project)).toBe(before);
  });
  it('uses seconds, computed layer dependencies and pre-expression thisLayer values', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.frameRate = 25;
    composition.transitions[0]!.durationFrames = 50;
    const rect = createLayerOfKind('rectangle');
    rect.name = 'Rectangle';
    const text = createLayerOfKind('text');
    text.name = 'Text';
    for (const layer of [rect, text]) {
      layer.keyframes = [
        createLayerKeyframe(0, {
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          rotation: 0,
          opacity: 1,
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        }),
      ];
    }
    rect.expressions = { width: '400', x: 'time * 100', y: 'thisLayer.width' };
    text.expressions = {
      x: 'layer("Rectangle").x + layer("Rectangle").width',
      y: 'thisLayer.width',
    };
    for (const layers of [
      [rect, text],
      [text, rect],
    ]) {
      composition.layers = layers;
      const svg = renderCompositionFrameSvg(project, composition.id, 25).svg;
      expect(svg).toContain('translate(100 100)');
      expect(svg).toContain('translate(500 100)');
    }
    rect.expressionsEnabled = { width: false };
    expect(renderCompositionFrameSvg(project, composition.id, 25).svg).toContain(
      'translate(200 100)',
    );
  });

  it('updates expression boundaries when authored transition durations change', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.keyframes = [
      { id: 'start', name: 'Start', role: 'start' },
      { id: 'step', name: 'On air', role: 'step' },
      { id: 'end', name: 'End', role: 'end' },
    ];
    composition.transitions = [
      {
        id: 'in',
        fromKeyframeId: 'start',
        toKeyframeId: 'step',
        durationFrames: 10,
        easing: 'linear',
      },
      {
        id: 'out',
        fromKeyframeId: 'step',
        toKeyframeId: 'end',
        durationFrames: 9,
        easing: 'linear',
      },
    ];
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(0, {
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    layer.expressions = {
      x: 'timeline.firstStepFrame',
      y: 'timeline.endFrame - timeline.lastStepFrame',
    };
    composition.layers = [layer];
    expect(renderCompositionFrameSvg(project, composition.id, 0).svg).toContain('translate(10 9)');
    composition.transitions[0]!.durationFrames = 25;
    composition.transitions[1]!.durationFrames = 30;
    expect(renderCompositionFrameSvg(project, composition.id, 0).svg).toContain('translate(25 30)');
  });

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

  it('uses select defaults in expression-driven SVG previews', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('text');
    layer.expressions = { x: 'data.Alphabet == "Latin" ? 100 : 200' };
    layer.keyframes = [
      createLayerKeyframe(0, {
        x: 0,
        y: 0,
        width: 300,
        height: 80,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    composition.layers.push(layer);
    composition.dataFields.push(
      createFieldDefinition('select', {
        key: 'Alphabet',
        defaultValue: 'Latin',
        options: [
          { value: 'Latin', label: 'Latin' },
          { value: 'Arabic', label: 'Arabic' },
        ],
      }),
    );
    expect(renderCompositionFrameSvg(project, composition.id, 0).svg).toContain('translate(100 0)');
    composition.dataFields[0]!.defaultValue = 'Arabic';
    expect(renderCompositionFrameSvg(project, composition.id, 0).svg).toContain('translate(200 0)');
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
    parent.element.borderRadius = createCornerRadii(6);
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
