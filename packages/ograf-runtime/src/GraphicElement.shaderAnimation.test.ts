import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CompiledGraphicDescriptor, ScheduledAction } from '@ograf-editor/ograf-types';
import * as shaderRuntime from './shaderRendering';
import {
  applyShaderAnimationValues,
  createChartElement,
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createMediaPaint,
  createRectangleLayer,
  createShaderPaint,
  createTextElement,
  createLayerModifier,
  clockTimerActionId,
  normalizeClockTimerSettings,
  resolveShaderParameters,
  sampleShaderAnimationValues,
  type Element,
  type LayerAnimationTracks,
  type TextAnimation,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  const frames: FrameRequestCallback[] = [];
  let nextFrameId = 0;
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    listeners = new Map<
      string,
      Array<(event: { pointerType?: string; detail?: number }) => void>
    >();
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
    modifierGlyph: { style: Record<string, string>; dataset: Record<string, string> } | null = null;
    shaderPaused = false;
    querySelectorAll(selector: string) {
      if (selector === '[data-ograf-shader-paused]') return this.shaderPaused ? [this] : [];
      return selector === '[data-ograf-modifier-text]' && this.modifierGlyph
        ? [this.modifierGlyph]
        : [];
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
    addEventListener(
      type: string,
      listener: (event: { pointerType?: string; detail?: number }) => void,
    ) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type: string, event: { pointerType?: string; detail?: number } = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
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
    paint: vi.fn(),
    content: vi.fn(),
    render: vi.fn(),
    previousText: vi.fn(),
    contentReady: vi.fn(async () => {}),
    text: vi.fn((_host: HTMLElement, element: Element, frame: number) => ({ element, frame })),
    chart: vi.fn((host: HTMLElement, element: Element, frame: number) => ({
      element,
      frame: Number(host.dataset.ografChartAnimationFrame ?? frame),
    })),
    frames,
  };
});
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
vi.mock('./renderElement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./renderElement')>();
  return {
    ...actual,
    renderElementContent: (host: HTMLElement, element: Element) => {
      mock.render(host, element);
      host.dataset.ografRenderedElement = JSON.stringify(element);
      if (element.type === 'text')
        (host as unknown as InstanceType<typeof mock.Host>).modifierGlyph = {
          style: {},
          dataset: { ografTextBaseline: String(element.baselineShift) },
        };
    },
    renderAnimatedElementAtTime: mock.content,
    applyAnimatedPaint: mock.paint,
    disposeElementContent: () => {},
    setLottieDeterministicRendering: () => {},
    waitForElementContentReady: mock.contentReady,
  };
});
import { GraphicElement } from './GraphicElement';

describe('pointer-triggered visual rules', () => {
  it('applies mouse-over and mouse-leave visibility in realtime playback', async () => {
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'enter',
        name: 'Hide on hover',
        enabled: true,
        trigger: 'pointer-enter',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: false }],
      },
      {
        id: 'leave',
        name: 'Show on leave',
        enabled: true,
        trigger: 'pointer-leave',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: true }],
      },
    ];
    class Graphic extends GraphicElement {
      static descriptor = compiled;
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

    const layerHost = (
      graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>
    ).children.find((child) => child.style.position === 'absolute')!;
    layerHost.emit('pointerenter', { pointerType: 'touch' });
    expect(layerHost.style.display).toBe('');
    layerHost.emit('pointerenter', { pointerType: 'mouse' });
    expect(layerHost.style.display).toBe('none');
    layerHost.emit('pointerleave', { pointerType: 'mouse' });
    expect(layerHost.style.display).toBe('');

    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });

  it('changes data and the layer pose from rules in realtime playback', async () => {
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'count',
        name: 'Count clicks',
        enabled: true,
        trigger: 'click',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'set-data', fieldId: 'clicks', dataKey: 'clicks', mode: 'increase' }],
      },
      {
        id: 'grow',
        name: 'Grow after two clicks',
        enabled: true,
        trigger: 'data',
        dataKey: 'clicks',
        sourcePath: [],
        operator: 'greater-or-equal',
        value: 2,
        actions: [{ type: 'property', targetProperty: 'layer.scale', value: 1.5 }],
      },
    ];
    class Graphic extends GraphicElement {
      static descriptor = compiled;
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
    const layerHost = (
      graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>
    ).children.find((child) => child.style.position === 'absolute')!;

    vi.useFakeTimers();
    try {
      layerHost.emit('click', { detail: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(layerHost.style.transform).not.toContain('scale(1.5)');
      layerHost.emit('click', { detail: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(layerHost.style.transform).toContain('scale(1.5)');
    } finally {
      vi.useRealTimers();
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    }
  });

  it('runs press and release rules only for a press that started on the layer', async () => {
    const compiled = descriptor();
    const pointerRule = (trigger: 'pointer-down' | 'pointer-up', scale: number) => ({
      id: trigger,
      name: trigger,
      enabled: true,
      trigger,
      dataKey: '',
      sourcePath: [],
      operator: 'equals' as const,
      actions: [{ type: 'property' as const, targetProperty: 'layer.scale', value: scale }],
    });
    compiled.layers[0]!.visualRules = [
      pointerRule('pointer-down', 0.9),
      pointerRule('pointer-up', 1.2),
    ];
    class Graphic extends GraphicElement {
      static descriptor = compiled;
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
    const layerHost = (
      graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>
    ).children.find((child) => child.style.position === 'absolute')!;
    const emit = (type: string, button = 0) =>
      layerHost.emit(type, { button, pointerId: 1 } as { pointerType?: string; detail?: number });

    emit('pointerup');
    expect(layerHost.style.transform).not.toContain('scale(1.2)');
    emit('pointerdown', 2);
    expect(layerHost.style.transform).not.toContain('scale(0.9)');
    emit('pointerdown');
    expect(layerHost.style.transform).toContain('scale(0.9)');
    emit('pointerup');
    expect(layerHost.style.transform).toContain('scale(1.2)');
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });

  it('does not fire a single-click rule during a double-click', async () => {
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'click',
        name: 'Hide on click',
        enabled: true,
        trigger: 'click',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: false }],
      },
      {
        id: 'double-click',
        name: 'Show on double-click',
        enabled: true,
        trigger: 'double-click',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: true }],
      },
    ];
    class Graphic extends GraphicElement {
      static descriptor = compiled;
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
    const layerHost = (
      graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>
    ).children.find((child) => child.style.position === 'absolute')!;

    vi.useFakeTimers();
    try {
      layerHost.emit('click', { detail: 1 });
      layerHost.emit('click', { detail: 2 });
      layerHost.emit('dblclick');
      await vi.advanceTimersByTimeAsync(500);
      expect(layerHost.style.display).toBe('');

      layerHost.emit('click', { detail: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(layerHost.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    }
  });
});

