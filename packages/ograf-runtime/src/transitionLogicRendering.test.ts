import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createImageSequenceElement,
  createRectangleLayer,
  createTextElement,
  createChartElement,
  parseChartData,
  normalizeClockTimerSettings,
  clockTimerActionId,
  type Element,
  type VisualRuleTrigger,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    parent: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {
      createElement: () => new Host(),
      defaultView: null,
      fonts: { ready: Promise.resolve() },
    };
    attachShadow() {
      return (this.shadowRoot = new Host());
    }
    append(...children: Host[]) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    }
    replaceChildren(...children: Host[]) {
      for (const child of this.children) child.parent = null;
      this.children = [];
      this.append(...children);
    }
    querySelectorAll() {
      return [];
    }
    addEventListener() {}
    removeEventListener() {}
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }
  return {
    Host,
    render: vi.fn(),
    resolve: vi.fn(),
    animated: vi.fn(),
    state: vi.fn(),
    text: vi.fn(),
    chart: vi.fn(),
    chartHistory: vi.fn(() => true),
    previous: vi.fn(),
    dispose: vi.fn(),
    masks: vi.fn(),
    paths: vi.fn(),
    ready: vi.fn(async () => {}),
    shaderComplete: vi.fn(async () => {}),
  };
});
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./autoLayoutRendering', () => ({ applyCompiledAutoLayout() {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: mock.masks }));
vi.mock('./motionPathRendering', () => ({ applyCompiledMotionPaths: mock.paths }));
vi.mock('./shaderRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shaderRendering')>()),
  waitForShadersComplete: mock.shaderComplete,
}));
vi.mock('./backdropEffectRendering', () => ({
  compositionHasBackdropBlur: () => false,
  setCompositionBackdropRoot() {},
}));
vi.mock('./loopRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./loopRendering')>()),
  applyCompiledLayerVisualState: mock.state,
  applyCompiledClipPaths() {},
}));
vi.mock('./textAnimationRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./textAnimationRendering')>()),
  renderTextAnimationAtFrame: mock.text,
  setTextAnimationPrevious: mock.previous,
}));
vi.mock('./chartRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chartRendering')>()),
  renderChartAnimationAtFrame: mock.chart,
  renderChartAnimationHistoryAtFrame: mock.chartHistory,
}));
vi.mock('./renderElement', async (importOriginal) => {
  const original = await importOriginal<typeof import('./renderElement')>();
  return {
    ...original,
    resolveBoundElement: mock.resolve.mockImplementation(original.resolveBoundElement),
    renderElementContent: (host: HTMLElement, element: Element, frame: number) => {
      host.dataset.ografRenderedElement = JSON.stringify(element);
      mock.render(host, element, frame);
    },
    renderAnimatedElementAtTime: mock.animated,
    disposeElementContent: mock.dispose,
    setLottieDeterministicRendering() {},
    waitForElementContentReady: mock.ready,
  };
});

import {
  mountTransitionLogicComposition,
  sharedLayerKey,
  type TransitionLogicRuleWork,
} from './transitionLogicRendering';

function layer(element: Element = createTextElement({ content: 'Default' })): CompiledLayer {
  return {
    id: 'text',
    isVisible: true,
    element,
    effects: createLayerEffects(),
    bindings: [],
    keyframes: [
      {
        id: 'start',
        frame: 0,
        easing: 'linear',
        transform: createDefaultTransform({ x: 5, width: 400, height: 80 }),
      },
    ],
    animationTracks: {},
  };
}
function descriptor(layers: CompiledLayer[]): CompiledGraphicDescriptor {
  return {
    width: 1920,
    height: 1080,
    frameRate: 50,
    backgroundColor: 'transparent',
    layers,
    keyframes: [
      { id: 'off', role: 'start', frame: 0 },
      { id: 'on', role: 'step', frame: 25 },
      { id: 'end', role: 'end', frame: 50 },
    ],
    transitions: [],
    stepKeyframeIds: ['on'],
    stepCount: 1,
    startKeyframeId: 'off',
    endKeyframeId: 'end',
    customActions: [],
  };
}
function mount(
  layers: CompiledLayer[],
  options: Partial<Parameters<typeof mountTransitionLogicComposition>[0]> = {},
) {
  return mountTransitionLogicComposition({
    parent: new mock.Host() as unknown as HTMLElement,
    descriptor: descriptor(layers),
    startFrame: 0,
    data: {},
    ...options,
  });
}
beforeEach(() => vi.clearAllMocks());

describe('coordinated mount keyboard Rules', () => {
  function keyboardLayer() {
    const host = layer();
    host.visualRules = [
      {
        id: 'keyboard',
        name: 'Keyboard',
        enabled: true,
        trigger: 'key-down',
        keyboard: { key: 'F8', shift: true, repeat: false },
        dataKey: 'allowed',
        conditions: [{ dataKey: 'allowed', sourcePath: [], operator: 'equals', value: true }],
        sourcePath: [],
        operator: 'equals',
        value: true,
        delayFrames: 5,
        actions: [
          { type: 'set-data', fieldId: 'count', dataKey: 'count', mode: 'increase', value: 1 },
        ],
      },
    ];
    return host;
  }
  it('retains existing conditions, delayed scheduling and data actions while claiming ignored repeats', async () => {
    const work: TransitionLogicRuleWork[] = [],
      changed = vi.fn();
    const rendered = mount([keyboardLayer()], {
      data: { allowed: true, count: 0 },
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 20)).toBe(
      false,
    );
    rendered.setOnAir(true, 20);
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 20)).toBe(
      false,
    );
    rendered.host.style.visibility = '';
    rendered.host.style.opacity = '0';
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 20)).toBe(
      false,
    );
    rendered.host.style.opacity = '1';
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 20)).toBe(true);
    expect(work).toHaveLength(1);
    expect(work[0]!.frame).toBe(25);
    expect(changed).not.toHaveBeenCalled();
    work.shift()!.run();
    expect(changed).toHaveBeenLastCalledWith({ count: 1 }, 25);
    expect(
      rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true, repeat: true }, 26),
    ).toBe(true);
    expect(work).toHaveLength(0);
    rendered.setData({ allowed: false, count: 1 }, 27);
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 27)).toBe(true);
    expect(work).toHaveLength(0);
    rendered.setOnAir(false, 28);
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 28)).toBe(
      false,
    );
    rendered.dispose();
    expect(rendered.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 30)).toBe(
      false,
    );
  });
  it('excludes deterministic mounts, shared proxies and IME input', async () => {
    const scheduleRule = vi.fn();
    const offline = mount([keyboardLayer()], { deterministic: true, scheduleRule });
    offline.setOnAir(true, 0);
    expect(offline.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 1)).toBe(false);
    const proxy = mount([keyboardLayer()], { hiddenLayers: new Set(['text']), scheduleRule });
    proxy.setOnAir(true, 0);
    expect(proxy.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true }, 1)).toBe(false);
    const active = mount([keyboardLayer()], { scheduleRule });
    active.setOnAir(true, 0);
    active.host.style.visibility = '';
    expect(
      active.handleKeyboardInput!('key-down', { key: 'F8', shiftKey: true, isComposing: true }, 1),
    ).toBe(false);
    expect(scheduleRule).not.toHaveBeenCalled();
    offline.dispose();
    proxy.dispose();
    active.dispose();
  });
});

describe('coordinated mount pointer Rules', () => {
  function pointerLayer(...triggers: VisualRuleTrigger[]) {
    const host = layer();
    host.visualRules = triggers.map((trigger) => ({
      id: trigger,
      name: trigger,
      enabled: true,
      trigger,
      dataKey: 'unused',
      sourcePath: [],
      operator: 'equals',
      value: true,
      actions: [],
    }));
    return host;
  }
  function mountedStyle(rendered: ReturnType<typeof mount>) {
    const surface = rendered.host.shadowRoot!.children[0]!;
    return (surface.children[0] as HTMLElement).style;
  }

  it.each(['click', 'double-click', 'pointer-down', 'pointer-up'] as const)(
    'shows the hand cursor on a layer that answers %s',
    (trigger) => {
      const rendered = mount([pointerLayer(trigger)], { scheduleRule: vi.fn() });
      expect(mountedStyle(rendered).pointerEvents).toBe('auto');
      expect(mountedStyle(rendered).cursor).toBe('pointer');
      rendered.dispose();
    },
  );

  it.each(['hover', 'pointer-enter', 'pointer-leave'] as const)(
    'keeps the default cursor on a layer that only answers %s',
    (trigger) => {
      const rendered = mount([pointerLayer(trigger)], { scheduleRule: vi.fn() });
      expect(mountedStyle(rendered).pointerEvents).toBe('auto');
      expect(mountedStyle(rendered).cursor).toBeUndefined();
      rendered.dispose();
    },
  );

  it('shows the hand cursor when a press trigger sits beside a hover trigger', () => {
    const rendered = mount([pointerLayer('hover', 'click')], { scheduleRule: vi.fn() });
    expect(mountedStyle(rendered).cursor).toBe('pointer');
    rendered.dispose();
  });

  it('leaves layers non-interactive on deterministic mounts and without a rule scheduler', () => {
    for (const rendered of [
      mount([pointerLayer('click')], { deterministic: true, scheduleRule: vi.fn() }),
      mount([pointerLayer('click')]),
    ]) {
      expect(mountedStyle(rendered).pointerEvents).toBeUndefined();
      expect(mountedStyle(rendered).cursor).toBeUndefined();
      rendered.dispose();
    }
  });
});

