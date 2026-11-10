import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompiledGraphicDescriptor,
  CompiledLayer,
  ScheduledAction,
} from '@ograf-editor/ograf-types';
import {
  createChartElement,
  createDefaultTransform,
  createLayerEffects,
  createTextElement,
  normalizeClockTimerSettings,
  normalizeTextAnimation,
  textAnimationTotalFrames,
  type Element,
  type LayerUpdateTransition,
  type LayerUpdateTransitionStyle,
} from '@ograf-editor/scene-model';

type Keyframe = { opacity: number; translate: string };

const mock = vi.hoisted(() => {
  const animations: Array<{
    layerId: string;
    keyframes: Keyframe[];
    duration: number;
    easing: string;
    fill: string | undefined;
    /** What the layer was showing when the animation started. */
    shown: string | undefined;
    cancelled: boolean;
  }> = [];
  const hooks: {
    afterAnimate: (() => void) | null;
    contentReady: (() => Promise<void>) | null;
  } = { afterAnimate: null, contentReady: null };
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
    layerId = '';
    shown: () => string | undefined = () => undefined;
    querySelectorAll() {
      return [];
    }
    attachShadow() {
      return (this.shadowRoot = new Host());
    }
    replaceChildren() {
      this.children = [];
    }
    appendChild(child: Host) {
      this.children.push(child);
      return child;
    }
    addEventListener() {}
    animate(keyframes: Keyframe[], options: { duration: number; easing: string; fill?: string }) {
      // A zero-length animation only holds re-rendered content hidden between the two halves.
      if (options.duration === 0) return { finished: Promise.resolve(), cancel() {} };
      const entry = {
        layerId: this.layerId,
        keyframes,
        duration: options.duration,
        easing: options.easing,
        fill: options.fill,
        shown: this.shown(),
        cancelled: false,
      };
      animations.push(entry);
      hooks.afterAnimate?.();
      return {
        finished: Promise.resolve(),
        cancel() {
          entry.cancelled = true;
        },
      };
    }
  }
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { Host, animations, hooks, text: vi.fn(), previousText: vi.fn(), chart: vi.fn() };
});
type Host = InstanceType<typeof mock.Host>;

vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: (compiled: CompiledGraphicDescriptor) => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 3 * compiled.frameRate,
      seek: (value: number) => {
        frame = value;
      },
      animateTo: (value: number, options: { onUpdate?: () => void; onComplete?: () => void }) => {
        frame = value;
        options.onUpdate?.();
        options.onComplete?.();
        return { cancel() {} };
      },
      dispose() {},
      pause() {},
      setClockOwner() {},
    };
  },
}));
vi.mock('./documentFonts', () => ({ registerDocumentFonts: async () => {} }));
vi.mock('./chartRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chartRendering')>()),
  renderChartAnimationAtFrame: mock.chart,
}));
vi.mock('./textAnimationRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./textAnimationRendering')>()),
  renderTextAnimationAtFrame: mock.text,
  setTextAnimationPrevious: mock.previousText,
}));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: (host: Host, element: Element) => {
    host.dataset.ografRenderedElement = JSON.stringify(element);
    if (!host.firstElementChild) {
      host.firstElementChild = new mock.Host();
      host.firstElementChild.layerId = host.dataset.ografLayerId!;
      host.firstElementChild.shown = () => renderedContent(host);
    }
  },
  renderAnimatedElementAtTime: vi.fn(),
  applyAnimatedPaint: vi.fn(),
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: async () => {
    await mock.hooks.contentReady?.();
  },
}));
import { GraphicElement } from './GraphicElement';

/** At this rate a frame lasts 100 ms, so each half of an N-frame update lasts N * 50 ms. */
const FRAME_RATE = 10;
const AT = 1000;

const OLD = 'old';
const NEW = 'new';

const renderedContent = (host: Host) =>
  (JSON.parse(host.dataset.ografRenderedElement!) as { content?: string }).content;

function own(
  style: LayerUpdateTransitionStyle,
  durationFrames = 0,
  distance = 24,
): LayerUpdateTransition {
  return { style, durationFrames, distance };
}

function compiledLayer(
  id: string,
  element: Element,
  bindings: CompiledLayer['bindings'],
  updateTransition?: LayerUpdateTransition,
): CompiledLayer {
  return {
    id,
    isVisible: true,
    element,
    effects: createLayerEffects(),
    keyframes: [
      {
        id: 'start',
        frame: 0,
        easing: 'linear',
        transform: createDefaultTransform({ width: 640, height: 360 }),
      },
    ],
    animationTracks: {},
    bindings,
    ...(updateTransition ? { updateTransition } : {}),
  } as CompiledLayer;
}

/** A text layer whose content follows the data key named after it. */
function text(id: string, updateTransition?: LayerUpdateTransition): CompiledLayer {
  return compiledLayer(
    id,
    createTextElement({ content: id }),
    [{ dataKey: id, targetProperty: 'content' }],
    updateTransition,
  );
}

function compiled(layers: CompiledLayer[], updateTransitionFrames: number) {
  return {
    width: 640,
    height: 360,
    frameRate: FRAME_RATE,
    backgroundColor: 'transparent',
    updateTransitionFrames,
    layers,
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'step1', frame: 10, role: 'step' },
      { id: 'end', frame: 30, role: 'end' },
    ],
    transitions: [
      { fromKeyframeId: 'step1', toKeyframeId: 'end', durationFrames: 10, easing: 'linear' },
    ],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1'],
    stepCount: 1,
    customActions: [],
  } as CompiledGraphicDescriptor;
}

async function loaded(
  source: CompiledGraphicDescriptor,
  renderType: 'realtime' | 'non-realtime',
  data: Record<string, unknown>,
): Promise<GraphicElement> {
  class Graphic extends GraphicElement {
    static descriptor = source;
  }
  const graphic = new Graphic();
  graphic.connectedCallback();
  expect(await graphic.load({ renderType, renderCharacteristics: {}, data })).toMatchObject({
    statusCode: 200,
  });
  if (renderType === 'realtime') await graphic.playAction({ skipAnimation: true });
  mock.animations.length = 0;
  return graphic;
}

