import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, ScheduledAction } from '@ograf-editor/ograf-types';
import {
  createChartElement,
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createShaderPaint,
  createTextElement,
  createProject,
  createRectangleLayer,
  materializeLowerThird,
  sampleChartMarkAnimations,
  type Element,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';

const fixture = vi.hoisted(() => {
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    shadowRoot: Host | null = null;
    firstElementChild: Host | null = null;
    ownerDocument = {};
    dispatchedEvents: Event[] = [];
    attributes = new Map<string, string>();
    dispatchEvent(event: Event) {
      this.dispatchedEvents.push(event);
      return true;
    }
    hasAttribute(name: string) {
      return this.attributes.has(name);
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    set tabIndex(value: number) {
      this.attributes.set('tabindex', String(value));
    }
    focus() {}
    removeEventListener() {}
    querySelectorAll() {
      return [];
    }
    querySelector() {
      return null;
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
  }
  type Animation = {
    from: number;
    to: number;
    update: (frame: number) => void;
    options: { durationMs?: number; onUpdate?: () => void; onComplete?: () => void };
  };
  const control: { pending: Animation | null; frame: number } = { pending: null, frame: 0 };
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return {
    Host,
    control,
    frames,
    chart: vi.fn(),
    content: vi.fn(),
    advance(progress: number) {
      const pending = control.pending!;
      pending.update(pending.from + (pending.to - pending.from) * progress);
      pending.options.onUpdate?.();
      if (progress === 1) {
        control.pending = null;
        pending.options.onComplete?.();
      }
    },
  };
});

vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 120,
      seek: (value: number) => {
        frame = value;
        fixture.control.frame = value;
      },
      animateTo: (
        value: number,
        options: { durationMs?: number; onUpdate?: () => void; onComplete?: () => void },
      ) => {
        fixture.control.pending = {
          from: frame,
          to: value,
          update: (value) => {
            frame = value;
            fixture.control.frame = value;
          },
          options,
        };
        return { cancel() {} };
      },
      dispose() {},
      pause() {},
      setClockOwner() {},
    };
  },
}));
vi.mock('./documentFonts', () => ({ registerDocumentFonts: async () => {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./chartRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chartRendering')>()),
  renderChartAnimationAtFrame: fixture.chart,
}));
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: (host: HTMLElement, element: Element) => {
    host.dataset.ografRenderedElement = JSON.stringify(element);
  },
  renderAnimatedElementAtTime: fixture.content,
  applyAnimatedPaint: () => {},
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: async () => {},
}));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
import { GraphicElement } from './GraphicElement';
import type { StudioFrameCueDetail } from './graphicInstances';

function descriptor(): CompiledGraphicDescriptor {
  const key = (frame: number, value: number) => ({
    id: `key-${frame}`,
    frame,
    value,
    easing: 'linear' as const,
  });
  return {
    width: 640,
    height: 360,
    frameRate: 10,
    backgroundColor: 'transparent',
    layers: [
      {
        id: 'chart',
        isVisible: true,
        element: createChartElement({
          fill: createShaderPaint(),
          markAnimations: {
            out: {
              reference: { id: 'test.motion', version: '1.0.0', sha256: 'a'.repeat(64) },
              presetId: 'fade',
              durationFrames: 20,
              delayFrames: 0,
              staggerFrames: 0,
            },
          },
          animation: {
            type: 'grow',
            durationFrames: 10,
            delayFrames: 0,
            staggerFrames: 0,
            easing: 'linear',
            replayOnUpdate: true,
          },
        }),
        chartMarkAnimations: {
          out: {
            startFrame: 100,
            durationFrames: 20,
            staggerFrames: 0,
            staggerSlots: 4,
            tracks: { opacity: [key(0, 1), key(20, 0)] },
          },
        },
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
        bindings: [{ dataKey: 'chartData', targetProperty: 'data' }],
        loop: null,
      },
    ],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'step1', frame: 20, role: 'step' },
      { id: 'step2', frame: 100, role: 'step' },
      { id: 'end', frame: 120, role: 'end' },
    ],
    transitions: [
      { fromKeyframeId: 'step2', toKeyframeId: 'end', durationFrames: 20, easing: 'linear' },
    ],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1', 'step2'],
    stepCount: 2,
    customActions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.frames.length = 0;
  fixture.control.pending = null;
  fixture.control.frame = 0;
});

