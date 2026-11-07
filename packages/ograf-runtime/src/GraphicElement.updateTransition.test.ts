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
  createRectangleLayer,
  createShaderPaint,
  createTextElement,
  normalizeTextAnimation,
  resolveShaderParameters,
  textAnimationTotalFrames,
  type Element,
  type LayerUpdateTransition,
  type ShaderPaint,
  type TextElement,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  const frames: FrameRequestCallback[] = [];
  const animations: Array<{
    layerId: string;
    duration: number;
    keyframes: Array<Record<string, unknown>>;
  }> = [];
  type FadeAnimation = {
    layerId: string;
    endOpacity: number;
    running: boolean;
    finished: Promise<void>;
    finish(): void;
    cancel(): void;
  };
  const fades = {
    /** While set, a fade runs until `finishFades` instead of finishing at once. */
    held: false,
    running: [] as FadeAnimation[],
    contentReady: Promise.resolve() as Promise<void>,
  };
  let nextFrameId = 0;
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
    layerId = '';
    /** As in a browser, `fill: 'forwards'` keeps a finished animation in force until cancelled. */
    inForce: FadeAnimation[] = [];
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
    animate(keyframes: Array<{ opacity: number }>, options: { duration: number; fill?: string }) {
      // A zero-length animation only holds re-rendered content hidden between the two halves.
      const holdOnly = options.duration === 0;
      if (!holdOnly) {
        animations.push({ layerId: this.layerId, duration: options.duration, keyframes });
      }
      let resolve = () => {};
      let reject = (_reason: unknown) => {};
      const finished = new Promise<void>((onFinish, onCancel) => {
        resolve = onFinish;
        reject = onCancel;
      });
      const stop = () => {
        animation.running = false;
        fades.running.splice(fades.running.indexOf(animation) >>> 0, 1);
      };
      const animation: FadeAnimation = {
        layerId: this.layerId,
        endOpacity: keyframes[1]!.opacity,
        running: true,
        finished,
        finish: () => {
          stop();
          // Without a fill, a finished animation stops applying by itself.
          if (options.fill === 'none')
            this.inForce.splice(this.inForce.indexOf(animation) >>> 0, 1);
          resolve();
        },
        cancel: () => {
          this.inForce.splice(this.inForce.indexOf(animation) >>> 0, 1);
          if (!animation.running) return;
          stop();
          reject(new Error('AbortError'));
        },
      };
      this.inForce.push(animation);
      fades.running.push(animation);
      if (!fades.held || holdOnly) animation.finish();
      return animation;
    }
  }
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return ++nextFrameId;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return {
    Host,
    frames,
    animations,
    fades,
    text: vi.fn(),
    previousText: vi.fn(),
    chart: vi.fn((host: HTMLElement, element: Element) => ({
      element,
      frame: Number(host.dataset.ografChartAnimationFrame),
    })),
  };
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
    // Every layer keeps one content element here, as charts, tickers and shader or media paints do.
    if (!host.firstElementChild) {
      host.firstElementChild = new mock.Host();
      host.firstElementChild.layerId = host.dataset.ografLayerId!;
    }
  },
  renderAnimatedElementAtTime: vi.fn(),
  applyAnimatedPaint: vi.fn(),
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: () => mock.fades.contentReady,
}));
import { GraphicElement } from './GraphicElement';

const FRAME_RATE = 10;
const UPDATE_FRAMES = 6;
/** Scheduled replay spreads the composition's update animation across the whole fade. */
const FADE_MS = (UPDATE_FRAMES / FRAME_RATE) * 1000;

const COMPLETE_DATA = {
  panelColor: '#101820',
  homeName: 'HOME',
  homeScore: '1',
  awayName: 'AWAY',
  awayScore: '0',
};
const BOUND_LAYER_IDS = ['panel', 'homeName', 'homeScore', 'awayName', 'awayScore'];

const SHADER_SOURCE = `#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.4;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`;

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

function rectangle(): Element {
  return createRectangleLayer().element;
}

function shaderRectangle(): Element {
  return {
    ...rectangle(),
    fill: createShaderPaint({ fragmentSource: SHADER_SOURCE }),
  } as Element;
}

function compiled(layers: CompiledLayer[]): CompiledGraphicDescriptor {
  return {
    width: 640,
    height: 360,
    frameRate: FRAME_RATE,
    backgroundColor: 'transparent',
    updateTransitionFrames: UPDATE_FRAMES,
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

/** The shape of the Scoreboard recipe: a bound panel, four bound texts, one unbound divider. */
function scoreboard(): CompiledGraphicDescriptor {
  const text = (id: string) =>
    compiledLayer(id, createTextElement({ content: id }), [
      { dataKey: id, targetProperty: 'content' },
    ]);
  return compiled([
    compiledLayer('panel', rectangle(), [{ dataKey: 'panelColor', targetProperty: 'fill' }]),
    compiledLayer('divider', rectangle(), []),
    text('homeName'),
    text('homeScore'),
    text('awayName'),
    text('awayScore'),
  ]);
}

async function loaded(
  source: CompiledGraphicDescriptor,
  renderType: 'realtime' | 'non-realtime',
  data: Record<string, unknown> = COMPLETE_DATA,
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

const rendered = (graphic: GraphicElement, id: string) =>
  JSON.parse(layerHost(graphic, id).dataset.ografRenderedElement!) as Element & {
    content?: string;
    fill?: ShaderPaint;
  };

const opacity = (graphic: GraphicElement, id: string) =>
  Number(layerHost(graphic, id).firstElementChild!.style.opacity || 1);

/** Everything a viewer could see of the bound layers at the current time. */
const picture = (graphic: GraphicElement, ids: string[] = BOUND_LAYER_IDS) =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      {
        opacity: opacity(graphic, id),
        element: layerHost(graphic, id).dataset.ografRenderedElement,
      },
    ]),
  );