function descriptor(): CompiledGraphicDescriptor {
  const authored = createRectangleLayer();
  if (authored.element.type !== 'rectangle') throw Error('Expected rectangle');
  const paint = createShaderPaint({
    fragmentSource: `#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.4;
#pragma ograf count slider min(0) max(10)
const int count = 3;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`,
  });
  const key = (id: string, frame: number, value: number) => ({
    id,
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
        id: 'shader',
        isVisible: true,
        element: { ...authored.element, fill: paint },
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
        bindings: [
          { dataKey: 'gain', targetProperty: 'fill.parameters.gain' },
          { dataKey: 'count', targetProperty: 'fill.parameters.count' },
        ],
        loop: createLayerLoopClip({
          durationFrames: 20,
          activation: { type: 'step', stepKeyframeId: 'step1' },
          tracks: {
            'fill.parameters.gain': [key('g0', 0, 0), key('g1', 10, 2), key('g2', 20, 0)],
            'fill.parameters.count': [key('c0', 0, 2), key('c1', 10, 8), key('c2', 20, 2)],
          },
        }),
      },
    ],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'step1', frame: 10, role: 'step' },
      { id: 'step2', frame: 20, role: 'step' },
      { id: 'end', frame: 30, role: 'end' },
    ],
    transitions: [
      { fromKeyframeId: 'step2', toKeyframeId: 'end', durationFrames: 10, easing: 'linear' },
    ],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1', 'step2'],
    stepCount: 2,
    customActions: [],
  };
}

function mediaDescriptor(): CompiledGraphicDescriptor {
  const result = descriptor();
  const authored = createRectangleLayer();
  if (authored.element.type !== 'rectangle') throw Error('Expected rectangle');
  return {
    ...result,
    layers: [
      {
        ...result.layers[0]!,
        id: 'media',
        element: {
          ...authored.element,
          fill: createMediaPaint({ source: { kind: 'clip', src: 'asset:clip' } }),
        },
        bindings: [],
        loop: null,
      },
    ],
  };
}