describe('single-template frame cues', () => {
  class Graphic extends GraphicElement {
    static descriptor: CompiledGraphicDescriptor = {
      ...descriptor(),
      exitTailStartFrame: 108,
      frameCues: [
        { id: 'start-cue', name: 'start', frame: 0 },
        { id: 'second-step-cue', name: 'step-two', frame: 100 },
        { id: 'first', name: 'first', frame: 5, payload: { score: 2 } },
        { id: 'second', name: 'second', frame: 5 },
        { id: 'first-step-cue', name: 'step-one', frame: 20 },
        { id: 'middle', name: 'middle', frame: 40 },
        { id: 'skipped-hold', name: 'skipped-hold', frame: 104 },
        { id: 'out-cue', name: 'out', frame: 110 },
        { id: 'end-cue', name: 'end', frame: 120 },
      ],
    };
  }
  const load = async (renderType: 'realtime' | 'non-realtime' = 'realtime') => {
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(Object.keys(graphic.instances)).toEqual([]);
    expect(
      await graphic.load({
        renderType,
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: {},
      }),
    ).toMatchObject({ statusCode: 200 });
    const events = () =>
      (graphic as unknown as InstanceType<typeof fixture.Host>).dispatchedEvents
        .filter((event) => event.type === 'ograf-studio-cue')
        .map((event) => (event as CustomEvent<StudioFrameCueDetail>).detail);
    return { graphic, events, names: () => events().map((event) => event.name) };
  };
  const waitForMotion = () => vi.waitFor(() => expect(fixture.control.pending).not.toBeNull());

  it('fires crossed cues in order without repeating a held frame or visiting skipped Out frames', async () => {
    const { graphic, events, names } = await load();
    expect(names()).toEqual([]);
    const take = graphic.playAction({});
    await waitForMotion();
    fixture.advance(0.5);
    fixture.advance(0.5);
    expect(names()).toEqual(['start', 'first', 'second']);
    expect(events()[1]).toEqual({
      id: 'first',
      name: 'first',
      frame: 5,
      payload: { score: 2 },
      instanceId: 'single',
    });
    expect(graphic.instances[events()[1]!.instanceId]?.instanceId).toBe('single');
    fixture.advance(1);
    expect(await take).toMatchObject({ currentStep: 0 });
    expect(names().at(-1)).toBe('step-one');

    const next = graphic.playAction({});
    await waitForMotion();
    fixture.advance(1);
    expect(await next).toMatchObject({ currentStep: 1 });
    expect(names()).toEqual(['start', 'first', 'second', 'step-one', 'middle', 'step-two']);

    const back = graphic.playAction({ goto: 0 });
    await waitForMotion();
    fixture.advance(1);
    expect(await back).toMatchObject({ currentStep: 0 });
    expect(names()).toHaveLength(6);

    const out = graphic.stopAction({});
    await waitForMotion();
    fixture.advance(0.5);
    expect(names().slice(6)).toEqual(['out']);
    fixture.advance(1);
    expect(await out).toMatchObject({ statusCode: 200 });
    expect(names().slice(6)).toEqual(['out', 'end']);
    await graphic.dispose();
  });

  it('keeps skip-animation and non-real-time seeks silent', async () => {
    const live = await load();
    await live.graphic.playAction({ skipAnimation: true });
    await live.graphic.stopAction({ skipAnimation: true });
    expect(live.events()).toEqual([]);
    await live.graphic.dispose();

    const offline = await load('non-realtime');
    await offline.graphic.setActionsSchedule({
      schedule: [{ timestamp: 0, action: { type: 'playAction', params: {} } }],
    });
    await offline.graphic.goToTime({ timestamp: 2000 });
    await offline.graphic.goToTime({ timestamp: 500 });
    expect(offline.events()).toEqual([]);
    await offline.graphic.dispose();
  });
});