const fadedLayers = () => [...new Set(mock.animations.map((entry) => entry.layerId))].sort();

const runningFades = () => [...new Set(mock.fades.running.map((fade) => fade.layerId))].sort();

const inForce = (graphic: GraphicElement, id: string) =>
  layerHost(graphic, id).firstElementChild!.inForce;

/** What a viewer sees of a layer: a running fade, else whatever holds the opacity once it ended. */
const painted = (graphic: GraphicElement, id: string) => {
  const latest = inForce(graphic, id).at(-1);
  if (latest) return latest.running ? 'fading' : latest.endOpacity;
  return opacity(graphic, id);
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

const finishFades = async () => {
  for (const fade of mock.fades.running.slice()) fade.finish();
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.frames.length = 0;
  mock.animations.length = 0;
  mock.fades.held = false;
  mock.fades.running.length = 0;
  mock.fades.contentReady = Promise.resolve();
});

describe('realtime updateAction with complete data', () => {
  it('fades only the layer whose value changed', async () => {
    const graphic = await loaded(scoreboard(), 'realtime');
    expect(
      await graphic.updateAction({ data: { ...COMPLETE_DATA, homeScore: '2' } }),
    ).toMatchObject({ statusCode: 200 });
    expect(fadedLayers()).toEqual(['homeScore']);
    // Out, then in.
    expect(mock.animations).toHaveLength(2);
    expect(rendered(graphic, 'homeScore').content).toBe('2');
    expect(rendered(graphic, 'awayScore').content).toBe('0');
    await graphic.dispose();
  });

  it('fades nothing when every value repeats the current one', async () => {
    const graphic = await loaded(scoreboard(), 'realtime');
    await graphic.updateAction({ data: { ...COMPLETE_DATA } });
    expect(mock.animations).toEqual([]);
    expect(rendered(graphic, 'homeScore').content).toBe('1');
    await graphic.dispose();
  });

  it('compares against what is on air, not against the load data', async () => {
    const graphic = await loaded(scoreboard(), 'realtime');
    await graphic.updateAction({ data: { ...COMPLETE_DATA, homeScore: '2' } });
    mock.animations.length = 0;
    await graphic.updateAction({ data: { ...COMPLETE_DATA, homeScore: '2' } });
    expect(mock.animations).toEqual([]);
    await graphic.updateAction({ data: { ...COMPLETE_DATA, homeScore: '1' } });
    expect(fadedLayers()).toEqual(['homeScore']);
    await graphic.dispose();
  });

  it('does not restart the fade for a repeat queued behind the change', async () => {
    const graphic = await loaded(scoreboard(), 'realtime');
    const update = { data: { ...COMPLETE_DATA, homeScore: '2' } };
    await Promise.all([graphic.updateAction(update), graphic.updateAction(update)]);
    expect(mock.animations).toHaveLength(2);
    await graphic.dispose();
  });

  it('still fades for a partial patch that changes a value', async () => {
    const graphic = await loaded(scoreboard(), 'realtime');
    await graphic.updateAction({ data: { homeScore: '2' } });
    expect(fadedLayers()).toEqual(['homeScore']);
    await graphic.dispose();
  });

  it('skips the fade on skipAnimation but still applies the value', async () => {
    const graphic = await loaded(scoreboard(), 'realtime');
    await graphic.updateAction({ data: { ...COMPLETE_DATA, homeScore: '2' }, skipAnimation: true });
    expect(mock.animations).toEqual([]);
    expect(rendered(graphic, 'homeScore').content).toBe('2');
    await graphic.dispose();
  });

  it('makes the same choice when newer data replaces a running fade', async () => {
    const source = scoreboard();
    source.updateInterruption = 'replace';
    const graphic = await loaded(source, 'realtime');
    const change = { data: { ...COMPLETE_DATA, homeScore: '2' } };
    await Promise.all([graphic.updateAction(change), graphic.updateAction(change)]);
    expect(fadedLayers()).toEqual(['homeScore']);
    expect(rendered(graphic, 'homeScore').content).toBe('2');
    mock.animations.length = 0;
    await graphic.updateAction(change);
    expect(mock.animations).toEqual([]);
    await graphic.dispose();
  });

  it('compares re-parsed object values by content', async () => {
    const gradient = {
      type: 'linear-gradient',
      angle: 90,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    const graphic = await loaded(scoreboard(), 'realtime', {
      ...COMPLETE_DATA,
      panelColor: gradient,
    });
    await graphic.updateAction({
      data: { ...COMPLETE_DATA, panelColor: JSON.parse(JSON.stringify(gradient)) },
    });
    expect(mock.animations).toEqual([]);
    await graphic.updateAction({
      data: {
        ...COMPLETE_DATA,
        panelColor: { ...gradient, stops: [gradient.stops[0], { offset: 1, color: '#ff0000' }] },
      },
    });
    expect(fadedLayers()).toEqual(['panel']);
    await graphic.dispose();
  });

  it('replays a chart only when its re-parsed data really changed', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const element = createChartElement({
      animation: {
        type: 'grow',
        durationFrames: 20,
        delayFrames: 0,
        staggerFrames: 0,
        easing: 'linear',
        replayOnUpdate: true,
      },
    });
    const chartData = (values: number[]) => ({
      ...element.data,
      datasets: [{ ...element.data.datasets[0]!, data: values }],
    });
    const source = compiled([
      compiledLayer('chart', element, [{ dataKey: 'chartData', targetProperty: 'data' }]),
    ]);
    const initial = chartData([10, 20, 30, 40]);
    const graphic = await loaded(source, 'realtime', { chartData: initial });
    try {
      // Settle the entrance so that any later animation frame can only be a replay.
      now = 5000;
      while (mock.frames.length) mock.frames.shift()!(now);

      await graphic.updateAction({ data: { chartData: JSON.parse(JSON.stringify(initial)) } });
      expect(mock.frames).toHaveLength(0);
      expect(mock.animations).toEqual([]);

      await graphic.updateAction({ data: { chartData: chartData([40, 30, 20, 10]) } });
      expect(mock.frames).toHaveLength(1);
      expect(fadedLayers()).toEqual(['chart']);
    } finally {
      clock.mockRestore();
      await graphic.dispose();
    }
  });
});