describe('coordinated composition rendering', () => {
  const liveChart = () => {
    const source = layer(
      createChartElement({
        animation: {
          type: 'grow',
          durationFrames: 20,
          delayFrames: 0,
          staggerFrames: 0,
          easing: 'linear',
          replayOnUpdate: true,
          updateMode: 'morph',
        },
      }),
    );
    source.id = 'chart';
    source.bindings = [{ dataKey: 'chartData', targetProperty: 'data' }];
    return source;
  };
  const quoteData = (value: number) =>
    JSON.stringify({
      labels: ['A'],
      datasets: [
        { label: 'Quote', data: [value], backgroundColor: '#44e6ad', borderColor: '#102637' },
      ],
    });
  const hiddenChart = () => {
    const source = liveChart();
    source.isVisible = false;
    source.visualRules = [
      {
        id: 'show-chart-view',
        name: 'Show chart view',
        enabled: true,
        trigger: 'data',
        dataKey: 'uiView',
        sourcePath: [],
        operator: 'equals',
        value: 'chart',
        actions: [{ type: 'visibility', visible: true }],
      },
    ];
    return source;
  };

  it('prepares hidden chart resources at authored size, defers quote redraws and flushes only latest data before reveal', async () => {
    const source = hiddenChart();
    const rendered = mount([source], { data: { chartData: quoteData(10), uiView: 'other' } });
    await rendered.ready;
    expect(mock.render).toHaveBeenCalledTimes(1);
    const host = mock.render.mock.calls[0]![0];
    expect(host.style).toMatchObject({ width: '400px', height: '80px' });
    expect(mock.ready).toHaveBeenCalledTimes(1);
    mock.render.mockClear();
    mock.chart.mockClear();
    mock.chartHistory.mockClear();
    mock.state.mockClear();
    rendered.setData({ chartData: quoteData(20), uiView: 'other' }, 50);
    rendered.setData({ chartData: quoteData(30), uiView: 'other' }, 100);
    rendered.render(125, [], true);
    expect(mock.render).not.toHaveBeenCalled();
    expect(mock.chart).not.toHaveBeenCalled();
    expect(mock.chartHistory).not.toHaveBeenCalled();
    expect(mock.state).not.toHaveBeenCalled();
    rendered.setData({ chartData: quoteData(30), uiView: 'chart' }, 130);
    expect(mock.render).toHaveBeenCalledExactlyOnceWith(
      host,
      expect.objectContaining({
        data: expect.objectContaining({ datasets: [expect.objectContaining({ data: [30] })] }),
      }),
      0,
    );
    rendered.render(130, [], true);
    await rendered.waitReady();
    expect(host.style.display).toBe('');
    expect(mock.chartHistory).toHaveBeenCalledTimes(1);
    const history = (
      mock.chartHistory.mock.calls[0] as unknown as [unknown, Array<{ frame: number }>]
    )[1];
    expect(history.map((entry) => entry.frame)).toEqual([50, 100]);
    expect(mock.ready).toHaveBeenCalledTimes(2);
    rendered.dispose();
  });

  it('prepares hidden paint/configuration changes immediately instead of deferring their resources', async () => {
    const source = hiddenChart();
    source.bindings.push({ dataKey: 'fill', targetProperty: 'fill' });
    const rendered = mount([source], {
      data: { chartData: quoteData(10), uiView: 'other', fill: '#000000' },
    });
    await rendered.ready;
    mock.render.mockClear();
    rendered.setData({ chartData: quoteData(20), uiView: 'other', fill: '#ffffff' }, 50);
    expect(mock.render).toHaveBeenCalledTimes(1);
    expect(mock.render.mock.lastCall?.[1]).toMatchObject({
      fill: '#ffffff',
      data: { datasets: [{ data: [20] }] },
    });
    await rendered.waitReady();
    expect(mock.ready).toHaveBeenCalledTimes(2);
    rendered.dispose();
  });

  it('reveals deferred chart data with the latest paint while retaining its data-event clock', async () => {
    const source = hiddenChart();
    source.bindings.push({ dataKey: 'fill', targetProperty: 'fill' });
    const rendered = mount([source], {
      data: { chartData: quoteData(10), uiView: 'other', fill: '#000000' },
    });
    await rendered.ready;
    rendered.setData({ chartData: quoteData(20), uiView: 'other', fill: '#000000' }, 50);
    rendered.setData({ chartData: quoteData(20), uiView: 'other', fill: '#ffffff' }, 55);
    expect(mock.render.mock.lastCall?.[1]).toMatchObject({ fill: '#ffffff' });
    rendered.setData({ chartData: quoteData(20), uiView: 'chart', fill: '#ffffff' }, 60);
    rendered.render(60, [], true);
    const [, history, frame] = mock.chartHistory.mock.lastCall as unknown as [
      unknown,
      Array<{ frame: number; element: Element }>,
      number,
    ];
    expect(frame).toBe(60);
    expect(history.at(-1)).toMatchObject({
      frame: 50,
      element: { fill: '#ffffff', data: { datasets: [{ data: [20] }] } },
    });
    rendered.dispose();
  });

  it('starts a new preset reconstruction boundary without restarting the latest data-event clock', async () => {
    const source = hiddenChart();
    source.bindings.push({ dataKey: 'preset', targetProperty: 'preset' });
    const rendered = mount([source], {
      data: { chartData: quoteData(10), uiView: 'other', preset: 'bar' },
    });
    await rendered.ready;
    rendered.setData({ chartData: quoteData(20), uiView: 'other', preset: 'bar' }, 50);
    rendered.setData({ chartData: quoteData(20), uiView: 'other', preset: 'horizontal-bar' }, 55);
    rendered.setData({ chartData: quoteData(20), uiView: 'chart', preset: 'horizontal-bar' }, 60);
    rendered.render(60, [], true);
    const [, history, frame] = mock.chartHistory.mock.lastCall as unknown as [
      unknown,
      Array<{ frame: number; element: Element; reset?: boolean }>,
      number,
    ];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      frame: 50,
      reset: true,
      element: { preset: 'horizontal-bar', data: { datasets: [{ data: [20] }] } },
    });
    expect(frame).toBe(60);
    rendered.dispose();
  });

  it('keeps private UI state bindings current without resolving them for unrelated quote updates', async () => {
    const ui = layer(createTextElement({ content: 'overview' }));
    ui.bindings = [{ dataKey: 'uiView', targetProperty: 'content' }];
    const rendered = mount([ui], { data: { uiView: 'overview', price: 10 } });
    await rendered.ready;
    mock.resolve.mockClear();
    mock.render.mockClear();
    rendered.setData({ uiView: 'overview', price: 20 }, 50);
    expect(mock.resolve).not.toHaveBeenCalled();
    expect(mock.render).not.toHaveBeenCalled();
    rendered.setData({ uiView: 'alerts', price: 20 }, 55);
    expect(mock.resolve).toHaveBeenCalledTimes(1);
    expect(mock.render.mock.lastCall?.[1]).toMatchObject({ content: 'alerts' });
    rendered.dispose();
  });

  it('invalidates collection row bindings even when a caller retains the same array object', async () => {
    const text = layer();
    text.bindings = [{ dataKey: 'items', sourcePath: ['label'], targetProperty: 'content' }];
    const compiled = descriptor([]);
    compiled.collections = [
      {
        id: 'rows',
        name: 'Rows',
        dataKey: 'items',
        prototypeLayers: [text],
        capacity: 2,
        overflow: 'truncate',
        offsetPerItem: { x: 0, y: 40 },
        itemKeyPath: ['id'],
        sortPath: ['rank'],
        sortDirection: 'ascending',
        pageSize: 0,
        page: 0,
      },
    ];
    const items = [
      { id: 'A', label: 'Alpha', rank: 1 },
      { id: 'B', label: 'Beta', rank: 2 },
    ];
    const rendered = mount([], { descriptor: compiled, data: { items } });
    await rendered.ready;
    mock.render.mockClear();
    items[0]!.rank = 3;
    items[1]!.label = 'Updated Beta';
    rendered.setData({ items }, 50);
    expect(
      mock.render.mock.calls.map(([host, element]) => [
        host.dataset.transitionLayerId,
        element.content,
      ]),
    ).toEqual([
      ['rows::0::text', 'Updated Beta'],
      ['rows::1::text', 'Alpha'],
    ]);
    rendered.dispose();
  });

  it.each([false, true])(
    'keeps %s deterministic chart history semantics over 100 feed updates',
    async (deterministic) => {
      const rendered = mount([liveChart()], { data: { chartData: quoteData(0) }, deterministic });
      await rendered.ready;
      for (let index = 1; index <= 100; index++) {
        rendered.setData({ chartData: quoteData(index) }, index * 750);
        rendered.render(index * 750 + 25, [], !deterministic);
      }
      const history = (
        mock.chartHistory.mock.lastCall as unknown as [unknown, Array<{ frame: number }>]
      )[1];
      expect(history).toHaveLength(deterministic ? 101 : 2);
      expect(history.at(-1)?.frame).toBe(75000);
      if (deterministic) expect(history[0]!.frame).toBe(0);
      else expect(history[0]!.frame).toBe(74250);
      rendered.dispose();
    },
  );

  it('keeps alarms on a hidden clock active while visual-only hidden layers are culled', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 2000,
          autoStart: true,
          endBehavior: 'stop',
        }),
      }),
    );
    timer.id = 'hidden-timer';
    timer.isVisible = false;
    timer.visualRules = [
      {
        id: 'one-second',
        name: 'One second left',
        enabled: true,
        trigger: 'timer-alarm',
        timerAlarm: { sourceLayerId: timer.id, thresholdMs: 1000, direction: 'down' },
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [
          { type: 'set-data', fieldId: 'warning', dataKey: 'warning', mode: 'set', value: true },
        ],
      },
    ];
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rendered = mount([timer], {
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    rendered.setOnAir(true, 0);
    rendered.render(51, [], true);
    expect(work).toHaveLength(1);
    work[0]!.run();
    expect(changed).toHaveBeenCalledWith({ warning: true }, 50);
    rendered.dispose();
  });

  it('schedules two timer alarms once per run and retains latches across data snapshots', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 10000,
          autoStart: true,
          endBehavior: 'stop',
        }),
      }),
    );
    timer.id = 'timer';
    timer.visualRules = [5000, 0].map((threshold) => ({
      id: `alarm-${threshold}`,
      name: `Alarm ${threshold}`,
      enabled: true,
      trigger: 'timer-alarm',
      timerAlarm: { sourceLayerId: timer.id, thresholdMs: threshold, direction: 'down' },
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
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rendered = mount([timer], {
      deterministic: true,
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    rendered.setOnAir(true, 50);
    rendered.render(50, [], false);
    expect(rendered.nextAlarmFrame!(50)).toBe(300);
    rendered.render(300, [], false);
    expect(work).toHaveLength(1);
    expect(work.shift()!.frame).toBe(300);
    rendered.render(300, [], false);
    expect(work).toHaveLength(0);
    rendered.render(550, [], false);
    expect(work).toHaveLength(1);
    expect(work[0]!.frame).toBe(550);
    work.shift()!.run();
    expect(changed).toHaveBeenLastCalledWith({ status: 'TIME UP' }, 550);
    const next = mount([timer], {
      startFrame: 600,
      deterministic: true,
      scheduleRule: (entry) => work.push(entry),
    });
    next.inheritRules(rendered, {});
    next.setOnAir(true, 600);
    next.render(650, [], false);
    expect(work).toHaveLength(0);
    next.customAction!(clockTimerActionId(timer.id, 'restart'), 650);
    next.render(900, [], false);
    expect(work).toHaveLength(1);
    expect(work[0]!.frame).toBe(900);
    rendered.dispose();
    next.dispose();
  });

  it('replays externally fed alarm crossings in travel order and live expiry skips obsolete warnings', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          source: 'manual',
          manualValue: 6000,
        }),
      }),
    );
    timer.bindings = [{ dataKey: 'remaining', targetProperty: 'clock.manualValue' }];
    timer.visualRules = [0, 5000].map((threshold) => ({
      id: `alarm-${threshold}`,
      name: `Alarm ${threshold}`,
      enabled: true,
      trigger: 'timer-alarm',
      timerAlarm: { sourceLayerId: timer.id, thresholdMs: threshold, direction: 'down' },
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
    for (const deterministic of [false, true]) {
      const work: TransitionLogicRuleWork[] = [];
      const changed = vi.fn();
      const rendered = mount([timer], {
        deterministic,
        data: { remaining: 6000 },
        scheduleRule: (entry) => work.push(entry),
        ruleDataChanged: changed,
      });
      await rendered.ready;
      rendered.setOnAir(true, 0);
      rendered.render(0, [], true);
      rendered.setData({ remaining: 0 }, 50);
      rendered.render(50, [], true);
      expect(work.map((entry) => entry.id)).toEqual(
        deterministic ? ['["text","alarm-5000"]', '["text","alarm-0"]'] : ['["text","alarm-0"]'],
      );
      for (const entry of work) entry.run();
      expect(changed).toHaveBeenLastCalledWith({ status: 'TIME UP' }, 50);
      rendered.customAction!(clockTimerActionId(timer.id, 'reset'), 60);
      rendered.setData({ remaining: 10000 }, 70);
      rendered.setData({ remaining: 4000 }, 80);
      rendered.render(80, [], true);
      expect(work.at(-1)!.id).toBe('["text","alarm-5000"]');
      rendered.dispose();
    }
  });

  it('replaces authored entrance geometry with the hold pose without remounting content or losing update effects', async () => {
    const text = layer(
      createTextElement({
        content: 'Before',
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'typewriter',
          durationFrames: 60,
          replayOnUpdate: true,
        },
      }),
    );
    const key = (frame: number, value: number) => ({
      id: String(frame),
      frame,
      value,
      easing: 'linear' as const,
    });
    text.animationTracks.width = [key(0, 0), key(25, 400), key(50, 0)];
    text.bindings = [{ dataKey: 'value', targetProperty: 'content' }];
    const rendered = mount([text], { startFrame: 100, data: { value: 'Before' } });
    await rendered.ready;
    rendered.setOnAir(true, 100);
    const lifecycle = {
      phase: 'in' as const,
      startFrame: 100,
      durationFrames: 50,
      contentAtHold: true,
    };
    rendered.render(110, [], false, lifecycle);
    expect(mock.state.mock.lastCall?.[1].transform.width).toBe(400);
    expect(mock.animated.mock.lastCall?.[2]).toBe(200);
    expect(mock.text.mock.lastCall?.[2]).toBe(60);
    const contentRenders = mock.render.mock.calls.length;
    rendered.render(120, [], false, lifecycle);
    expect(mock.render.mock.calls.length).toBe(contentRenders);
    expect(mock.animated.mock.lastCall?.[2]).toBe(400);
    rendered.setData({ value: 'After' }, 120);
    rendered.render(125, [], false, lifecycle);
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    rendered.dispose();
  });

  it('replays inherited chart morph history from the previous snapshot and keeps the update clock', () => {
    const chartData = (values: number[]) =>
      JSON.stringify({
        mode: 'percentages',
        rows: values.map((value, index) => ({
          id: String(index),
          label: `Category ${index}`,
          value,
        })),
      });
    const source = layer(
      createChartElement({
        preset: 'horizontal-bar',
        data: parseChartData(chartData([48, 32, 20])),
        animation: {
          type: 'grow',
          durationFrames: 20,
          delayFrames: 0,
          staggerFrames: 0,
          easing: 'linear',
          replayOnUpdate: true,
          updateMode: 'morph',
        },
      }),
    );
    source.id = 'chart';
    source.bindings = [{ dataKey: 'chartData', targetProperty: 'data' }];
    const initial = { chartData: chartData([48, 32, 20]) };
    const updated = { chartData: chartData([40, 40, 20]) };
    const previous = mount([source], { data: initial, deterministic: true });
    previous.setOnAir(true, 0);
    previous.render(60, [], false);
    const next = mount([source], {
      data: updated,
      previousData: initial,
      startFrame: 60,
      deterministic: true,
    });
    next.inheritRules(previous, initial);
    next.startFrame = 65;
    next.render(70, [], false);
    const historyCall = mock.chartHistory.mock.calls.at(-1) as unknown as [
      unknown,
      Array<{ frame: number; element: typeof source.element }>,
      number,
    ];
    expect(historyCall[1].map((entry) => entry.frame)).toEqual([0, 65]);
    expect(historyCall[2]).toBe(70);
    next.setData({ chartData: chartData([30, 50, 20]) }, 75);
    next.render(80, [], false);
    const interrupted = mock.chartHistory.mock.calls.at(-1) as unknown as typeof historyCall;
    expect(interrupted[1].map((entry) => entry.frame)).toEqual([0, 65, 75]);
    expect(interrupted[2]).toBe(80);
    previous.dispose();
    next.dispose();
  });

  it('rejects invalid chart data atomically and settles skipped chart updates', () => {
    const data = parseChartData({
      mode: 'percentages',
      rows: [{ id: 'one', label: 'One', value: 100 }],
    });
    const source = layer(createChartElement({ preset: 'horizontal-bar', data }));
    source.bindings = [{ dataKey: 'chartData', targetProperty: 'data' }];
    const initial = { chartData: JSON.stringify(data) };
    const rendered = mount([source], { data: initial });
    expect(() =>
      rendered.setData(
        {
          chartData: JSON.stringify({
            mode: 'percentages',
            rows: [{ id: 'one', label: 'One', value: 90 }],
          }),
        },
        30,
      ),
    ).toThrow('missing 10%');
    rendered.render(35, [], false);
    expect(mock.animated.mock.calls.at(-1)?.[1]).toMatchObject({ data });
    rendered.setData(
      {
        chartData: JSON.stringify(
          parseChartData({ mode: 'percentages', rows: [{ id: 'two', label: 'Two', value: 100 }] }),
        ),
      },
      40,
      true,
    );
    rendered.render(40, [], false);
    expect(mock.chart.mock.calls.at(-1)?.[2]).toBe(25);
    rendered.dispose();
  });
  it('runs delayed custom-action data rules and samples their animated geometry on the coordinator clock', async () => {
    const target = layer();
    target.visualRules = [
      {
        id: 'resize',
        name: 'Resize',
        enabled: true,
        trigger: 'data',
        dataKey: 'advertising',
        sourcePath: [],
        operator: 'equals',
        value: true,
        actions: [
          { type: 'property', targetProperty: 'layer.width', value: 200, transitionFrames: 10 },
        ],
      },
    ];
    const controller = layer();
    controller.id = 'controller';
    controller.visualRules = [
      {
        id: 'show-ad',
        name: 'Show ad',
        enabled: true,
        trigger: 'custom-action',
        eventId: 'show_ad',
        dataKey: 'busy',
        sourcePath: [],
        operator: 'equals',
        value: false,
        delayFrames: 20,
        actions: [
          {
            type: 'set-data',
            fieldId: 'advertising',
            dataKey: 'advertising',
            mode: 'set',
            value: true,
          },
        ],
      },
    ];
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rendered = mount([target, controller], {
      deterministic: true,
      data: { busy: false, advertising: false },
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    rendered.setOnAir(true, 10);
    rendered.customAction!('show_ad', 10);
    expect(work).toHaveLength(1);
    expect(work[0]!.frame).toBe(30);
    expect(changed).not.toHaveBeenCalled();
    expect(work.shift()!.run()).toEqual([]);
    expect(changed).toHaveBeenCalledWith({ advertising: true }, 30);
    rendered.render(35, [], true);
    expect(
      mock.state.mock.calls.filter(([host]) => host.dataset.transitionLayerId === 'text').at(-1)![1]
        .transform.width,
    ).toBe(300);
    rendered.render(40, [], true);
    expect(
      mock.state.mock.calls.filter(([host]) => host.dataset.transitionLayerId === 'text').at(-1)![1]
        .transform.width,
    ).toBe(200);
    rendered.dispose();
  });

  it('routes rule custom actions through the same delayed frame queue and drops released work', async () => {
    const controller = layer();
    controller.visualRules = [
      {
        id: 'play',
        name: 'Play',
        enabled: true,
        trigger: 'play',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        value: '',
        actions: [{ type: 'custom-action', actionId: 'ready' }],
      },
      {
        id: 'ready',
        name: 'Ready',
        enabled: true,
        trigger: 'custom-action',
        eventId: 'ready',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        value: '',
        delayFrames: 5,
        actions: [
          { type: 'set-data', fieldId: 'count', dataKey: 'count', mode: 'increase', value: 2 },
        ],
      },
    ];
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rendered = mount([controller], {
      deterministic: true,
      data: { count: 1 },
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    rendered.setOnAir(true, 20);
    rendered.fireLifecycle('play', 20);
    expect(work.shift()!.run()).toEqual([]);
    expect(work[0]!.frame).toBe(25);
    expect(work.shift()!.run()).toEqual([]);
    expect(changed).toHaveBeenLastCalledWith({ count: 3 }, 25);
    rendered.customAction!('ready', 30);
    rendered.dispose();
    expect(work.shift()!.run()).toEqual([]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('keeps custom-action Text FX settled until triggered and replays it from that command frame', async () => {
    const text = layer(
      createTextElement({
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          customActionId: 'show_ad',
          replayOnUpdate: false,
        },
      }),
    );
    const rendered = mount([text], { deterministic: true });
    await rendered.ready;
    rendered.setOnAir(true, 10);
    rendered.render(15, [], true);
    expect(mock.text.mock.lastCall?.[2]).toBe(20);
    rendered.customAction!('show_ad', 20);
    rendered.render(25, [], true);
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    rendered.customAction!('show_ad', 26, true);
    rendered.render(26, [], true);
    expect(mock.text.mock.lastCall?.[2]).toBe(20);
    rendered.dispose();
  });

  it('replays explicit custom-action Text FX after a payload update even when update replay is disabled', async () => {
    const text = layer(
      createTextElement({
        content: '9',
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          customActionId: 'show_ad',
          replayOnUpdate: false,
        },
      }),
    );
    text.bindings = [{ dataKey: 'value', targetProperty: 'content' }];
    const rendered = mount([text], { deterministic: true, data: { value: '9' } });
    await rendered.ready;
    rendered.setOnAir(true, 0);
    rendered.setData({ value: '10' }, 20);
    rendered.render(25, [], true);
    expect(mock.text.mock.lastCall?.[2]).toBe(20);
    rendered.customAction!('show_ad', 20);
    rendered.render(25, [], true);
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    expect(mock.previous.mock.lastCall?.[1].content).toBe('9');
    rendered.dispose();
  });

  it('keeps constructor and resource-preparation poses hidden before insertion', async () => {
    const parent = new mock.Host();
    const append = vi.spyOn(parent, 'append');
    append.mockImplementation((...children) => {
      expect(children[0]!.style.visibility).toBe('hidden');
    });
    const rendered = mount([layer()], { parent: parent as unknown as HTMLElement });
    await rendered.ready;
    expect(append).toHaveBeenCalledOnce();
    expect(rendered.host.style.visibility).toBe('hidden');
    rendered.dispose();
  });

  it('skips duplicate DOM, content and clocks when all local layers are retained shared proxies', async () => {
    const rendered = mount([layer()], { hiddenLayers: new Set(['text']) });
    await rendered.ready;
    rendered.render(10, [], false);
    expect(mock.render).not.toHaveBeenCalled();
    expect(mock.state).not.toHaveBeenCalled();
    expect(mock.animated).not.toHaveBeenCalled();
    expect(rendered.getLoopGroups?.()).toEqual([]);
    rendered.dispose();
  });

  it('reuses readiness checks until content changes instead of scanning every on-air node per Take', async () => {
    const text = layer();
    text.bindings = [{ dataKey: 'headline', targetProperty: 'content' }];
    const rendered = mount([text], { data: { headline: 'First' } });
    await rendered.ready;
    await rendered.waitReady();
    rendered.render(10, [], false);
    await rendered.waitReady();
    expect(mock.ready).toHaveBeenCalledTimes(1);
    rendered.setData({ headline: 'Second' }, 11);
    await rendered.waitReady();
    expect(mock.ready).toHaveBeenCalledTimes(2);
    rendered.dispose();
  });

  it('retains per-frame readiness for animated image-sequence and media resources', async () => {
    const rendered = mount([layer(createImageSequenceElement())]);
    await rendered.ready;
    await rendered.waitReady();
    expect(mock.ready).toHaveBeenCalledTimes(2);
    rendered.dispose();
  });

  it('preserves authored entry/exit travel and mask sizes relative to shared layout pins', async () => {
    const mask = { ...layer(createRectangleLayer().element), id: 'mask', isMaskOnly: true };
    mask.animationTracks.width = [
      { id: 'off', frame: 0, value: 0, easing: 'linear' },
      { id: 'on', frame: 25, value: 400, easing: 'linear' },
      { id: 'end', frame: 50, value: 0, easing: 'linear' },
    ];
    mask.animationTracks.x = [
      { id: 'off', frame: 0, value: -95, easing: 'linear' },
      { id: 'on', frame: 25, value: 5, easing: 'linear' },
      { id: 'end', frame: 50, value: -95, easing: 'linear' },
    ];
    const text = layer();
    text.mask = { sourceLayerId: 'mask', mode: 'alpha', inverted: false };
    const rendered = mount([text, mask], {
      startFrame: 100,
      hiddenLayers: new Set(['mask']),
      sharedKeys: new Map([['mask', sharedLayerKey('panel', 'source')]]),
    });
    await rendered.ready;
    const shared = [
      { instanceId: 'panel', sourceLayerId: 'source', property: 'width' as const, value: 800 },
      { instanceId: 'panel', sourceLayerId: 'source', property: 'x' as const, value: 200 },
    ];
    const check = (frame: number, phase: 'in' | 'out', width: number, x: number) => {
      rendered.render(frame, shared, false, { phase, startFrame: 100, durationFrames: 50 });
      const states = mock.masks.mock.lastCall?.[2] as Map<
        string,
        { transform: { width: number; x: number } }
      >;
      expect(states.get('mask')!.transform).toMatchObject({ width, x });
      expect(mock.paths.mock.lastCall?.[1]).toBe(states);
      expect(
        mock.state.mock.calls
          .filter(([host]) => host.dataset.transitionLayerId === 'mask')
          .at(-1)?.[0].style.visibility,
      ).toBe('hidden');
    };
    check(125, 'in', 400, 150);
    check(125, 'out', 400, 150);
    rendered.render(125, shared, false);
    expect(mock.masks.mock.lastCall?.[2].get('mask').transform).toMatchObject({
      width: 800,
      x: 200,
    });
    rendered.dispose();
  });

  it('scales initial text FX with the incoming timeline and keeps data updates on their own clock', async () => {
    const text = layer(
      createTextElement({
        content: 'First',
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          replayOnUpdate: true,
        },
      }),
    );
    text.bindings = [{ dataKey: 'value', targetProperty: 'content' }];
    const rendered = mount([text], { startFrame: 100, data: { value: 'First' } });
    await rendered.ready;
    rendered.render(125, [], false, { phase: 'in', startFrame: 100, durationFrames: 50 });
    expect(mock.text.mock.lastCall?.[2]).toBe(12.5);
    rendered.setData({ value: 'Second' }, 126);
    rendered.render(131, [], false, { phase: 'in', startFrame: 100, durationFrames: 50 });
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    expect(mock.previous.mock.lastCall?.[1].content).toBe('First');
    rendered.dispose();
  });

  it('updates OTS geometry with data and keeps explicit shared pins above local rules', async () => {
    const panel = layer(createRectangleLayer().element);
    panel.visualRules = [261, 396, 531].map((height, index) => ({
      id: `count-${index}`,
      name: 'Story count',
      enabled: true,
      trigger: 'data',
      dataKey: 'storyCount',
      sourcePath: [],
      operator: 'equals',
      value: index + 1,
      actions: [{ type: 'property', targetProperty: 'height', value: height }],
    }));
    const rendered = mount([panel], {
      data: { storyCount: 3 },
      sharedKeys: new Map([['text', sharedLayerKey('panel', 'source')]]),
    });
    await rendered.ready;
    for (const [frame, storyCount, height] of [
      [0, 3, 531],
      [1, 1, 261],
      [2, 2, 396],
      [3, 3, 531],
    ]) {
      rendered.setData({ storyCount }, frame!);
      rendered.render(frame!, [], false);
      expect(mock.state.mock.lastCall?.[1].transform.height).toBe(height);
      expect(mock.render.mock.lastCall?.[1]).not.toHaveProperty('height');
    }
    rendered.render(
      4,
      [{ instanceId: 'panel', sourceLayerId: 'source', property: 'height', value: 400 }],
      false,
    );
    expect(mock.state.mock.lastCall?.[1].transform.height).toBe(400);
    rendered.dispose();
  });

  it('draws and retracts a Rules-sized OTS bracket relative to its one-story on-air height', async () => {
    const bracket = layer(createRectangleLayer().element);
    bracket.animationTracks.height = [
      { id: 'off', frame: 0, value: 1, easing: 'linear' },
      { id: 'on', frame: 25, value: 389, easing: 'linear' },
      { id: 'end', frame: 50, value: 1, easing: 'linear' },
    ];
    bracket.visualRules = [
      {
        id: 'single',
        name: 'One story',
        enabled: true,
        trigger: 'data',
        dataKey: 'stories',
        sourcePath: [],
        operator: 'equals',
        value: 1,
        actions: [{ type: 'property', targetProperty: 'height', value: 119 }],
      },
    ];
    const rendered = mount([bracket], { startFrame: 100, data: { stories: 1 } });
    await rendered.ready;
    for (const phase of ['in', 'out'] as const) {
      rendered.render(125, [], false, { phase, startFrame: 100, durationFrames: 50 });
      expect(mock.state.mock.lastCall?.[1].transform.height).toBeCloseTo(119 * (195 / 389));
    }
    rendered.render(150, [], false);
    expect(mock.state.mock.lastCall?.[1].transform.height).toBe(119);
    rendered.dispose();
  });

  it('animates geometry from the held authored pose instead of the off pose', async () => {
    const panel = layer(createRectangleLayer().element);
    panel.animationTracks.height = [
      { id: 'off', frame: 0, value: 1, easing: 'linear' },
      { id: 'on', frame: 25, value: 531, easing: 'linear' },
    ];
    panel.visualRules = [
      {
        id: 'small',
        name: 'Small',
        enabled: true,
        dataKey: 'small',
        sourcePath: [],
        operator: 'equals',
        value: true,
        actions: [{ type: 'property', targetProperty: 'height', value: 261, transitionFrames: 10 }],
      },
    ];
    const rendered = mount([panel], { data: { small: false } });
    await rendered.ready;
    rendered.setData({ small: true }, 10);
    rendered.render(15, [], false);
    expect(mock.state.mock.lastCall?.[1].transform.height).toBe(396);
    rendered.render(20, [], false);
    expect(mock.state.mock.lastCall?.[1].transform.height).toBe(261);
    rendered.dispose();
  });
  it('holds the on-air pose while independent loops use elapsed coordinator frames', async () => {
    const animated = layer(createRectangleLayer().element);
    animated.animationTracks.y = [
      { id: 'off', frame: 0, value: 1000, easing: 'linear' },
      { id: 'on', frame: 25, value: 200, easing: 'linear' },
    ];
    animated.loop = createLayerLoopClip({
      durationFrames: 100,
      tracks: {
        x: [
          { id: 'a', frame: 0, value: 0, easing: 'linear' },
          { id: 'b', frame: 100, value: 100, easing: 'linear' },
        ],
      },
    });
    const rendered = mount([animated], { startFrame: 40 });
    await rendered.ready;
    rendered.render(65, [], false);
    expect(mock.state.mock.lastCall?.[1].transform).toMatchObject({ x: 25, y: 200 });
    expect(mock.animated.mock.lastCall?.[2]).toBe(500);
    rendered.dispose();
  });

  it.each([false, true])(
    'applies cross-layer rule properties, effects and visibility after data bindings (deterministic=%s)',
    async (deterministic) => {
      const target = layer();
      target.bindings = [{ dataKey: 'headline', targetProperty: 'content' }];
      const controller = {
        ...layer(),
        id: 'controller',
        visualRules: [
          {
            id: 'breaking',
            name: 'Breaking',
            enabled: true,
            dataKey: 'breaking',
            sourcePath: [],
            operator: 'equals' as const,
            value: true,
            actions: [
              {
                type: 'property' as const,
                targetLayerId: 'text',
                targetProperty: 'content',
                value: 'BREAKING',
              },
              {
                type: 'property' as const,
                targetLayerId: 'text',
                targetProperty: 'dropShadowColor',
                value: '#ff0000',
              },
              { type: 'visibility' as const, targetLayerId: 'text', visible: false },
            ],
          },
        ],
      };
      const rendered = mount([target, controller], {
        data: { headline: 'Bound', breaking: true },
        deterministic,
      });
      await rendered.ready;
      const content = mock.render.mock.calls.filter(
        ([host]) => host.dataset.transitionLayerId === 'text',
      );
      expect(content.at(-1)?.[1].content).toBe('BREAKING');
      const targetHost = content.at(-1)![0];
      const targetState = mock.state.mock.calls
        .filter(([host]) => host.dataset.transitionLayerId === 'text')
        .at(-1);
      expect(targetHost.style.display).toBe('none');
      if (deterministic) expect(targetState![1].effects.dropShadowColor).toBe('#ff0000');
      else expect(targetState).toBeUndefined();
      rendered.setData({ headline: 'Updated', breaking: false }, 10);
      rendered.render(10, [], false);
      expect(
        mock.render.mock.calls
          .filter(([host]) => host.dataset.transitionLayerId === 'text')
          .at(-1)?.[1].content,
      ).toBe('Updated');
      expect(targetHost.style.display).toBe('');
      expect(
        mock.state.mock.calls.filter(([host]) => host === targetHost).at(-1)![1].effects
          .dropShadowColor,
      ).toBe(target.effects.dropShadowColor);
      rendered.dispose();
    },
  );

  it('keeps required mask proxies hidden and applies their coordinator geometry', async () => {
    const visible = {
      ...layer(),
      id: 'visible',
      mask: { sourceLayerId: 'text', mode: 'alpha' as const, inverted: false },
    };
    const rendered = mount([visible, layer()], {
      sharedKeys: new Map([['text', sharedLayerKey('panel', 'source')]]),
      hiddenLayers: new Set(['text']),
    });
    await rendered.ready;
    rendered.render(
      10,
      [{ instanceId: 'panel', sourceLayerId: 'source', property: 'width', value: 800 }],
      false,
    );
    expect(mock.state.mock.lastCall?.[1].transform.width).toBe(800);
    expect(mock.state.mock.lastCall?.[0].style.visibility).toBe('hidden');
    rendered.dispose();
  });

  it('starts a count-up timer at its actual take boundary and freezes it on out', async () => {
    const clock = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-up',
          format: 'ss',
          initialValueMs: 0,
          autoStart: true,
        }),
      }),
    );
    const rendered = mount([clock], { startFrame: 0 });
    await rendered.ready;
    rendered.startFrame = 50;
    rendered.setOnAir(true, 50);
    rendered.render(100, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('01');
    rendered.setOnAir(false, 100);
    rendered.render(200, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('01');
    rendered.dispose();
  });

  it('reanchors the system clock to the actual template start without wall-clock seeking', async () => {
    const clock = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'clock',
          format: 'hh:mm:ss',
          timeZone: 'UTC',
          referenceTimeMs: 0,
        }),
      }),
    );
    const rendered = mount([clock], { startFrame: 0, clockEpoch: Date.UTC(2026, 0, 1, 12, 0, 0) });
    await rendered.ready;
    rendered.startFrame = 50;
    rendered.setOnAir(true, 50);
    rendered.render(100, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('12:00:02');
    rendered.dispose();
  });

  it('refreshes only system-clock content when a live coordinator epoch changes after warmup', async () => {
    let epoch = Date.UTC(2026, 0, 1, 12, 0, 0);
    const getClockEpoch = vi.fn(() => epoch);
    const clock = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'clock',
          format: 'hh:mm:ss.SSS',
          timeZone: 'UTC',
        }),
      }),
    );
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 10000,
          format: 'ss.SSS',
          autoStart: true,
        }),
      }),
    );
    clock.id = 'clock';
    timer.id = 'timer';
    const rendered = mount([clock, timer], { getClockEpoch });
    await rendered.ready;
    const renderCount = mock.render.mock.calls.length;
    epoch += 300;
    rendered.render(0, [], false);
    expect(
      mock.text.mock.calls
        .filter((call) => call[0].dataset.transitionLayerId === 'clock')
        .at(-1)?.[1].content,
    ).toBe('12:00:00.300');
    expect(
      mock.render.mock.calls
        .slice(renderCount)
        .filter((call) => call[0].dataset.transitionLayerId === 'timer'),
    ).toHaveLength(0);
    rendered.startFrame = 50;
    rendered.setOnAir(true, 50);
    rendered.render(100, [], false);
    expect(
      mock.text.mock.calls
        .filter((call) => call[0].dataset.transitionLayerId === 'timer')
        .at(-1)?.[1].content,
    ).toBe('09.000');
    rendered.dispose();
    const manual = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'clock',
          source: 'manual',
          manualValue: '12:34:56',
          format: 'hh:mm:ss',
          timeZone: 'UTC',
        }),
      }),
    );
    getClockEpoch.mockClear();
    const withoutSystemClock = mount([manual, timer], { getClockEpoch });
    await withoutSystemClock.ready;
    withoutSystemClock.render(50, [], false);
    expect(getClockEpoch).not.toHaveBeenCalled();
    withoutSystemClock.dispose();
  });

  it('anchors a delayed realtime startup to actual wall time and starts countdowns only on Take', async () => {
    const epoch = Date.UTC(2026, 0, 1, 12, 0, 0),
      now = vi.spyOn(Date, 'now').mockReturnValue(epoch);
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.stubGlobal('HTMLElement', mock.Host);
    const { CoordinatedGraphicElement } = await import('./CoordinatedGraphicElement');
    const { tickFramePlayers } = await import('./framePlayer');
    const clock = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'clock',
          format: 'hh:mm:ss.SSS',
          timeZone: 'UTC',
        }),
      }),
    );
    clock.id = 'wall-clock';
    const countdown = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          format: 'ss.SSS',
          initialValueMs: 10000,
          autoStart: true,
        }),
      }),
    );
    countdown.id = 'countdown';
    const definition = {
      version: 1 as const,
      id: 'clock-startup',
      name: 'Clock startup',
      defaultTransitionId: 'instant',
      slots: [{ id: 'main', name: 'Main', order: 0 }],
      states: [{ id: 'clock', name: 'Clock', slotId: 'main', templateId: 'clock' }],
      transitions: [
        {
          id: 'instant',
          name: 'Instant',
          durationFrames: 0,
          outgoingFrames: 0,
          incomingStartFrame: 0,
          incomingFrames: 0,
          sharedFrames: 0,
          easing: 'linear' as const,
        },
      ],
      routes: [],
      sharedInstances: [],
      initialSharedValues: [],
    };
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = {
        version: 1 as const,
        id: 'clock-startup',
        name: 'Clock startup',
        width: 1920,
        height: 1080,
        frameRate: 50,
        definition,
        templates: [
          {
            id: 'clock',
            name: 'Clock',
            descriptor: descriptor([clock, countdown]),
            sharedLayers: [],
            sharedDataBindings: [],
          },
        ],
        sharedInstances: [],
      };
    }
    const graphic = new Graphic();
    let ready = () => {};
    mock.ready.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const displayed = (id: string) =>
      mock.text.mock.calls.filter((call) => call[0].dataset.transitionLayerId === id).at(-1)?.[1]
        .content;
    try {
      const loading = graphic.load({ renderType: 'realtime', renderCharacteristics: {} });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(mock.ready).toHaveBeenCalled();
      now.mockReturnValue(epoch + 300);
      ready();
      expect(await loading).toEqual({ statusCode: 200 });
      expect(graphic.getPlayoutSnapshot().clockEpochMs).toBe(epoch + 300);
      expect(await graphic.playAction({ skipAnimation: true })).toEqual({
        statusCode: 200,
        currentStep: 0,
      });
      expect(displayed('wall-clock')).toBe('12:00:00.300');
      expect(displayed('countdown')).toBe('10.000');
      now.mockReturnValue(epoch + 1300);
      tickFramePlayers(1000);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(displayed('wall-clock')).toBe('12:00:01.300');
      expect(displayed('countdown')).toBe('09.000');
    } finally {
      await graphic.dispose();
      now.mockRestore();
      performanceNow.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps a fixed offline clock epoch through backward and repeated samples', async () => {
    const clock = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'clock',
          format: 'hh:mm:ss.SSS',
          timeZone: 'UTC',
        }),
      }),
    );
    const rendered = mount([clock], {
      deterministic: true,
      clockEpoch: Date.UTC(2026, 0, 1, 12, 0, 0),
    });
    await rendered.ready;
    const values = [];
    for (const frame of [100, 50, 100]) {
      rendered.render(frame, [], false);
      values.push(mock.text.mock.lastCall?.[1].content);
    }
    expect(values).toEqual(['12:00:02.000', '12:00:01.000', '12:00:02.000']);
    rendered.dispose();
  });

  it('replays start, pause, reset and restart from mount-local time with repeated and backward sampling', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-up',
          format: 'ss.SSS',
          autoStart: false,
        }),
      }),
    );
    timer.id = 'timer:main / 1';
    const rendered = mount([timer], { startFrame: 100, deterministic: true });
    await rendered.ready;
    rendered.setOnAir(true, 100);
    const sample = (frame: number) => {
      rendered.render(frame, [], false);
      return mock.text.mock.lastCall?.[1].content;
    };
    rendered.customAction!(clockTimerActionId(timer.id, 'start'), 125);
    expect(sample(175)).toBe('01.000');
    rendered.customAction!(clockTimerActionId(timer.id, 'pause'), 175);
    expect(sample(250)).toBe('01.000');
    rendered.customAction!(clockTimerActionId(timer.id, 'reset'), 250);
    expect(sample(275)).toBe('00.000');
    rendered.customAction!(clockTimerActionId(timer.id, 'restart'), 300);
    expect(sample(375)).toBe('01.500');
    expect(sample(150)).toBe('00.500');
    expect(sample(375)).toBe('01.500');
    rendered.setOnAir(false, 375);
    rendered.customAction!(clockTimerActionId(timer.id, 'restart'), 400);
    expect(sample(450)).toBe('01.500');
    rendered.dispose();
  });

  it('keeps a paused timer and its original event origin through same-template data snapshots', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({ mode: 'count-up', format: 'ss', autoStart: true }),
      }),
    );
    const previous = mount([timer], { startFrame: 50, data: { headline: 'Before' } });
    await previous.ready;
    previous.setOnAir(true, 50);
    previous.customAction!(clockTimerActionId(timer.id, 'pause'), 150);
    const next = mount([timer], { startFrame: 175, data: { headline: 'After' } });
    await next.ready;
    next.inheritRules(previous, { headline: 'Before' });
    next.startFrame = 200;
    next.setOnAir(true, 200);
    next.render(300, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('02');
    next.customAction!(clockTimerActionId(timer.id, 'start'), 300);
    next.render(350, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('03');
    previous.dispose();
    next.dispose();
  });

  it('settles skipped timer command updates while later ticks keep their rolling animation', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-up',
          format: 'ss',
          autoStart: true,
        }),
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          replayOnUpdate: true,
        },
      }),
    );
    const rendered = mount([timer], { deterministic: true });
    await rendered.ready;
    rendered.setOnAir(true, 0);
    rendered.render(105, [], false);
    rendered.customAction!(clockTimerActionId(timer.id, 'restart'), 105, true);
    rendered.render(105, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('00');
    expect(mock.text.mock.lastCall?.[2]).toBe(20);
    rendered.render(160, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('01');
    expect(mock.text.mock.lastCall?.[2]).toBeCloseTo(5, 1);
    rendered.dispose();
  });

  it('preserves timer bindings, rolling updates and command-triggered Rules and Text FX', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 10000,
          format: 'ss',
          autoStart: false,
        }),
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-down',
          durationFrames: 20,
          replayOnUpdate: true,
        },
      }),
    );
    timer.bindings = [{ dataKey: 'label', targetProperty: 'content' }];
    const startId = clockTimerActionId(timer.id, 'start');
    timer.visualRules = [
      {
        id: 'timer-started',
        name: 'Timer started',
        enabled: true,
        trigger: 'custom-action',
        eventId: startId,
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        value: '',
        actions: [
          { type: 'set-data', fieldId: 'started', dataKey: 'started', mode: 'set', value: true },
        ],
      },
    ];
    const title = layer(
      createTextElement({
        content: 'Ready',
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          customActionId: startId,
          replayOnUpdate: false,
        },
      }),
    );
    title.id = 'title';
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rendered = mount([timer, title], {
      deterministic: true,
      data: { label: 'Bound' },
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    rendered.setOnAir(true, 0);
    rendered.customAction!(startId, 50);
    expect(work.shift()!.run()).toEqual([]);
    expect(changed).toHaveBeenLastCalledWith({ started: true }, 50);
    rendered.render(105, [], false);
    const timerText = mock.text.mock.calls
      .filter(([host]) => host.dataset.transitionLayerId === timer.id)
      .at(-1)!;
    expect(timerText[1].content).toBe('09');
    expect(timerText[2]).toBeCloseTo(5, 1);
    expect(mock.text.mock.lastCall?.[1].content).toBe('Ready');
    expect(mock.text.mock.lastCall?.[2]).toBe(55);
    expect(timer.element.type === 'text' && timer.element.content).not.toBe('09');
    rendered.dispose();
  });

  it('targets collection timer prototypes together and expanded timer IDs individually', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-up',
          format: 'ss',
          autoStart: false,
        }),
      }),
    );
    const compiled = descriptor([]);
    compiled.collections = [
      {
        id: 'timers',
        name: 'Timers',
        dataKey: 'items',
        prototypeLayers: [timer],
        capacity: 2,
        overflow: 'truncate',
        offsetPerItem: { x: 0, y: 40 },
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
      },
    ];
    const rendered = mount([], {
      descriptor: compiled,
      data: { items: [{}, {}] },
      deterministic: true,
    });
    await rendered.ready;
    rendered.setOnAir(true, 0);
    rendered.customAction!(clockTimerActionId(timer.id, 'start'), 50);
    rendered.customAction!(clockTimerActionId('timers::0::text', 'pause'), 100);
    rendered.render(150, [], false);
    expect(
      mock.text.mock.calls
        .slice(-2)
        .map(([host, element]) => [host.dataset.transitionLayerId, element.content]),
    ).toEqual([
      ['timers::0::text', '01'],
      ['timers::1::text', '02'],
    ]);
    rendered.dispose();
  });

  it('broadcasts timer-ID Rules without executing a timer assigned to a different routed mount', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-up',
          format: 'ss',
          autoStart: false,
        }),
      }),
    );
    const actionId = clockTimerActionId(timer.id, 'start');
    timer.visualRules = [
      {
        id: 'started-elsewhere',
        name: 'Started elsewhere',
        enabled: true,
        trigger: 'custom-action',
        eventId: actionId,
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        value: '',
        actions: [
          { type: 'set-data', fieldId: 'received', dataKey: 'received', mode: 'set', value: true },
        ],
      },
    ];
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rendered = mount([timer], {
      deterministic: true,
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await rendered.ready;
    rendered.setOnAir(true, 0);
    rendered.customAction!(actionId, 50, false, false);
    expect(work.shift()!.run()).toEqual([]);
    expect(changed).toHaveBeenLastCalledWith({ received: true }, 50);
    rendered.render(150, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('00');
    rendered.dispose();
  });

  it('keeps bound manual timer history and rolling text on the original origin after an update', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-up',
          source: 'manual',
          format: 'ss',
          manualValue: 1000,
        }),
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          replayOnUpdate: true,
        },
      }),
    );
    timer.bindings = [{ dataKey: 'value', targetProperty: 'clock.manualValue' }];
    const before = mount([timer], { startFrame: 0, data: { value: 1000 } });
    await before.ready;
    before.setOnAir(true, 0);
    before.setData({ value: 2000 }, 50);
    const after = mount([timer], { startFrame: 100, data: { value: 3000 } });
    await after.ready;
    after.inheritRules(before, { value: 2000 });
    after.startFrame = 150;
    after.setOnAir(true, 150);
    after.render(155, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('03');
    expect(mock.previous.mock.lastCall?.[1].content).toBe('02');
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    after.render(55, [], false);
    expect(mock.text.mock.lastCall?.[1].content).toBe('02');
    expect(mock.previous.mock.lastCall?.[1].content).toBe('01');
    before.dispose();
    after.dispose();
  });

  it('preserves preceding text for rolling updates and settles skipAnimation', async () => {
    const text = layer(
      createTextElement({
        content: '9',
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          replayOnUpdate: true,
        },
      }),
    );
    text.bindings = [{ dataKey: 'value', targetProperty: 'content' }];
    const rendered = mount([text], {
      data: { value: '10' },
      previousData: { value: '9' },
      startFrame: 30,
    });
    await rendered.ready;
    rendered.render(35, [], false);
    expect(mock.previous.mock.lastCall?.[1].content).toBe('9');
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    rendered.settleText();
    rendered.render(35, [], false);
    expect(mock.text.mock.lastCall?.[2]).toBe(20);
    rendered.dispose();
  });

  it('keeps unused prepared instances dormant without firing data, lifecycle or alarm Rules', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 10000,
          autoStart: true,
          format: 'ss',
        }),
      }),
    );
    timer.id = 'timer';
    const action = {
      type: 'set-data' as const,
      fieldId: 'status',
      dataKey: 'status',
      mode: 'set' as const,
      value: 'FIRED',
    };
    timer.visualRules = [
      {
        id: 'matching-data',
        name: 'Matching data',
        enabled: true,
        trigger: 'data',
        dataKey: 'enabled',
        sourcePath: [],
        operator: 'equals',
        value: true,
        actions: [action],
      },
      {
        id: 'played',
        name: 'Played',
        enabled: true,
        trigger: 'play',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [action],
      },
      {
        id: 'expired',
        name: 'Expired',
        enabled: true,
        trigger: 'timer-alarm',
        timerAlarm: { sourceLayerId: timer.id, thresholdMs: 0, direction: 'down' },
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [action],
      },
    ];
    const scheduled = vi.fn();
    const changed = vi.fn();
    const prepared = mount([timer], {
      data: { enabled: true },
      deterministic: true,
      scheduleRule: scheduled,
      ruleDataChanged: changed,
    });
    await prepared.ready;
    prepared.render(1000, [], false);
    prepared.fireLifecycle('play', 1000);
    prepared.customAction!(clockTimerActionId(timer.id, 'restart'), 1000);
    expect(prepared.nextAlarmFrame!(1000)).toBeUndefined();
    expect(mock.text.mock.lastCall?.[1].content).toBe('10');
    expect(scheduled).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    prepared.dispose();
  });

  it.each([undefined, { enabled: false }, { enabled: true }])(
    'adopts prepared data Rules with the same predecessor semantics as a cold mount: %s',
    async (before) => {
      const controller = layer();
      controller.visualRules = [
        {
          id: 'enabled',
          name: 'Enabled',
          enabled: true,
          trigger: 'data',
          dataKey: 'enabled',
          sourcePath: [],
          operator: 'equals',
          value: true,
          actions: [
            { type: 'set-data', fieldId: 'status', dataKey: 'status', mode: 'set', value: 'ON' },
          ],
        },
      ];
      const preparedWork: TransitionLogicRuleWork[] = [];
      const coldWork: TransitionLogicRuleWork[] = [];
      const prepared = mount([controller], {
        startFrame: 0,
        data: { enabled: true },
        scheduleRule: (entry) => preparedWork.push(entry),
      });
      const cold = mount([controller], {
        startFrame: 100,
        data: { enabled: true },
        ...(before ? { previousData: before } : {}),
        scheduleRule: (entry) => coldWork.push(entry),
      });
      await Promise.all([prepared.ready, cold.ready]);
      expect(preparedWork).toHaveLength(0);
      prepared.prepareForTake!(100, before);
      prepared.setOnAir(true, 100);
      cold.setOnAir(true, 100);
      expect(preparedWork.map(({ id, frame }) => ({ id, frame }))).toEqual(
        coldWork.map(({ id, frame }) => ({ id, frame })),
      );
      expect(preparedWork).toHaveLength(before?.enabled === true ? 0 : 1);
      prepared.dispose();
      cold.dispose();
    },
  );

  it('rebases prepared countdown alarms to Take and preserves exact warning and expiry frames', async () => {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 10000,
          autoStart: true,
          format: 'ss',
          endBehavior: 'stop',
        }),
      }),
    );
    timer.id = 'timer';
    timer.visualRules = [5000, 0].map((threshold) => ({
      id: `alarm-${threshold}`,
      name: `Alarm ${threshold}`,
      enabled: true,
      trigger: 'timer-alarm',
      timerAlarm: { sourceLayerId: timer.id, thresholdMs: threshold, direction: 'down' },
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
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const prepared = mount([timer], {
      deterministic: true,
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    await prepared.ready;
    prepared.render(700, [], false);
    prepared.prepareForTake!(1000);
    prepared.setOnAir(true, 1000);
    prepared.render(1000, [], false);
    expect(prepared.nextAlarmFrame!(1000)).toBe(1250);
    expect(mock.text.mock.lastCall?.[1].content).toBe('10');
    prepared.render(1249, [], false);
    expect(work).toHaveLength(0);
    prepared.render(1250, [], false);
    expect(work).toHaveLength(1);
    expect(work[0]!.frame).toBe(1250);
    work.shift()!.run();
    expect(changed).toHaveBeenLastCalledWith({ status: 'WARNING' }, 1250);
    prepared.render(1500, [], false);
    expect(work).toHaveLength(1);
    expect(work[0]!.frame).toBe(1500);
    work.shift()!.run();
    expect(changed).toHaveBeenLastCalledWith({ status: 'TIME UP' }, 1500);
    prepared.render(1600, [], false);
    expect(work).toHaveLength(0);
    prepared.dispose();
  });

  it('supplies actual predecessor text to a prepared rolling update without restarting its clock', async () => {
    const text = layer(
      createTextElement({
        textAnimation: {
          ...createTextElement().textAnimation,
          type: 'roll-up',
          durationFrames: 20,
          replayOnUpdate: true,
        },
      }),
    );
    text.bindings = [{ dataKey: 'value', targetProperty: 'content' }];
    const prepared = mount([text], { data: { value: '10' } });
    await prepared.ready;
    prepared.prepareForTake!(100, { value: '9' });
    prepared.setOnAir(true, 100);
    prepared.render(105, [], false);
    expect(mock.previous.mock.lastCall?.[1].content).toBe('9');
    expect(mock.text.mock.lastCall?.[1].content).toBe('10');
    expect(mock.text.mock.lastCall?.[2]).toBe(5);
    prepared.dispose();
  });

  it('rejects adopting active, previously active and disposed renderers as pristine instances', async () => {
    const prepared = mount([layer()]);
    await prepared.ready;
    prepared.prepareForTake!(100);
    prepared.setOnAir(true, 100);
    expect(() => prepared.prepareForTake!(200)).toThrow('unused prepared instance');
    prepared.setOnAir(false, 200);
    expect(() => prepared.prepareForTake!(300)).toThrow('unused prepared instance');
    prepared.dispose();
    expect(() => prepared.prepareForTake!(400)).toThrow('unused prepared instance');
  });

  it('awaits newly submitted shader work even when decoded content readiness is cached', async () => {
    const prepared = mount([layer()]);
    await prepared.ready;
    expect(mock.ready).toHaveBeenCalledTimes(1);
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.shaderComplete.mockImplementationOnce(() => completion);
    prepared.render(50, [], false);
    let settled = false;
    const waiting = prepared.waitReady().then(() => {
      settled = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mock.shaderComplete).toHaveBeenCalledTimes(1);
    expect(mock.ready).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    release();
    await waiting;
    expect(settled).toBe(true);
    prepared.dispose();
  });

  it('does not turn an Out-disposed pending shader fence into a permanent playout failure', async () => {
    const prepared = mount([layer()]);
    await prepared.ready;
    let rejectFence!: (error: Error) => void;
    mock.shaderComplete.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFence = reject;
        }),
    );
    const waiting = prepared.waitReady();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(rejectFence).toBeTypeOf('function');
    prepared.dispose();
    rejectFence(new Error('Shader playback has been disposed.'));
    await expect(waiting).resolves.toBeUndefined();
  });

  it('does not hide a shader fence failure while the composition is still owned', async () => {
    const prepared = mount([layer()]);
    await prepared.ready;
    mock.shaderComplete.mockRejectedValueOnce(new Error('Shader GPU completion wait failed.'));
    await expect(prepared.waitReady()).rejects.toThrow('Shader GPU completion wait failed');
    prepared.dispose();
  });

  it('settles initial resource cancellation when its prepared composition is discarded', async () => {
    let rejectReady!: (error: Error) => void;
    mock.ready.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectReady = reject;
        }),
    );
    const prepared = mount([layer()]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(rejectReady).toBeTypeOf('function');
    prepared.dispose();
    rejectReady(new Error('Shader playback has been disposed.'));
    await expect(prepared.ready).resolves.toBeUndefined();
  });
});

