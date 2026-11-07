import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createImageLayer,
  createImageSequenceElement,
  createLayerOfKind,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerPropertyKeyframe,
  createShaderPaint,
  defaultTransformForRole,
  getElementShaderPaint,
  applyShaderAnimationValues,
  sampleShaderAnimationValues,
  createTextElement,
  createDefaultTransform,
  createLayerModifier,
  type Asset,
  type FieldValue,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';

const runtime = vi.hoisted(() => {
  vi.stubGlobal('HTMLElement', class {});
  return {
    paint: vi.fn(),
    time: vi.fn(),
    ready: vi.fn(async () => {}),
    deterministic: vi.fn(),
    pattern: vi.fn(),
    presentation: vi.fn(),
  };
});
vi.mock('@ograf-editor/ograf-runtime', async (original) => ({
  ...(await original<typeof import('@ograf-editor/ograf-runtime')>()),
  applyAnimatedPaint: runtime.paint,
  renderAnimatedElementAtTime: runtime.time,
  waitForElementContentReady: runtime.ready,
  setLottieDeterministicRendering: runtime.deterministic,
  renderPatternAtElapsed: runtime.pattern,
  applyCompiledLayerVisualState: runtime.presentation,
}));
afterAll(() => vi.unstubAllGlobals());
import {
  sampleCompiledLayerVisualState,
  compiledLoopElapsedFrames,
  expandRuntimeCollections,
} from '@ograf-editor/ograf-runtime';
import {
  renderCaptureElementFrame,
  resolveCaptureElement,
  settleCaptureContent,
  resolveCaptureFrameLayout,
  compileTextMeasurement,
} from './agentCapture';
import { inferResolvedFamily, rasterize } from './agentCapture';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { captureMaskedCanvas } from './maskedCapture';
import { acquireProjectFonts } from './projectFonts';
vi.mock('html-to-image', () => ({ getFontEmbedCSS: vi.fn(), toCanvas: vi.fn() }));
vi.mock('./maskedCapture', () => ({ captureMaskedCanvas: vi.fn() }));

describe('static authoring capture Functions boundary', () => {
  it('resolves static capture bindings from authored defaults without executing Functions or changing export metadata', () => {
    const field = createFieldDefinition('number', {
      key: 'score',
      defaultValue: 42,
      exposeToOgraf: false,
    });
    const label = createLayerOfKind('text');
    label.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    const composition = createComposition({
      layers: [label],
      dataFields: [field],
      functions: [
        {
          type: 'javascript',
          version: 1,
          id: 'logic',
          name: 'Logic',
          enabled: true,
          source: '(()=>{ throw new Error("Authoring capture must not execute this source"); })()',
          inputs: { score: field.id },
          outputs: { score: field.id },
          actions: [],
          initialState: { started: false },
        },
      ],
    });
    const before = structuredClone(composition);
    const exported = compileDescriptor(composition);
    const defaults = Object.fromEntries(
      composition.dataFields.map((field) => [field.key, field.defaultValue]),
    );
    const rendered = resolveCaptureElement(exported.layers[0]!, defaults, composition);
    expect(rendered).toMatchObject({ type: 'text', content: '42' });
    expect(exported.functions).toHaveLength(1);
    expect(exported.dataDefaults?.score).toBe(42);
    expect(composition).toEqual(before);
    expect(compileDescriptor(composition).functions).toEqual(exported.functions);
  });
});