function customActionDescriptor(): CompiledGraphicDescriptor {
  const result = descriptor();
  const layer = result.layers[0]!;
  return {
    ...result,
    layers: [
      {
        ...layer,
        loop: {
          ...layer.loop!,
          activation: { type: 'customAction', customActionId: 'goal_scored' },
          repeatCount: 1,
        },
      },
    ],
    customActions: [{ id: 'goal_scored', name: 'Goal scored', durationFrames: 20 }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.frames.length = 0;
});

describe('exported shader field exposure', () => {
  function exposureDescriptor(): CompiledGraphicDescriptor {
    const source = descriptor();
    const layer = source.layers[0]!;
    if (
      layer.element.type !== 'rectangle' ||
      typeof layer.element.fill !== 'object' ||
      layer.element.fill.type !== 'shader'
    )
      throw Error('Expected shader rectangle');
    layer.element.fill.fragmentSource = layer.element.fill.fragmentSource.replace(
      'void mainImage',
      '#pragma ograf phase slider min(0.0) max(2.0)\nconst float phase = 0.2;\nvoid mainImage',
    );
    layer.bindings = [
      ...layer.bindings!,
      { dataKey: 'phase', targetProperty: 'fill.parameters.phase' },
    ];
    layer.loop!.tracks = {
      'fill.parameters.phase': [
        { id: 'phase-start', frame: 0, value: 0, easing: 'linear' },
        { id: 'phase-end', frame: 10, value: 2, easing: 'linear' },
      ],
    };
    layer.visualRules = [
      {
        id: 'boost',
        name: 'Internal gain from public trigger',
        enabled: true,
        trigger: 'data',
        dataKey: 'boost',
        sourcePath: [],
        operator: 'equals',
        value: true,
        actions: [{ type: 'set-data', fieldId: 'gain', dataKey: 'gain', mode: 'set', value: 1.6 }],
      },
      {
        id: 'probe-rule',
        name: 'Custom action still controls internal gain',
        enabled: true,
        trigger: 'custom-action',
        eventId: 'probe',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'set-data', fieldId: 'gain', dataKey: 'gain', mode: 'set', value: 0.9 }],
      },
    ];
    source.customActions = [{ id: 'probe', name: 'Probe', durationFrames: 0 }];
    source.dataExposure = {
      gain: { exposed: false, defaultValue: 0.4 },
      phase: { exposed: false, defaultValue: 0.2 },
    };
    source.dataDefaults = { gain: 0.4, phase: 0.2, count: 3, boost: false };
    return source;
  }

  const currentShader = (graphic: GraphicElement) => {
    const host = (graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>).children.find(
      (child) => child.style.position === 'absolute',
    )!;
    const element = JSON.parse(host.dataset.ografRenderedElement!) as Element;
    if (
      element.type !== 'rectangle' ||
      typeof element.fill !== 'object' ||
      element.fill.type !== 'shader'
    )
      throw Error('Expected shader');
    return resolveShaderParameters(element.fill);
  };

  it('blocks external load/update/custom writes but keeps hidden bindings and Rules live', async () => {
    class Exported extends GraphicElement {
      static descriptor = exposureDescriptor();
      protected resolveExternalData(data: unknown, current: Record<string, unknown>): unknown {
        return this.filterPublicData(data, current);
      }
    }
    const graphic = new Exported();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: {},
        data: { gain: 1.9, phase: 1.8, count: 4 },
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(currentShader(graphic)).toMatchObject({ gain: 0.4, phase: 0.2, count: 4 });
    expect(
      await graphic.updateAction({
        data: { gain: 1.9, count: 5, boost: true },
        skipAnimation: true,
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(currentShader(graphic)).toMatchObject({ gain: 1.6, phase: 0.2, count: 5 });
    expect(
      await graphic.customAction({
        id: 'probe',
        payload: { gain: 0.1, phase: 1.7, count: 6 },
        skipAnimation: true,
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(currentShader(graphic)).toMatchObject({ gain: 0.9, phase: 0.2, count: 6 });
    await graphic.dispose();
  });

  it('retains hidden shader animation and internal Rules through scheduled and backward replay', async () => {
    class Exported extends GraphicElement {
      static descriptor = exposureDescriptor();
      protected resolveExternalData(data: unknown, current: Record<string, unknown>): unknown {
        return this.filterPublicData(data, current);
      }
    }
    const graphic = new Exported();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'non-realtime',
        renderCharacteristics: {},
        data: { gain: 1.9, phase: 1.8 },
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          {
            timestamp: 100,
            action: {
              type: 'updateAction',
              params: {
                data: { gain: 1.9, phase: 1.8, count: 5, boost: true },
                skipAnimation: true,
              },
            },
          },
          {
            timestamp: 200,
            action: {
              type: 'customAction',
              params: {
                id: 'probe',
                payload: { gain: 0.1, phase: 1.7, count: 6 },
                skipAnimation: true,
              },
            },
          },
        ],
      }),
    ).toMatchObject({ statusCode: 200 });
    for (const [timestamp, gain, count] of [
      [50, 0.4, 3],
      [150, 1.6, 5],
      [250, 0.9, 6],
      [50, 0.4, 3],
      [250, 0.9, 6],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      expect(currentShader(graphic)).toMatchObject({ gain, count });
      const [host, tracks, frame] = mock.paint.mock.calls.at(-1) as [
        HTMLElement,
        LayerAnimationTracks,
        number,
      ];
      const base = JSON.parse(host.dataset.ografRenderedElement!) as Element;
      const animated = applyShaderAnimationValues(
        base,
        sampleShaderAnimationValues(base, tracks, frame),
      );
      if (
        animated.type !== 'rectangle' ||
        typeof animated.fill !== 'object' ||
        animated.fill.type !== 'shader'
      )
        throw Error('Expected animated shader');
      expect(resolveShaderParameters(animated.fill).phase).toBeCloseTo(timestamp / 500);
    }
    await graphic.dispose();
  });
});

describe('timer alarms through exported Graphic Rules', () => {
  function alarmDescriptor(manual = false): CompiledGraphicDescriptor {
    const result = descriptor();
    const timer = result.layers[0]!;
    timer.id = 'timer';
    timer.element = createTextElement({
      clock: normalizeClockTimerSettings({
        mode: 'count-down',
        initialValueMs: 10000,
        source: manual ? 'manual' : 'automatic',
        manualValue: 10000,
        autoStart: true,
        endBehavior: 'stop',
        format: 'ss.SSS',
      }),
    });
    timer.loop = null;
    timer.bindings = manual ? [{ dataKey: 'remaining', targetProperty: 'clock.manualValue' }] : [];
    timer.visualRules = [0, 5000].map((threshold) => ({
      id: `alarm-${threshold}`,
      name: `Alarm ${threshold}`,
      enabled: true,
      trigger: 'timer-alarm',
      timerAlarm: { sourceLayerId: 'timer', thresholdMs: threshold, direction: 'down' },
      dataKey: '',
      sourcePath: [],
      operator: 'equals',
      actions: [
        {
          type: 'set-data',
          fieldId: 'status',
          dataKey: 'status',
          mode: 'set',
          value: threshold === 0 ? 'TIME UP' : 'WARNING',
        },
      ],
    }));
    result.layers.push({
      ...structuredClone(timer),
      id: 'status',
      visualRules: [],
      element: createTextElement({ content: 'READY' }),
      bindings: [{ dataKey: 'status', targetProperty: 'content' }],
    });
    result.customActions = ['start', 'pause', 'reset', 'restart'].map((command) => ({
      id: clockTimerActionId('timer', command as 'start'),
      name: command,
      durationFrames: 0,
    }));
    return result;
  }

  function status(graphic: GraphicElement): string {
    const hosts = (graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>).children;
    const host =
      hosts.find((entry) => entry.dataset.layerId === 'status') ??
      hosts.filter((entry) => entry.style.position === 'absolute').at(-1)!;
    return JSON.parse(host.dataset.ografRenderedElement!).content;
  }

  it('replays warning, zero, Reset and Restart with actual data actions and backward seeks', async () => {
    class Graphic extends GraphicElement {
      static descriptor = alarmDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'non-realtime',
        renderCharacteristics: {},
        data: { status: 'READY' },
      }),
    ).toMatchObject({ statusCode: 200 });
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 12000,
          action: { type: 'customAction', params: { id: clockTimerActionId('timer', 'reset') } },
        },
        {
          timestamp: 13000,
          action: { type: 'customAction', params: { id: clockTimerActionId('timer', 'restart') } },
        },
        {
          timestamp: 13000,
          action: { type: 'updateAction', params: { data: { status: 'READY' } } },
        },
      ],
    });
    for (const [timestamp, expected] of [
      [4999, 'READY'],
      [5001, 'WARNING'],
      [10000, 'TIME UP'],
      [17000, 'READY'],
      [18000, 'WARNING'],
      [23000, 'TIME UP'],
      [1000, 'READY'],
      [23000, 'TIME UP'],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      expect(status(graphic)).toBe(expected);
    }
    await graphic.dispose();
  });

  it('orders jumped manual warning and zero so the final alarm wins, then rearms without rewriting feed', async () => {
    class Graphic extends GraphicElement {
      static descriptor = alarmDescriptor(true);
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'non-realtime',
        renderCharacteristics: {},
        data: { status: 'READY', remaining: 6000 },
      }),
    ).toMatchObject({ statusCode: 200 });
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 1000,
          action: { type: 'updateAction', params: { skipAnimation: true, data: { remaining: 0 } } },
        },
        {
          timestamp: 2000,
          action: { type: 'customAction', params: { id: clockTimerActionId('timer', 'reset') } },
        },
        {
          timestamp: 3000,
          action: {
            type: 'updateAction',
            params: { skipAnimation: true, data: { remaining: 10000, status: 'READY' } },
          },
        },
        {
          timestamp: 4000,
          action: {
            type: 'updateAction',
            params: { skipAnimation: true, data: { remaining: 4000 } },
          },
        },
        {
          timestamp: 5000,
          action: { type: 'updateAction', params: { skipAnimation: true, data: { remaining: 0 } } },
        },
      ],
    });
    for (const [timestamp, expected] of [
      [1000, 'TIME UP'],
      [3000, 'READY'],
      [4000, 'WARNING'],
      [5000, 'TIME UP'],
      [0, 'READY'],
      [5000, 'TIME UP'],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      expect(status(graphic)).toBe(expected);
    }
    await graphic.dispose();
  });

  it('bounds an initial-threshold alarm that restarts its own timer in live and scheduled playback', async () => {
    for (const renderType of ['realtime', 'non-realtime'] as const) {
      const source = alarmDescriptor();
      const timer = source.layers[0]!;
      if (timer.element.type !== 'text' || !timer.element.clock) throw Error('Expected timer');
      timer.element.clock.initialValueMs = 5000;
      timer.visualRules = timer.visualRules!.filter(
        (rule) => rule.timerAlarm!.thresholdMs === 5000,
      );
      timer.visualRules[0]!.actions = [
        { type: 'set-data', fieldId: 'status', dataKey: 'status', mode: 'increase', value: 1 },
        { type: 'custom-action', actionId: clockTimerActionId('timer', 'restart') },
      ];
      class Graphic extends GraphicElement {
        static descriptor = source;
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({ renderType, renderCharacteristics: {}, data: { status: 0 } }),
      ).toMatchObject({ statusCode: 200 });
      if (renderType === 'realtime') {
        await graphic.playAction({ skipAnimation: true });
        for (let index = 0; index < 100; index++) await Promise.resolve();
      } else {
        await graphic.setActionsSchedule({
          schedule: [
            { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          ],
        });
        expect(await graphic.goToTime({ timestamp: 0 })).toMatchObject({ statusCode: 200 });
      }
      expect(Number(status(graphic))).toBeGreaterThan(0);
      expect(Number(status(graphic))).toBeLessThanOrEqual(4);
      await graphic.dispose();
    }
  });
});

