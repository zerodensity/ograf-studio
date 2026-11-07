import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createTextElement,
  type Element,
  type LogicFunctionContext,
  type LogicFunctionResult,
} from '@ograf-editor/scene-model';

const fixture = vi.hoisted(() => {
  class Host extends EventTarget {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    shadowRoot: Host | null = null;
    firstElementChild: Host | null = null;
    nodeType = 1;
    tagName = 'DIV';
    isConnected = true;
    ownerDocument!: typeof owner;
    constructor() {
      super();
      this.ownerDocument = owner;
    }
    closest() {
      return null;
    }
    contains(target: Host) {
      return target === this;
    }
    getAttribute() {
      return null;
    }
    querySelector() {
      return null;
    }
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
  }
  const owner = Object.assign(new EventTarget(), {
    hidden: false,
    defaultView: Object.assign(new EventTarget(), {
      performance: globalThis.performance,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      CustomEvent: class extends Event {
        detail: unknown;
        constructor(name: string, init: CustomEventInit) {
          super(name, init);
          this.detail = init.detail;
        }
      },
    }),
    createElement: () => new Host(),
  });
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', owner);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return {
    Host,
    handler: (_ctx: LogicFunctionContext): LogicFunctionResult => ({}),
    invoke: vi.fn<(ctx: LogicFunctionContext) => Promise<LogicFunctionResult>>(),
    dispose: vi.fn(),
  };
});
vi.mock('./logicFunctionSandbox', () => ({
  createLogicFunctionSandbox: () => ({
    ready: Promise.resolve(),
    invoke: fixture.invoke,
    dispose: fixture.dispose,
  }),
}));
vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 20,
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
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: (host: HTMLElement, element: Element) => {
    host.dataset.ografRenderedElement = JSON.stringify(element);
  },
  renderAnimatedElementAtTime: () => {},
  applyAnimatedPaint: () => {},
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: async () => {},
}));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
import { GraphicElement } from './GraphicElement';
import { MediaCueRuntime } from './mediaCueRuntime';

function descriptor(): CompiledGraphicDescriptor {
  return {
    width: 640,
    height: 360,
    frameRate: 10,
    backgroundColor: 'transparent',
    layers: [
      {
        id: 'label',
        isVisible: true,
        element: createTextElement({ content: 'authored' }),
        effects: createLayerEffects(),
        keyframes: [
          { id: 'start', frame: 0, easing: 'linear', transform: createDefaultTransform() },
        ],
        animationTracks: {},
        bindings: [{ dataKey: 'label', targetProperty: 'content' }],
      },
    ],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'on', frame: 10, role: 'step' },
      { id: 'end', frame: 20, role: 'end' },
    ],
    transitions: [],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['on'],
    stepCount: 1,
    dataDefaults: { label: 'default', settings: { amount: 1 } },
    customActions: ['go', 'notice'].map((id) => ({ id, name: id, durationFrames: 0 })),
    functions: [
      {
        type: 'javascript',
        version: 1,
        id: 'logic',
        name: 'Logic',
        enabled: true,
        source: '(ctx) => ({})',
        inputs: { value: 'label', settings: 'settings' },
        outputs: { value: 'label' },
        actions: ['go', 'notice'],
        emits: { next: 'notice' },
        initialState: null,
      },
    ],
  };
}
const flush = async () => {
  for (let n = 0; n < 80; n++) await Promise.resolve();
};
async function graphic(compiled = descriptor()) {
  class Graphic extends GraphicElement {
    static descriptor = compiled;
  }
  const graphic = new Graphic();
  graphic.connectedCallback();
  const result = await graphic.load({
    renderType: 'realtime',
    renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
    data: {},
  });
  expect(result).toMatchObject({ statusCode: 200 });
  return graphic;
}
function label(graphic: GraphicElement) {
  const root = graphic.shadowRoot as unknown as InstanceType<typeof fixture.Host>;
  const host = root.children.find((child) => child.style.position === 'absolute')!;
  return (JSON.parse(host.dataset.ografRenderedElement!) as { content: string }).content;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.handler = () => ({});
  fixture.invoke.mockImplementation(async (ctx) => fixture.handler(ctx));
});