describe('coordinated data-driven timer settings', () => {
  function timerLayer(autoStart = true) {
    const timer = layer(
      createTextElement({
        clock: normalizeClockTimerSettings({
          mode: 'count-down',
          initialValueMs: 30000,
          format: 'ss',
          autoStart,
        }),
      }),
    );
    timer.id = 'timer-settings';
    timer.bindings = [
      { dataKey: 'duration', targetProperty: 'clock.initialValueMs' },
      { dataKey: 'behavior', targetProperty: 'clock.endBehavior' },
    ];
    return timer;
  }
  const shown = () => mock.text.mock.lastCall?.[1].content;

  it('changes end behavior without rewinding a running timer', async () => {
    const rendered = mount([timerLayer()], { data: { duration: 30000, behavior: 'stop' } });
    try {
      await rendered.ready;
      rendered.setOnAir(true, 0);
      rendered.render(500, [], false);
      expect(shown()).toBe('20');
      rendered.setData({ duration: 30000, behavior: 'continue' }, 500);
      rendered.render(500, [], false);
      expect(shown()).toBe('20');
      rendered.render(600, [], false);
      expect(shown()).toBe('18');
    } finally {
      rendered.dispose();
    }
  });

  it('retains explicit Pause when a new duration resets its value', async () => {
    const timer = timerLayer();
    const rendered = mount([timer], { data: { duration: 30000, behavior: 'stop' } });
    try {
      await rendered.ready;
      rendered.setOnAir(true, 0);
      rendered.customAction!(clockTimerActionId(timer.id, 'pause'), 250);
      rendered.render(500, [], false);
      expect(shown()).toBe('25');
      rendered.setData({ duration: 60000, behavior: 'stop' }, 500);
      rendered.render(500, [], false);
      expect(shown()).toBe('60');
      rendered.render(600, [], false);
      expect(shown()).toBe('60');
    } finally {
      rendered.dispose();
    }
  });

  it('retains explicit Start when autoStart is disabled and duration changes', async () => {
    const timer = timerLayer(false);
    const rendered = mount([timer], { data: { duration: 30000, behavior: 'stop' } });
    try {
      await rendered.ready;
      rendered.setOnAir(true, 0);
      rendered.customAction!(clockTimerActionId(timer.id, 'start'), 0);
      rendered.render(500, [], false);
      expect(shown()).toBe('20');
      rendered.setData({ duration: 60000, behavior: 'stop' }, 500);
      rendered.render(600, [], false);
      expect(shown()).toBe('58');
    } finally {
      rendered.dispose();
    }
  });

  it('keeps alarm latches for end behavior and rearms a later duration from that event', async () => {
    const timer = timerLayer();
    const receive = vi.fn();
    const rendered = mount([timer], {
      data: { duration: 10000, behavior: 'stop' },
      deterministic: true,
      scheduleRule: () => {},
    });
    try {
      await rendered.ready;
      rendered.observeTimerAlarms!(
        timer.id,
        'timer-settings-alarms',
        [
          { id: 'warning', thresholdMs: 5000, direction: 'down' },
          { id: 'zero', thresholdMs: 0, direction: 'down' },
        ],
        receive,
      );
      rendered.setOnAir(true, 0);
      rendered.render(250, [], false);
      rendered.setData({ duration: 10000, behavior: 'continue' }, 300);
      rendered.render(300, [], false);
      expect(shown()).toBe('04');
      expect(receive).toHaveBeenCalledTimes(1);
      rendered.setData({ duration: 20000, behavior: 'continue' }, 350);
      rendered.render(350, [], false);
      expect(rendered.nextAlarmFrame!(350)).toBe(1100);
      rendered.render(1100, [], false);
      rendered.render(1350, [], false);
      expect(receive.mock.calls.map(([alarm, frame]) => [alarm.id, alarm.run, frame])).toEqual([
        ['warning', 0, 250],
        ['warning', 1, 1100],
        ['zero', 1, 1350],
      ]);
    } finally {
      rendered.dispose();
    }
  });

  it('replays display format changes at their own timestamps', async () => {
    const timer = timerLayer();
    timer.bindings.push({ dataKey: 'format', targetProperty: 'clock.format' });
    const rendered = mount([timer], { data: { duration: 30000, behavior: 'stop', format: 'ss' } });
    try {
      await rendered.ready;
      rendered.setOnAir(true, 0);
      rendered.setData({ duration: 30000, behavior: 'stop', format: 'mm:ss' }, 500);
      rendered.render(600, [], false);
      expect(shown()).toBe('00:18');
      rendered.render(250, [], false);
      expect(shown()).toBe('25');
      rendered.render(600, [], false);
      expect(shown()).toBe('00:18');
    } finally {
      rendered.dispose();
    }
  });

  it('replays timer state before a later duration change without rewriting history', async () => {
    const rendered = mount([timerLayer()], { data: { duration: 30000, behavior: 'stop' } });
    try {
      await rendered.ready;
      rendered.setOnAir(true, 0);
      rendered.setData({ duration: 60000, behavior: 'stop' }, 500);
      rendered.render(600, [], false);
      expect(shown()).toBe('58');
      rendered.render(250, [], false);
      expect(shown()).toBe('25');
      rendered.render(600, [], false);
      expect(shown()).toBe('58');
    } finally {
      rendered.dispose();
    }
  });

  it('inherits the original settings history and retimes a successor duration update', async () => {
    const timer = timerLayer();
    const before = mount([timer], { data: { duration: 30000, behavior: 'stop' } });
    const after = mount([timer], { startFrame: 500, data: { duration: 60000, behavior: 'stop' } });
    try {
      await Promise.all([before.ready, after.ready]);
      before.setOnAir(true, 0);
      before.customAction!(clockTimerActionId(timer.id, 'pause'), 250);
      after.inheritRules(before, { duration: 30000, behavior: 'stop' });
      after.startFrame = 550;
      after.setOnAir(true, 550);
      after.render(600, [], false);
      expect(shown()).toBe('60');
      after.render(300, [], false);
      expect(shown()).toBe('25');
      after.render(600, [], false);
      expect(shown()).toBe('60');
    } finally {
      before.dispose();
      after.dispose();
    }
  });
});