describe('clock modifier glyph replacement', () => {
  function clockDescriptor() {
    const result = descriptor(),
      layer = result.layers[0]!;
    layer.element = createTextElement({
      content: 'X',
      clock: normalizeClockTimerSettings({
        mode: 'count-up',
        format: 's',
        initialValueMs: 9000,
        autoStart: true,
      }),
    });
    layer.bindings = [];
    layer.loop = null;
    layer.modifiers = [createLayerModifier('max-text-width', { maxWidth: 100 })];
    return result;
  }
  it('reapplies Max Text Width after deterministic clock callbacks, including scheduled and backward seeks', async () => {
    class Graphic extends GraphicElement {
      static descriptor = clockDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({ renderType: 'non-realtime', renderCharacteristics: {} }),
    ).toMatchObject({ statusCode: 200 });
    const host = (graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>).children.find(
      (child) => child.style.position === 'absolute',
    )!;
    const assertFit = (content: string) => {
      expect(JSON.parse(host.dataset.ografRenderedElement!).content).toBe(content);
      expect(host.modifierGlyph!.dataset.ografModifierScaleX).toBe(String(100 / 640));
      expect(host.modifierGlyph!.style.transform).toBe(`scale(${100 / 640}, 1) translateY(0px)`);
    };
    for (const [timestamp, text] of [
      [0, '9'],
      [1000, '10'],
      [0, '9'],
      [1000, '10'],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      assertFit(text);
    }
    await graphic.setActionsSchedule({
      schedule: [{ timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } }],
    });
    for (const [timestamp, text] of [
      [2000, '11'],
      [0, '9'],
      [2000, '11'],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      assertFit(text);
    }
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });
  it('reapplies the fit when the independent realtime timer replaces its glyph DOM', async () => {
    let now = 1000;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      class Graphic extends GraphicElement {
        static descriptor = clockDescriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({ renderType: 'realtime', renderCharacteristics: {} }),
      ).toMatchObject({ statusCode: 200 });
      expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({ statusCode: 200 });
      const host = (graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>).children.find(
        (child) => child.style.position === 'absolute',
      )!;
      now = 2100;
      const pending = mock.frames.splice(0);
      for (const callback of pending) callback(now);
      expect(JSON.parse(host.dataset.ografRenderedElement!).content).toBe('10');
      expect(host.modifierGlyph!.dataset.ografModifierScaleX).toBe(String(100 / 640));
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    } finally {
      time.mockRestore();
    }
  });
});

