import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createImageElement,
  createImageSequenceElement,
  createLayerEffects,
  createLayerKeyframe,
  createLottieElement,
  createProject,
  createShaderElement,
  createTextElement,
  createTickerElement,
  createTickerLayer,
  isShaderPaint,
  normalizeMediaPaint,
  sampleTicker,
  type TickerElement,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
} from '@ograf-editor/ograf-types';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';
import { buildExportArtifactsWithRuntime, validatePackageLayout } from './buildExportArtifacts';
import { getExportProfile } from './exportProfiles';

const FRAME_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];
const svg = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="24" fill="${fill}"/></svg>`)}`;
const texturePng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

function fixture(frameRate = 50) {
  const logo = createAsset({
    id: 'ticker-logo',
    name: 'Ticker logo',
    mimeType: 'image/svg+xml',
    packagePath: 'images/logo.svg',
    dataUri: svg('#00ccff'),
  });
  const ticker = createTickerElement({
    speedPixelsPerSecond: 137.5,
    gap: 47.25,
    direction: 'right',
    textDirection: 'rtl',
    entryFade: 73,
    exitFade: 51,
    fadeSoftness: 0.75,
    items: [
      {
        id: 'rtl-headline',
        width: 610.125,
        element: createTextElement({
          content: 'آخر الأخبار • NEWS 24 • חדשות',
          direction: 'rtl',
          fill: createShaderElement({
            fragmentSource:
              'void mainImage(out vec4 color,in vec2 p){color=vec4(0.2+0.1*sin(iTime),0.7,1.,1.);}',
          }),
        }),
        animation: { type: 'fade', durationMs: 800, delayMs: 100 },
      },
      { id: 'logo', width: 80, element: createImageElement({ src: 'asset:ticker-logo' }) },
      {
        id: 'animated-icon',
        width: 80,
        element: createImageSequenceElement({ frames: [svg('#ff9900'), svg('#cc3377')], fps: 12 }),
      },
      {
        id: 'lottie',
        width: 80,
        element: createLottieElement({
          animationData: { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 64, h: 64, layers: [] },
        }),
      },
    ],
  });
  const layer = createTickerLayer();
  layer.id = 'native-ticker';
  layer.element = ticker;
  layer.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 40, y: 900, width: 1840, height: 96 })),
  ];
  const composition = createComposition({ frameRate, layers: [layer], assets: [logo] });
  const project = createProject({ compositions: [composition], mainCompositionId: composition.id });
  const definition: TransitionLogicDefinition = {
    version: 4,
    id: 'ticker-logic',
    name: 'Ticker logic',
    defaultTransitionId: 'cut',
    slots: [{ id: 'ticker', name: 'Ticker', order: 0 }],
    states: [{ id: 'ticker-on', name: 'Ticker', slotId: 'ticker', templateId: 'ticker' }],
    transitions: [
      {
        id: 'cut',
        name: 'Cut',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
  const input: CoordinatedExportInput = {
    id: 'native-ticker-set',
    name: 'Native ticker',
    definition,
    templates: [{ id: 'ticker', name: 'Ticker', project }],
    componentAssets: [],
  };
  return { ticker, composition, project, input };
}

function tickerOf(descriptor: CompiledGraphicDescriptor): TickerElement {
  const ticker = descriptor.layers.find((layer) => layer.id === 'native-ticker')!.element;
  if (ticker.type !== 'ticker') throw new Error('Native ticker descriptor missing.');
  return ticker;
}

function resourceSources(ticker: TickerElement) {
  return ticker.items
    .flatMap(({ element }) =>
      element.type === 'image'
        ? [element.src]
        : element.type === 'image-sequence'
          ? element.frames
          : [],
    )
    .filter((source): source is string => typeof source === 'string');
}

describe('native ticker portable export contract', () => {
  it.each(['next-appearance', 'immediate'] as const)(
    'preserves the %s update policy in single and coordinated exports',
    (updatePolicy) => {
      const { ticker, composition, project, input } = fixture();
      ticker.updatePolicy = updatePolicy;
      const before = structuredClone(input);
      const single = buildExportArtifactsWithRuntime(
        project,
        composition,
        'class GraphicElement {}',
      );
      const coordinated = buildCoordinatedExportArtifactsWithRuntime(
        input,
        'class CoordinatedGraphicElement {}',
      );
      expect(single.valid, single.errors.join('\n')).toBe(true);
      expect(coordinated.valid, coordinated.errors.join('\n')).toBe(true);
      for (const descriptor of [
        single.descriptor!,
        coordinated.transitionDescriptor!.templates[0]!.descriptor,
      ])
        expect(tickerOf(descriptor).updatePolicy).toBe(updatePolicy);
      for (const artifact of [single, coordinated])
        expect(artifact.mainJs).toContain(`"updatePolicy":"${updatePolicy}"`);
      expect(input).toEqual(before);
    },
  );

  it('defaults newly authored ticker exports to Next appearance without changing item identity', () => {
    const { ticker, composition, project, input } = fixture();
    expect(ticker.updatePolicy).toBe('next-appearance');
    const single = buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}');
    const coordinated = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    for (const descriptor of [
      single.descriptor!,
      coordinated.transitionDescriptor!.templates[0]!.descriptor,
    ]) {
      const exported = tickerOf(descriptor);
      expect(exported.updatePolicy).toBe('next-appearance');
      expect(exported.items.map((item) => item.id)).toEqual(ticker.items.map((item) => item.id));
    }
  });

  it.each(['single', 'coordinated'] as const)(
    'packages and rebases resources inside an Items feed binding in %s exports',
    (kind) => {
      const { ticker, composition, project, input } = fixture();
      const feed = createFieldDefinition('array', {
        id: 'feed',
        key: 'feed',
        label: 'Ticker feed',
        defaultValue: structuredClone(ticker.items) as never,
      });
      composition.dataFields = [feed];
      composition.layers[0]!.bindings = [{ fieldId: feed.id, targetProperty: 'items' }];
      const stub =
        kind === 'single'
          ? 'class GraphicElement { filterPublicData(data) { return data; } updateAction(params) { return params; } }'
          : 'class CoordinatedGraphicElement { filterPublicTemplateData(id,data) { return data; } }';
      const artifacts =
        kind === 'single'
          ? buildExportArtifactsWithRuntime(project, composition, stub)
          : buildCoordinatedExportArtifactsWithRuntime(input, stub);
      expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
      const exportedFeed = (
        kind === 'single'
          ? (artifacts.manifest.schema!.properties as Record<string, { default: unknown }>).feed!
              .default
          : artifacts.transitionDescriptor!.templates[0]!.dataDefaults!.feed
      ) as TickerElement['items'];
      const logo = exportedFeed.find((item) => item.id === 'logo')!.element;
      if (logo.type !== 'image') throw new Error('Expected image item');
      expect(logo.src).not.toMatch(/^(asset:|data:)/);
      expect(artifacts.resources.some((resource) => resource.path === logo.src)).toBe(true);
      const base = 'https://playout.example.test/native-ticker/main.js';
      const className = kind === 'single' ? 'ExportedGraphic' : 'ExportedCoordinatedGraphic';
      const Graphic = new Function(
        artifacts.mainJs
          .replaceAll('import.meta.url', JSON.stringify(base))
          .replace(`export default ${className};`, `return ${className};`),
      )() as {
        new (): {
          updateAction?: (params: { data: unknown }) => { data: { feed: TickerElement['items'] } };
          resolveTemplateData?: (id: string, data: unknown) => { feed: TickerElement['items'] };
        };
      };
      const instance = new Graphic();
      const update =
        kind === 'single'
          ? instance.updateAction!({ data: { feed: exportedFeed } }).data
          : instance.resolveTemplateData!('ticker', { feed: exportedFeed });
      const resolvedLogo = update.feed.find((item) => item.id === 'logo')!.element;
      expect(resolvedLogo.type === 'image' && resolvedLogo.src).toBe(new URL(logo.src!, base).href);
    },
  );

  it.each(['single', 'coordinated'] as const)(
    'rebases a JSON-string feed behind a nested binding source path in %s exports',
    (kind) => {
      const { ticker, composition, project, input } = fixture();
      const news = createFieldDefinition('object', {
        id: 'news',
        key: 'news',
        defaultValue: { messages: JSON.stringify(ticker.items) },
        properties: [createFieldDefinition('textarea', { key: 'messages' })],
      });
      composition.dataFields = [news];
      composition.layers[0]!.bindings = [
        { fieldId: news.id, targetProperty: 'items', sourcePath: ['messages'] },
      ];
      const stub =
        kind === 'single'
          ? 'class GraphicElement { filterPublicData(data) { return data; } updateAction(params) { return params; } }'
          : 'class CoordinatedGraphicElement { filterPublicTemplateData(id,data) { return data; } }';
      const artifacts =
        kind === 'single'
          ? buildExportArtifactsWithRuntime(project, composition, stub)
          : buildCoordinatedExportArtifactsWithRuntime(input, stub);
      expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
      const exported = (
        kind === 'single'
          ? (artifacts.manifest.schema!.properties as Record<string, { default: unknown }>).news!
              .default
          : artifacts.transitionDescriptor!.templates[0]!.dataDefaults!.news
      ) as { messages: string };
      const packagedFeed = JSON.parse(exported.messages) as TickerElement['items'];
      const logo = packagedFeed.find((item) => item.id === 'logo')!.element;
      if (logo.type !== 'image') throw new Error('Expected image item');
      expect(logo.src).not.toMatch(/^(asset:|data:)/);
      expect(artifacts.resources.some((resource) => resource.path === logo.src)).toBe(true);
      const base = 'https://playout.example.test/native-ticker/main.js';
      const className = kind === 'single' ? 'ExportedGraphic' : 'ExportedCoordinatedGraphic';
      const Graphic = new Function(
        artifacts.mainJs
          .replaceAll('import.meta.url', JSON.stringify(base))
          .replace(`export default ${className};`, `return ${className};`),
      )() as {
        new (): {
          resolveExternalData?: (data: unknown) => { news: { messages: string } };
          resolveTemplateData?: (id: string, data: unknown) => { news: { messages: string } };
        };
      };
      const instance = new Graphic();
      // This external-data hook is used for both live and scheduled custom-action payloads.
      const resolved =
        kind === 'single'
          ? instance.resolveExternalData!({ news: exported })
          : instance.resolveTemplateData!('ticker', { news: exported });
      const feed = JSON.parse(resolved.news.messages) as TickerElement['items'];
      const resolvedLogo = feed.find((item) => item.id === 'logo')!.element;
      expect(resolvedLogo.type === 'image' && resolvedLogo.src).toBe(new URL(logo.src!, base).href);
    },
  );

  it.each(FRAME_RATES)(
    'preserves exact mixed-content timing at %s FPS in both export types',
    (fps) => {
      const { ticker, composition, project, input } = fixture(fps);
      const before = structuredClone(input);
      const single = buildExportArtifactsWithRuntime(
        project,
        composition,
        'class GraphicElement {}',
      );
      const coordinated = buildCoordinatedExportArtifactsWithRuntime(
        input,
        'class CoordinatedGraphicElement {}',
      );
      expect(single.valid, single.errors.join('\n')).toBe(true);
      expect(coordinated.valid, coordinated.errors.join('\n')).toBe(true);
      for (const descriptor of [
        single.descriptor!,
        coordinated.transitionDescriptor!.templates[0]!.descriptor,
      ]) {
        expect(descriptor.frameRate).toBe(fps);
        const compiled = tickerOf(descriptor);
        expect(compiled).toMatchObject({
          direction: 'right',
          textDirection: 'rtl',
          entryFade: 73,
          exitFade: 51,
          fadeSoftness: 0.75,
          speedPixelsPerSecond: 137.5,
        });
        expect(compiled.items.map((item) => item.element.type)).toEqual([
          'text',
          'image',
          'image-sequence',
          'lottie',
        ]);
        const atFrame = sampleTicker(compiled, 1840, (23 / fps) * 1000);
        const nextFrame = sampleTicker(compiled, 1840, (24 / fps) * 1000);
        expect(nextFrame.offset - atFrame.offset).toBeCloseTo(
          ticker.speedPixelsPerSecond / fps,
          10,
        );
        expect(sampleTicker(compiled, 1840, 1250).offset).toBeCloseTo(
          sampleTicker(ticker, 1840, 1250).offset,
          10,
        );
        const earlier = sampleTicker(compiled, 1840, 1250);
        sampleTicker(compiled, 1840, 60000);
        expect(sampleTicker(compiled, 1840, 1250)).toEqual(earlier);
      }
      expect(input).toEqual(before);
    },
  );

  it.each(['single', 'coordinated'] as const)(
    'packages and resolves every nested image in the %s module',
    (kind) => {
      const { composition, project, input } = fixture();
      const artifacts =
        kind === 'single'
          ? buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}')
          : buildCoordinatedExportArtifactsWithRuntime(input, 'class CoordinatedGraphicElement {}');
      expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
      expect(validatePackageLayout(artifacts)).toEqual([]);
      const descriptor =
        kind === 'single'
          ? artifacts.descriptor!
          : artifacts.transitionDescriptor!.templates[0]!.descriptor;
      const sources = resourceSources(tickerOf(descriptor));
      expect(sources).toHaveLength(3);
      expect(
        sources.every((source) => !source.startsWith('data:') && !source.startsWith('asset:')),
      ).toBe(true);
      for (const source of sources)
        expect(artifacts.resources.some((resource) => resource.path === source)).toBe(true);
      const base = 'https://playout.example.test/graphics/native-ticker/main.js';
      const className = kind === 'single' ? 'ExportedGraphic' : 'ExportedCoordinatedGraphic';
      const Graphic = new Function(
        artifacts.mainJs
          .replaceAll('import.meta.url', JSON.stringify(base))
          .replace(`export default ${className};`, `return ${className};`),
      )() as {
        descriptor?: CompiledGraphicDescriptor;
        transitionDescriptor?: CompiledTransitionLogicDescriptor;
      };
      const resolved = Graphic.descriptor ?? Graphic.transitionDescriptor!.templates[0]!.descriptor;
      expect(resourceSources(tickerOf(resolved))).toEqual(
        sources.map((source) => new URL(source, base).href),
      );
    },
  );

  it('retains shader, RTL, Lottie and image sequence content across JSON and non-realtime export', () => {
    const { composition, project, input } = fixture(60000 / 1001);
    const reopened = JSON.parse(JSON.stringify(input)) as CoordinatedExportInput;
    expect(reopened).toEqual(input);
    const profile = getExportProfile('non-realtime');
    const single = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
      profile,
    );
    const coordinated = buildCoordinatedExportArtifactsWithRuntime(
      reopened,
      'class CoordinatedGraphicElement {}',
      profile,
    );
    expect(single.valid, single.errors.join('\n')).toBe(true);
    expect(coordinated.valid, coordinated.errors.join('\n')).toBe(true);
    expect(coordinated.manifest.supportsNonRealTime).toBe(true);
    const text = tickerOf(coordinated.transitionDescriptor!.templates[0]!.descriptor).items[0]!
      .element;
    expect(text).toMatchObject({ type: 'text', direction: 'rtl', fill: { type: 'shader' } });
  });

  it.each(['single', 'coordinated'] as const)(
    'packages nested shader textures, media fallbacks and effect resources in %s output',
    (kind) => {
      const { ticker, composition, project, input } = fixture();
      const texture = (source: string) =>
        createShaderElement({ inputImage: { source, wrap: 'repeat', filter: 'linear' } });
      ticker.background = texture(texturePng);
      const text = ticker.items[0]!.element;
      if (text.type !== 'text') throw new Error('Expected text.');
      text.strokePaint = texture(texturePng);
      const logo = ticker.items[1]!;
      if (logo.element.type !== 'image') throw new Error('Expected image.');
      logo.element.fill = normalizeMediaPaint({
        source: { kind: 'live', tag: 'ticker-camera', fallback: svg('#55aacc') },
      });
      logo.effects = createLayerEffects({
        stack: [
          {
            id: 'effect',
            name: 'Ticker reflection',
            type: 'shader',
            enabled: true,
            params: {},
            shader: createShaderElement(),
          },
        ],
      });
      const artifacts =
        kind === 'single'
          ? buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}')
          : buildCoordinatedExportArtifactsWithRuntime(input, 'class CoordinatedGraphicElement {}');
      expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
      const descriptor =
        kind === 'single'
          ? artifacts.descriptor!
          : artifacts.transitionDescriptor!.templates[0]!.descriptor;
      const compiled = tickerOf(descriptor);
      const compiledText = compiled.items[0]!.element;
      const compiledImage = compiled.items[1]!.element;
      if (
        !isShaderPaint(compiled.background) ||
        compiledText.type !== 'text' ||
        !isShaderPaint(compiledText.strokePaint) ||
        compiledImage.type !== 'image' ||
        compiledImage.fill?.type !== 'media' ||
        compiledImage.fill.source.kind !== 'live'
      )
        throw new Error('Missing nested paints.');
      const sources = [
        compiled.background.inputImage!.source,
        compiledText.strokePaint.inputImage!.source,
        compiledImage.fill.source.fallback!,
      ];
      expect(compiled.items[1]!.effects!.stack![0]!.shader).toEqual(logo.effects.stack![0]!.shader);
      for (const source of sources) {
        expect(source).not.toMatch(/^(data:|asset:)/);
        expect(artifacts.resources.some((resource) => resource.path === source)).toBe(true);
      }
      const base = 'https://playout.example.test/ticker/main.js';
      const className = kind === 'single' ? 'ExportedGraphic' : 'ExportedCoordinatedGraphic';
      const Graphic = new Function(
        artifacts.mainJs
          .replaceAll('import.meta.url', JSON.stringify(base))
          .replace(`export default ${className};`, `return ${className};`),
      )() as {
        descriptor?: CompiledGraphicDescriptor;
        transitionDescriptor?: CompiledTransitionLogicDescriptor;
      };
      const resolved = tickerOf(
        Graphic.descriptor ?? Graphic.transitionDescriptor!.templates[0]!.descriptor,
      );
      const resolvedText = resolved.items[0]!.element;
      const resolvedImage = resolved.items[1]!.element;
      if (
        !isShaderPaint(resolved.background) ||
        resolvedText.type !== 'text' ||
        !isShaderPaint(resolvedText.strokePaint) ||
        resolvedImage.type !== 'image' ||
        resolvedImage.fill?.type !== 'media' ||
        resolvedImage.fill.source.kind !== 'live'
      )
        throw new Error('Missing resolved paints.');
      expect([
        resolved.background.inputImage!.source,
        resolvedText.strokePaint.inputImage!.source,
        resolvedImage.fill.source.fallback!,
      ]).toEqual(sources.map((source) => new URL(source, base).href));
    },
  );

  it.each([
    ['single', false],
    ['single', true],
    ['coordinated', false],
    ['coordinated', true],
  ] as const)(
    'keeps nested image data bindings portable in %s output (value map: %s)',
    (kind, valueMap) => {
      const { composition, project, input } = fixture();
      const field = createFieldDefinition('text', {
        id: 'logo-field',
        key: 'logo',
        defaultValue: valueMap ? 'station' : 'asset:ticker-logo',
      });
      composition.dataFields.push(field);
      composition.layers[0]!.bindings = [
        {
          fieldId: field.id,
          targetProperty: 'items.logo.src',
          ...(valueMap
            ? { valueMap: { station: 'asset:ticker-logo', special: svg('#dd5577') } }
            : {}),
        },
      ];
      const stub =
        kind === 'single'
          ? 'class GraphicElement { filterPublicData(data) { return data; } updateAction(params) { return params; } }'
          : 'class CoordinatedGraphicElement { filterPublicTemplateData(id,data) { return data; } }';
      const artifacts =
        kind === 'single'
          ? buildExportArtifactsWithRuntime(project, composition, stub)
          : buildCoordinatedExportArtifactsWithRuntime(input, stub);
      expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
      const descriptor =
        kind === 'single'
          ? artifacts.descriptor!
          : artifacts.transitionDescriptor!.templates[0]!.descriptor;
      const binding = descriptor.layers.find((layer) => layer.id === 'native-ticker')!
        .bindings![0]!;
      expect(binding.targetProperty).toBe('items.logo.src');
      const sources = valueMap
        ? Object.values(binding.valueMap!)
        : [
            kind === 'single'
              ? (artifacts.manifest.schema!.properties as Record<string, { default: string }>).logo!
                  .default
              : (artifacts.transitionDescriptor!.templates[0]!.dataDefaults!.logo as string),
          ];
      for (const source of sources) {
        expect(source).not.toMatch(/^(asset:|data:)/);
        expect(artifacts.resources.some((resource) => resource.path === source)).toBe(true);
      }
      const base = 'https://playout.example.test/native-ticker/main.js';
      const className = kind === 'single' ? 'ExportedGraphic' : 'ExportedCoordinatedGraphic';
      const Graphic = new Function(
        artifacts.mainJs
          .replaceAll('import.meta.url', JSON.stringify(base))
          .replace(`export default ${className};`, `return ${className};`),
      )() as {
        new (): {
          updateAction?: (params: { data: unknown }) => { data: { logo: string } };
          resolveTemplateData?: (id: string, data: unknown) => { logo: string };
        };
        descriptor?: CompiledGraphicDescriptor;
        transitionDescriptor?: CompiledTransitionLogicDescriptor;
      };
      const resolved = Graphic.descriptor ?? Graphic.transitionDescriptor!.templates[0]!.descriptor;
      if (valueMap) {
        const resolvedBinding = resolved.layers.find((layer) => layer.id === 'native-ticker')!
          .bindings![0]!;
        expect(Object.values(resolvedBinding.valueMap!)).toEqual(
          sources.map((source) => new URL(source as string, base).href),
        );
      } else {
        const instance = new Graphic();
        const update =
          kind === 'single'
            ? instance.updateAction!({ data: { logo: sources[0] } }).data
            : instance.resolveTemplateData!('ticker', { logo: sources[0] });
        expect(update.logo).toBe(new URL(sources[0] as string, base).href);
      }
    },
  );
});
