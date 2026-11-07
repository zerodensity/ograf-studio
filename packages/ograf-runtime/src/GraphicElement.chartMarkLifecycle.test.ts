import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, ScheduledAction } from '@ograf-editor/ograf-types';
import {
  createChartElement,
  createDefaultTransform,
  createLayerEffects,
  createShaderPaint,
  createTextElement,
  createProject,
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
    attributes = new Map<string, string>();
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