describe('realtime Media paint playback', () => {
  it('continues other animated layers while a shader is paused', async () => {
    const source = mediaDescriptor();
    const second = { ...source.layers[0]!, id: 'second' };
    class Graphic extends GraphicElement {
      static descriptor = { ...source, layers: [source.layers[0]!, second] };
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(await graphic.load({ renderType: 'realtime', renderCharacteristics: {} })).toMatchObject(
      { statusCode: 200 },
    );
    const hosts = (graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>).children.filter(
      (child) => child.style.position === 'absolute',
    );
    hosts[0]!.shaderPaused = true;
    const count = mock.content.mock.calls.length;
    expect(hosts).toHaveLength(2);
    const counts = vi
      .spyOn(shaderRuntime, 'shaderContextCounts')
      .mockReturnValue({ live: 1, lost: 1 });
    try {
      const scheduled = mock.frames.findIndex((frame) => frame.name === 'invoke');
      mock.frames.splice(scheduled, 1)[0]!(performance.now());
      const calls = mock.content.mock.calls.slice(count);
      expect(calls.some(([host]) => host === hosts[0])).toBe(false);
      expect(calls.some(([host]) => host === hosts[1])).toBe(true);
      await graphic.dispose();
    } finally {
      counts.mockRestore();
    }
  });
  it('keeps rendering Media frames after load', async () => {
    class Graphic extends GraphicElement {
      static descriptor = mediaDescriptor();
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
    expect(mock.frames.filter((frame) => frame.name === 'invoke')).toHaveLength(1);

    const rendersAfterLoad = mock.content.mock.calls.length;
    const scheduled = mock.frames.findIndex((frame) => frame.name === 'invoke');
    mock.frames.splice(scheduled, 1)[0]!(performance.now());
    expect(mock.content.mock.calls.length).toBeGreaterThan(rendersAfterLoad);
    expect(mock.frames.filter((frame) => frame.name === 'invoke')).toHaveLength(1);

    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });
});

describe('custom-action clips', () => {
  it('applies payload data, plays the authored clip, and settles automatically', async () => {
    vi.useFakeTimers();
    try {
      class Graphic extends GraphicElement {
        static descriptor = customActionDescriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: { gain: 0.5, count: 3 },
        }),
      ).toMatchObject({ statusCode: 200 });

      let settled = false;
      const action = graphic
        .customAction({ id: 'goal_scored', payload: { gain: 1.25 }, skipAnimation: false })
        .then((result) => {
          settled = true;
          return result;
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      expect(
        mock.render.mock.calls.some(
          ([, element]) =>
            element.type === 'rectangle' &&
            element.fill.type === 'shader' &&
            element.fill.parameters.gain === 1.25,
        ),
      ).toBe(true);

      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await action).toMatchObject({ statusCode: 200 });
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scheduled shader lifecycle replay', () => {
  it.each(['stopAction', 'playAction'] as const)(
    'preserves held loop phase and discrete uniforms through %s and backward replay',
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
          data: { gain: 0.8, count: 5 },
        }),
      ).toMatchObject({ statusCode: 200 });
      const schedule: ScheduledAction[] = [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 250,
          action: {
            type: 'updateAction',
            params: { data: { gain: 0.6, count: 4 }, skipAnimation: true },
          },
        },
        { timestamp: 500, action: { type: action, params: {} } },
      ];
      await graphic.setActionsSchedule({ schedule });
      const sample = async (timestamp: number) => {
        expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
        const [host, tracks, frame] = mock.paint.mock.calls.at(-1) as [
          HTMLElement,
          LayerAnimationTracks,
          number,
        ];
        const base = JSON.parse(host.dataset.ografRenderedElement!) as Element;
        const animated = applyShaderAnimationValues(
          base,
          sampleShaderAnimationValues(base, tracks, frame),
        );
        if (
          !('fill' in animated) ||
          !animated.fill ||
          typeof animated.fill === 'string' ||
          animated.fill.type !== 'shader'
        )
          throw Error('Expected shader fill');
        return resolveShaderParameters(animated.fill);
      };
      const first = await sample(1000);
      expect(first).toMatchObject({ gain: 0.8, count: 2 });
      expect(await sample(100)).toMatchObject({ gain: 0.2, count: 2 });
      expect(await sample(1000)).toEqual(first);
      expect(await sample(1500)).toMatchObject({ gain: 0.6, count: 4 });
      await graphic.setActionsSchedule({ schedule: [] });
      expect(await sample(1000)).toMatchObject({ gain: 0.6, count: 4 });
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    },
  );
});

function chartDescriptor(): CompiledGraphicDescriptor {
  const result = descriptor();
  return {
    ...result,
    layers: [
      {
        ...result.layers[0]!,
        id: 'chart',
        element: createChartElement({
          animation: {
            type: 'grow',
            durationFrames: 20,
            delayFrames: 0,
            staggerFrames: 0,
            easing: 'linear',
            replayOnUpdate: true,
          },
        }),
        bindings: [{ dataKey: 'chartData', targetProperty: 'data' }],
        loop: null,
      },
    ],
  };
}

function chartData(values: number[]): string {
  const element = createChartElement();
  return JSON.stringify({
    ...element.data,
    datasets: [{ ...element.data.datasets[0]!, data: values }],
  });
}

function rollingTextDescriptor(): CompiledGraphicDescriptor {
  const result = descriptor();
  const element = createTextElement({ content: '100' });
  element.textAnimation = {
    ...element.textAnimation,
    type: 'roll-up',
    durationFrames: 10,
    replayOnUpdate: true,
  };
  return {
    ...result,
    layers: [
      {
        ...result.layers[0]!,
        id: 'rolling-text',
        element,
        bindings: [{ dataKey: 'score', targetProperty: 'content' }],
        loop: null,
      },
    ],
  };
}

function latestTextSample() {
  const sample = mock.text.mock.results.at(-1)?.value;
  if (!sample || sample.element.type !== 'text') throw Error('Expected text render');
  return {
    frame: sample.frame,
    content: sample.element.content,
    previous: mock.previousText.mock.calls.at(-1)?.[1]?.content ?? null,
  };
}

describe('rolling text update integration', () => {
  it('captures the previous bound text before applying a realtime data update', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    class Graphic extends GraphicElement {
      static descriptor = rollingTextDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: { score: '100' },
      }),
    ).toMatchObject({ statusCode: 200 });
    now = 1000;
    expect(await graphic.updateAction({ data: { score: '200' } })).toMatchObject({
      statusCode: 200,
    });
    expect(latestTextSample()).toEqual({ content: '200', previous: '100', frame: 0 });
    now = 1500;
    for (const callback of mock.frames.splice(0)) callback(now);
    expect(latestTextSample()).toEqual({ content: '200', previous: '100', frame: 5 });
    expect(await graphic.updateAction({ data: { score: '200' } })).toMatchObject({
      statusCode: 200,
    });
    expect(latestTextSample()).toEqual({ content: '200', previous: '100', frame: 5 });
    now = 2000;
    expect(await graphic.updateAction({ data: { score: '300' } })).toMatchObject({
      statusCode: 200,
    });
    expect(latestTextSample()).toEqual({ content: '300', previous: '200', frame: 0 });
    expect(
      await graphic.updateAction({ data: { score: '400' }, skipAnimation: true }),
    ).toMatchObject({
      statusCode: 200,
    });
    expect(latestTextSample()).toEqual({ content: '400', previous: null, frame: 10 });
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    clock.mockRestore();
  });

  it('reconstructs each scheduled predecessor on backward seeks and settles skipped updates', async () => {
    class Graphic extends GraphicElement {
      static descriptor = rollingTextDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'non-realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: { score: '100' },
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: {} } },
          { timestamp: 1000, action: { type: 'updateAction', params: { data: { score: '200' } } } },
          { timestamp: 1200, action: { type: 'updateAction', params: { data: { score: '200' } } } },
          { timestamp: 2000, action: { type: 'updateAction', params: { data: { score: '300' } } } },
          {
            timestamp: 2600,
            action: {
              type: 'updateAction',
              params: { data: { score: '400' }, skipAnimation: true },
            },
          },
        ],
      }),
    ).toMatchObject({ statusCode: 200 });
    const sample = async (timestamp: number) => {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      return latestTextSample();
    };
    expect(await sample(1500)).toEqual({ content: '200', previous: '100', frame: 5 });
    expect(await sample(2500)).toEqual({ content: '300', previous: '200', frame: 5 });
    expect(await sample(1500)).toEqual({ content: '200', previous: '100', frame: 5 });
    expect(await sample(500)).toEqual({ content: '100', previous: null, frame: 5 });
    expect(await sample(2700)).toEqual({ content: '400', previous: null, frame: 10 });
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });
});

