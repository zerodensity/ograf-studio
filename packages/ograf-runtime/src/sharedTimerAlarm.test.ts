import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompiledGraphicDescriptor,
  CompiledLayer,
  CompiledTransitionLogicDescriptor,
  LoadParams,
  ScheduledAction,
} from '@ograf-editor/ograf-types';
import {
  clockTimerActionId,
  createDefaultTransform,
  createLayerEffects,
  createRectangleLayer,
  createTextElement,
  normalizeClockTimerSettings,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    parent: Host | null = null;
    shadowRoot: Host | null = null;
    textContent = '';
    ownerDocument = {
      createElement: () => new Host(),
      defaultView: null,
      fonts: { ready: Promise.resolve() },
    };
    attachShadow() {
      return (this.shadowRoot = new Host());
    }
    replaceChildren(...children: Host[]) {
      for (const child of this.children) child.parent = null;
      this.children = [];
      this.append(...children);
    }
    append(...children: Host[]) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
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
  vi.stubGlobal('HTMLElement', Host);
  return {
    Host,
    players: [] as Array<{ renderFrame(frame: number): void; disposed: boolean }>,
    readiness: new Map<string, Promise<void>>(),
  };
});
vi.mock('./framePlayer', () => ({
  FramePlayer: class {
    disposed = false;
    renderFrame: (frame: number) => void;
    constructor(options: { renderFrame(frame: number): void }) {
      this.renderFrame = options.renderFrame;
      mock.players.push(this);
    }
    setClockOwner() {
      return this;
    }
    play() {
      return this;
    }
    pause() {
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock('./autoLayoutRendering', () => ({ applyCompiledAutoLayout() {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks() {} }));
vi.mock('./motionPathRendering', () => ({ applyCompiledMotionPaths() {} }));
vi.mock('./backdropEffectRendering', () => ({
  compositionHasBackdropBlur: () => false,
  setCompositionBackdropRoot() {},
}));
vi.mock('./loopRendering', async (original) => ({
  ...(await original<typeof import('./loopRendering')>()),
  applyCompiledLayerVisualState(host: HTMLElement, state: { transform: { x: number } }) {
    host.style.transform = `translateX(${state.transform.x}px)`;
  },
  applyCompiledClipPaths() {},
}));
vi.mock('./renderElement', async (original) => ({
  ...(await original<typeof import('./renderElement')>()),
  renderElementContent(host: HTMLElement, element: CompiledLayer['element']) {
    host.dataset.ografRenderedElement = JSON.stringify(element);
    if (element.type === 'text') host.textContent = element.content;
  },
  renderAnimatedElementAtTime() {},
  disposeElementContent() {},
  setLottieDeterministicRendering() {},
  async waitForElementContentReady(root: unknown) {
    const texts = (host: InstanceType<typeof mock.Host>): string[] => [
      host.textContent,
      ...host.children.flatMap(texts),
      ...(host.shadowRoot ? texts(host.shadowRoot) : []),
    ];
    for (const value of texts(root as InstanceType<typeof mock.Host>))
      if (mock.readiness.has(value)) await mock.readiness.get(value);
  },
}));
vi.mock('./textAnimationRendering', async (original) => ({
  ...(await original<typeof import('./textAnimationRendering')>()),
  renderTextAnimationAtFrame(host: HTMLElement, element: CompiledLayer['element']) {
    if (element.type === 'text') host.textContent = element.content;
  },
  setTextAnimationPrevious() {},
}));
import { CoordinatedGraphicElement } from './CoordinatedGraphicElement';

function layer(id: string, element: CompiledLayer['element']): CompiledLayer {
  return {
    id,
    element,
    isVisible: true,
    effects: createLayerEffects(),
    bindings: [],
    keyframes: [
      {
        id: `pose-${id}`,
        frame: 0,
        easing: 'linear',
        transform: createDefaultTransform({ width: 400, height: 80 }),
      },
    ],
    animationTracks: {},
  };
}
function composition(layers: CompiledLayer[]): CompiledGraphicDescriptor {
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
const timer = (id: string) =>
  layer(
    id,
    createTextElement({
      clock: normalizeClockTimerSettings({
        mode: 'count-down',
        format: 'ss.SSS',
        initialValueMs: 10000,
        autoStart: false,
        endBehavior: 'stop',
      }),
    }),
  );

function fixture(twoInstances = false): CompiledTransitionLogicDescriptor {
  const instanceIds = twoInstances ? ['clock-a', 'clock-b'] : ['clock-a'];
  const proxies: CompiledLayer[] = [];
  const defaults: Record<string, unknown> = {};
  for (const instanceId of instanceIds) {
    const proxyId = `proxy-${instanceId}`;
    proxies.push(timer(proxyId));
    for (const thresholdMs of [5000, 0]) {
      const field = `${thresholdMs ? 'warning' : 'ending'}-${instanceId}`;
      defaults[field] = 0;
      const owner = layer(field, createRectangleLayer().element);
      owner.visualRules = [
        {
          // Equal Rule IDs on separate owners are valid and must not merge timer latches.
          id: 'alarm',
          name: thresholdMs ? 'Five seconds' : 'Time up',
          enabled: true,
          trigger: 'timer-alarm',
          timerAlarm: { sourceLayerId: proxyId, thresholdMs, direction: 'down' },
          dataKey: '',
          sourcePath: [],
          operator: 'equals',
          actions: [
            { type: 'set-data', fieldId: field, dataKey: field, mode: 'increase', value: 1 },
          ],
        },
      ];
      proxies.push(owner);
    }
  }
  const descriptor = composition(proxies);
  descriptor.customActions = instanceIds.flatMap((id) =>
    (['start', 'pause', 'reset', 'restart'] as const).map((command) => ({
      id: clockTimerActionId(`proxy-${id}`, command),
      name: `${id} ${command}`,
      durationFrames: 0,
    })),
  );
  return {
    version: 1,
    id: 'shared-timer-alarms',
    name: 'Shared timer alarms',
    width: 1920,
    height: 1080,
    frameRate: 50,
    definition: {
      version: 4,
      id: 'shared-timer-logic',
      name: 'Shared timer logic',
      defaultTransitionId: 'cut',
      slots: [{ id: 'game', name: 'Game', order: 0 }],
      states: [
        {
          id: 'question',
          name: 'Question',
          slotId: 'game',
          templateId: 'question',
          sharedValues: instanceIds.map((id) => ({
            instanceId: id,
            sourceLayerId: 'canonical-timer',
            property: 'opacity',
            value: 1,
          })),
        },
      ],
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
      sharedInstances: instanceIds.map((id) => ({
        id,
        name: id,
        componentAssetId: 'timer-asset',
        continuityKey: id,
        slotId: 'game',
      })),
      initialSharedValues: instanceIds.map((id) => ({
        instanceId: id,
        sourceLayerId: 'canonical-timer',
        property: 'opacity',
        value: 0,
      })),
    },
    templates: [
      {
        id: 'question',
        name: 'Question',
        descriptor,
        dataDefaults: defaults,
        sharedLayers: instanceIds.map((id) => ({
          layerId: `proxy-${id}`,
          instanceId: id,
          sourceLayerId: 'canonical-timer',
        })),
        sharedDataBindings: instanceIds.map((id) => ({ instanceId: id, fields: {} })),
      },
    ],
    sharedInstances: instanceIds.map((id) => ({
      id,
      descriptor: composition([timer('canonical-timer')]),
      dataDefaults: {},
    })),
  };
}

const instances: CoordinatedGraphicElement[] = [];
afterEach(async () => {
  for (const graphic of instances.splice(0)) await graphic.dispose();
  mock.players.length = 0;
  mock.readiness.clear();
});
async function create(
  renderType: LoadParams['renderType'] = 'realtime',
  twoInstances = false,
  source = fixture(twoInstances),
) {
  class Graphic extends CoordinatedGraphicElement {
    static transitionDescriptor = source;
  }
  const graphic = new Graphic();
  instances.push(graphic);
  expect(
    await graphic.load({
      renderType,
      renderCharacteristics: { resolution: { width: 1920, height: 1080 }, frameRate: 50 },
      data: {},
    }),
  ).toEqual({ statusCode: 200 });
  return graphic;
}
async function tick(frame: number) {
  for (const player of mock.players) if (!player.disposed) player.renderFrame(frame);
  for (let index = 0; index < 40; index++) await Promise.resolve();
}
const count = (
  graphic: CoordinatedGraphicElement,
  type: 'warning' | 'ending',
  instanceId = 'clock-a',
) => graphic.getPlayoutSnapshot().slots.game!.current?.data[`${type}-${instanceId}`];
const commandParams = (
  command: 'start' | 'pause' | 'reset' | 'restart',
  instanceId = 'clock-a',
) => ({
  id: 'template.action',
  payload: { slotId: 'game', actionId: clockTimerActionId(`proxy-${instanceId}`, command) },
});
async function command(
  graphic: CoordinatedGraphicElement,
  action: 'start' | 'pause' | 'reset' | 'restart',
  instanceId = 'clock-a',
) {
  expect(await graphic.customAction(commandParams(action, instanceId))).toEqual({
    statusCode: 200,
  });
}
async function take(graphic: CoordinatedGraphicElement) {
  const result = await graphic.customAction({
    id: 'transition.take',
    payload: { slotId: 'game', stateId: 'question' },
    skipAnimation: true,
  });
  expect(result).toEqual({ statusCode: 200 });
}

describe('external Rules driven by retained shared timers', () => {
  it('preserves the live incoming timer and its alarm observer when a later Play resource probe fails', async () => {
    const source = fixture();
    Object.assign(source.definition.transitions[0]!, {
      durationFrames: 500,
      incomingFrames: 500,
      sharedFrames: 500,
    });
    source.definition.slots.push({
      id: 'child',
      name: 'Child',
      order: 1,
      admission: { requireOnSlotIds: ['game'] },
    });
    source.definition.states.push({
      id: 'child',
      name: 'Child',
      slotId: 'child',
      templateId: 'child',
    });
    source.templates.push({
      id: 'child',
      name: 'Child',
      descriptor: composition([
        layer('child-text', createTextElement({ content: 'Blocked child texture' })),
      ]),
      dataDefaults: {},
      sharedLayers: [],
      sharedDataBindings: [],
    });
    const graphic = await create('realtime', false, source);
    const entering = graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'game', stateId: 'question' },
    });
    await tick(0);
    await command(graphic, 'start');
    const original = graphic.getPlayoutSnapshot().slots.game!.transition!;
    expect(original).toMatchObject({ startFrame: 0, endFrame: 500 });
    expect(
      await graphic.updateAction({ data: { slots: { child: { stateId: 'child' } } } }),
    ).toEqual({ statusCode: 200 });
    let rejectReady!: (cause: Error) => void;
    const ready = new Promise<void>((_resolve, reject) => {
      rejectReady = reject;
    });
    void ready.catch(() => {});
    mock.readiness.set('Blocked child texture', ready);
    const play = graphic.playAction({ goto: 0 });
    await tick(250);
    const waiting = graphic.getPlayoutSnapshot();
    expect(waiting.slots.game!.transition).toMatchObject({
      requestId: original.requestId,
      startFrame: 0,
      endFrame: 500,
    });
    expect(waiting.slots.game!.incoming?.data['warning-clock-a']).toBe(1);
    expect(waiting.slots.game!.incoming?.data['ending-clock-a']).toBe(0);
    expect(waiting.slots.child!.current).toBeNull();
    expect(waiting.slots.child!.pending).toBeNull();
    rejectReady(new Error('Child texture failed before Play commit'));
    expect(await play).toMatchObject({
      statusCode: 550,
      statusMessage: 'Child texture failed before Play commit',
    });
    await tick(500);
    expect(await entering).toEqual({ statusCode: 200 });
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
    expect(graphic.getPlayoutSnapshot().slots.child!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.child!.pending).toBeNull();
  });

  it('keeps the real shared timer clock and alarm latches intact when an invalid Play is rejected', async () => {
    const source = fixture();
    source.definition.slots.push({
      id: 'alert',
      name: 'Alert',
      order: 1,
      admission: { blockWhileActiveSlotIds: ['game'] },
    });
    source.definition.states.push({
      id: 'alert-state',
      name: 'Alert',
      slotId: 'alert',
      templateId: 'question',
      sharedValues: [],
    });
    const graphic = await create('realtime', false, source);
    expect(await graphic.playAction({ skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    await command(graphic, 'start');
    await tick(250);
    expect(count(graphic, 'warning')).toBe(1);
    expect(
      await graphic.updateAction({ data: { slots: { alert: { stateId: 'alert-state' } } } }),
    ).toEqual({ statusCode: 200 });
    const before = graphic.getPlayoutSnapshot();
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toMatchObject({
      statusCode: 550,
    });
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
    await tick(500);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
  });
  it('keeps simultaneous instances of the same template in different lanes independent', async () => {
    const source = fixture();
    source.definition.slots.push({ id: 'score', name: 'Score', order: 1 });
    source.definition.states.push({
      ...structuredClone(source.definition.states[0]!),
      id: 'score-question',
      name: 'Score question',
      slotId: 'score',
      templateId: 'question',
      sharedValues: [],
    });
    const graphic = await create('realtime', false, source);
    await take(graphic);
    expect(
      await graphic.customAction({
        id: 'transition.take',
        payload: { slotId: 'score', stateId: 'score-question' },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    await command(graphic, 'start');
    await tick(250);
    const counts = (field: string) =>
      Object.values(graphic.getPlayoutSnapshot().slots).map((slot) => slot.current?.data[field]);
    expect(counts('warning-clock-a')).toEqual([1, 1]);
    expect(
      await graphic.customAction({
        id: 'transition.take',
        payload: { slotId: 'score', stateId: 'score-question', data: { revision: 2 } },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    await tick(500);
    expect(counts('warning-clock-a')).toEqual([1, 1]);
    expect(counts('ending-clock-a')).toEqual([1, 1]);
  });
  it('follows only canonical Start/Pause/Reset/Restart and disambiguates same-ID owners', async () => {
    const graphic = await create();
    await take(graphic);
    await tick(500); // A stopped timer cannot fire an alarm just because its template is on air.
    expect(count(graphic, 'warning')).toBe(0);
    expect(count(graphic, 'ending')).toBe(0);
    await command(graphic, 'start');
    await tick(600); // Eight seconds remain.
    await command(graphic, 'pause');
    await tick(1000); // Passing wall time while paused must not advance proxy alarms.
    expect(count(graphic, 'warning')).toBe(0);
    expect(count(graphic, 'ending')).toBe(0);
    await command(graphic, 'start');
    await tick(1150);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(0);
    await tick(1400);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
    await command(graphic, 'reset');
    await tick(1900);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
    await command(graphic, 'restart');
    await tick(2150);
    expect(count(graphic, 'warning')).toBe(2);
    expect(count(graphic, 'ending')).toBe(1);
    await tick(2400);
    expect(count(graphic, 'ending')).toBe(2);
  });

  it('keeps two instances of the same timer source independent', async () => {
    const graphic = await create('realtime', true);
    await take(graphic);
    await command(graphic, 'start', 'clock-a');
    await tick(250);
    expect(count(graphic, 'warning', 'clock-a')).toBe(1);
    expect(count(graphic, 'warning', 'clock-b')).toBe(0);
    await tick(500);
    expect(count(graphic, 'ending', 'clock-a')).toBe(1);
    expect(count(graphic, 'ending', 'clock-b')).toBe(0);
    await command(graphic, 'start', 'clock-b');
    await tick(750);
    expect(count(graphic, 'warning', 'clock-a')).toBe(1);
    expect(count(graphic, 'warning', 'clock-b')).toBe(1);
    expect(count(graphic, 'ending', 'clock-b')).toBe(0);
    await tick(1000);
    expect(count(graphic, 'ending', 'clock-b')).toBe(1);
  });

  it('preserves the retained timer and alarm latches through a same-template data update', async () => {
    const graphic = await create();
    await take(graphic);
    await command(graphic, 'start');
    await tick(250);
    expect(count(graphic, 'warning')).toBe(1);
    expect(
      await graphic.updateAction({
        data: { slots: { game: { data: { label: 'Updated question' } } } },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    await tick(300);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(0);
    await command(graphic, 'pause');
    await tick(600);
    expect(count(graphic, 'ending')).toBe(0);
    await command(graphic, 'start');
    await tick(800);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
  });

  it('unbinds old alarm observers after Clear and re-Take without stale or duplicate firing', async () => {
    const graphic = await create();
    await take(graphic);
    await command(graphic, 'start');
    await tick(250);
    expect(count(graphic, 'warning')).toBe(1);
    expect(
      await graphic.customAction({ id: 'transition.clear', payload: { slotId: 'game' } }),
    ).toEqual({ statusCode: 200 });
    await tick(1000);
    expect(graphic.getPlayoutSnapshot().slots.game!.current).toBeNull();
    expect(
      await graphic.customAction({
        id: 'transition.take',
        payload: {
          slotId: 'game',
          stateId: 'question',
          data: { 'warning-clock-a': 0, 'ending-clock-a': 0 },
        },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    await tick(1500);
    expect(count(graphic, 'warning')).toBe(0);
    expect(count(graphic, 'ending')).toBe(0);
    await command(graphic, 'restart');
    await tick(1750);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(0);
    await tick(2000);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
  });

  it('forwards alarm crossings from bound manual data on the retained shared timer', async () => {
    const source = fixture();
    for (const descriptor of [
      source.templates[0]!.descriptor,
      source.sharedInstances[0]!.descriptor,
    ])
      for (const layer of descriptor.layers) {
        if (layer.element.type !== 'text' || !layer.element.clock) continue;
        layer.element.clock = { ...layer.element.clock, source: 'manual', manualValue: 10000 };
        layer.bindings = [{ dataKey: 'remaining', targetProperty: 'clock.manualValue' }];
      }
    source.templates[0]!.dataDefaults!.remaining = 10000;
    source.sharedInstances[0]!.dataDefaults!.remaining = 10000;
    source.templates[0]!.sharedDataBindings[0]!.fields = { remaining: 'remaining' };
    const graphic = await create('realtime', false, source);
    await take(graphic);
    await tick(50);
    expect(count(graphic, 'warning')).toBe(0);
    expect(
      await graphic.updateAction({ data: { slots: { game: { data: { remaining: 4000 } } } } }),
    ).toEqual({ statusCode: 200 });
    await tick(50);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(0);
    expect(
      await graphic.updateAction({ data: { slots: { game: { data: { remaining: 0 } } } } }),
    ).toEqual({ statusCode: 200 });
    await tick(50);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
    await tick(500);
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(1);
  });

  it.each(['realtime', 'non-realtime'] as const)(
    'routes a five-second Rule action back to Pause its canonical shared timer (%s)',
    async (renderType) => {
      const source = fixture();
      source.templates[0]!.descriptor.layers.find(
        (layer) => layer.id === 'warning-clock-a',
      )!.visualRules![0]!.actions.push({
        type: 'custom-action',
        actionId: clockTimerActionId('proxy-clock-a', 'pause'),
      });
      const graphic = await create(renderType, false, source);
      if (renderType === 'realtime') {
        await take(graphic);
        await command(graphic, 'start');
        await tick(250);
        expect(count(graphic, 'warning')).toBe(1);
        await tick(400);
        expect(count(graphic, 'ending')).toBe(0);
        await command(graphic, 'start');
        await tick(650);
      } else {
        expect(
          await graphic.setActionsSchedule({
            schedule: [
              {
                timestamp: 0,
                action: {
                  type: 'customAction',
                  params: {
                    id: 'transition.take',
                    payload: { slotId: 'game', stateId: 'question' },
                    skipAnimation: true,
                  },
                },
              },
              { timestamp: 0, action: { type: 'customAction', params: commandParams('start') } },
              { timestamp: 8000, action: { type: 'customAction', params: commandParams('start') } },
            ],
          }),
        ).toEqual({ statusCode: 200 });
        expect(await graphic.goToTime({ timestamp: 7999 })).toEqual({ statusCode: 200 });
        expect(count(graphic, 'warning')).toBe(1);
        expect(count(graphic, 'ending')).toBe(0);
        expect(await graphic.goToTime({ timestamp: 13000 })).toEqual({ statusCode: 200 });
      }
      expect(count(graphic, 'warning')).toBe(1);
      expect(count(graphic, 'ending')).toBe(1);
    },
  );

  it('replays canonical commands and alarm boundaries deterministically after backward non-realtime seeks', async () => {
    const graphic = await create('non-realtime');
    const scheduled = (
      timestamp: number,
      params: Parameters<CoordinatedGraphicElement['customAction']>[0],
    ): ScheduledAction => ({ timestamp, action: { type: 'customAction', params } });
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          scheduled(0, {
            id: 'transition.take',
            payload: { slotId: 'game', stateId: 'question' },
            skipAnimation: true,
          }),
          scheduled(200, commandParams('start')),
          scheduled(2200, commandParams('pause')),
          scheduled(6200, commandParams('start')),
          scheduled(14220, commandParams('reset')),
          scheduled(16000, commandParams('restart')),
        ],
      }),
    ).toEqual({ statusCode: 200 });
    expect(await graphic.goToTime({ timestamp: 9000 })).toEqual({ statusCode: 200 });
    expect(count(graphic, 'warning')).toBe(0);
    expect(count(graphic, 'ending')).toBe(0);
    expect(await graphic.goToTime({ timestamp: 9200 })).toEqual({ statusCode: 200 });
    expect(count(graphic, 'warning')).toBe(1);
    expect(count(graphic, 'ending')).toBe(0);
    expect(await graphic.goToTime({ timestamp: 14200 })).toEqual({ statusCode: 200 });
    expect(count(graphic, 'ending')).toBe(1);
    expect(await graphic.goToTime({ timestamp: 26000 })).toEqual({ statusCode: 200 });
    expect(count(graphic, 'warning')).toBe(2);
    expect(count(graphic, 'ending')).toBe(2);
    expect(await graphic.goToTime({ timestamp: 100 })).toEqual({ statusCode: 200 });
    expect(count(graphic, 'warning')).toBe(0);
    expect(count(graphic, 'ending')).toBe(0);
    expect(await graphic.goToTime({ timestamp: 26000 })).toEqual({ statusCode: 200 });
    expect(count(graphic, 'warning')).toBe(2);
    expect(count(graphic, 'ending')).toBe(2);
  });

  it('stops a shared timer alarm that recursively restarts itself at the same threshold', async () => {
    const source = fixture();
    const timer = source.sharedInstances[0]!.descriptor.layers[0]!.element;
    if (timer.type !== 'text' || !timer.clock) throw Error('Expected timer');
    timer.clock.initialValueMs = 5000;
    source.templates[0]!.descriptor.layers.find(
      (layer) => layer.id === 'warning-clock-a',
    )!.visualRules![0]!.actions.push({
      type: 'custom-action',
      actionId: clockTimerActionId('proxy-clock-a', 'restart'),
    });
    const graphic = await create('non-realtime', false, source);
    await graphic.setActionsSchedule({
      schedule: [
        {
          timestamp: 0,
          action: {
            type: 'customAction',
            params: {
              id: 'transition.take',
              payload: { slotId: 'game', stateId: 'question' },
              skipAnimation: true,
            },
          },
        },
        { timestamp: 0, action: { type: 'customAction', params: commandParams('start') } },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 0 })).toMatchObject({
      statusMessage: expect.stringContaining('Rules playout cycle stopped'),
    });
  });
});