describe('GraphicElement function integration', () => {
  it('keeps delayed Taken out Rules when a later asynchronous function Out result commits data', async () => {
    vi.useFakeTimers();
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'delayed-out',
        name: 'Delayed Out',
        enabled: true,
        trigger: 'stop',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        delayFrames: 2,
        actions: [{ type: 'custom-action', actionId: 'notice' }],
      },
    ];
    let finishOut!: (value: LogicFunctionResult) => void;
    const result = new Promise<LogicFunctionResult>((resolve) => {
      finishOut = resolve;
    });
    fixture.invoke.mockImplementation(async (ctx) => (ctx.event.type === 'out' ? result : {}));
    const trigger = vi.spyOn(MediaCueRuntime.prototype, 'triggerCustomAction');
    let instance: GraphicElement | undefined;
    try {
      instance = await graphic(compiled);
      await instance.playAction({ skipAnimation: true });
      await instance.stopAction({ skipAnimation: true });
      await flush();
      expect(fixture.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'out')).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
      finishOut({ state: { paused: true }, data: { value: 'paused' }, wakeAt: null });
      await flush();
      expect(label(instance)).toBe('paused');
      await vi.advanceTimersByTimeAsync(149);
      expect(trigger).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(trigger).toHaveBeenCalledExactlyOnceWith('notice', {});
    } finally {
      if (instance) await instance.dispose();
      trigger.mockRestore();
      vi.useRealTimers();
    }
  });

  it('initializes bound output without running data-triggered action or media effects', async () => {
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'ready-effect',
        name: 'Ready effect',
        enabled: true,
        trigger: 'data',
        dataKey: 'label',
        sourcePath: [],
        operator: 'equals',
        value: 'ready',
        actions: [{ type: 'custom-action', actionId: 'notice' }],
      },
    ];
    fixture.handler = (ctx) => (ctx.event.type === 'load' ? { data: { value: 'ready' } } : {});
    const trigger = vi.spyOn(MediaCueRuntime.prototype, 'triggerCustomAction');
    try {
      const instance = await graphic(compiled);
      await flush();
      expect(label(instance)).toBe('ready');
      expect(trigger).not.toHaveBeenCalled();
      expect(fixture.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'custom-action')).toBe(
        false,
      );
      await instance.dispose();
    } finally {
      trigger.mockRestore();
    }
  });

  it('renders load and action outputs, listens only on air, and does not merge emitted payload into fields', async () => {
    fixture.handler = (ctx) => {
      if (ctx.event.type === 'load') return { state: { ready: true }, data: { value: 'ready' } };
      if (ctx.event.type === 'custom-action' && ctx.event.actionId === 'go')
        return {
          data: { value: 'started' },
          actions: [{ name: 'next', payload: { label: 'must not merge' } }],
        };
      return {};
    };
    const instance = await graphic();
    expect(label(instance)).toBe('ready');
    await instance.customAction({ id: 'go', payload: {}, skipAnimation: true });
    expect(label(instance)).toBe('ready');
    await instance.playAction({ skipAnimation: true });
    await instance.customAction({ id: 'go', payload: {}, skipAnimation: true });
    expect(label(instance)).toBe('started');
    const notice = fixture.invoke.mock.calls
      .map(([ctx]) => ctx)
      .find((ctx) => ctx.event.actionId === 'notice');
    expect(notice).toMatchObject({
      data: { value: 'started' },
      event: { payload: { label: 'must not merge' } },
    });
    await instance.stopAction({ skipAnimation: true });
    await flush();
    expect(fixture.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'out')).toBe(true);
    const count = fixture.invoke.mock.calls.filter(
      ([ctx]) => ctx.event.type === 'custom-action',
    ).length;
    await instance.customAction({ id: 'go', payload: {}, skipAnimation: true });
    expect(
      fixture.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'custom-action'),
    ).toHaveLength(count);
    await instance.dispose();
    expect(fixture.dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves function state for ordinary data updates and resets it only on load', async () => {
    fixture.handler = (ctx) => (ctx.event.type === 'load' ? { state: { count: 1 } } : {});
    const instance = await graphic();
    await instance.updateAction({ data: { settings: { amount: 7 } }, skipAnimation: true });
    await flush();
    expect(fixture.invoke.mock.calls.find(([ctx]) => ctx.event.type === 'data')?.[0]).toMatchObject(
      {
        state: { count: 1 },
        data: { settings: { amount: 7 } },
        event: { changed: { settings: { amount: 7 } } },
      },
    );
    expect(
      await instance.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: {},
      }),
    ).toMatchObject({ statusCode: 200 });
    const loads = fixture.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'load');
    expect(loads).toHaveLength(2);
    expect(loads[1]![0].state).toBeNull();
    expect(fixture.dispose).toHaveBeenCalledTimes(1);
    await instance.dispose();
    expect(fixture.dispose).toHaveBeenCalledTimes(2);
  });
});