describe('update transitions on bound text', () => {
  const inherited = { style: 'inherit', durationFrames: 0, distance: 24 } as const;
  type UpdateTransition = NonNullable<
    CompiledGraphicDescriptor['layers'][number]['updateTransition']
  >;
  interface TextLayerOptions {
    type?: TextAnimation['type'];
    replayOnUpdate?: boolean;
    updateTransition?: UpdateTransition;
  }

  function textLayer(
    id: string,
    content: string,
    { type = 'none', replayOnUpdate = true, updateTransition = inherited }: TextLayerOptions = {},
  ): CompiledGraphicDescriptor['layers'][number] {
    const element = createTextElement({ content });
    element.textAnimation = { ...element.textAnimation, type, durationFrames: 10, replayOnUpdate };
    return {
      ...descriptor().layers[0]!,
      id,
      element,
      bindings: [{ dataKey: id, targetProperty: 'content' }],
      loop: null,
      updateTransition,
    };
  }

  /** Text hosts get a content node that records its fades, keyed by the initial text. */
  async function mount(
    layers: CompiledGraphicDescriptor['layers'],
    renderType: 'realtime' | 'non-realtime' = 'realtime',
    updateInterruption: CompiledGraphicDescriptor['updateInterruption'] = 'queue',
  ) {
    const contents = new Map<string, { style: Record<string, string>; animate: Mock }>();
    mock.render.mockImplementation((host: HTMLElement, element: Element) => {
      const node = host as unknown as InstanceType<typeof mock.Host>;
      if (node.firstElementChild || element.type !== 'text') return;
      const content = Object.assign(new mock.Host(), {
        animate: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() })),
      });
      node.firstElementChild = content;
      contents.set(element.content, content);
    });
    class Graphic extends GraphicElement {
      static descriptor = {
        ...descriptor(),
        updateTransitionFrames: 10,
        updateInterruption,
        layers,
      };
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    const data = Object.fromEntries(
      layers.map((layer) => [layer.id, layer.element.type === 'text' ? layer.element.content : '']),
    );
    expect(
      await graphic.load({
        renderType,
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data,
      }),
    ).toMatchObject({ statusCode: 200 });
    return { graphic, contents };
  }

  /** The newest render of one layer, since a scheduled seek redraws every text layer. */
  function textSampleOf(content: string) {
    const index = mock.text.mock.results
      .map(({ value }) => value.element.type === 'text' && value.element.content === content)
      .lastIndexOf(true);
    const sample = mock.text.mock.results[index]?.value;
    if (sample?.element.type !== 'text') throw Error(`Expected a render of ${content}`);
    const host = mock.text.mock.calls[index]![0];
    const previous = mock.previousText.mock.calls.filter((call) => call[0] === host).at(-1);
    return {
      frame: sample.frame,
      content: sample.element.content,
      previous: previous?.[1]?.content ?? null,
    };
  }

  /** The fades one content node has run, oldest first. */
  function fades(content: { animate: Mock }) {
    return content.animate.mock.results.map((result, index) => ({
      cancel: result.value.cancel as Mock,
      fill: (content.animate.mock.calls[index]![1] as KeyframeAnimationOptions).fill,
      startedAt: content.animate.mock.invocationCallOrder[index]!,
    }));
  }

  /** How many of those fades the audience sees, leaving out the zero-length hold between them. */
  function fadePhases(content: { animate: Mock }) {
    return content.animate.mock.calls.filter(
      (call) => (call[1] as KeyframeAnimationOptions).duration !== 0,
    ).length;
  }

  /** Lets an update reach its fade-out, then pauses it until the new value is ready. */
  function pauseAfterApply() {
    let release!: (error?: Error) => void;
    const paused = new Promise<void>((resolve, reject) => {
      release = (error) => (error ? reject(error) : resolve());
    });
    let reached = false;
    mock.contentReady
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => {
        reached = true;
        return paused;
      });
    return {
      release: (error?: Error) => release(error),
      reached: () => vi.waitFor(() => expect(reached).toBe(true)),
    };
  }

  afterEach(() => mock.render.mockReset());

  it('holds only the fade-out, and releases it as the fade-in starts', async () => {
    const { graphic, contents } = await mount([textLayer('team', 'ARS')]);
    await graphic.updateAction({ data: { team: 'CHE' } });
    const [out, hold, into] = fades(contents.get('ARS')!);
    expect(out!.fill).toBe('forwards');
    expect(hold!.fill).toBe('forwards');
    // A held fade-in would outrank every later inline opacity, such as a Rule's visibility fade.
    expect(into!.fill).toBe('none');
    expect(out!.cancel).toHaveBeenCalledOnce();
    expect(hold!.cancel).toHaveBeenCalledOnce();
    // Releasing a hold before its replacement exists would show the content for a frame.
    expect(out!.cancel.mock.invocationCallOrder[0]).toBeGreaterThan(hold!.startedAt);
    expect(hold!.cancel.mock.invocationCallOrder[0]).toBeGreaterThan(into!.startedAt);
    expect(into!.cancel).not.toHaveBeenCalled();
  });

  it('keeps the old value hidden until the new value is ready', async () => {
    const { graphic, contents } = await mount([textLayer('team', 'ARS')]);
    const content = contents.get('ARS')!;
    const pause = pauseAfterApply();
    const update = graphic.updateAction({ data: { team: 'CHE' } });
    await pause.reached();
    expect(fadePhases(content)).toBe(1);
    expect(fades(content).at(-1)!.fill).toBe('forwards');
    expect(fades(content).at(-1)!.cancel).not.toHaveBeenCalled();
    pause.release();
    await update;
    expect(fadePhases(content)).toBe(2);
    expect(fades(content)[1]!.cancel).toHaveBeenCalledOnce();
  });

  it('keeps re-rendered content hidden until its fade-in starts', async () => {
    const { graphic, contents } = await mount([textLayer('team', 'ARS')]);
    const replacement = Object.assign(new mock.Host(), {
      animate: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() })),
    });
    mock.render.mockImplementation((host: HTMLElement) => {
      (host as unknown as InstanceType<typeof mock.Host>).firstElementChild = replacement;
    });
    const pause = pauseAfterApply();
    const update = graphic.updateAction({ data: { team: 'CHE' } });
    await pause.reached();
    expect(replacement.animate).toHaveBeenCalledOnce();
    const [keyframes, options] = replacement.animate.mock.calls[0]! as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(keyframes.map((keyframe) => keyframe.opacity)).toEqual([0, 0]);
    expect(options).toMatchObject({ duration: 0, fill: 'forwards' });
    expect(fades(contents.get('ARS')!)[0]!.cancel).toHaveBeenCalledOnce();
    pause.release();
    await update;
    const [hold, into] = fades(replacement);
    expect(into!.fill).toBe('none');
    expect(hold!.cancel.mock.invocationCallOrder[0]).toBeGreaterThan(into!.startedAt);
  });

  it('shows the layer again when an update fails after its fade-out', async () => {
    const { graphic, contents } = await mount([textLayer('team', 'ARS')]);
    const content = contents.get('ARS')!;
    const pause = pauseAfterApply();
    const update = graphic.updateAction({ data: { team: 'CHE' } });
    await pause.reached();
    pause.release(new Error('Content failed to render.'));
    expect((await update)?.statusCode).not.toBe(200);
    expect(fadePhases(content)).toBe(1);
    for (const fade of fades(content)) expect(fade.cancel).toHaveBeenCalledOnce();
  });

  it('does not fade in an update that a newer one replaced', async () => {
    const { graphic, contents } = await mount([textLayer('team', 'ARS')], 'realtime', 'replace');
    const content = contents.get('ARS')!;
    const pause = pauseAfterApply();
    const older = graphic.updateAction({ data: { team: 'CHE' } });
    await pause.reached();
    const newer = graphic.updateAction({ data: { team: 'MUN' } });
    await newer;
    pause.release();
    await older;
    expect(fadePhases(content)).toBe(3);
    const newerIn = fades(content).at(-1)!;
    expect(newerIn.fill).toBe('none');
    expect(newerIn.cancel).not.toHaveBeenCalled();
    for (const fade of fades(content).slice(0, -1)) expect(fade.cancel).toHaveBeenCalledOnce();
  });

  it.each(['count-up', 'count-down', 'roll-up', 'roll-down'] as const)(
    'plays %s on a score change without the inherited crossfade',
    async (type) => {
      const { graphic, contents } = await mount([textLayer('score', '100', { type })]);
      expect(await graphic.updateAction({ data: { score: '200' } })).toMatchObject({
        statusCode: 200,
      });
      expect(contents.get('100')!.animate).not.toHaveBeenCalled();
      expect(latestTextSample()).toEqual({ content: '200', previous: '100', frame: 0 });
    },
  );

  it.each<[string, UpdateTransition]>([
    ['crossfade', { style: 'crossfade', durationFrames: 0, distance: 24 }],
    ['slide', { style: 'slide-up', durationFrames: 6, distance: 30 }],
    [
      'inherited style with its own duration',
      { style: 'inherit', durationFrames: 6, distance: 24 },
    ],
  ])('keeps an authored %s around a count', async (_name, updateTransition) => {
    const { graphic, contents } = await mount([
      textLayer('score', '100', { type: 'count-up', updateTransition }),
    ]);
    await graphic.updateAction({ data: { score: '200' } });
    expect(fadePhases(contents.get('100')!)).toBe(2);
  });

  it.each<[string, TextLayerOptions]>([
    ['no text animation', {}],
    ['an entrance effect', { type: 'fade' }],
    ['a count that does not replay', { type: 'count-up', replayOnUpdate: false }],
  ])('still crossfades a changed value with %s', async (_name, options) => {
    const { graphic, contents } = await mount([textLayer('score', '100', options)]);
    await graphic.updateAction({ data: { score: '200' } });
    expect(fadePhases(contents.get('100')!)).toBe(2);
  });

  it('fades only the layers whose bound value changed', async () => {
    const { graphic, contents } = await mount([
      textLayer('score', '100'),
      textLayer('team', 'ARS'),
    ]);
    await graphic.updateAction({ data: { score: '200', team: 'ARS' } });
    expect(fadePhases(contents.get('100')!)).toBe(2);
    expect(contents.get('ARS')!.animate).not.toHaveBeenCalled();
  });

  it('compares object values by content, so a resent payload does not fade', async () => {
    const { graphic, contents } = await mount([textLayer('team', 'ARS')]);
    await graphic.updateAction({ data: { team: { name: 'CHE' } } });
    expect(fadePhases(contents.get('ARS')!)).toBe(2);
    await graphic.updateAction({ data: { team: { name: 'CHE' } } });
    expect(fadePhases(contents.get('ARS')!)).toBe(2);
  });

  it('starts a count at the update when nothing else fades in a scheduled render', async () => {
    const { graphic, contents } = await mount(
      [textLayer('score', '100', { type: 'count-up' }), textLayer('team', 'ARS')],
      'non-realtime',
    );
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: {} } },
        {
          timestamp: 1000,
          action: { type: 'updateAction', params: { data: { score: '200', team: 'ARS' } } },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 1300 })).toMatchObject({ statusCode: 200 });
    expect(textSampleOf('200')).toEqual({ content: '200', previous: '100', frame: 3 });
    expect(contents.get('100')!.style.opacity).toBeFalsy();
    expect(contents.get('ARS')!.style.opacity).toBeFalsy();
  });

  it('holds a count until the swap while another changed layer fades in a scheduled render', async () => {
    const { graphic, contents } = await mount(
      [textLayer('score', '100', { type: 'count-up' }), textLayer('team', 'ARS')],
      'non-realtime',
    );
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: {} } },
        {
          timestamp: 1000,
          action: { type: 'updateAction', params: { data: { score: '200', team: 'CHE' } } },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 1250 })).toMatchObject({ statusCode: 200 });
    expect(contents.get('ARS')!.style.opacity).toBe('0.5');
    expect(contents.get('100')!.style.opacity).toBeFalsy();
    expect(await graphic.goToTime({ timestamp: 1700 })).toMatchObject({ statusCode: 200 });
    expect(textSampleOf('200')).toEqual({ content: '200', previous: '100', frame: 2 });
    expect(contents.get('100')!.style.opacity).toBeFalsy();
  });

  it('does not fade a No transition layer in a scheduled render', async () => {
    const { graphic, contents } = await mount(
      [
        textLayer('score', '100', {
          updateTransition: { style: 'none', durationFrames: 0, distance: 24 },
        }),
        textLayer('team', 'ARS'),
      ],
      'non-realtime',
    );
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: {} } },
        {
          timestamp: 1000,
          action: { type: 'updateAction', params: { data: { score: '200', team: 'CHE' } } },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 1250 })).toMatchObject({ statusCode: 200 });
    expect(contents.get('100')!.style.opacity).toBeFalsy();
    expect(contents.get('ARS')!.style.opacity).toBe('0.5');
  });
});