describe('data arriving mid-fade', () => {
  const onAir = async (
    updateInterruption: 'queue' | 'replace',
    source: CompiledGraphicDescriptor = scoreboard(),
    data: Record<string, unknown> = COMPLETE_DATA,
  ) => {
    source.updateInterruption = updateInterruption;
    const graphic = await loaded(source, 'realtime', data);
    mock.fades.held = true;
    return graphic;
  };
  const score = (value: string) => ({ data: { ...COMPLETE_DATA, homeScore: value } });
  const homeScore = (graphic: GraphicElement) => rendered(graphic, 'homeScore').content;

  describe('under Jump to newest data', () => {
    it('keeps values landing through a stream of changes faster than the fade', async () => {
      const graphic = await onAir('replace');
      const updates = [graphic.updateAction(score('2'))];
      await settle();
      expect(homeScore(graphic)).toBe('1');
      for (const value of ['3', '4', '5', '6']) {
        updates.push(graphic.updateAction(score(value)));
        await settle();
        // The fade it replaced ended with its own value on air.
        expect(homeScore(graphic)).toBe(String(Number(value) - 1));
        expect(runningFades()).toEqual(['homeScore']);
      }
      await finishFades();
      expect(homeScore(graphic)).toBe('6');
      await finishFades();
      await Promise.all(updates);
      expect(painted(graphic, 'homeScore')).toBe(1);
      await graphic.dispose();
    });

    it('lets a repeat of the data leave the running fade alone, in either phase', async () => {
      const graphic = await onAir('replace');
      const change = graphic.updateAction(score('2'));
      await settle();
      let repeatFinished = false;
      const repeats = [graphic.updateAction(score('2')), graphic.updateAction(score('2'))].map(
        (repeat) =>
          repeat.then((result) => {
            repeatFinished = true;
            return result;
          }),
      );
      await settle();
      expect(mock.animations).toHaveLength(1);
      expect(runningFades()).toEqual(['homeScore']);

      await finishFades();
      expect(homeScore(graphic)).toBe('2');
      repeats.push(graphic.updateAction(score('2')));
      await settle();
      expect(mock.animations).toHaveLength(2);
      expect(runningFades()).toEqual(['homeScore']);
      // A host waiting on a repeat waits until that data really is on air.
      expect(repeatFinished).toBe(false);

      await finishFades();
      for (const result of await Promise.all([change, ...repeats]))
        expect(result).toMatchObject({ statusCode: 200 });
      expect(painted(graphic, 'homeScore')).toBe(1);
      await graphic.dispose();
    });

    it('leaves no layer hidden when a change to another layer ends the fade', async () => {
      const graphic = await onAir('replace');
      const change = graphic.updateAction(score('2'));
      await settle();
      await finishFades();
      expect(runningFades()).toEqual(['homeScore']);

      const other = graphic.updateAction({ data: { ...score('2').data, awayScore: '9' } });
      await settle();
      expect(painted(graphic, 'homeScore')).toBe(1);
      expect(runningFades()).toEqual(['awayScore']);

      await finishFades();
      await finishFades();
      await Promise.all([change, other]);
      expect(painted(graphic, 'homeScore')).toBe(1);
      expect(painted(graphic, 'awayScore')).toBe(1);
      expect(rendered(graphic, 'awayScore').content).toBe('9');
      await graphic.dispose();
    });

    it('does not bring a replaced fade back in over the one that replaced it', async () => {
      const graphic = await onAir('replace');
      const change = graphic.updateAction(score('2'));
      await settle();
      // The out phase has ended and the new value is getting ready to fade in.
      let ready = () => {};
      mock.fades.contentReady = new Promise((resolve) => {
        ready = resolve;
      });
      await finishFades();
      expect(painted(graphic, 'homeScore')).toBe(0);

      const other = graphic.updateAction({ data: { ...score('2').data, awayScore: '9' } });
      await settle();
      expect(painted(graphic, 'homeScore')).toBe(1);

      mock.animations.length = 0;
      mock.fades.contentReady = Promise.resolve();
      ready();
      await settle();
      expect(mock.animations.map((entry) => entry.layerId)).toEqual(['awayScore']);
      expect(runningFades()).toEqual(['awayScore']);

      await finishFades();
      await finishFades();
      await Promise.all([change, other]);
      expect(painted(graphic, 'awayScore')).toBe(1);
      await graphic.dispose();
    });

    it('still replaces the fade when the host goes back to the value on air', async () => {
      const graphic = await onAir('replace');
      const change = graphic.updateAction(score('2'));
      await settle();
      const back = graphic.updateAction(score('1'));
      await settle();
      expect(homeScore(graphic)).toBe('2');
      await finishFades();
      expect(homeScore(graphic)).toBe('1');
      await finishFades();
      await Promise.all([change, back]);
      expect(painted(graphic, 'homeScore')).toBe(1);
      await graphic.dispose();
    });

    it('lands at once on a repeat that asks to skip the animation', async () => {
      const graphic = await onAir('replace');
      const change = graphic.updateAction(score('2'));
      await settle();
      await graphic.updateAction({ ...score('2'), skipAnimation: true });
      await change;
      expect(homeScore(graphic)).toBe('2');
      expect(painted(graphic, 'homeScore')).toBe(1);
      expect(runningFades()).toEqual([]);
      await graphic.dispose();
    });

    it('keeps both of two partial patches sent together', async () => {
      const graphic = await onAir('replace');
      const updates = [
        graphic.updateAction({ data: { homeScore: '2' } }),
        graphic.updateAction({ data: { awayScore: '9' } }),
      ];
      await settle();
      await finishFades();
      await finishFades();
      await Promise.all(updates);
      expect(homeScore(graphic)).toBe('2');
      expect(rendered(graphic, 'awayScore').content).toBe('9');
      await graphic.dispose();
    });

    it('keeps track of a change that replaced one still waiting to start', async () => {
      const graphic = await onAir('replace');
      const updates = [
        graphic.updateAction({ data: { homeScore: '2' } }),
        graphic.updateAction({ data: { awayScore: '9' } }),
      ];
      await settle();
      updates.push(graphic.updateAction({ data: { awayName: 'VISITORS' } }));
      await settle();
      expect(rendered(graphic, 'awayScore').content).toBe('9');
      await finishFades();
      await finishFades();
      await Promise.all(updates);
      expect(rendered(graphic, 'awayName').content).toBe('VISITORS');
      expect(homeScore(graphic)).toBe('2');
      await graphic.dispose();
    });

    it('keeps a partial patch that a later one replaces mid-fade', async () => {
      const graphic = await onAir('replace');
      const first = graphic.updateAction({ data: { homeScore: '2' } });
      await settle();
      const second = graphic.updateAction({ data: { awayScore: '9' } });
      await settle();
      expect(homeScore(graphic)).toBe('2');
      await finishFades();
      await finishFades();
      await Promise.all([first, second]);
      expect(rendered(graphic, 'awayScore').content).toBe('9');
      expect(painted(graphic, 'homeScore')).toBe(1);
      await graphic.dispose();
    });

    it('does not let data it refuses end the running fade', async () => {
      const source = compiled([
        compiledLayer('panel', shaderRectangle(), [
          { dataKey: 'gain', targetProperty: 'fill.parameters.gain' },
        ]),
        compiledLayer('title', createTextElement({ content: 'One' }), [
          { dataKey: 'title', targetProperty: 'content' },
        ]),
      ]);
      const graphic = await onAir('replace', source, { gain: 0.5, title: 'One' });
      const change = graphic.updateAction({ data: { title: 'Two' } });
      await settle();
      const refused = await graphic.updateAction({ data: { title: 'Three', gain: 'loud' } });
      expect(refused?.statusCode).not.toBe(200);
      expect(rendered(graphic, 'title').content).toBe('One');
      expect(runningFades()).toEqual(['title']);
      await finishFades();
      expect(rendered(graphic, 'title').content).toBe('Two');
      await finishFades();
      expect(await change).toMatchObject({ statusCode: 200 });
      await graphic.dispose();
    });

    it('settles the animated text of a change it replaces instead of replaying it', async () => {
      const source = compiled([
        compiledLayer(
          'title',
          createTextElement({
            content: 'One',
            textAnimation: {
              ...normalizeTextAnimation(undefined),
              type: 'fade',
              replayOnUpdate: true,
            },
          }),
          [{ dataKey: 'title', targetProperty: 'content' }],
        ),
      ]);
      const graphic = await onAir('replace', source, { title: 'One' });
      const first = graphic.updateAction({ data: { title: 'Two' } });
      await settle();
      mock.text.mockClear();
      const second = graphic.updateAction({ data: { title: 'Three' } });
      await settle();
      expect(rendered(graphic, 'title').content).toBe('Two');
      const total = textAnimationTotalFrames(
        (rendered(graphic, 'title') as unknown as TextElement).textAnimation,
      );
      expect(mock.text.mock.calls.at(-1)?.[2]).toBe(total);
      await finishFades();
      await finishFades();
      await Promise.all([first, second]);
      await graphic.dispose();
    });

    it('settles the chart of a change it replaces instead of replaying it', async () => {
      const element = createChartElement({
        animation: {
          type: 'grow',
          durationFrames: 20,
          delayFrames: 0,
          staggerFrames: 0,
          easing: 'linear',
          replayOnUpdate: true,
        },
      });
      const chartData = (values: number[]) => ({
        ...element.data,
        datasets: [{ ...element.data.datasets[0]!, data: values }],
      });
      const source = compiled([
        compiledLayer('chart', element, [{ dataKey: 'chartData', targetProperty: 'data' }]),
      ]);
      const graphic = await onAir('replace', source, { chartData: chartData([1, 2, 3, 4]) });
      const first = graphic.updateAction({ data: { chartData: chartData([4, 3, 2, 1]) } });
      await settle();
      const second = graphic.updateAction({ data: { chartData: chartData([9, 9, 9, 9]) } });
      await settle();
      expect(Number(layerHost(graphic, 'chart').dataset.ografChartAnimationFrame)).toBe(20);
      await finishFades();
      await finishFades();
      await Promise.all([first, second]);
      await graphic.dispose();
    });

    it.each([
      ['after its fade', {}],
      ['without a fade', { skipAnimation: true }],
    ])('does not bring back a change that landed %s', async (_name, options) => {
      const source = scoreboard();
      source.customActions = [{ id: 'correct', name: 'Correct', schema: {} }] as never;
      const graphic = await onAir('replace', source);
      mock.fades.held = false;
      await graphic.updateAction({ ...score('2'), ...options });
      await graphic.customAction({ id: 'correct', payload: { homeScore: '5' } });
      expect(homeScore(graphic)).toBe('5');
      await graphic.updateAction({ data: { awayScore: '9' } });
      expect(homeScore(graphic)).toBe('5');
      await graphic.dispose();
    });

    it('forgets a change that failed, and does not repeat its failure', async () => {
      const graphic = await onAir('replace');
      const broken = Promise.reject(new Error('Broken media'));
      broken.catch(() => {});
      mock.fades.contentReady = broken;
      expect((await graphic.updateAction(score('2')))?.statusMessage).toBe('Broken media');
      mock.fades.contentReady = Promise.resolve();

      expect(await graphic.updateAction({ data: { ...COMPLETE_DATA } })).toMatchObject({
        statusCode: 200,
      });
      expect(homeScore(graphic)).toBe('1');
      await graphic.dispose();
    });

    it('forgets the running fade when the graphic is loaded again', async () => {
      const graphic = await onAir('replace');
      const change = graphic.updateAction(score('2'));
      await settle();
      mock.fades.held = false;
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: {},
        data: COMPLETE_DATA,
      });
      await change;
      await graphic.playAction({ skipAnimation: true });
      await graphic.updateAction({ data: { awayScore: '9' } });
      expect(homeScore(graphic)).toBe('1');
      expect(rendered(graphic, 'awayScore').content).toBe('9');
      await graphic.dispose();
    });

    it('draws the same values and fades as scheduled replay', async () => {
      const steps = [
        { data: { ...COMPLETE_DATA, homeScore: '2' } },
        { data: { ...COMPLETE_DATA, homeScore: '2' } },
        { data: { ...COMPLETE_DATA, homeScore: '3' } },
        { data: { ...COMPLETE_DATA, homeScore: '3', awayName: 'VISITORS' } },
      ];
      const view = (graphic: GraphicElement) => ({
        homeScore: homeScore(graphic),
        awayName: rendered(graphic, 'awayName').content,
      });

      const live = await onAir('replace');
      const liveViews = [];
      const liveFades = [];
      const updates = [];
      for (const step of steps) {
        updates.push(live.updateAction(step));
        await settle();
        liveViews.push(view(live));
        liveFades.push(runningFades());
      }
      await finishFades();
      liveViews.push(view(live));
      await finishFades();
      await Promise.all(updates);
      liveViews.push(view(live));
      await live.dispose();

      mock.fades.held = false;
      const replaySource = scoreboard();
      replaySource.updateInterruption = 'replace';
      const replay = await loaded(replaySource, 'non-realtime');
      await replay.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          ...steps.map((step, index) => ({
            timestamp: 1000 + index * 50,
            action: { type: 'updateAction' as const, params: step },
          })),
        ],
      });
      const replayViews = [];
      const replayFades = [];
      for (const index of steps.keys()) {
        await replay.goToTime({ timestamp: 1000 + index * 50 + 10 });
        replayViews.push(view(replay));
        replayFades.push(BOUND_LAYER_IDS.filter((id) => opacity(replay, id) < 1).sort());
      }
      // Past the midpoint and past the end of the last fade.
      const lastFade = 1000 + (steps.length - 1) * 50;
      for (const timestamp of [lastFade + FADE_MS * 0.75, lastFade + FADE_MS + 100]) {
        await replay.goToTime({ timestamp });
        replayViews.push(view(replay));
      }
      await replay.dispose();

      expect(liveViews).toEqual(replayViews);
      expect(liveFades).toEqual(replayFades);
    });
  });

  describe('under Finish current fade first', () => {
    it('holds a change back until the fade in front of it has finished', async () => {
      const graphic = await onAir('queue');
      const updates = [graphic.updateAction(score('2')), graphic.updateAction(score('3'))];
      await settle();
      expect(homeScore(graphic)).toBe('1');
      await finishFades();
      expect(homeScore(graphic)).toBe('2');
      await finishFades();
      expect(homeScore(graphic)).toBe('2');
      await finishFades();
      expect(homeScore(graphic)).toBe('3');
      await finishFades();
      await Promise.all(updates);
      expect(mock.animations).toHaveLength(4);
      expect(painted(graphic, 'homeScore')).toBe(1);
      await graphic.dispose();
    });

    const FIRST = 1000;
    const steps = [
      score('2'),
      score('3'),
      { data: { ...COMPLETE_DATA, homeScore: '3', awayName: 'VISITORS' } },
    ];
    const replayOf = async () => {
      const graphic = await loaded(scoreboard(), 'non-realtime');
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          // All three arrive during the first fade.
          ...steps.map((step, index) => ({
            timestamp: FIRST + index * 50,
            action: { type: 'updateAction' as const, params: step },
          })),
        ],
      });
      return graphic;
    };

    it('draws the same values and fades as scheduled replay', async () => {
      const view = (graphic: GraphicElement) => ({
        homeScore: homeScore(graphic),
        awayName: rendered(graphic, 'awayName').content,
      });

      const live = await onAir('queue');
      const updates = steps.map((step) => live.updateAction(step));
      await settle();
      const liveViews = [view(live)];
      const liveFades = [runningFades()];
      // Each of the three updates fades out and back in.
      for (let half = 1; half <= 6; half += 1) {
        await finishFades();
        liveViews.push(view(live));
        liveFades.push(runningFades());
      }
      await Promise.all(updates);
      await live.dispose();

      mock.fades.held = false;
      const replay = await replayOf();
      const replayViews = [];
      const replayFades = [];
      const quarters = [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25];
      for (const quarter of quarters) {
        await replay.goToTime({ timestamp: FIRST + FADE_MS * quarter });
        replayViews.push(view(replay));
        replayFades.push(BOUND_LAYER_IDS.filter((id) => opacity(replay, id) < 1).sort());
      }
      await replay.dispose();

      expect(replayViews).toEqual(liveViews);
      expect(replayFades).toEqual(liveFades);
    });

    it('shows the same picture at a time however the seeks got there', async () => {
      mock.fades.held = false;
      const times = [
        FIRST - 100,
        FIRST + 60,
        FIRST + FADE_MS - 1,
        FIRST + FADE_MS,
        FIRST + FADE_MS * 1.75,
        FIRST + FADE_MS * 2.25,
        FIRST + FADE_MS * 3,
        FIRST + FADE_MS * 4,
      ];
      const fresh = new Map<number, unknown>();
      for (const timestamp of times) {
        const graphic = await replayOf();
        await graphic.goToTime({ timestamp });
        fresh.set(timestamp, picture(graphic));
        await graphic.dispose();
      }

      const graphic = await replayOf();
      const hops = [1, 6, 2, 7, 0, 4, 3, 5].map((index) => times[index]!);
      for (const timestamp of [...times, ...times.slice().reverse(), ...hops]) {
        await graphic.goToTime({ timestamp });
        expect(picture(graphic), `at ${timestamp}`).toEqual(fresh.get(timestamp));
      }
      await graphic.dispose();
    });

    it('ends on the newest value when a later change is already waiting at the seek', async () => {
      mock.fades.held = false;
      const graphic = await replayOf();
      // The third change has not started yet, and is not shown before its own fade reaches it.
      await graphic.goToTime({ timestamp: FIRST + FADE_MS * 1.25 });
      expect(rendered(graphic, 'homeScore').content).toBe('2');
      expect(rendered(graphic, 'awayName').content).not.toBe('VISITORS');
      await graphic.goToTime({ timestamp: FIRST + FADE_MS * 4 });
      expect(rendered(graphic, 'homeScore').content).toBe('3');
      expect(rendered(graphic, 'awayName').content).toBe('VISITORS');
      await graphic.dispose();
    });
  });

  describe('on a layer under a shader effect', () => {
    const withOutput = (graphic: GraphicElement, id: string) => {
      const output = new mock.Host();
      output.layerId = `${id}:output`;
      output.dataset.ografShaderEffectOutput = 'true';
      layerHost(graphic, id).appendChild(output);
      return output;
    };

    it('fades what shows, and leaves the input of the capture alone', async () => {
      const graphic = await onAir('queue');
      mock.fades.held = false;
      const output = withOutput(graphic, 'homeScore');
      await graphic.updateAction(score('2'));
      expect(mock.animations.map((animation) => animation.layerId)).toEqual([
        'homeScore:output',
        'homeScore:output',
      ]);
      expect(inForce(graphic, 'homeScore')).toEqual([]);
      expect(output.inForce).toEqual([]);
      await graphic.dispose();
    });

    it('keeps the new picture hidden until its fade starts', async () => {
      const graphic = await onAir('queue');
      const output = withOutput(graphic, 'homeScore');
      const update = graphic.updateAction(score('2'));
      await settle();
      await finishFades();
      // The zero-length hold that stands in until the content is ready, then the fade in.
      expect(output.inForce.map((fade) => fade.endOpacity)).toEqual([1]);
      expect(inForce(graphic, 'homeScore')).toEqual([]);
      await finishFades();
      await update;
      await graphic.dispose();
    });

    it('comes back to the blend opacity of an overlay', async () => {
      const graphic = await onAir('queue');
      mock.fades.held = false;
      const output = withOutput(graphic, 'homeScore');
      output.style.opacity = '0.5';
      await graphic.updateAction(score('2'));
      expect(mock.animations[0]!.keyframes[0]!.opacity).toBe(0.5);
      expect(mock.animations[1]!.keyframes[1]!.opacity).toBe(0.5);
      await graphic.dispose();
    });

    it('moves the content too when a Media input leaves it showing', async () => {
      const graphic = await onAir('queue');
      mock.fades.held = false;
      withOutput(graphic, 'homeScore');
      Object.assign(layerHost(graphic, 'homeScore'), {
        querySelectorAll: (selector: string) => (selector.includes('media-canvas') ? [{}] : []),
      });
      await graphic.updateAction(score('2'));
      expect(mock.animations.map((animation) => animation.layerId)).toEqual([
        'homeScore',
        'homeScore:output',
        'homeScore',
        'homeScore:output',
      ]);
      await graphic.dispose();
    });

    it('draws scheduled replay on the output, and takes it off again', async () => {
      mock.fades.held = false;
      const graphic = await loaded(scoreboard(), 'non-realtime');
      const output = withOutput(graphic, 'homeScore');
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          { timestamp: 1000, action: { type: 'updateAction', params: score('2') } },
        ],
      });
      await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.25 });
      expect(output.inForce).toHaveLength(1);
      expect(output.inForce[0]!.endOpacity).toBeGreaterThan(0);
      expect(output.inForce[0]!.endOpacity).toBeLessThan(1);
      expect(opacity(graphic, 'homeScore')).toBe(1);
      await graphic.goToTime({ timestamp: 1000 + FADE_MS * 2 });
      expect(output.inForce).toEqual([]);
      await graphic.dispose();
    });
  });

  describe('text fitted through its inline transform', () => {
    const SQUEEZED = 'scale(0.67, 1) translateY(12px)';

    it.each(['queue', 'replace'] as const)(
      'stays fitted while other layers update, under %s',
      async (policy) => {
        const graphic = await onAir(policy);
        mock.fades.held = false;
        const fitted = layerHost(graphic, 'awayName').firstElementChild!;
        const changed = layerHost(graphic, 'homeScore').firstElementChild!;
        fitted.style.transform = SQUEEZED;
        changed.style.transform = SQUEEZED;

        await graphic.updateAction(score('2'));
        expect(fitted.style.transform).toBe(SQUEEZED);
        expect(changed.style.transform).toBe(SQUEEZED);

        // A resend changes nothing, so nothing would render these layers again to restore it.
        await graphic.updateAction(score('2'));
        expect(fitted.style.transform).toBe(SQUEEZED);
        expect(changed.style.transform).toBe(SQUEEZED);
        await graphic.dispose();
      },
    );

    it('stays fitted when newer data ends a fade', async () => {
      const graphic = await onAir('replace');
      const fitted = layerHost(graphic, 'awayName').firstElementChild!;
      fitted.style.transform = SQUEEZED;
      const change = graphic.updateAction(score('2'));
      await settle();
      const newer = graphic.updateAction(score('3'));
      await settle();
      expect(fitted.style.transform).toBe(SQUEEZED);
      await finishFades();
      await finishFades();
      await Promise.all([change, newer]);
      await graphic.dispose();
    });

    it('is not overridden by the fade, which moves the layer with translate', async () => {
      const slide = (distance: number): LayerUpdateTransition => ({
        style: 'slide-left',
        durationFrames: 0,
        distance,
      });
      const source = compiled([
        compiledLayer(
          'slider',
          createTextElement({ content: 'One' }),
          [{ dataKey: 'slider', targetProperty: 'content' }],
          slide(30),
        ),
        compiledLayer('fader', createTextElement({ content: 'One' }), [
          { dataKey: 'fader', targetProperty: 'content' },
        ]),
      ]);
      const graphic = await onAir('queue', source, { slider: 'One', fader: 'One' });
      mock.fades.held = false;
      await graphic.updateAction({ data: { slider: 'Two', fader: 'Two' } });
      const frames = (id: string) =>
        mock.animations.filter((entry) => entry.layerId === id).map((entry) => entry.keyframes);
      expect(frames('slider')).toEqual([
        [
          { opacity: 1, translate: '0px 0px' },
          { opacity: 0, translate: '-30px 0px' },
        ],
        [
          { opacity: 0, translate: '-30px 0px' },
          { opacity: 1, translate: '0px 0px' },
        ],
      ]);
      for (const [from, to] of frames('fader')) {
        expect(from).not.toHaveProperty('transform');
        expect(to).not.toHaveProperty('transform');
      }
      await graphic.dispose();
    });
  });

  it.each(['queue', 'replace'] as const)(
    'leaves nothing holding the layer once a fade is over, under %s',
    async (policy) => {
      const graphic = await onAir(policy);
      const change = graphic.updateAction(score('2'));
      await settle();
      await finishFades();
      // The out phase holds the layer hidden only until the in phase takes over from it.
      expect(inForce(graphic, 'homeScore')).toHaveLength(1);
      await finishFades();
      await change;
      // A fill left in force would outrank the opacity a Rules fade writes to the same element.
      expect(inForce(graphic, 'homeScore')).toEqual([]);
      await graphic.dispose();
    },
  );
});