describe('standalone keyboard Rules transport', () => {
  const keyboardDescriptor = () => {
    const source = descriptor();
    source.dataDefaults = { count: 0, allowed: true };
    delete source.layers[0]!.chartMarkAnimations;
    source.layers[0] = {
      ...source.layers[0]!,
      element: createTextElement({ content: '0' }),
      bindings: [{ dataKey: 'count', targetProperty: 'content' }],
      visualRules: ['key-down', 'key-up'].map((trigger) => ({
        id: trigger,
        name: trigger,
        enabled: true,
        trigger: trigger as 'key-down' | 'key-up',
        keyboard: { key: 'a', ctrl: true, repeat: false },
        dataKey: 'allowed',
        conditions: [
          { dataKey: 'allowed', sourcePath: [], operator: 'equals' as const, value: true },
        ],
        sourcePath: [],
        operator: 'equals' as const,
        value: true,
        actions: [
          {
            type: 'set-data' as const,
            fieldId: 'count',
            dataKey: 'count',
            mode: 'increase' as const,
            value: 1,
          },
        ],
      })),
    };
    return source;
  };
  const count = (graphic: GraphicElement) => {
    const find = (node: InstanceType<typeof fixture.Host>): string | undefined => {
      const rendered = node.dataset.ografRenderedElement;
      if (rendered) {
        const element = JSON.parse(rendered);
        if (element.type === 'text') return element.content;
      }
      for (const child of node.children) {
        const value = find(child);
        if (value !== undefined) return value;
      }
    };
    return find(graphic.shadowRoot as unknown as InstanceType<typeof fixture.Host>);
  };
  const load = (graphic: GraphicElement, renderType: 'realtime' | 'non-realtime' = 'realtime') =>
    graphic.load({
      renderType,
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      data: {},
    });
  it('fires down/up actions only on air, claims suppressed repeats/conditions, and removes eligibility on reload/dispose', async () => {
    class Graphic extends GraphicElement {
      static descriptor = keyboardDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(await load(graphic)).toMatchObject({ statusCode: 200 });
    expect(graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true })).toBe(false);
    await graphic.playAction({ skipAnimation: true });
    expect(graphic.handleKeyboardInput('key-down', { key: 'A', ctrlKey: true })).toBe(true);
    expect(count(graphic)).toBe('1');
    expect(graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true, repeat: true })).toBe(
      true,
    );
    expect(count(graphic)).toBe('1');
    expect(graphic.handleKeyboardInput('key-up', { key: 'a', ctrlKey: true, repeat: true })).toBe(
      true,
    );
    expect(count(graphic)).toBe('2');
    expect(
      graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true, shiftKey: true }),
    ).toBe(false);
    await graphic.updateAction({ data: { allowed: false }, skipAnimation: true });
    expect(graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true })).toBe(true);
    expect(count(graphic)).toBe('2');
    await load(graphic, 'non-realtime');
    await graphic.playAction({ skipAnimation: true });
    expect(graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true })).toBe(false);
    await load(graphic);
    await graphic.playAction({ skipAnimation: true });
    await graphic.dispose();
    expect(graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true })).toBe(false);
  });
  it('does not respond while its Out animation is running', async () => {
    class Graphic extends GraphicElement {
      static descriptor = keyboardDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    await load(graphic);
    await graphic.playAction({ skipAnimation: true });
    const stopping = graphic.stopAction({});
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(graphic.handleKeyboardInput('key-down', { key: 'a', ctrlKey: true })).toBe(false);
    fixture.advance(1);
    await stopping;
    await graphic.dispose();
  });
});