function latestChartSample() {
  const sample = mock.chart.mock.results.at(-1)?.value;
  if (!sample || sample.element.type !== 'chart') throw Error('Expected chart render');
  return { frame: sample.frame, data: sample.element.data };
}

describe('chart lifecycle animation replay', () => {
  it('rejects an invalid distribution before committing any on-air fields', async () => {
    class Graphic extends GraphicElement {
      static descriptor = chartDescriptor();
    }
    const graphic = new Graphic();
    const initialData = chartData([10, 20, 30, 40]);
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: { chartData: initialData, headline: 'Existing' },
      }),
    ).toMatchObject({ statusCode: 200 });
    await graphic.playAction({ skipAnimation: true });
    const before = latestChartSample();
    const invalid = JSON.stringify({
      mode: 'percentages',
      rows: [{ id: 'first', label: 'First', value: 90 }],
    });
    const response = await graphic.updateAction({
      data: { chartData: invalid, headline: 'Changed' },
    });
    expect(response?.statusCode).not.toBe(200);
    expect(response?.statusMessage).toContain('missing 10%');
    expect(latestChartSample()).toEqual(before);
    expect(
      await graphic.updateAction({ data: { headline: 'Valid unrelated update' } }),
    ).toMatchObject({ statusCode: 200 });
    expect(latestChartSample().data).toEqual(JSON.parse(initialData));
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });
  it('replays changed JSON data at its scheduled update and reproduces backward seeks', async () => {
    class Graphic extends GraphicElement {
      static descriptor = chartDescriptor();
    }
    const graphic = new Graphic();
    const initialData = chartData([10, 20, 30, 40]);
    const updatedData = chartData([40, 30, 20, 10]);
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'non-realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: { chartData: initialData },
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: {} } },
          {
            timestamp: 1000,
            action: { type: 'updateAction', params: { data: { chartData: updatedData } } },
          },
          {
            timestamp: 1200,
            action: { type: 'updateAction', params: { data: { chartData: updatedData } } },
          },
          { timestamp: 1500, action: { type: 'stopAction', params: { skipAnimation: true } } },
        ],
      }),
    ).toMatchObject({ statusCode: 200 });
    const sample = async (timestamp: number) => {
      expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
      return latestChartSample();
    };
    const onOut = await sample(1500);
    expect(onOut).toEqual({ frame: 5, data: JSON.parse(updatedData) });
    expect(await sample(500)).toEqual({ frame: 5, data: JSON.parse(initialData) });
    expect(await sample(1500)).toEqual(onOut);
    expect(await sample(1000)).toEqual({ frame: 0, data: JSON.parse(updatedData) });
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });

  it('settles skipped play and update animations at their completed frame', async () => {
    class Graphic extends GraphicElement {
      static descriptor = chartDescriptor();
    }
    const graphic = new Graphic();
    const updatedData = chartData([40, 30, 20, 10]);
    graphic.connectedCallback();
    await graphic.load({
      renderType: 'non-realtime',
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      data: { chartData: chartData([10, 20, 30, 40]) },
    });
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 500,
          action: {
            type: 'updateAction',
            params: { data: { chartData: updatedData }, skipAnimation: true },
          },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 100 })).toMatchObject({ statusCode: 200 });
    expect(latestChartSample().frame).toBe(20);
    expect(await graphic.goToTime({ timestamp: 600 })).toMatchObject({ statusCode: 200 });
    expect(latestChartSample()).toEqual({ frame: 20, data: JSON.parse(updatedData) });
    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });

  it('finishes in realtime at a parked Step and replays only changed chart data', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    class Graphic extends GraphicElement {
      static descriptor = chartDescriptor();
    }
    const graphic = new Graphic();
    const initialData = chartData([10, 20, 30, 40]);
    const updatedData = chartData([40, 30, 20, 10]);
    try {
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: { chartData: initialData },
        }),
      ).toMatchObject({ statusCode: 200 });
      expect(await graphic.playAction({})).toMatchObject({ statusCode: 200, currentStep: 0 });
      expect(latestChartSample().frame).toBe(0);
      expect(mock.frames).toHaveLength(1);
      now = 1000;
      mock.frames.shift()!(now);
      expect(latestChartSample().frame).toBe(10);
      now = 2500;
      mock.frames.shift()!(now);
      expect(latestChartSample().frame).toBe(20);
      expect(mock.frames).toHaveLength(0);

      expect(await graphic.updateAction({ data: { chartData: initialData } })).toMatchObject({
        statusCode: 200,
      });
      expect(latestChartSample().frame).toBe(20);
      expect(mock.frames).toHaveLength(0);
      now = 3000;
      expect(await graphic.updateAction({ data: { chartData: updatedData } })).toMatchObject({
        statusCode: 200,
      });
      expect(latestChartSample()).toEqual({ frame: 0, data: JSON.parse(updatedData) });
      expect(mock.frames).toHaveLength(1);
      now = 5000;
      mock.frames.shift()!(now);
      expect(latestChartSample().frame).toBe(20);
      expect(mock.frames).toHaveLength(0);

      expect(await graphic.stopAction({ skipAnimation: true })).toMatchObject({ statusCode: 200 });
      expect(latestChartSample().frame).toBe(20);
      expect(mock.frames).toHaveLength(0);
      expect(
        await graphic.updateAction({ data: { chartData: initialData }, skipAnimation: true }),
      ).toMatchObject({ statusCode: 200 });
      expect(latestChartSample()).toEqual({ frame: 20, data: JSON.parse(initialData) });
      expect(mock.frames).toHaveLength(0);
    } finally {
      clock.mockRestore();
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    }
  });
});