describe('text measurement source-to-runtime identity', () => {
  it('resolves collection prototype text to its first clone with bound geometry and remapped clipping', () => {
    const parent = createLayerOfKind('rectangle'),
      label = createLayerOfKind('text');
    parent.groupId = 'brick';
    label.groupId = 'brick';
    parent.clipChildren = true;
    label.parentId = parent.id;
    parent.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 100, width: 200, height: 40 })),
    ];
    label.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 100, width: 180, height: 30 })),
    ];
    const rows = createFieldDefinition('array', {
      key: 'bricks',
      constraints: { maxItems: 72 },
      items: createFieldDefinition('object', {
        properties: [
          createFieldDefinition('number', { key: 'width' }),
          createFieldDefinition('text', { key: 'armor' }),
        ],
      }),
      defaultValue: [{ width: 90, armor: '2' }],
    });
    label.bindings = [
      { fieldId: rows.id, targetProperty: 'content', sourcePath: ['armor'] },
      { fieldId: rows.id, targetProperty: 'layer.width', sourcePath: ['width'] },
    ];
    const composition = createComposition({
      layers: [parent, label],
      dataFields: [rows],
      runtimeCollections: [
        {
          id: 'bricks',
          name: 'Bricks',
          fieldId: rows.id,
          prototypeLayerIds: [parent.id, label.id],
          offsetPerItem: { x: 0, y: 40 },
          capacity: 72,
          overflow: 'truncate',
        },
      ],
    });
    const before = structuredClone(composition);
    const { descriptor, layer } = compileTextMeasurement(composition, label.id);
    expect(layer.id).not.toBe(label.id);
    expect(layer.collectionItem).toMatchObject({ prototypeLayerId: label.id, slot: 0 });
    expect(descriptor.layers.some((candidate) => candidate.id === layer.clipParentId)).toBe(true);
    const data = { bricks: rows.defaultValue };
    expect(resolveCaptureElement(layer, data, composition)).toMatchObject({
      type: 'text',
      content: '2',
    });
    const states = resolveCaptureFrameLayout(descriptor, 0, data);
    expect(states.get(layer.id)!.transform.width).toBe(90);
    expect(states.get(layer.clipParentId!)!.transform.width).toBe(200);
    expect(composition).toEqual(before);
  });
  it('keeps explicit guide text measurable and reports missing authored targets clearly', () => {
    const label = createLayerOfKind('text');
    label.isGuide = true;
    label.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    const composition = createComposition({ layers: [label] });
    expect(compileTextMeasurement(composition, label.id).layer.id).toBe(label.id);
    expect(() => compileTextMeasurement(composition, 'missing')).toThrow(
      'could not be compiled for measurement',
    );
  });
});

describe('capture frame geometry', () => {
  const pose = (
    layer: ReturnType<typeof createLayerOfKind>,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x, y, width, height }))];
    return layer;
  };

  it('arranges and justifies cards plus nested artwork before capture presentation, collapsing hidden data items', () => {
    const owner = pose(createLayerOfKind('rectangle'), 100, 200, 600, 100);
    owner.id = 'owner';
    owner.modifiers = [
      createLayerModifier('grid-arrange', { columns: 3, spreadX: 120 }),
      createLayerModifier('justify', { horizontal: 'center' }),
    ];
    const cards = [0, 1, 2].map((index) => {
      const card = pose(createLayerOfKind('rectangle'), 0, 0, 100, 50);
      card.id = `card${index}`;
      card.parentId = owner.id;
      return card;
    });
    const field = createFieldDefinition('text', { key: 'second', defaultValue: 'Visible' });
    cards[1]!.modifiers = [
      createLayerModifier('hide-empty', {
        source: { kind: 'field', fieldId: field.id, sourcePath: [] },
      }),
    ];
    const label = pose(createLayerOfKind('rectangle'), 8, 11, 40, 20);
    label.id = 'label';
    label.parentId = cards[0]!.id;
    const descriptor = compileDescriptor(
      createComposition({ layers: [owner, ...cards, label], dataFields: [field] }),
    );
    const source = structuredClone(descriptor);
    for (const second of ['Visible', '', 'Visible']) {
      const states = resolveCaptureFrameLayout(descriptor, 0, { second });
      expect(states.get('card0')!.transform.x).toBe(second ? 230 : 290);
      expect(states.get('card2')!.transform.x).toBe(second ? 470 : 410);
      expect(states.get('card1')!.isVisible).toBe(Boolean(second));
      expect(states.get('label')!.transform).toMatchObject({ x: second ? 238 : 298, y: 211 });
      renderCaptureElementFrame(
        {} as HTMLElement,
        descriptor.layers[1]!.element,
        states.get('card0')!,
        0,
      );
      expect(runtime.presentation).toHaveBeenLastCalledWith(
        expect.anything(),
        states.get('card0'),
        0,
      );
    }
    expect(descriptor).toEqual(source);
  });

  it('captures the final arranged path and rider geometry rather than their authored origin', () => {
    const owner = pose(createLayerOfKind('rectangle'), 300, 200, 500, 300);
    owner.id = 'owner';
    owner.modifiers = [createLayerModifier('grid-arrange', { columns: 1 })];
    const path = pose(createLayerOfKind('path'), 0, 0, 200, 100);
    path.id = 'path';
    path.parentId = owner.id;
    if (path.element.type !== 'path') throw Error('fixture');
    path.element = { ...path.element, d: 'M0 0 L100 100', viewBoxWidth: 100, viewBoxHeight: 100 };
    const rider = pose(createLayerOfKind('rectangle'), 0, 0, 20, 10);
    rider.id = 'rider';
    rider.motionPath = {
      sourceLayerId: path.id,
      progress: 0.45,
      orientToPath: true,
      offsetX: 17,
      offsetY: -9,
      rotationOffset: 21,
    };
    const descriptor = compileDescriptor(createComposition({ layers: [rider, path, owner] }));
    for (const frame of [12, 0, 6, 12, 0]) {
      const transform = resolveCaptureFrameLayout(descriptor, frame, {}).get('rider')!.transform;
      expect(transform.x).toBeCloseTo(397);
      expect(transform.y).toBeCloseTo(231);
      expect(transform.rotation).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI + 21);
    }
  });

  it('keeps Max Text Width dimensions and fit consistent across fresh capture samples', () => {
    const label = pose(createLayerOfKind('text'), 100, 200, 400, 40);
    if (label.element.type !== 'text') throw Error('fixture');
    label.element.fontSize = 40;
    label.modifiers = [
      createLayerModifier('max-text-width', {
        maxWidth: 200,
        mode: 'shrink',
        minFontSize: 1,
      }),
    ];
    const descriptor = compileDescriptor(createComposition({ layers: [label] }));
    for (const frame of [12, 0, 6, 12]) {
      const state = resolveCaptureFrameLayout(descriptor, frame, {}).get(label.id)!;
      expect(state.transform).toMatchObject({ width: 200, height: 20 });
      expect(state.textFit).toMatchObject({ scaleX: 0.5, scaleY: 0.5, fontSize: 20 });
    }
    expect(label.keyframes[0]!.transform.width).toBe(400);
    expect(label.element.fontSize).toBe(40);
  });

  it('arranges active collection rows while retaining inactive row visibility state', () => {
    const owner = pose(createLayerOfKind('rectangle'), 100, 200, 400, 200);
    owner.id = 'owner';
    owner.modifiers = [createLayerModifier('grid-arrange', { columns: 1, spreadY: 60 })];
    const card = pose(createLayerOfKind('rectangle'), 0, 0, 100, 50);
    card.id = 'card';
    card.parentId = owner.id;
    const people = createFieldDefinition('array', {
      key: 'people',
      defaultValue: [],
      items: createFieldDefinition('object', {
        key: 'person',
        properties: [createFieldDefinition('text', { key: 'name' })],
      }),
    });
    const composition = createComposition({ layers: [owner, card], dataFields: [people] });
    composition.runtimeCollections = [
      {
        id: 'people',
        name: 'People',
        fieldId: people.id,
        prototypeLayerIds: [card.id],
        offsetPerItem: { x: 0, y: 0 },
        capacity: 3,
        overflow: 'truncate',
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
      },
    ];
    const descriptor = expandRuntimeCollections(compileDescriptor(composition));
    const states = resolveCaptureFrameLayout(descriptor, 0, {
      people: [{ name: 'A' }, { name: 'B' }],
    });
    expect(states.get('people::0::card')!.transform).toMatchObject({ x: 100, y: 200 });
    expect(states.get('people::1::card')!.transform).toMatchObject({ x: 100, y: 260 });
    expect(states.get('people::2::card')!.isVisible).toBe(false);
  });
});