describe('shader parameter bindings', () => {
  const stroked = () =>
    ({
      ...createTextElement({ content: 'stroked' }),
      strokePaint: createShaderPaint({ fragmentSource: SHADER_SOURCE }),
    }) as Element;
  const paintOf = (element: Element & { strokePaint?: ShaderPaint; fill?: ShaderPaint }) =>
    element.type === 'shader' ? (element as ShaderPaint) : (element.strokePaint ?? element.fill)!;

  it.each([
    ['a fill', shaderRectangle, 'fill.parameters.gain'],
    ['a stroke', stroked, 'strokePaint.parameters.gain'],
    [
      'a shader object',
      () => createShaderPaint({ fragmentSource: SHADER_SOURCE }) as unknown as Element,
      'parameters.gain',
    ],
  ])('apply a new value to %s at once, without a fade', async (_name, element, targetProperty) => {
    const source = compiled([
      compiledLayer('panel', element(), [{ dataKey: 'gain', targetProperty }]),
    ]);
    const graphic = await loaded(source, 'realtime', { gain: 0.5 });
    await graphic.updateAction({ data: { gain: 1.5 } });
    expect(mock.animations).toEqual([]);
    expect(resolveShaderParameters(paintOf(rendered(graphic, 'panel'))).gain).toBe(1.5);
    await graphic.dispose();
  });

  it('keep a transition the layer chose for itself', async () => {
    const source = compiled([
      compiledLayer(
        'panel',
        shaderRectangle(),
        [{ dataKey: 'gain', targetProperty: 'fill.parameters.gain' }],
        { style: 'crossfade', durationFrames: 0, distance: 24 },
      ),
    ]);
    const graphic = await loaded(source, 'realtime', { gain: 0.5 });
    await graphic.updateAction({ data: { gain: 1.5 } });
    expect(fadedLayers()).toEqual(['panel']);
    await graphic.dispose();
  });

  it('do not stop a layer fading for its other changed binding', async () => {
    const element = {
      ...createTextElement({ content: 'title' }),
      fill: createShaderPaint({ fragmentSource: SHADER_SOURCE }),
    } as Element;
    const source = compiled([
      compiledLayer('title', element, [
        { dataKey: 'gain', targetProperty: 'fill.parameters.gain' },
        { dataKey: 'title', targetProperty: 'content' },
      ]),
    ]);
    const graphic = await loaded(source, 'realtime', { gain: 0.5, title: 'One' });
    await graphic.updateAction({ data: { gain: 1.5, title: 'One' } });
    expect(mock.animations).toEqual([]);
    await graphic.updateAction({ data: { gain: 1.5, title: 'Two' } });
    expect(fadedLayers()).toEqual(['title']);
    await graphic.dispose();
  });

  it('fade only the text layer when one key drives both text and a shader', async () => {
    const source = compiled([
      compiledLayer('panel', shaderRectangle(), [
        { dataKey: 'level', targetProperty: 'fill.parameters.gain' },
      ]),
      compiledLayer('readout', createTextElement({ content: '0.5' }), [
        { dataKey: 'level', targetProperty: 'content' },
      ]),
    ]);
    const graphic = await loaded(source, 'realtime', { level: 0.5 });
    await graphic.updateAction({ data: { level: 1.5 } });
    expect(fadedLayers()).toEqual(['readout']);
    expect(rendered(graphic, 'readout').content).toBe('1.5');
    await graphic.dispose();
  });

  it('take a new value at once in scheduled replay too', async () => {
    const source = compiled([
      compiledLayer('panel', shaderRectangle(), [
        { dataKey: 'gain', targetProperty: 'fill.parameters.gain' },
      ]),
    ]);
    const graphic = await loaded(source, 'non-realtime', { gain: 0.5 });
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        { timestamp: 1000, action: { type: 'updateAction', params: { data: { gain: 1.5 } } } },
      ],
    });
    await graphic.goToTime({ timestamp: 1010 });
    expect(opacity(graphic, 'panel')).toBe(1);
    expect(resolveShaderParameters(paintOf(rendered(graphic, 'panel'))).gain).toBe(1.5);
    await graphic.dispose();
  });
});