const every = (layers: CompiledLayer[], value: string) =>
  Object.fromEntries(layers.map((layer) => [layer.id, value]));

const play: ScheduledAction = {
  timestamp: 0,
  action: { type: 'playAction', params: { skipAnimation: true } },
};
const update = (
  timestamp: number,
  data: Record<string, unknown>,
  skipAnimation?: boolean,
): ScheduledAction => ({
  timestamp,
  action: {
    type: 'updateAction',
    params: { data, ...(skipAnimation === undefined ? {} : { skipAnimation }) },
  },
});

/** A non-realtime graphic that changes every layer from OLD to NEW at `AT`. */
async function replay(
  layers: CompiledLayer[],
  updateTransitionFrames: number,
  { skipAnimation }: { skipAnimation?: boolean } = {},
): Promise<GraphicElement> {
  const graphic = await loaded(
    compiled(layers, updateTransitionFrames),
    'non-realtime',
    every(layers, OLD),
  );
  await graphic.setActionsSchedule({
    schedule: [play, update(AT, every(layers, NEW), skipAnimation)],
  });
  return graphic;
}

function layerHost(graphic: GraphicElement, id: string): Host {
  const search = (hosts: Host[]): Host | undefined => {
    for (const host of hosts) {
      if (host.dataset.ografLayerId === id) return host;
      const nested = search(host.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const host = search((graphic.shadowRoot as unknown as Host).children);
  if (!host) throw Error(`No layer ${id}`);
  return host;
}

const contentStyle = (graphic: GraphicElement, id: string) =>
  layerHost(graphic, id).firstElementChild!.style;

/** Everything a viewer could see of a layer at the current time. */
function look(graphic: GraphicElement, id: string) {
  const style = contentStyle(graphic, id);
  const [x = '0', y = '0'] = (style.translate ?? '').split(' ').filter(Boolean);
  return {
    opacity: Number(style.opacity || 1),
    x: Number.parseFloat(x),
    y: Number.parseFloat(y),
    content: renderedContent(layerHost(graphic, id)),
  };
}

async function at(graphic: GraphicElement, timestamp: number, id: string) {
  expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
  return look(graphic, id);
}

/** CSS `ease-in-out`, solved independently of the runtime's own sampler. */
function cssEaseInOut(x: number): number {
  const bezier = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 60; index++) {
    const t = (low + high) / 2;
    if (bezier(t, 0.42, 0.58) < x) low = t;
    else high = t;
  }
  return bezier((low + high) / 2, 0, 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.animations.length = 0;
  mock.hooks.afterAnimate = null;
  mock.hooks.contentReady = null;
});

it('retains the export key on authored layer wrappers across data updates', async () => {
  const descriptor = compiled([{ ...text('score'), exportKey: 'scoreline' }, text('unkeyed')], 0);
  descriptor.collections = [
    {
      id: 'rows',
      name: 'Rows',
      dataKey: 'items',
      prototypeLayers: [{ ...text('row'), exportKey: 'row-text' }],
      offsetPerItem: { x: 0, y: 40 },
      capacity: 2,
      overflow: 'truncate',
      itemKeyPath: [],
      sortPath: [],
      sortDirection: 'none',
      pageSize: 0,
      page: 0,
    },
  ];
  const graphic = await loaded(descriptor, 'realtime', { score: OLD, items: [{}, {}] });
  const host = layerHost(graphic, 'score');
  expect(host.dataset.ografLayerKey).toBe('scoreline');
  expect(layerHost(graphic, 'unkeyed').dataset.ografLayerKey).toBeUndefined();
  expect(layerHost(graphic, 'rows::0::row').dataset.ografLayerKey).toBeUndefined();
  expect(layerHost(graphic, 'rows::1::row').dataset.ografLayerKey).toBeUndefined();

  expect(await graphic.updateAction({ data: { score: NEW } })).toMatchObject({ statusCode: 200 });
  expect(layerHost(graphic, 'score')).toBe(host);
  expect(host.dataset.ografLayerKey).toBe('scoreline');
  expect(renderedContent(host)).toBe(NEW);
  await graphic.dispose();
});

describe('scheduled replay of a layer with style none', () => {
  it('does not fade that layer while another layer fades', async () => {
    const graphic = await replay([text('faded'), text('cut', own('none'))], 6);
    await graphic.goToTime({ timestamp: AT + 150 });
    expect(look(graphic, 'cut').opacity).toBe(1);
    expect(look(graphic, 'faded').opacity).toBeCloseTo(0.5, 2);
    await graphic.dispose();
  });

  it('switches its value with the fading layer, as the single on-air data change does', async () => {
    const graphic = await replay([text('faded'), text('cut', own('none'))], 6);
    expect((await at(graphic, AT + 299, 'cut')).content).toBe(OLD);
    expect((await at(graphic, AT + 300, 'cut')).content).toBe(NEW);
    await graphic.dispose();
  });

  it('switches at once when no changed layer animates', async () => {
    const graphic = await replay([text('cut', own('none'))], 6);
    expect(await at(graphic, AT, 'cut')).toMatchObject({ opacity: 1, content: NEW });
    expect(await at(graphic, AT + 150, 'cut')).toMatchObject({ opacity: 1, content: NEW });
    await graphic.dispose();
  });

  it('ignores a duration set on the layer', async () => {
    const graphic = await replay([text('cut', own('none', 20))], 6);
    expect(await at(graphic, AT + 100, 'cut')).toMatchObject({ opacity: 1, content: NEW });
    await graphic.dispose();
  });
});

describe('scheduled replay of a layer with its own duration', () => {
  it('runs for that duration, not the composition one', async () => {
    const graphic = await replay([text('slow', own('crossfade', 20))], 6);
    // The composition's six frames would have finished at AT + 600.
    const fadingOut = await at(graphic, AT + 700, 'slow');
    expect(fadingOut.opacity).toBeCloseTo(1 - cssEaseInOut(0.7), 2);
    expect(fadingOut.content).toBe(OLD);
    expect(await at(graphic, AT + 1000, 'slow')).toMatchObject({ opacity: 0, content: NEW });
    expect((await at(graphic, AT + 1500, 'slow')).opacity).toBeCloseTo(0.5, 2);
    expect(await at(graphic, AT + 2000, 'slow')).toMatchObject({ opacity: 1, content: NEW });
    await graphic.dispose();
  });

  it('leaves a layer without its own duration on the composition one', async () => {
    const graphic = await replay([text('slow', own('crossfade', 20)), text('plain')], 6);
    expect((await at(graphic, AT + 150, 'plain')).opacity).toBeCloseTo(0.5, 2);
    await graphic.dispose();
  });

  it('switches every value when the longest out half ends, holding shorter layers out', async () => {
    const graphic = await replay(
      [text('short', own('crossfade', 4)), text('long', own('crossfade', 20))],
      6,
    );
    expect((await at(graphic, AT + 100, 'short')).opacity).toBeCloseTo(0.5, 2);
    // Its own out half ended at AT + 200, and on air it stays out until the shared data change.
    expect(await at(graphic, AT + 600, 'short')).toMatchObject({ opacity: 0, content: OLD });
    expect(await at(graphic, AT + 1000, 'short')).toMatchObject({ opacity: 0, content: NEW });
    expect((await at(graphic, AT + 1100, 'short')).opacity).toBeCloseTo(0.5, 2);
    expect(await at(graphic, AT + 1200, 'short')).toMatchObject({ opacity: 1, content: NEW });
    expect((await at(graphic, AT + 1500, 'long')).opacity).toBeCloseTo(0.5, 2);
    expect((await at(graphic, AT + 2000, 'long')).opacity).toBe(1);
    await graphic.dispose();
  });
});

describe('scheduled replay when the composition update duration is 0', () => {
  it('still runs a layer override', async () => {
    const graphic = await replay([text('slow', own('crossfade', 10))], 0);
    const fadingOut = await at(graphic, AT + 250, 'slow');
    expect(fadingOut.opacity).toBeCloseTo(0.5, 2);
    expect(fadingOut.content).toBe(OLD);
    expect(await at(graphic, AT + 500, 'slow')).toMatchObject({ opacity: 0, content: NEW });
    expect((await at(graphic, AT + 750, 'slow')).opacity).toBeCloseTo(0.5, 2);
    expect(await at(graphic, AT + 1000, 'slow')).toMatchObject({ opacity: 1, content: NEW });
    await graphic.dispose();
  });

  it('cuts a layer with no override, at the shared data change', async () => {
    const graphic = await replay([text('slow', own('crossfade', 10)), text('plain')], 0);
    expect(await at(graphic, AT + 250, 'plain')).toMatchObject({ opacity: 1, content: OLD });
    expect(await at(graphic, AT + 500, 'plain')).toMatchObject({ opacity: 1, content: NEW });
    await graphic.dispose();
  });

  it('switches at once when no layer has an override', async () => {
    const graphic = await replay([text('plain')], 0);
    expect(await at(graphic, AT, 'plain')).toMatchObject({ opacity: 1, content: NEW });
    await graphic.dispose();
  });
});

describe('scheduled replay of a slide', () => {
  it.each([
    ['slide-left', -40, 0],
    ['slide-right', 40, 0],
    ['slide-up', 0, -40],
    ['slide-down', 0, 40],
  ] as const)('%s leaves and comes back from the same side', async (style, x, y) => {
    const graphic = await replay([text('moving', own(style, 0, 40))], 6);

    const leaving = await at(graphic, AT + 150, 'moving');
    expect(leaving.x).toBeCloseTo(x / 2, 1);
    expect(leaving.y).toBeCloseTo(y / 2, 1);
    expect(leaving.opacity).toBeCloseTo(0.5, 2);
    expect(leaving.content).toBe(OLD);

    expect(await at(graphic, AT + 300, 'moving')).toMatchObject({
      x,
      y,
      opacity: 0,
      content: NEW,
    });

    const returning = await at(graphic, AT + 450, 'moving');
    expect(returning.x).toBeCloseTo(x / 2, 1);
    expect(returning.y).toBeCloseTo(y / 2, 1);
    expect(returning.opacity).toBeCloseTo(0.5, 2);

    expect(await at(graphic, AT + 600, 'moving')).toMatchObject({ x: 0, y: 0, opacity: 1 });
    await graphic.dispose();
  });

  it('moves in pixels across its own duration', async () => {
    const graphic = await replay([text('moving', own('slide-right', 10, 100))], 0);
    expect((await at(graphic, AT + 500, 'moving')).x).toBe(100);
    await graphic.dispose();
  });

  it('does not move a crossfade', async () => {
    const graphic = await replay([text('faded', own('crossfade'))], 6);
    await graphic.goToTime({ timestamp: AT + 150 });
    expect(contentStyle(graphic, 'faded').translate ?? '').toBe('');
    await graphic.dispose();
  });

  it('keeps the transform text uses for baseline shift and squeeze', async () => {
    const graphic = await replay([text('moving', own('slide-left', 0, 40))], 6);
    contentStyle(graphic, 'moving').transform = 'scale(0.5, 1) translateY(4px)';
    for (const timestamp of [AT + 150, AT + 300, AT + 600, 0]) {
      await graphic.goToTime({ timestamp });
      expect(contentStyle(graphic, 'moving').transform).toBe('scale(0.5, 1) translateY(4px)');
    }
    await graphic.dispose();
  });
});

describe('scheduled replay easing', () => {
  it('samples the same curve the on-air animation asks the browser for', async () => {
    const graphic = await replay([text('faded')], 10);
    // Halfway through the out half is 0.5 on any symmetric curve; a quarter of it is not.
    expect((await at(graphic, AT + 125, 'faded')).opacity).toBeCloseTo(0.871, 2);
    expect((await at(graphic, AT + 375, 'faded')).opacity).toBeCloseTo(0.129, 2);
    expect((await at(graphic, AT + 625, 'faded')).opacity).toBeCloseTo(0.129, 2);
    expect((await at(graphic, AT + 875, 'faded')).opacity).toBeCloseTo(0.871, 2);
    await graphic.dispose();
  });
});

describe('scheduled replay across seeks', () => {
  const layers = () => [
    text('plain'),
    text('cut', own('none')),
    text('slow', own('crossfade', 20)),
    text('left', own('slide-left', 8, 30)),
    text('down', own('slide-down', 0, 12)),
  ];
  const ids = layers().map((layer) => layer.id);
  const picture = (graphic: GraphicElement) =>
    Object.fromEntries(ids.map((id) => [id, look(graphic, id)]));

  it('draws each time the same whatever was sampled before it', async () => {
    const times = [
      500,
      AT,
      AT + 100,
      AT + 300,
      AT + 700,
      AT + 1000,
      AT + 1200,
      AT + 1500,
      AT + 2000,
      AT + 4000,
    ];
    const expected = new Map<number, ReturnType<typeof picture>>();
    for (const timestamp of times) {
      const fresh = await replay(layers(), 6);
      await fresh.goToTime({ timestamp });
      expected.set(timestamp, picture(fresh));
      await fresh.dispose();
    }

    const scrubbed = await replay(layers(), 6);
    const hops = [AT + 1500, AT + 100, AT + 4000, AT + 700, 500, AT + 1000];
    for (const timestamp of [...times, ...[...times].reverse(), ...hops]) {
      await scrubbed.goToTime({ timestamp });
      expect(picture(scrubbed), `at ${timestamp}`).toEqual(expected.get(timestamp));
    }
    await scrubbed.dispose();
  });

  it('draws nothing of the update once a seek goes back before it', async () => {
    const graphic = await replay(layers(), 6);
    await graphic.goToTime({ timestamp: AT + 300 });
    await graphic.goToTime({ timestamp: AT - 1 });
    for (const id of ids) {
      expect(contentStyle(graphic, id).opacity ?? '').toBe('');
      expect(contentStyle(graphic, id).translate ?? '').toBe('');
      expect(look(graphic, id).content).toBe(OLD);
    }
    await graphic.dispose();
  });

  it('clears a sampled update when the schedule is emptied', async () => {
    const graphic = await replay([text('left', own('slide-left', 8, 30))], 6);
    await graphic.goToTime({ timestamp: AT + 200 });
    expect(look(graphic, 'left').x).toBeLessThan(0);
    await graphic.setActionsSchedule({ schedule: [] });
    expect(contentStyle(graphic, 'left').opacity ?? '').toBe('');
    expect(contentStyle(graphic, 'left').translate ?? '').toBe('');
    await graphic.dispose();
  });

  it('leaves the opacity of a running Rules fade alone', async () => {
    const hidden = text('hidden');
    hidden.bindings = [];
    hidden.visualRules = [
      {
        id: 'hide',
        name: 'Hide on flag',
        enabled: true,
        trigger: 'data',
        dataKey: 'flag',
        sourcePath: [],
        operator: 'equals',
        value: 'HIDE',
        actions: [{ type: 'visibility', visible: false, transitionFrames: 10 }],
      },
    ] as NonNullable<CompiledLayer['visualRules']>;
    const graphic = await loaded(compiled([hidden], 6), 'non-realtime', { flag: 'SHOW' });
    await graphic.setActionsSchedule({ schedule: [play, update(AT, { flag: 'HIDE' })] });
    // The data fade ends at AT + 600; the rule took over at its midpoint and runs until AT + 1300.
    await graphic.goToTime({ timestamp: AT + 800 });
    expect(look(graphic, 'hidden').opacity).toBeCloseTo(0.5, 1);
    await graphic.dispose();
  });

  it('skips the motion on skipAnimation, even for a layer with its own duration', async () => {
    const graphic = await replay([text('slow', own('slide-left', 20, 40))], 6, {
      skipAnimation: true,
    });
    expect(await at(graphic, AT, 'slow')).toMatchObject({ opacity: 1, x: 0, content: NEW });
    await graphic.dispose();
  });

  it('does not touch a layer whose key the update does not change', async () => {
    const source = compiled([text('changed'), text('other')], 6);
    const graphic = await loaded(source, 'non-realtime', every(source.layers, OLD));
    await graphic.setActionsSchedule({ schedule: [play, update(AT, { changed: NEW })] });
    expect(await at(graphic, AT + 150, 'other')).toMatchObject({ opacity: 1, x: 0, content: OLD });
    expect((await at(graphic, AT + 150, 'changed')).opacity).toBeCloseTo(0.5, 2);
    await graphic.dispose();
  });
});

describe('scheduled replay of chart and text animations started by an update', () => {
  const chart = (updateTransition?: LayerUpdateTransition) =>
    compiledLayer(
      'chart',
      createChartElement({
        animation: {
          type: 'grow',
          durationFrames: 20,
          delayFrames: 0,
          staggerFrames: 0,
          easing: 'linear',
          replayOnUpdate: true,
        },
      }),
      [{ dataKey: 'chart', targetProperty: 'data' }],
      updateTransition,
    );
  const chartData = (values: number[]) => {
    const { data } = createChartElement();
    return { ...data, datasets: [{ ...data.datasets[0]!, data: values }] };
  };
  const chartFrame = (graphic: GraphicElement) =>
    Number(layerHost(graphic, 'chart').dataset.ografChartAnimationFrame);

  const chartGraphic = async (layers: CompiledLayer[], frames: number, skipAnimation?: boolean) => {
    const others = layers.filter((layer) => layer.id !== 'chart');
    const graphic = await loaded(compiled(layers, frames), 'non-realtime', {
      chart: chartData([1, 2, 3, 4]),
      ...every(others, OLD),
    });
    await graphic.setActionsSchedule({
      schedule: [
        play,
        update(AT, { chart: chartData([4, 3, 2, 1]), ...every(others, NEW) }, skipAnimation),
      ],
    });
    return graphic;
  };

  it('keeps a chart settled through the out half and starts it at the data change', async () => {
    const graphic = await chartGraphic([chart()], 6);
    await graphic.goToTime({ timestamp: AT + 100 });
    expect(chartFrame(graphic)).toBeGreaterThanOrEqual(20);
    await graphic.goToTime({ timestamp: AT + 300 });
    expect(chartFrame(graphic)).toBe(0);
    await graphic.goToTime({ timestamp: AT + 800 });
    expect(chartFrame(graphic)).toBeCloseTo(5);
    await graphic.dispose();
  });

  it('starts a short chart at the shared data change a longer layer sets', async () => {
    const graphic = await chartGraphic(
      [chart(own('crossfade', 4)), text('slow', own('crossfade', 20))],
      6,
    );
    // The chart's own half is 200 ms, but on air it starts with the data at AT + 1000.
    await graphic.goToTime({ timestamp: AT + 500 });
    expect(chartFrame(graphic)).toBeGreaterThanOrEqual(20);
    await graphic.goToTime({ timestamp: AT + 1000 });
    expect(chartFrame(graphic)).toBe(0);
    await graphic.dispose();
  });

  it('makes a none chart wait for the shared data change too', async () => {
    const graphic = await chartGraphic([chart(own('none')), text('slow', own('crossfade', 20))], 0);
    await graphic.goToTime({ timestamp: AT + 500 });
    expect(chartFrame(graphic)).toBeGreaterThanOrEqual(20);
    await graphic.goToTime({ timestamp: AT + 1000 });
    expect(chartFrame(graphic)).toBe(0);
    await graphic.dispose();
  });

  it('starts a none chart at the update when nothing else animates', async () => {
    const graphic = await chartGraphic([chart(own('none'))], 6);
    await graphic.goToTime({ timestamp: AT });
    expect(chartFrame(graphic)).toBe(0);
    await graphic.dispose();
  });

  it('settles a chart at once on skipAnimation', async () => {
    const graphic = await chartGraphic([chart(own('crossfade', 20))], 6, true);
    await graphic.goToTime({ timestamp: AT });
    expect(chartFrame(graphic)).toBeGreaterThanOrEqual(20);
    await graphic.dispose();
  });

  const typed = (updateTransition?: LayerUpdateTransition) =>
    compiledLayer(
      'typed',
      createTextElement({
        content: 'typed',
        textAnimation: normalizeTextAnimation({
          type: 'fade',
          durationFrames: 20,
          replayOnUpdate: true,
        }),
      }),
      [{ dataKey: 'typed', targetProperty: 'content' }],
      updateTransition,
    );
  const textFrame = (graphic: GraphicElement) =>
    Number(layerHost(graphic, 'typed').dataset.ografTextAnimationFrame);
  const lastPrevious = (graphic: GraphicElement) =>
    mock.previousText.mock.calls
      .filter((call) => call[0] === layerHost(graphic, 'typed'))
      .at(-1)?.[1] as { content?: string } | null | undefined;

  it('keeps text settled through the out half and replays it at the data change', async () => {
    const graphic = await replay([typed()], 6);
    await graphic.goToTime({ timestamp: AT + 100 });
    // Not yet replaying: the frame still follows the timeline, as it did before the update.
    expect(textFrame(graphic)).toBe(10);
    expect(lastPrevious(graphic)).toBeNull();
    await graphic.goToTime({ timestamp: AT + 300 });
    expect(textFrame(graphic)).toBe(0);
    expect(lastPrevious(graphic)?.content).toBe(OLD);
    await graphic.goToTime({ timestamp: AT + 800 });
    expect(textFrame(graphic)).toBeCloseTo(5);
    await graphic.dispose();
  });

  it('starts short text at the shared data change a longer layer sets', async () => {
    const graphic = await replay(
      [typed(own('crossfade', 4)), text('slow', own('crossfade', 20))],
      6,
    );
    await graphic.goToTime({ timestamp: AT + 500 });
    expect(textFrame(graphic)).toBe(10);
    await graphic.goToTime({ timestamp: AT + 1000 });
    expect(textFrame(graphic)).toBe(0);
    await graphic.dispose();
  });

  it('settles text replay when a newer update cuts its pending swap short', async () => {
    const layer = typed(own('crossfade', 20));
    const source = compiled([layer], 6);
    source.updateInterruption = 'replace';
    const graphic = await loaded(source, 'non-realtime', { typed: OLD });
    await graphic.setActionsSchedule({
      schedule: [play, update(AT, { typed: NEW }), update(AT + 200, { unrelated: 1 })],
    });
    await graphic.goToTime({ timestamp: AT + 300 });
    expect(look(graphic, 'typed')).toMatchObject({ opacity: 1, content: NEW });
    if (layer.element.type !== 'text') throw Error('Expected text');
    expect(textFrame(graphic)).toBe(textAnimationTotalFrames(layer.element.textAnimation));
    await graphic.dispose();
  });

  it.each(['text', 'chart'] as const)(
    'settles interrupted %s FX to the same sample as live replacement, including backward seeks',
    async (kind) => {
      const source = compiled(
        [kind === 'text' ? typed(own('crossfade', 20)) : chart(own('crossfade', 20))],
        6,
      );
      source.updateInterruption = 'replace';
      const initial = kind === 'text' ? { typed: OLD } : { chart: chartData([1, 2, 3, 4]) };
      const patch = kind === 'text' ? { typed: NEW } : { chart: chartData([4, 3, 2, 1]) };
      const sample = (graphic: GraphicElement) =>
        kind === 'text' ? textFrame(graphic) : chartFrame(graphic);
      const live = await loaded(source, 'realtime', initial);
      let replacement: Promise<unknown> | undefined;
      mock.hooks.afterAnimate = () => {
        mock.hooks.afterAnimate = null;
        replacement = live.updateAction({ data: { unrelated: 1 } });
      };
      expect(await live.updateAction({ data: patch })).toMatchObject({ statusCode: 200 });
      expect(await replacement).toMatchObject({ statusCode: 200 });
      const settledFrame = sample(live);
      expect(settledFrame).toBeGreaterThanOrEqual(20);
      await live.dispose();

      const replayed = await loaded(source, 'non-realtime', initial);
      await replayed.setActionsSchedule({
        schedule: [play, update(AT, patch), update(AT + 200, { unrelated: 1 })],
      });
      for (const elapsed of [300, 1100, 100, 300]) {
        expect(await replayed.goToTime({ timestamp: AT + elapsed })).toMatchObject({
          statusCode: 200,
        });
        if (elapsed >= 200) expect(sample(replayed)).toBe(settledFrame);
        if (kind === 'text')
          expect(look(replayed, 'typed').content).toBe(elapsed < 200 ? OLD : NEW);
      }
      await replayed.dispose();
    },
  );
});

describe('scheduled rule work around an update', () => {
  const ruled = (updateTransition?: LayerUpdateTransition) => {
    const layer = text('ruled', updateTransition);
    layer.bindings = [];
    layer.visualRules = [
      {
        id: 'hide',
        name: 'Hide on flag',
        enabled: true,
        trigger: 'data',
        dataKey: 'flag',
        sourcePath: [],
        operator: 'equals',
        value: 'HIDE',
        actions: [{ type: 'visibility', visible: false, transitionFrames: 0 }],
      },
    ] as NonNullable<CompiledLayer['visualRules']>;
    return layer;
  };

  it('reacts at the data change a layer override sets', async () => {
    const graphic = await loaded(compiled([ruled(own('crossfade', 20))], 0), 'non-realtime', {
      flag: 'SHOW',
    });
    await graphic.setActionsSchedule({ schedule: [play, update(AT, { flag: 'HIDE' })] });
    await graphic.goToTime({ timestamp: AT + 500 });
    expect(layerHost(graphic, 'ruled').style.display).not.toBe('none');
    await graphic.goToTime({ timestamp: AT + 1000 });
    expect(layerHost(graphic, 'ruled').style.display).toBe('none');
    await graphic.dispose();
  });

  it('reacts at once when the layer cuts', async () => {
    const graphic = await loaded(compiled([ruled(own('none'))], 6), 'non-realtime', {
      flag: 'SHOW',
    });
    await graphic.setActionsSchedule({ schedule: [play, update(AT, { flag: 'HIDE' })] });
    await graphic.goToTime({ timestamp: AT });
    expect(layerHost(graphic, 'ruled').style.display).toBe('none');
    await graphic.dispose();
  });
});

describe('scheduled replay of a change that waits behind a fade', () => {
  const FADE_MS = (6 / FRAME_RATE) * 1000;
  const ENDS = AT + FADE_MS;
  const layers = () => {
    const ruled = text('ruled', own('none'));
    ruled.bindings = [];
    ruled.visualRules = [
      {
        id: 'hide',
        name: 'Hide on flag',
        enabled: true,
        trigger: 'data',
        dataKey: 'flag',
        sourcePath: [],
        operator: 'equals',
        value: 'HIDE',
        actions: [{ type: 'visibility', visible: false, transitionFrames: 0 }],
      },
    ] as NonNullable<CompiledLayer['visualRules']>;
    return [text('a'), text('b'), ruled];
  };
  const after = async (arrives: number, timestamp: number) => {
    const graphic = await loaded(compiled(layers(), 6), 'non-realtime', {
      a: OLD,
      b: OLD,
      flag: 'SHOW',
    });
    await graphic.setActionsSchedule({
      schedule: [play, update(AT, { a: NEW }), update(arrives, { a: NEW, b: NEW, flag: 'HIDE' })],
    });
    await graphic.goToTime({ timestamp });
    const picture = {
      a: look(graphic, 'a'),
      b: look(graphic, 'b'),
      ruled: layerHost(graphic, 'ruled').style.display,
    };
    await graphic.dispose();
    return picture;
  };

  it('does nothing until the fade in front of it ends', async () => {
    const waiting = await after(AT + 10, ENDS - 1);
    expect(waiting.b).toMatchObject({ opacity: 1, content: OLD });
    expect(waiting.ruled).not.toBe('none');
  });

  it.each([0, 0.25, 0.5, 0.75, 1, 1.5])(
    'looks as if it were sent when that fade ended, %s fades on',
    async (fades) => {
      const timestamp = ENDS + FADE_MS * fades;
      expect(await after(AT + 10, timestamp)).toEqual(await after(ENDS, timestamp));
    },
  );

  it('still runs what arrives during the fade but is not an update', async () => {
    const graphic = await loaded(compiled(layers(), 6), 'non-realtime', {
      a: OLD,
      b: OLD,
      flag: 'SHOW',
    });
    await graphic.setActionsSchedule({
      schedule: [
        play,
        update(AT, { a: NEW }),
        update(AT + 10, { b: NEW }),
        { timestamp: AT + 20, action: { type: 'stopAction', params: { skipAnimation: true } } },
      ],
    });
    await graphic.goToTime({ timestamp: AT + 30 });
    expect(look(graphic, 'b')).toMatchObject({ content: OLD });
    await graphic.dispose();
  });
});

describe('the transform text keeps its baseline shift and squeeze in', () => {
  const OWN_TRANSFORM = 'scale(0.5, 1) translateY(4px)';

  it.each(['realtime', 'non-realtime'] as const)('survives a %s load', async (renderType) => {
    const source = compiled([text('a')], 6);
    class Graphic extends GraphicElement {
      static descriptor = source;
    }
    const graphic = new Graphic();
    // Connecting renders the layer, so load must not clear what that rendering measured.
    graphic.connectedCallback();
    contentStyle(graphic, 'a').transform = OWN_TRANSFORM;
    await graphic.load({ renderType, renderCharacteristics: {}, data: { a: 'a' } });
    expect(contentStyle(graphic, 'a').transform).toBe(OWN_TRANSFORM);
    await graphic.dispose();
  });

  it('survives an on-air update of another layer', async () => {
    const graphic = await loaded(compiled([text('a'), text('b')], 6), 'realtime', {
      a: OLD,
      b: OLD,
    });
    contentStyle(graphic, 'a').transform = OWN_TRANSFORM;
    await graphic.updateAction({ data: { b: NEW } });
    expect(contentStyle(graphic, 'a').transform).toBe(OWN_TRANSFORM);
    await graphic.dispose();
  });

  it('survives an on-air update of the layer itself', async () => {
    const graphic = await loaded(compiled([text('a')], 6), 'realtime', { a: OLD });
    contentStyle(graphic, 'a').transform = OWN_TRANSFORM;
    await graphic.updateAction({ data: { a: NEW } });
    expect(contentStyle(graphic, 'a').transform).toBe(OWN_TRANSFORM);
    await graphic.dispose();
  });

  it('is not animated over, because an animation would replace it', async () => {
    const graphic = await loaded(compiled([text('a', own('slide-left'))], 6), 'realtime', {
      a: OLD,
    });
    await graphic.updateAction({ data: { a: NEW } });
    expect(mock.animations).toHaveLength(2);
    for (const { keyframes } of mock.animations)
      for (const keyframe of keyframes) expect(keyframe).not.toHaveProperty('transform');
    await graphic.dispose();
  });

  it('is not animated over when a collection item moves to another slot', async () => {
    const row = (id: string, slot: number): CompiledLayer => ({
      ...compiledLayer(id, createTextElement({ content: id }), []),
      collectionItem: {
        collectionId: 'rows',
        dataKey: 'rows',
        slot,
        capacity: 2,
        itemKeyPath: ['id'],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
        offsetPerItem: { x: 0, y: 50 },
        prototypeLayerId: 'row',
      },
    });
    const graphic = await loaded(compiled([row('first', 0), row('second', 1)], 0), 'realtime', {
      rows: [{ id: 'x' }, { id: 'y' }],
    });
    await graphic.updateAction({ data: { rows: [{ id: 'y' }, { id: 'x' }] } });
    expect(mock.animations.map(({ layerId, keyframes }) => [layerId, keyframes])).toEqual([
      [
        'first',
        [
          { translate: '0px 50px', opacity: 0.65 },
          { translate: '0px 0px', opacity: 1 },
        ],
      ],
      [
        'second',
        [
          { translate: '0px -50px', opacity: 0.65 },
          { translate: '0px 0px', opacity: 1 },
        ],
      ],
    ]);
    await graphic.dispose();
  });
});

describe('on-air update motion', () => {
  it('slides out and back with the translate property', async () => {
    const graphic = await loaded(compiled([text('a', own('slide-left', 0, 40))], 6), 'realtime', {
      a: OLD,
    });
    await graphic.updateAction({ data: { a: NEW } });
    const resting = { opacity: 1, translate: '0px 0px' };
    const shifted = { opacity: 0, translate: '-40px 0px' };
    expect(mock.animations.map((animation) => animation.keyframes)).toEqual([
      [resting, shifted],
      [shifted, resting],
    ]);
    await graphic.dispose();
  });

  it('holds the out half until the in half has taken over', async () => {
    const graphic = await loaded(compiled([text('a')], 6), 'realtime', { a: OLD });
    const cancelledSoFar: boolean[] = [];
    mock.hooks.afterAnimate = () =>
      cancelledSoFar.push(...mock.animations.map((animation) => animation.cancelled));
    await graphic.updateAction({ data: { a: NEW } });
    // One check when the out half starts, and two when the in half does. By then the zero-length
    // hold has taken over from the out half, which it has to because a re-render replaces the node.
    expect(cancelledSoFar).toEqual([false, true, false]);
    await graphic.dispose();
  });

  it('leaves nothing running once the update has finished', async () => {
    const graphic = await loaded(
      compiled([text('a'), text('b', own('slide-up', 12))], 6),
      'realtime',
      { a: OLD, b: OLD },
    );
    await graphic.updateAction({ data: { a: NEW, b: NEW } });
    expect(mock.animations).toHaveLength(4);
    // The out halves are cancelled, and the in halves have no fill to keep applying.
    expect(mock.animations.map((animation) => animation.cancelled)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(mock.animations.slice(2).map((animation) => animation.fill)).toEqual(['none', 'none']);
    await graphic.dispose();
  });

  it('does not leave a layer held out when newer data replaces the update', async () => {
    const source = compiled([text('a'), text('b', own('none'))], 6);
    source.updateInterruption = 'replace';
    const graphic = await loaded(source, 'realtime', { a: OLD, b: OLD });
    let newer: Promise<unknown> | undefined;
    mock.hooks.afterAnimate = () => {
      // The in half has just started. Cancelling only that would expose the out half's held pose.
      if (mock.animations.length === 2) newer = graphic.updateAction({ data: { b: NEW } });
    };
    await graphic.updateAction({ data: { a: NEW } });
    await newer;
    expect(mock.animations[0]!.cancelled).toBe(true);
    expect(mock.animations[1]!.fill).toBe('none');
    await graphic.dispose();
  });
});

describe('an on-air update replaced while it waits for its new content', () => {
  it('does not start its in half over the newer update', async () => {
    const source = compiled([text('a'), text('b')], 6);
    source.updateInterruption = 'replace';
    const graphic = await loaded(source, 'realtime', { a: OLD, b: OLD });
    let release!: () => void;
    const contentArrives = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Once the out half has started, the next wait is the one between the two halves.
    mock.hooks.afterAnimate = () => {
      mock.hooks.afterAnimate = null;
      mock.hooks.contentReady = () => contentArrives;
    };
    const older = graphic.updateAction({ data: { a: NEW } });
    await vi.waitFor(() => expect(renderedContent(layerHost(graphic, 'a'))).toBe(NEW));

    mock.hooks.contentReady = null;
    await graphic.updateAction({ data: { b: NEW } });
    release();
    await older;

    expect(mock.animations.map((animation) => animation.layerId)).toEqual(['a', 'b', 'b']);
    expect(mock.animations.map((animation) => animation.cancelled)).toEqual([true, true, false]);
    expect(mock.animations.at(-1)!.fill).toBe('none');
    await graphic.dispose();
  });
});

describe('scheduled replay against what the same update does on air', () => {
  const CASES: Array<[string, () => CompiledLayer[], number]> = [
    ['an inherited crossfade', () => [text('a')], 6],
    ['style none beside a fade', () => [text('a'), text('b', own('none'))], 6],
    ['only style none', () => [text('a', own('none')), text('b', own('none', 10))], 6],
    ['a duration override', () => [text('a', own('crossfade', 20)), text('b')], 6],
    ['composition 0 with an override', () => [text('a', own('crossfade', 10)), text('b')], 0],
    ['composition 0 with no override', () => [text('a'), text('b')], 0],
    ['inherit style with its own duration', () => [text('a', own('inherit', 12))], 0],
    [
      'slides of different lengths',
      () => [text('a', own('slide-left', 0, 40)), text('b', own('slide-down', 8, 10))],
      6,
    ],
    [
      'a slide outliving a none layer',
      () => [text('a', own('slide-up', 15, 25)), text('b', own('none'))],
      4,
    ],
  ];

  const pose = (keyframe: Keyframe) => {
    const [x, y] = keyframe.translate.split(' ').map((part) => Number.parseFloat(part));
    return { opacity: keyframe.opacity, x: x!, y: y! };
  };

  /** Reads the visible result at `elapsed` ms from the animations an on-air update really started. */
  function onAirAt(calls: typeof mock.animations, id: string, elapsed: number) {
    const halves = calls.filter((call) => call.layerId === id);
    const firstInIndex = calls.findIndex((call) => call.shown === NEW);
    const switchMs = Math.max(
      0,
      ...calls.slice(0, firstInIndex < 0 ? calls.length : firstInIndex).map((c) => c.duration),
    );
    const out = elapsed < switchMs;
    const call = halves[out ? 0 : 1];
    const content = out ? OLD : NEW;
    if (!call) return { opacity: 1, x: 0, y: 0, content };
    expect(call.easing).toBe('ease-in-out');
    expect(call.shown).toBe(content);
    const progress = cssEaseInOut(
      Math.min(1, (out ? elapsed : elapsed - switchMs) / call.duration),
    );
    const [from, to] = [pose(call.keyframes[0]!), pose(call.keyframes[1]!)];
    return {
      opacity: from.opacity + (to.opacity - from.opacity) * progress,
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      content,
    };
  }

  it.each(CASES)('%s', async (_name, layers, frames) => {
    const live = await loaded(compiled(layers(), frames), 'realtime', every(layers(), OLD));
    expect(await live.updateAction({ data: every(layers(), NEW) })).toMatchObject({
      statusCode: 200,
    });
    const calls = [...mock.animations];
    await live.dispose();

    const replayed = await replay(layers(), frames);
    for (let elapsed = 0; elapsed <= 2200; elapsed += 50) {
      await replayed.goToTime({ timestamp: AT + elapsed });
      for (const { id } of layers()) {
        const expected = onAirAt(calls, id, elapsed);
        const actual = look(replayed, id);
        const where = `${id} at +${elapsed}`;
        expect(actual.content, where).toBe(expected.content);
        expect(actual.opacity, where).toBeCloseTo(expected.opacity, 2);
        expect(actual.x, where).toBeCloseTo(expected.x, 1);
        expect(actual.y, where).toBeCloseTo(expected.y, 1);
      }
    }
    await replayed.dispose();
  });
});

describe('scheduled replacement commits pending data with its Rules and clocks', () => {
  const replacementDescriptor = () => {
    const ruled = text('ruled', own('none'));
    ruled.bindings = [{ dataKey: 'flag', targetProperty: 'content' }];
    ruled.visualRules = [
      {
        id: 'mark-new-data',
        name: 'Mark when new data reaches air',
        enabled: true,
        trigger: 'data',
        dataKey: 'a',
        sourcePath: [],
        operator: 'equals',
        value: NEW,
        actions: [
          { type: 'set-data', fieldId: 'flag', dataKey: 'flag', mode: 'set', value: 'LANDED' },
        ],
      },
    ];
    const source = compiled([text('a', own('crossfade', 20)), ruled], 6);
    source.updateInterruption = 'replace';
    return source;
  };

  it('runs the pending data Rule immediately when live replacement settles its value', async () => {
    const graphic = await loaded(replacementDescriptor(), 'realtime', { a: OLD, flag: 'WAITING' });
    let replacement: Promise<unknown> | undefined;
    mock.hooks.afterAnimate = () => {
      mock.hooks.afterAnimate = null;
      replacement = graphic.updateAction({ data: { unrelated: 1 } });
    };
    await graphic.updateAction({ data: { a: NEW } });
    await replacement;
    expect(look(graphic, 'a').content).toBe(NEW);
    expect(look(graphic, 'ruled').content).toBe('LANDED');
    await graphic.dispose();
  });

  it('replays that Rule at replacement time, with no stale event after later or backward seeks', async () => {
    const graphic = await loaded(replacementDescriptor(), 'non-realtime', {
      a: OLD,
      flag: 'WAITING',
    });
    await graphic.setActionsSchedule({
      schedule: [play, update(AT, { a: NEW }), update(AT + 200, { unrelated: 1 })],
    });
    for (const elapsed of [250, 1100, 100, 250]) {
      expect(await graphic.goToTime({ timestamp: AT + elapsed })).toMatchObject({
        statusCode: 200,
      });
      expect(look(graphic, 'a').content).toBe(elapsed < 200 ? OLD : NEW);
      expect(look(graphic, 'ruled').content).toBe(elapsed < 200 ? 'WAITING' : 'LANDED');
    }
    await graphic.dispose();
  });

  it('moves a manual clock value to the replacement even while the next value fades', async () => {
    const timer = compiledLayer(
      'timer',
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 10000,
          source: 'manual',
          manualValue: 10000,
          autoStart: false,
          format: 'ss.SSS',
        }),
      }),
      [{ dataKey: 'remaining', targetProperty: 'clock.manualValue' }],
      own('none'),
    );
    const source = compiled(
      [text('a', own('crossfade', 20)), text('b', own('crossfade', 20)), timer],
      6,
    );
    source.updateInterruption = 'replace';
    const graphic = await loaded(source, 'non-realtime', { a: OLD, b: OLD, remaining: 10000 });
    await graphic.setActionsSchedule({
      schedule: [play, update(AT, { a: NEW, remaining: 5000 }), update(AT + 200, { b: NEW })],
    });
    for (const elapsed of [250, 1100, 100, 250]) {
      expect(await graphic.goToTime({ timestamp: AT + elapsed })).toMatchObject({
        statusCode: 200,
      });
      expect(renderedContent(layerHost(graphic, 'timer'))).toBe(
        elapsed < 200 ? '10.000' : '05.000',
      );
    }
    await graphic.dispose();
  });
});