describe('embedded capture fonts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const asset: Asset = {
    id: 'project-font',
    name: 'Project Face.woff2',
    kind: 'font',
    mimeType: 'font/woff2',
    fontFamily: 'Project Face',
    fontWeight: '700',
    fontStyle: 'italic',
    dataUri: 'data:font/woff2;base64,Zm9udA==',
  };
  it.each([false, true])(
    'embeds project and stylesheet faces into capture options (masked: %s)',
    async (masked) => {
      const root = { querySelector: () => (masked ? {} : null) } as unknown as HTMLElement;
      vi.mocked(getFontEmbedCSS).mockResolvedValue(
        '@font-face{font-family:"App Face";src:url("data:font/woff2;base64,YXBw");}',
      );
      const render = masked ? captureMaskedCanvas : toCanvas;
      vi.mocked(render).mockResolvedValue({
        toDataURL: () => 'data:image/png;base64,cG5n',
      } as HTMLCanvasElement);
      await rasterize(root, 1920, 1080, 320, undefined, [asset]);
      expect(render).toHaveBeenCalledWith(
        root,
        expect.objectContaining({
          fontEmbedCSS: expect.stringContaining(
            '@font-face{font-family:"Project Face";src:url("data:font/woff2;base64,Zm9udA==");font-weight:700;font-style:italic;}',
          ),
          canvasWidth: 320,
          canvasHeight: 180,
        }),
      );
      expect(vi.mocked(render).mock.calls[0]![1]!.fontEmbedCSS).toContain('font-family:"App Face"');
    },
  );
  it('recognizes loaded project faces without a local system-font probe', async () => {
    const check = vi.fn(() => true);
    vi.stubGlobal('document', {
      fonts: Object.assign(new Set([{ family: '"Project Face"', status: 'loaded' }]), { check }),
    });
    const probe = vi.fn();
    vi.stubGlobal('FontFace', probe);
    expect(
      await inferResolvedFamily(
        createTextElement({
          fontFamily: '"Project Face", sans-serif',
          fontWeight: 700,
          fontSize: 32,
          content: 'Title',
        }),
      ),
    ).toBe('Project Face');
    expect(check).toHaveBeenCalledWith('700 32px "Project Face"', 'Title');
    expect(probe).not.toHaveBeenCalled();
  });
  it('does not trust fonts.check alone when a requested face is missing or failed', async () => {
    vi.stubGlobal('document', {
      fonts: Object.assign(new Set([{ family: 'Broken Face', status: 'error' }]), {
        check: () => true,
      }),
    });
    vi.stubGlobal(
      'FontFace',
      class {
        load() {
          return Promise.reject(new Error('Not installed'));
        }
      },
    );
    expect(
      await inferResolvedFamily(
        createTextElement({ fontFamily: 'Missing Face, Broken Face, sans-serif' }),
      ),
    ).toBe('sans-serif');
  });
  it('recognizes the loaded embedded face even when a failed sidecar makes fonts.check false', async () => {
    class EmbeddedFace {
      status = 'loaded';
      load() {
        return Promise.resolve(this);
      }
    }
    const fonts = Object.assign(new Set(), { check: vi.fn(() => false) });
    const target = { fonts, defaultView: { FontFace: EmbeddedFace } } as unknown as Document;
    vi.stubGlobal('document', target);
    const localProbe = vi.fn();
    vi.stubGlobal('FontFace', localProbe);
    const lease = acquireProjectFonts(target, [asset]);
    await lease.ready;
    try {
      expect(
        await inferResolvedFamily(createTextElement({ fontFamily: 'Project Face, serif' })),
      ).toBe('Project Face');
      expect(localProbe).not.toHaveBeenCalled();
    } finally {
      lease.dispose();
    }
  });
});

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

  it('resolves image and sequence references after a whole ticker feed replaces compiled artwork', () => {
    const ticker = createLayerOfKind('ticker');
    if (ticker.element.type !== 'ticker') throw Error('Expected ticker.');
    ticker.element.items = [
      { id: 'original', width: 96, element: { type: 'image', src: 'asset:default-image' } },
    ];
    const feed = [
      { id: 'logo', width: 96, element: { type: 'image', src: 'asset:bound-image' } },
      {
        id: 'sequence',
        width: 128,
        element: createImageSequenceElement({
          frames: ['asset:default-image', 'asset:bound-image'],
        }),
      },
    ];
    const field = createFieldDefinition('array', {
      key: 'tickerFeed',
      defaultValue: JSON.parse(JSON.stringify(feed)) as FieldValue,
    });
    ticker.bindings = [{ fieldId: field.id, targetProperty: 'items' }];
    const composition = createComposition({ assets, layers: [ticker], dataFields: [field] });
    const compiled = compileDescriptor(composition).layers[0]!;
    expect(compiled.element).toMatchObject({
      items: [{ id: 'original', element: { src: assets[0]!.dataUri } }],
    });
    const captured = resolveCaptureElement(
      compiled,
      { tickerFeed: field.defaultValue },
      composition,
    );
    expect(captured).toMatchObject({
      items: [
        { id: 'logo', element: { src: assets[1]!.dataUri } },
        { id: 'sequence', element: { frames: assets.map((asset) => asset.dataUri) } },
      ],
    });
    expect(field.defaultValue).toEqual(feed);
    expect(ticker.element.items[0]!.element).toMatchObject({ src: 'asset:default-image' });
  });
});