describe('scheduled replay of complete-data updates', () => {
  const play: ScheduledAction = {
    timestamp: 0,
    action: { type: 'playAction', params: { skipAnimation: true } },
  };
  const update = (timestamp: number, data: Record<string, unknown>): ScheduledAction => ({
    timestamp,
    action: { type: 'updateAction', params: { data } },
  });
  const twoChanges: ScheduledAction[] = [
    play,
    update(1000, { ...COMPLETE_DATA, homeScore: '2' }),
    update(3000, { ...COMPLETE_DATA, homeScore: '2', awayName: 'VISITORS' }),
  ];

  const scheduled = async (schedule: ScheduledAction[]) => {
    const graphic = await loaded(scoreboard(), 'non-realtime');
    await graphic.setActionsSchedule({ schedule });
    return graphic;
  };

  it('fades only the changed layer, holding the old value until the midpoint', async () => {
    const graphic = await scheduled(twoChanges);
    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.25 });
    expect(opacity(graphic, 'homeScore')).toBeCloseTo(0.5);
    expect(rendered(graphic, 'homeScore').content).toBe('1');
    for (const id of ['panel', 'homeName', 'awayName', 'awayScore'])
      expect(opacity(graphic, id)).toBe(1);

    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.75 });
    expect(opacity(graphic, 'homeScore')).toBeCloseTo(0.5);
    expect(rendered(graphic, 'homeScore').content).toBe('2');
    await graphic.dispose();
  });

  it('settles at full opacity once the fade is over', async () => {
    const graphic = await scheduled(twoChanges);
    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.75 });
    await graphic.goToTime({ timestamp: 1000 + FADE_MS + 100 });
    expect(opacity(graphic, 'homeScore')).toBe(1);
    await graphic.dispose();
  });

  it('draws each time the same whatever was sampled before it', async () => {
    const times = [
      500,
      1000 + FADE_MS * 0.25,
      1000 + FADE_MS * 0.75,
      2000,
      3000 + FADE_MS * 0.25,
      3000 + FADE_MS * 0.75,
      5000,
    ];
    const expected = new Map<number, ReturnType<typeof picture>>();
    for (const timestamp of times) {
      const fresh = await scheduled(twoChanges);
      await fresh.goToTime({ timestamp });
      expected.set(timestamp, picture(fresh));
      await fresh.dispose();
    }

    const scrubbed = await scheduled(twoChanges);
    // Forward, backward, and every hop that leaves a different value on air before the next one.
    for (const timestamp of [...times, ...[...times].reverse(), times[3]!, times[1]!, times[6]!]) {
      await scrubbed.goToTime({ timestamp });
      expect(picture(scrubbed), `at ${timestamp}`).toEqual(expected.get(timestamp));
    }
    await scrubbed.dispose();
  });

  it('lets a running fade finish through a repeat of the same data', async () => {
    const graphic = await scheduled([
      play,
      update(1000, { ...COMPLETE_DATA, homeScore: '2' }),
      update(1100, { ...COMPLETE_DATA, homeScore: '2' }),
    ]);
    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.25 });
    expect(opacity(graphic, 'homeScore')).toBeCloseTo(0.5);
    expect(rendered(graphic, 'homeScore').content).toBe('1');
    expect(opacity(graphic, 'panel')).toBe(1);
    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.75 });
    expect(rendered(graphic, 'homeScore').content).toBe('2');
    await graphic.goToTime({ timestamp: 1000 + FADE_MS + 100 });
    expect(opacity(graphic, 'homeScore')).toBe(1);
    await graphic.dispose();
  });

  it('applies a complete update that changes nothing without any fade', async () => {
    const graphic = await scheduled([play, update(1000, { ...COMPLETE_DATA })]);
    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.25 });
    for (const id of BOUND_LAYER_IDS) expect(opacity(graphic, id)).toBe(1);
    await graphic.dispose();
  });

  it('clears a sampled fade when the schedule is emptied', async () => {
    const graphic = await scheduled(twoChanges);
    await graphic.goToTime({ timestamp: 1000 + FADE_MS * 0.25 });
    expect(opacity(graphic, 'homeScore')).toBeCloseTo(0.5);
    await graphic.setActionsSchedule({ schedule: [] });
    expect(opacity(graphic, 'homeScore')).toBe(1);
    await graphic.dispose();
  });

  it('leaves the opacity of a running Rules fade alone', async () => {
    const source = scoreboard();
    source.layers[1]!.visualRules = [
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
    ];
    const graphic = await loaded(source, 'non-realtime', { ...COMPLETE_DATA, flag: 'SHOW' });
    await graphic.setActionsSchedule({ schedule: [play, update(1000, { flag: 'HIDE' })] });
    // The data fade ends at 1600; the rule took over at its midpoint and runs until 2300.
    await graphic.goToTime({ timestamp: 1800 });
    expect(opacity(graphic, 'divider')).toBeCloseTo(0.5, 1);
    await graphic.dispose();
  });
});