describe('standalone release-only keyboard priority', () => {
  it('reserves key-down for a release-only Space rule without firing until key-up', async () => {
    const source = descriptor();
    source.dataDefaults = { count: 0 };
    delete source.layers[0]!.chartMarkAnimations;
    source.layers[0] = {
      ...source.layers[0]!,
      element: createTextElement({ content: '0' }),
      bindings: [{ dataKey: 'count', targetProperty: 'content' }],
      visualRules: [
        {
          id: 'release',
          name: 'Release',
          enabled: true,
          trigger: 'key-up',
          keyboard: { key: 'Space', repeat: false },
          dataKey: '',
          sourcePath: [],
          operator: 'equals',
          actions: [
            { type: 'set-data', fieldId: 'count', dataKey: 'count', mode: 'increase', value: 1 },
          ],
        },
      ],
    };
    class Graphic extends GraphicElement {
      static descriptor = source;
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    await graphic.load({
      renderType: 'realtime',
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      data: {},
    });
    await graphic.playAction({ skipAnimation: true });
    const values = () => {
      const scan = (node: InstanceType<typeof fixture.Host>): string[] => [
        ...(node.dataset.ografRenderedElement
          ? [JSON.parse(node.dataset.ografRenderedElement).content as string]
          : []),
        ...node.children.flatMap(scan),
      ];
      return scan(graphic.shadowRoot as unknown as InstanceType<typeof fixture.Host>);
    };
    expect(graphic.handleKeyboardInput('key-down', { key: ' ' })).toBe(true);
    expect(graphic.handleKeyboardInput('key-down', { key: ' ', repeat: true })).toBe(true);
    expect(values()).toContain('0');
    expect(graphic.handleKeyboardInput('key-up', { key: ' ' })).toBe(true);
    expect(values()).toContain('1');
    await graphic.dispose();
  });
});

function latestMarkFrame(): number {
  return fixture.chart.mock.calls.at(-1)![3] as number;
}

describe('individual chart marks during direct multi-Step Take Out', () => {
  it('uses a proven exit-tail duration in realtime and scheduled stop', async () => {
    class Graphic extends GraphicElement {
      static descriptor = { ...descriptor(), exitTailStartFrame: 115 };
    }
    const live = new Graphic();
    live.connectedCallback();
    await live.load({
      renderType: 'realtime',
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      data: {},
    });
    await live.playAction({ skipAnimation: true });
    const stopping = live.stopAction({});
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fixture.control.pending?.options.durationMs).toBe(500);
    fixture.advance(1);
    await stopping;
    await live.dispose();
    const offline = new Graphic();
    offline.connectedCallback();
    await offline.load({
      renderType: 'non-realtime',
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      data: {},
    });
    await offline.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        { timestamp: 500, action: { type: 'stopAction', params: {} } },
      ],
    });
    await offline.goToTime({ timestamp: 750 });
    expect(latestMarkFrame()).toBeCloseTo(110);
    await offline.goToTime({ timestamp: 1000 });
    expect(latestMarkFrame()).toBeCloseTo(120);
    await offline.goToTime({ timestamp: 750 });
    expect(latestMarkFrame()).toBeCloseTo(110);
    await offline.dispose();
  });
  it.each(['stopAction', 'playAction'] as const)(
    'plays the complete mark Out from an earlier Step through %s and shader ticks',
    async (action) => {
      class Graphic extends GraphicElement {
        static descriptor = descriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: {},
        }),
      ).toMatchObject({ statusCode: 200 });
      expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({
        statusCode: 200,
        currentStep: 0,
      });
      const out =
        action === 'stopAction' ? graphic.stopAction({}) : graphic.playAction({ goto: 2 });
      await vi.waitFor(() => expect(fixture.control.pending).not.toBeNull());
      fixture.advance(0.5);
      expect(latestMarkFrame()).toBe(110);
      expect(
        sampleChartMarkAnimations(
          Graphic.descriptor.layers[0]!.chartMarkAnimations,
          latestMarkFrame(),
          0,
        ).opacity,
      ).toBe(0.5);
      for (const callback of fixture.frames.splice(0)) callback(1000);
      expect(fixture.content.mock.calls.at(-1)![3]).toMatchObject({ chartMarkFrame: 110 });
      fixture.advance(1);
      expect(await out).toMatchObject({ statusCode: 200 });
      expect(latestMarkFrame()).toBe(120);
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    },
  );

  it.each(['stopAction', 'playAction'] as const)(
    'reconstructs scheduled %s with backward seeks and an interrupted data replay clock',
    async (action) => {
      class Graphic extends GraphicElement {
        static descriptor = descriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'non-realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: {},
        }),
      ).toMatchObject({ statusCode: 200 });
      const changed = createChartElement().data;
      changed.datasets[0]!.data[0] = 60;
      const schedule: ScheduledAction[] = [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 500,
          action: { type: action, params: action === 'playAction' ? { goto: 2 } : {} },
        },
        {
          timestamp: 1000,
          action: {
            type: 'updateAction',
            params: { data: { chartData: JSON.stringify(changed) }, skipAnimation: true },
          },
        },
      ];
      expect(await graphic.setActionsSchedule({ schedule })).toMatchObject({ statusCode: 200 });
      const sample = async (timestamp: number) => {
        expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
        return {
          frame: latestMarkFrame(),
          pose: sampleChartMarkAnimations(
            Graphic.descriptor.layers[0]!.chartMarkAnimations,
            latestMarkFrame(),
            0,
          ),
        };
      };
      const half = await sample(1500);
      expect(half.frame).toBe(110);
      expect(half.pose.opacity).toBe(0.5);
      expect(fixture.chart.mock.calls.at(-1)![2]).toBe(10);
      expect(fixture.content.mock.calls.at(-1)![3]).toMatchObject({ chartMarkFrame: 110 });
      expect((await sample(750)).frame).toBe(102.5);
      expect(await sample(1500)).toEqual(half);
      expect((await sample(2500)).pose.opacity).toBe(0);
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    },
  );
});

