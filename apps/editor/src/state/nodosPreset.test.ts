import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createFieldDefinition,
  createProject,
  createLayerOfKind,
  createMediaPaint,
  createMediaCue,
  createRectangleElement,
  createTickerElement,
} from '@ograf-editor/scene-model';
import {
  buildNodosInputContract,
  compileDescriptor,
  NODOS_INPUT_RUNTIME,
} from '@ograf-editor/codegen';
import { createProjectSet } from './projectSet';
import {
  buildNodosPresetDefinition,
  buildNodosInputDeclarations,
  buildNodosRendererPage,
  NODOS_ELECTRONODE_CLASS,
  NODOS_RENDERER_PAGE,
  nodosPresetName,
  nodosTemplatePresetName,
} from './nodosPreset';

function composition() {
  const project = createProject();
  const main = project.compositions[0]!;
  delete main.nodosInputFieldIds;
  main.width = 1920;
  main.height = 1080;
  main.frameRate = 29.97;
  return main;
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type Result = { statusCode: number; statusMessage?: string };
function rendererHarness(main = composition()) {
  const graphic = {
    load: vi.fn<(params: { data: Record<string, unknown> }) => Promise<Result>>(async () => ({
      statusCode: 200,
    })),
    updateAction: vi.fn<(params: { data: Record<string, unknown> }) => Promise<Result>>(
      async () => ({ statusCode: 200 }),
    ),
    playAction: vi.fn<(params: { delta: number }) => Promise<Result>>(async () => ({
      statusCode: 200,
    })),
  };
  const errors = vi.fn();
  let receive!: (values: Record<string, unknown>) => void;
  const body = buildNodosRendererPage('Test', main)
    .match(/<script type="module">([\s\S]*?)<\/script>/)![1]!
    .replace("import Graphic from './main.js';", '');
  const execute = new Function(
    'Graphic',
    'window',
    'document',
    'customElements',
    'console',
    `return (async()=>{${body}})()`,
  );
  return {
    graphic,
    errors,
    receive: (values: Record<string, unknown>) => receive(values),
    start: () =>
      execute(
        class {},
        {
          nodos: {
            onData: (callback: typeof receive) => {
              receive = callback;
            },
          },
        },
        { createElement: () => graphic, body: { appendChild: () => undefined } },
        { define: () => undefined },
        { error: errors },
      ) as Promise<void>,
  };
}

describe('Nodos preset', () => {
  it('declares native Dict, typed arrays, structs and enums and accepts their decoded values', async () => {
    const main = composition();
    const point = (key: string) =>
      createFieldDefinition('object', {
        key,
        nodosType: 'demo.Vec2',
        properties: [
          createFieldDefinition('number', { key: 'x' }),
          createFieldDefinition('number', { key: 'y' }),
        ],
        defaultValue: { x: 1.5, y: -2 },
      });
    main.dataFields = [
      point('position'),
      createFieldDefinition('array', {
        key: 'points',
        items: point('point'),
        defaultValue: [{ x: 1.5, y: -2 }],
      }),
      createFieldDefinition('select', {
        key: 'trend',
        nodosType: 'demo.Trend',
        options: ['Down', 'Flat', 'Up'].map((value) => ({ value, label: value })),
        defaultValue: 'Up',
      }),
      createFieldDefinition('object', {
        key: 'settings',
        properties: [createFieldDefinition('boolean', { key: 'enabled' })],
        defaultValue: { enabled: true },
      }),
      createFieldDefinition('array', {
        key: 'matrix',
        items: createFieldDefinition('array', {
          key: 'row',
          items: createFieldDefinition('number', { key: 'cell' }),
        }),
        defaultValue: [[1, 2], [3]],
      }),
      createFieldDefinition('object', {
        key: 'quote',
        nodosType: 'demo.Quote',
        properties: [
          createFieldDefinition('text', { key: 'label' }),
          point('position'),
          createFieldDefinition('select', {
            key: 'trend',
            options: ['Down', 'Flat', 'Up'].map((value) => ({ value, label: value })),
          }),
          createFieldDefinition('array', {
            key: 'values',
            items: createFieldDefinition('number', { key: 'item' }),
          }),
        ],
        defaultValue: { label: 'BTC', position: { x: 1.5, y: -2 }, trend: 'Flat', values: [4, 5] },
      }),
    ];
    expect(buildNodosInputDeclarations(main).map((input) => input.type)).toEqual([
      'demo.Vec2',
      '[demo.Vec2]',
      'demo.Trend',
      'nos.Dict',
      '[nos.Dict]',
      'demo.Quote',
    ]);
    const incoming = {
      position: { x: 1.5, y: -2 },
      points: [{ x: 1.5, y: -2 }],
      trend: 'Up',
      settings: { enabled: true },
      matrix: [{ items: [1, 2] }, { items: [3] }],
      quote: { label: 'BTC', position: { x: 1.5, y: -2 }, trend: 'Flat', values: [4, 5] },
    };
    const harness = rendererHarness(main);
    await harness.start();
    harness.receive(incoming);
    await Promise.resolve();
    expect(harness.graphic.updateAction).not.toHaveBeenCalled();
    harness.receive({
      ...incoming,
      matrix: [{ items: [4, 5] }, { items: [] }],
      position: { x: 7, y: 8 },
    });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledOnce());
    expect(harness.graphic.updateAction).toHaveBeenCalledWith({
      data: { matrix: [[4, 5], []], position: { x: 7, y: 8 } },
    });
    expect(harness.errors).not.toHaveBeenCalled();
  });

  it('unwraps nested arrays inside dictionary objects received from native transport', async () => {
    const main = composition();
    const array = (key: string, items: ReturnType<typeof createFieldDefinition>) =>
      createFieldDefinition('array', { key, items });
    const value = { grid: [[[1, 2], [3]], [[4]]] };
    main.dataFields = [
      createFieldDefinition('object', {
        key: 'table',
        properties: [
          array(
            'grid',
            array('plane', array('row', createFieldDefinition('number', { key: 'cell' }))),
          ),
        ],
        defaultValue: value,
      }),
    ];
    expect(buildNodosInputDeclarations(main)).toEqual([{ name: 'table', type: 'nos.Dict' }]);
    const incoming = {
      grid: [{ items: [{ items: [1, 2] }, { items: [3] }] }, { items: [{ items: [4] }] }],
    };
    const harness = rendererHarness(main);
    await harness.start();
    harness.receive({ table: incoming });
    await Promise.resolve();
    expect(harness.graphic.updateAction).not.toHaveBeenCalled();
    harness.receive({ table: { grid: [{ items: [{ items: [5, 6] }] }] } });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledOnce());
    expect(harness.graphic.updateAction).toHaveBeenLastCalledWith({
      data: { table: { grid: [[[5, 6]]] } },
    });
  });

  it('filters hidden native-struct members, including array items, before updating the graphic', async () => {
    const main = composition();
    const point = (key: string) =>
      createFieldDefinition('object', {
        key,
        nodosType: 'demo.Vec2',
        properties: [
          createFieldDefinition('number', { key: 'x', defaultValue: 1.5 }),
          createFieldDefinition('number', { key: 'y', defaultValue: 99, exposeToOgraf: false }),
        ],
        defaultValue: { x: 1.5, y: 99 },
      });
    main.dataFields = [
      point('position'),
      createFieldDefinition('array', {
        key: 'points',
        items: point('item'),
        defaultValue: [{ x: 1.5, y: 99 }],
      }),
    ];
    const descriptor = compileDescriptor(main);
    expect(descriptor.dataDefaults).toMatchObject({ position: { y: 99 }, points: [{ y: 99 }] });
    expect(buildNodosInputDeclarations(main)).toEqual([
      { name: 'position', type: 'demo.Vec2' },
      { name: 'points', type: '[demo.Vec2]' },
    ]);
    const incoming = { position: { x: 1.5, y: 0 }, points: [{ x: 1.5, y: 0 }] };
    const harness = rendererHarness(main);
    await harness.start();
    harness.receive({ ...incoming, position: { x: 7, y: 0 }, points: [{ x: 8, y: 0 }] });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledOnce());
    const update = harness.graphic.updateAction.mock.calls[0]![0].data;
    expect(update).toEqual({ position: { x: 7 }, points: [{ x: 8 }] });
    const { filterExposedData } = await vi.importActual<{
      filterExposedData(input: unknown, policy: unknown, current: unknown): unknown;
    }>('../../../../packages/ograf-runtime/src/dataExposure');
    expect(filterExposedData(update, descriptor.dataExposure, descriptor.dataDefaults)).toEqual({
      position: { x: 7, y: 99 },
      points: [{ x: 8, y: 99 }],
    });
  });

  it('serializes startup and subsequent updates, retaining snapshots of reused callback objects', async () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('object', {
        key: 'quote',
        properties: [createFieldDefinition('number', { key: 'price' })],
        defaultValue: { price: 0 },
      }),
    ];
    const harness = rendererHarness(main),
      load = deferred<Result>(),
      initialUpdate = deferred<Result>(),
      play = deferred<Result>();
    harness.graphic.load.mockReturnValue(load.promise);
    harness.graphic.updateAction.mockReturnValueOnce(initialUpdate.promise);
    harness.graphic.playAction.mockReturnValue(play.promise);
    const boot = harness.start();
    const reused = { quote: { price: 1 } };
    harness.receive(reused);
    reused.quote.price = 999;
    load.resolve({ statusCode: 200 });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledOnce());
    expect(harness.graphic.updateAction).toHaveBeenLastCalledWith({
      data: { quote: { price: 1 } },
    });
    const next = { quote: { price: 2 } };
    harness.receive(next);
    next.quote.price = 3;
    harness.receive(next);
    initialUpdate.resolve({ statusCode: 200 });
    await vi.waitFor(() => expect(harness.graphic.playAction).toHaveBeenCalledOnce());
    expect(harness.graphic.updateAction).toHaveBeenCalledOnce();
    play.resolve({ statusCode: 200 });
    await boot;
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledTimes(3));
    expect(harness.graphic.updateAction.mock.calls.map(([p]) => p.data)).toEqual([
      { quote: { price: 1 } },
      { quote: { price: 2 } },
      { quote: { price: 3 } },
    ]);
    harness.receive(next);
    await Promise.resolve();
    expect(harness.graphic.updateAction).toHaveBeenCalledTimes(3);
    next.quote.price = 4;
    harness.receive(next);
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledTimes(4));
    expect(harness.graphic.updateAction).toHaveBeenLastCalledWith({
      data: { quote: { price: 4 } },
    });
  });

  it('does not acknowledge failed updates and fails startup closed while allowing an update retry', async () => {
    const main = composition();
    main.dataFields = [createFieldDefinition('text', { key: 'headline', defaultValue: 'A' })];
    const harness = rendererHarness(main);
    await harness.start();
    harness.graphic.updateAction.mockResolvedValueOnce({
      statusCode: 500,
      statusMessage: 'Temporary failure',
    });
    harness.receive({ headline: 'B' });
    await vi.waitFor(() => expect(harness.errors).toHaveBeenCalledOnce());
    harness.receive({ headline: 'B' });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledTimes(2));
    expect(harness.graphic.updateAction).toHaveBeenLastCalledWith({ data: { headline: 'B' } });
    const failed = rendererHarness(main);
    failed.graphic.load.mockResolvedValue({ statusCode: 400, statusMessage: 'Cannot load' });
    await failed.start();
    failed.receive({ headline: 'later' });
    await Promise.resolve();
    expect(failed.graphic.playAction).not.toHaveBeenCalled();
    expect(failed.graphic.updateAction).not.toHaveBeenCalled();
    expect(failed.errors).toHaveBeenCalledOnce();
    const failedPlay = rendererHarness(main),
      play = deferred<Result>();
    failedPlay.graphic.playAction.mockReturnValue(play.promise);
    const boot = failedPlay.start();
    await vi.waitFor(() => expect(failedPlay.graphic.playAction).toHaveBeenCalledOnce());
    failedPlay.receive({ headline: 'Must not update a failed graphic' });
    play.resolve({ statusCode: 400, statusMessage: 'Cannot play' });
    await boot;
    await Promise.resolve();
    expect(failedPlay.graphic.updateAction).not.toHaveBeenCalled();
    expect(failedPlay.errors).toHaveBeenCalledOnce();
  });

  it('ignores hidden nested array values before decoding their native wrappers', async () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('object', {
        key: 'settings',
        properties: [
          createFieldDefinition('text', { key: 'label' }),
          createFieldDefinition('array', {
            key: 'privateMatrix',
            exposeToOgraf: false,
            items: createFieldDefinition('array', {
              key: 'row',
              items: createFieldDefinition('number', { key: 'cell' }),
            }),
          }),
        ],
        defaultValue: { label: 'Original', privateMatrix: [[99]] },
      }),
    ];
    expect(compileDescriptor(main).dataDefaults).toMatchObject({
      settings: { privateMatrix: [[99]] },
    });
    const harness = rendererHarness(main);
    await harness.start();
    harness.receive({
      settings: { label: 'Changed', privateMatrix: [{}] },
      constructor: 'ignored',
    });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledOnce());
    expect(harness.graphic.updateAction).toHaveBeenCalledWith({
      data: { settings: { label: 'Changed' } },
    });
    expect(harness.errors).not.toHaveBeenCalled();
  });

  it('normalizes safe native bigint values and rejects malformed rows, nonfinite and unsafe integer values', async () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('integer', { key: 'count', defaultValue: 0 }),
      createFieldDefinition('array', {
        key: 'matrix',
        items: createFieldDefinition('array', {
          key: 'row',
          items: createFieldDefinition('number', { key: 'cell' }),
        }),
        defaultValue: [],
      }),
    ];
    const harness = rendererHarness(main);
    await harness.start();
    harness.receive({ count: 7n });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledOnce());
    expect(harness.graphic.updateAction).toHaveBeenLastCalledWith({ data: { count: 7 } });
    for (const values of [
      { count: 9007199254740992n },
      { count: 1.5 },
      { matrix: [{}] },
      { matrix: [{ items: [Infinity] }] },
    ])
      harness.receive(values);
    expect(harness.errors).toHaveBeenCalledTimes(4);
    expect(harness.graphic.updateAction).toHaveBeenCalledOnce();
    harness.receive({ count: 8 });
    await vi.waitFor(() => expect(harness.graphic.updateAction).toHaveBeenCalledTimes(2));
    main.dataFields[0]!.defaultValue = Number.MAX_SAFE_INTEGER + 1;
    expect(() =>
      buildNodosPresetDefinition(main, { displayName: 'Unsafe', category: 'OGraf' }),
    ).toThrow('safe JSON integer');
  });
  it.each([
    ['project UUID', createProject().id],
    ['template UUID', createProjectSet('Test', createProject()).templates[0]!.id],
    ['Unicode', '時計-İstanbul-📈'],
    ['long identity', 'template-long-identity-'.repeat(1000)],
  ])('sends a bounded complete preset accepted by the server for %s', async (_label, id) => {
    const name = nodosTemplatePresetName(id);
    expect(name).toHaveLength(79);
    expect(name).toBe(`ograf.template_${createHash('sha256').update(id, 'utf8').digest('hex')}`);
    // Load the real server contract without making the editor TypeScript project own server sources.
    const { nodosSendMessageSchema } = await vi.importActual<{
      nodosSendMessageSchema: { parse(value: unknown): unknown };
    }>('../../../mcp-server/src/nodos/nodosPresets');
    const request = {
      type: 'nodos.send',
      requestId: 'contract-check',
      address: 'localhost:50052',
      preset: {
        ...buildNodosPresetDefinition(composition(), {
          displayName: 'Display name',
          category: 'OGraf',
        }),
        name,
      },
      files: [{ path: NODOS_RENDERER_PAGE, base64: 'eA==' }],
    };
    expect(nodosSendMessageSchema.parse(request)).toEqual(request);
  });
  it('gives distinct template identities distinct sync classes without slug collisions', () => {
    expect(nodosTemplatePresetName('template-a')).not.toBe(nodosTemplatePresetName('template_a'));
    expect(nodosTemplatePresetName('template-a')).toBe(nodosTemplatePresetName('template-a'));
    expect(nodosTemplatePresetName('template-a')).toMatch(/^ograf\.[A-Za-z0-9_]+$/);
  });
  it('names the preset from its display name, in the ograf namespace', () => {
    expect(nodosPresetName('Lower Third — Breaking')).toBe('ograf.Lower_Third_Breaking');
    expect(nodosPresetName('Şampiyon')).toBe('ograf.Sampiyon');
    expect(nodosPresetName('   ')).toBe('ograf.graphic');
  });

  it('defines an ElectroNode preset that loads the renderer page at the composition size', () => {
    const preset = buildNodosPresetDefinition(composition(), {
      displayName: 'Lower Third',
      category: 'OGraf|News',
    });
    expect(preset.name).toBe('ograf.Lower_Third');
    expect(preset.menu_info).toEqual({ display_name: 'Lower Third', category: 'OGraf|News' });
    expect(preset.node.class_name).toBe(NODOS_ELECTRONODE_CLASS);
    expect(preset.node.display_name).toBe('Lower Third');
    expect(preset.node.pins).toEqual([
      { name: 'URL', type_name: 'string', data: NODOS_RENDERER_PAGE },
      { name: 'Resolution', type_name: 'nos.fb.vec2u', data: { x: 1920, y: 1080 } },
    ]);
  });

  it('sets Resolution from the cropped output without fixing the Nodos thread frame rate', () => {
    const main = composition();
    main.crop = { x: 80, y: 60, width: 1280, height: 720 };
    const preset = buildNodosPresetDefinition(main, {
      displayName: 'Cropped lower third',
      category: 'OGraf',
    });
    expect(preset.node.pins).toEqual([
      { name: 'URL', type_name: 'string', data: NODOS_RENDERER_PAGE },
      { name: 'Resolution', type_name: 'nos.fb.vec2u', data: { x: 1280, y: 720 } },
    ]);
    expect(buildNodosRendererPage('Cropped lower third', main)).toContain(
      '"resolution":{"width":1280,"height":720},"frameRate":29.97',
    );
  });

  it('allows Width, Height and FrameRate as ordinary exposed data fields', () => {
    const main = composition();
    main.dataFields = ['Width', 'Height', 'FrameRate'].map((key, index) =>
      createFieldDefinition('integer', { key, defaultValue: index + 1 }),
    );
    const preset = buildNodosPresetDefinition(main, {
      displayName: 'Independent data',
      category: 'OGraf',
    });
    expect(preset.node.pins.slice(2)).toEqual([]);
    expect(buildNodosInputDeclarations(main)).toEqual(
      ['Width', 'Height', 'FrameRate'].map((name) => ({ name, type: 'int' })),
    );
    expect(preset.node.pins.find((pin) => pin.name === 'Resolution')?.data).toEqual({
      x: 1920,
      y: 1080,
    });
  });

  it('declares required input types in the page while keeping presets free of data pins', () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('text', {
        key: 'headline',
        label: 'Headline',
        description: 'Main line',
        defaultValue: 'Breaking',
      }),
      createFieldDefinition('number', { key: 'scale', defaultValue: 1.5 }),
      createFieldDefinition('integer', { key: 'count', defaultValue: 3 }),
      createFieldDefinition('boolean', { key: 'live', defaultValue: true }),
      createFieldDefinition('select-multiple', { key: 'tags', defaultValue: ['a', 'b'] }),
      createFieldDefinition('object', {
        key: 'person',
        properties: [createFieldDefinition('text', { key: 'name' })],
        defaultValue: { name: 'Ada' },
      }),
      createFieldDefinition('array', {
        key: 'grid',
        items: createFieldDefinition('array', {
          key: 'row',
          items: createFieldDefinition('number', { key: 'cell' }),
        }),
        defaultValue: [[1, 2], [3]],
      }),
    ];
    expect(
      buildNodosPresetDefinition(main, { displayName: 'News', category: 'OGraf' }).node.pins,
    ).toHaveLength(2);
    const inputs = buildNodosInputDeclarations(main);
    expect(inputs).toEqual([
      { name: 'headline', type: 'string' },
      { name: 'scale', type: 'double' },
      { name: 'count', type: 'int' },
      { name: 'live', type: 'bool' },
      { name: 'tags', type: '[string]' },
      { name: 'person', type: 'nos.Dict' },
      { name: 'grid', type: '[nos.Dict]' },
    ]);
    const page = buildNodosRendererPage('News', main);
    const declaration = page.match(
      /<script id="nodos-inputs" type="application\/json">([\s\S]*?)<\/script>/,
    )![1]!;
    expect(JSON.parse(declaration)).toEqual(inputs);
  });

  it('declares live-media tags as reusable texture slots and connects the live-media adapter', () => {
    const main = composition();
    const layer = createLayerOfKind('rectangle');
    if (!('fill' in layer.element)) throw new Error('Expected a paint');
    layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'TextureInput1' } });
    main.layers = [layer, structuredClone(layer)];
    const title = createFieldDefinition('text', { key: 'TitleInput1' });
    main.dataFields = [title, createFieldDefinition('text', { key: 'headline' })];
    main.nodosInputFieldIds = [title.id];
    const expected = [
      { name: 'TitleInput1', type: 'string' },
      { name: 'TextureInput1', type: 'nos.sys.vulkan.Texture' },
    ];
    expect(buildNodosInputDeclarations(main)).toEqual(expected);
    const page = buildNodosRendererPage('Live', main);
    const declaration = page.match(
      /<script id="nodos-inputs" type="application\/json">([\s\S]*?)<\/script>/,
    )![1]!;
    expect(JSON.parse(declaration)).toEqual(expected);
    expect(page).toContain('"liveMediaElementTag":"zd-ograf-media"');
    expect(page).toContain(
      "targets.get(this.dataset.sourceTag)?.shadowRoot?.querySelector('canvas')",
    );
    const conflicting = createFieldDefinition('text', { key: 'TextureInput1' });
    main.dataFields.push(conflicting);
    main.nodosInputFieldIds.push(conflicting.id);
    expect(() => buildNodosInputDeclarations(main)).toThrow('conflicting types');
  });

  it('ignores guide-only live sources while declaring exported background, layer, ticker and cue sources', () => {
    const main = composition();
    const livePaint = (tag: string) => createMediaPaint({ source: { kind: 'live', tag } });
    const visible = createLayerOfKind('rectangle');
    visible.element = createRectangleElement({ fill: livePaint('VisibleInput') });
    const guide = createLayerOfKind('rectangle');
    guide.isGuide = true;
    // This reserved name must not block exporting content that does not render the guide.
    guide.element = createRectangleElement({ fill: livePaint('URL') });
    const ticker = createLayerOfKind('ticker');
    ticker.element = createTickerElement({
      background: livePaint('TickerBackgroundInput'),
      items: [
        {
          id: 'live-item',
          width: 100,
          element: createRectangleElement({ fill: livePaint('TickerInput') }),
        },
      ],
    });
    const guideTicker = structuredClone(ticker);
    guideTicker.isGuide = true;
    guideTicker.element = createTickerElement({
      background: livePaint('Output'),
      items: [
        {
          id: 'guide-item',
          width: 100,
          element: createRectangleElement({ fill: livePaint('GuideOnlyInput') }),
        },
      ],
    });
    main.layers = [guide, visible, guideTicker, ticker];
    main.backgroundPaint = livePaint('BackgroundInput');
    main.mediaCues = [
      createMediaCue({
        sources: [{ id: 'live', name: 'Live', kind: 'live', tag: 'CueInput' }],
      }),
    ];
    expect(buildNodosInputDeclarations(main)).toEqual(
      ['BackgroundInput', 'VisibleInput', 'TickerBackgroundInput', 'TickerInput', 'CueInput'].map(
        (name) => ({ name, type: 'nos.sys.vulkan.Texture' }),
      ),
    );
  });

  it('reads the current matching Nodos texture canvas and tolerates unavailable frames', () => {
    const main = composition();
    main.backgroundPaint = createMediaPaint({
      source: { kind: 'live', tag: 'TextureInput1' },
    });
    const contract = buildNodosInputContract(main);
    const adapter = `${NODOS_INPUT_RUNTIME}\ncreateNodosInputBinding(${JSON.stringify(contract)}, {}, () => {});`;
    const registry = new Map<string, unknown>();
    const target = {
      hidden: false,
      setAttribute: vi.fn(),
      shadowRoot: null as { querySelector: (selector: string) => object | null } | null,
    };
    const appendChild = vi.fn();
    class LiveElement {
      dataset: Record<string, string> = {};
    }
    new Function('window', 'document', 'customElements', 'HTMLElement', adapter)(
      { nodos: { onData: () => undefined } },
      { createElement: vi.fn(() => target), body: { appendChild } },
      {
        get: (name: string) => registry.get(name),
        define: (name: string, ctor: unknown) => registry.set(name, ctor),
      },
      LiveElement,
    );
    expect(target.setAttribute.mock.calls).toEqual([
      ['name', 'TextureInput1'],
      ['type', 'texture'],
    ]);
    expect(target.hidden).toBe(true);
    expect(appendChild).toHaveBeenCalledWith(target);
    const LiveAdapter = registry.get('zd-ograf-media') as new () => LiveElement & {
      getFrame: () => object | null;
    };
    const live = new LiveAdapter();
    live.dataset.sourceTag = 'TextureInput1';
    expect(live.getFrame()).toBeNull();
    let canvas: object | null = { frame: 1 };
    target.shadowRoot = { querySelector: vi.fn(() => canvas) };
    expect(live.getFrame()).toBe(canvas);
    canvas = { frame: 2 };
    expect(live.getFrame()).toBe(canvas);
    canvas = null;
    expect(live.getFrame()).toBeNull();
    live.dataset.sourceTag = 'UnknownInput';
    expect(live.getFrame()).toBeNull();
  });

  it('refuses a data field named like a pin every ElectroNode has', () => {
    const main = composition();
    main.dataFields = [createFieldDefinition('text', { key: 'Resolution', defaultValue: 'x' })];
    expect(() =>
      buildNodosPresetDefinition(main, { displayName: 'News', category: 'OGraf' }),
    ).toThrow(/Rename the data field "Resolution"/);
  });

  it('passes changed data pins to the graphic and unwraps inner arrays', () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('text', { key: 'headline', defaultValue: 'Breaking' }),
      createFieldDefinition('array', {
        key: 'grid',
        items: createFieldDefinition('array', {
          key: 'row',
          items: createFieldDefinition('number', { key: 'cell' }),
        }),
        defaultValue: [],
      }),
    ];
    const page = buildNodosRendererPage('News', main);
    expect(page).toContain('window.nodos.onData(');
    expect(page).toContain('graphic.updateAction({ data })');
    expect(page).toContain('"wrapped":{"grid":{"items":null,"wrapped":true}}');
  });

  it('plays the graphic with its default data and keeps the data from closing the script', () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('text', { key: 'headline', defaultValue: '</script><b>' }),
    ];
    const page = buildNodosRendererPage('News', main);
    expect(page).toContain("import Graphic from './main.js';");
    expect(page).toContain('"renderType":"realtime"');
    expect(page).toContain('"resolution":{"width":1920,"height":1080}');
    expect(page).toContain('"headline":"\\u003c/script>\\u003cb>"');
    expect(page).not.toContain('</script><b>');
    expect(page).toContain('graphic.playAction({ delta: 1 })');
  });
});