describe('shader animation capture', () => {
  it('applies complete lifecycle scale and wipe samples for solid non-loop capture layers', () => {
    const composition = createComposition({ frameRate: 25 });
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(index * 12, defaultTransformForRole('rectangle', keyframe.role)),
    );
    layer.animationTracks.clipLeft = [
      createLayerPropertyKeyframe(0, 0.5),
      createLayerPropertyKeyframe(12, 0, { easing: 'linear' }),
    ];
    layer.animationTracks.clipRight = [
      createLayerPropertyKeyframe(0, 0.5),
      createLayerPropertyKeyframe(12, 0, { easing: 'linear' }),
    ];
    layer.animationTracks.scale = [
      createLayerPropertyKeyframe(0, 1),
      createLayerPropertyKeyframe(12, 1),
      createLayerPropertyKeyframe(15, 1.25),
      createLayerPropertyKeyframe(24, 0.05, { easing: 'linear' }),
    ];
    composition.layers = [layer];
    const compiled = compileDescriptor(composition).layers[0]!;
    runtime.presentation.mockClear();
    for (const frame of [0, 4, 8, 12, 18, 22, 24]) {
      const state = sampleCompiledLayerVisualState(compiled, frame);
      renderCaptureElementFrame({} as HTMLElement, compiled.element, state, (frame / 25) * 1000);
      expect(runtime.presentation).toHaveBeenLastCalledWith(
        expect.anything(),
        state,
        (frame / 25) * 1000,
      );
    }
    const first = runtime.presentation.mock.calls[0]![1];
    expect(first.paintTracks.clipLeft[0].value + first.paintTracks.clipRight[0].value).toBe(1);
    expect(runtime.presentation.mock.calls[4]![1].paintTracks.scale[0].value).toBeCloseTo(0.85);
  });
  it('applies the shared loop sample after binding, before drawing the exact capture timestamp', () => {
    const composition = createComposition({ frameRate: 25 });
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw Error('Expected rectangle');
    layer.element.fill = createShaderPaint({
      fragmentSource: `#pragma ograf tint color
const vec3 tint = vec3(1.0);
void mainImage(out vec4 c, in vec2 p) { c = vec4(tint, 1.0); }`,
    });
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(index * 12, defaultTransformForRole('rectangle', keyframe.role)),
    );
    layer.animationTracks['fill.parameters.tint.r'] = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(24, 1, { easing: 'linear' }),
    ];
    layer.loop = createLayerLoopClip({
      durationFrames: 25,
      activation: { type: 'lifecycle' },
      tracks: {
        'fill.parameters.tint.r': [
          createLayerPropertyKeyframe(0, 0.2),
          createLayerPropertyKeyframe(25, 0.4, { easing: 'linear' }),
        ],
      },
    });
    const field = createFieldDefinition('color', { key: 'tint', defaultValue: '#336699' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill.parameters.tint' }];
    composition.layers = [layer];
    composition.dataFields = [field];
    const descriptor = compileDescriptor(composition),
      compiled = descriptor.layers[0]!;
    const data = { tint: '#336699' },
      frame = 18;
    const state = sampleCompiledLayerVisualState(
      compiled,
      frame,
      compiledLoopElapsedFrames(descriptor, compiled, frame),
      data,
    );
    const element = resolveCaptureElement(compiled, data, composition);
    let rendered = element;
    const order: string[] = [];
    runtime.paint.mockImplementation((_host, tracks, sampledFrame) => {
      order.push('uniforms');
      rendered = applyShaderAnimationValues(
        element,
        sampleShaderAnimationValues(element, tracks, sampledFrame),
      );
    });
    runtime.time.mockImplementation((_host, _element, timestamp) => {
      order.push('draw');
      expect(timestamp).toBe(720);
      const tint = getElementShaderPaint(rendered)!.parameters.tint as number[];
      expect(tint[0]).toBeCloseTo(0.248);
      expect(tint.slice(1)).toEqual([0.4, 0.6]);
    });
    renderCaptureElementFrame({} as HTMLElement, element, state, 720);
    expect(order).toEqual(['uniforms', 'draw']);
    expect(getElementShaderPaint(element)!.parameters.tint).toEqual([0.2, 0.4, 0.6]);
    runtime.paint.mockReset();
    runtime.time.mockReset();
  });

  it('waits for the latest shader draw after layout settles before declaring capture ready', async () => {
    const events: string[] = [];
    let finishRedraw = () => {};
    let finalWaitStarted = () => {};
    const enteredFinalWait = new Promise<void>((resolve) => {
      finalWaitStarted = resolve;
    });
    runtime.ready.mockReset();
    runtime.ready.mockImplementationOnce(async () => {
      events.push('initial');
    });
    runtime.ready.mockImplementationOnce(() => {
      events.push('latest');
      finalWaitStarted();
      return new Promise<void>((resolve) => {
        finishRedraw = resolve;
      });
    });
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 0) });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      events.push('layout');
      callback(0);
      return 0;
    });
    let settled = false;
    const capture = settleCaptureContent({
      querySelectorAll: () => [],
    } as unknown as HTMLElement).then(() => {
      settled = true;
    });
    await enteredFinalWait;
    expect(events).toEqual(['initial', 'layout', 'layout', 'latest']);
    expect(settled).toBe(false);
    finishRedraw();
    await capture;
    expect(settled).toBe(true);
  });
});