describe('authored standalone Out property keys', () => {
  const key = (frame: number, value: number) => ({
    id: `key-${frame}`,
    frame,
    value,
    easing: 'linear' as const,
  });

  class Graphic extends GraphicElement {
    static descriptor: CompiledGraphicDescriptor = {
      ...descriptor(),
      layers: [
        {
          id: 'staged-out',
          element: createRectangleLayer().element,
          isVisible: true,
          effects: createLayerEffects(),
          keyframes: descriptor().layers[0]!.keyframes,
          animationTracks: {
            x: [
              key(20, 10),
              key(60, 300),
              key(100, 20),
              key(105, 160),
              key(110, -40),
              key(120, 80),
            ],
            opacity: [
              key(20, 1),
              key(60, 0.4),
              key(100, 1),
              key(105, 0.35),
              key(110, 0.8),
              key(120, 0),
            ],
          },
          bindings: [],
          loop: null,
        },
      ],
    };
  }

  async function load(renderType: 'realtime' | 'non-realtime', graphic = new Graphic()) {
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType,
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: {},
      }),
    ).toMatchObject({ statusCode: 200 });
    return graphic;
  }

  function expectPose(graphic: Graphic, x: number, opacity: number) {
    const host = graphic as unknown as InstanceType<typeof fixture.Host>;
    const layer = host.shadowRoot!.children.find(
      (child) => child.dataset.ografLayerId === 'staged-out',
    )!;
    const transform = layer.style.transform;
    if (!transform?.startsWith('translate(')) throw new Error('Expected a translated Out layer.');
    expect(Number.parseFloat(transform.slice('translate('.length))).toBeCloseTo(x);
    expect(Number(layer.style.opacity)).toBeCloseTo(opacity);
  }

  it.each(['stopAction', 'playAction'] as const)(
    'plays intermediate Out keys from the final Step in realtime via %s',
    async (action) => {
      const graphic = await load('realtime');
      expect(await graphic.playAction({ goto: 1, skipAnimation: true })).toMatchObject({
        currentStep: 1,
      });
      const out = action === 'stopAction' ? graphic.stopAction({}) : graphic.playAction({});
      await vi.waitFor(() => expect(fixture.control.pending).not.toBeNull());
      expect(fixture.control.pending!.options.durationMs).toBe(2000);
      fixture.advance(0.25);
      expectPose(graphic, 160, 0.35);
      fixture.advance(0.5);
      expectPose(graphic, -40, 0.8);
      fixture.advance(1);
      expect(await out).toMatchObject({ statusCode: 200 });
      expectPose(graphic, 80, 0);
      await graphic.dispose();
    },
  );

  it.each(['stopAction', 'playAction'] as const)(
    'samples intermediate Out keys through forward and backward scheduled %s seeks',
    async (action) => {
      const graphic = await load('non-realtime');
      expect(
        await graphic.setActionsSchedule({
          schedule: [
            {
              timestamp: 0,
              action: { type: 'playAction', params: { goto: 1, skipAnimation: true } },
            },
            { timestamp: 500, action: { type: action, params: {} } },
          ],
        }),
      ).toMatchObject({ statusCode: 200 });
      for (const [timestamp, x, opacity] of [
        [500, 20, 1],
        [1000, 160, 0.35],
        [1500, -40, 0.8],
        [2500, 80, 0],
        [1000, 160, 0.35],
      ] as const) {
        expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
        expectPose(graphic, x, opacity);
      }
      await graphic.dispose();
    },
  );

  it('takes Out directly from the sampled pose if a scheduled Step transition is interrupted', async () => {
    const graphic = await load('non-realtime');
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          { timestamp: 500, action: { type: 'playAction', params: {} } },
          { timestamp: 4500, action: { type: 'stopAction', params: {} } },
        ],
      }),
    ).toMatchObject({ statusCode: 200 });
    for (const [timestamp, x, opacity] of [
      [4500, 300, 0.4],
      [5500, 190, 0.2],
      [6500, 80, 0],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      expectPose(graphic, x, opacity);
    }
    await graphic.dispose();
  });

  it('freezes a scheduled custom-action loop as the authored Out begins', async () => {
    class LoopedGraphic extends Graphic {
      static descriptor: CompiledGraphicDescriptor = {
        ...Graphic.descriptor,
        customActions: [{ id: 'hold-x', name: 'Hold X', durationFrames: 20 }],
        layers: [
          {
            ...Graphic.descriptor.layers[0]!,
            loop: createLayerLoopClip({
              durationFrames: 20,
              activation: { type: 'customAction', customActionId: 'hold-x' },
              tracks: { x: [key(0, 250), key(20, 250)] },
            }),
          },
        ],
      };
    }
    const graphic = await load('non-realtime', new LoopedGraphic());
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          {
            timestamp: 0,
            action: { type: 'playAction', params: { goto: 1, skipAnimation: true } },
          },
          { timestamp: 200, action: { type: 'customAction', params: { id: 'hold-x' } } },
          { timestamp: 500, action: { type: 'stopAction', params: {} } },
        ],
      }),
    ).toMatchObject({ statusCode: 200 });
    for (const [timestamp, x, opacity] of [
      [499, 250, 1],
      [500, 250, 1],
      [1000, 332.5, 0.35],
      [2500, 80, 0],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      expectPose(graphic, x, opacity);
    }
    await graphic.dispose();
  });
});

describe('short recipe standalone playout', () => {
  it.each([25, 50, 60_000 / 1_001])(
    'starts the complete lower-third Out immediately on realtime and scheduled playback at %s fps',
    async (fps) => {
      const project = createProject();
      const composition = project.compositions[0]!;
      composition.frameRate = fps;
      // This matches the authored recipe lifecycle independently verified in the editor tests.
      composition.transitions[0]!.durationFrames = Math.round(fps * 0.5);
      composition.transitions[1]!.durationFrames = 8;
      materializeLowerThird(composition);
      const recipe = compileDescriptor(composition);
      const step = recipe.keyframes.find((key) => key.role === 'step')!.frame;
      const end = recipe.keyframes.find((key) => key.role === 'end')!.frame;
      const exitMs = ((end - step) / fps) * 1000;
      // Keep the generated recipe's real lifecycle but replace its layers with the existing
      // instrumented chart fixture so the fake DOM can record every sampled output frame.
      const layer = { ...descriptor().layers[0]!, element: createChartElement(), bindings: [] };
      delete layer.chartMarkAnimations;
      const sampledRecipe: CompiledGraphicDescriptor = { ...recipe, layers: [layer] };
      class Graphic extends GraphicElement {
        static descriptor = sampledRecipe;
      }
      const load = (graphic: Graphic, renderType: 'realtime' | 'non-realtime') =>
        graphic.load({
          renderType,
          renderCharacteristics: {
            resolution: { width: recipe.width, height: recipe.height },
            frameRate: fps,
          },
          data: {},
        });
      const live = new Graphic();
      live.connectedCallback();
      expect(await load(live, 'realtime')).toMatchObject({ statusCode: 200 });
      expect(await live.playAction({ skipAnimation: true })).toMatchObject({
        statusCode: 200,
        currentStep: 0,
      });
      const stopping = live.stopAction({});
      await vi.waitFor(() => expect(fixture.control.pending).not.toBeNull());
      expect(fixture.control.pending).toMatchObject({ from: step, to: end });
      expect(fixture.control.pending!.options.durationMs).toBeCloseTo(exitMs);
      fixture.advance(0.125);
      expect(fixture.control.frame).toBeCloseTo(step + (end - step) * 0.125);
      fixture.advance(1);
      expect(await stopping).toMatchObject({ statusCode: 200 });
      await live.dispose();

      const offline = new Graphic();
      offline.connectedCallback();
      expect(await load(offline, 'non-realtime')).toMatchObject({ statusCode: 200 });
      expect(
        await offline.setActionsSchedule({
          schedule: [
            { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
            { timestamp: 500, action: { type: 'stopAction', params: {} } },
          ],
        }),
      ).toMatchObject({ statusCode: 200 });
      expect(await offline.goToTime({ timestamp: 500 + exitMs / 2 })).toMatchObject({
        statusCode: 200,
      });
      expect(fixture.control.frame).toBeCloseTo(step + (end - step) / 2);
      expect(await offline.goToTime({ timestamp: 500 + exitMs })).toMatchObject({
        statusCode: 200,
      });
      expect(fixture.control.frame).toBeCloseTo(end);
      expect(await offline.goToTime({ timestamp: 500 + exitMs / 2 })).toMatchObject({
        statusCode: 200,
      });
      expect(fixture.control.frame).toBeCloseTo(step + (end - step) / 2);
      await offline.dispose();
    },
  );
});
