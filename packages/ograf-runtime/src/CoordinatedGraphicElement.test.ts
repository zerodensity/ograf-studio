import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  LoadParams,
  ScheduledAction,
  SharedGraphicPointerEdge,
} from '@ograf-editor/ograf-types';
import {
  clockTimerActionId,
  createDefaultTransform,
  createLayerEffects,
  createRectangleLayer,
  createTextElement,
  normalizeClockTimerSettings,
  type TransitionLogicSharedValue,
} from '@ograf-editor/scene-model';
import type { TransitionLogicRuleWork } from './transitionLogicRendering';

const mock = vi.hoisted(() => {
  class Host extends EventTarget {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    parent: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = { createElement: () => new Host(), defaultView: null };
    getBoundingClientRect() {
      return { left: 20, top: 40, width: 960, height: 540, right: 980, bottom: 580 };
    }
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
    mounts: [] as Array<{
      host: Host;
      layerElement(id: string): Host | undefined;
      data: Record<string, unknown>;
      startFrame: number;
      ready: Promise<void>;
      waitReady: ReturnType<typeof vi.fn>;
      disposed: boolean;
      setData: ReturnType<typeof vi.fn>;
      prepareForTake: ReturnType<typeof vi.fn>;
      setOnAir: ReturnType<typeof vi.fn>;
      fireLifecycle: ReturnType<typeof vi.fn>;
      customAction: ReturnType<typeof vi.fn>;
      applySharedPointerPosition: ReturnType<typeof vi.fn>;
      applySharedPointerEdge: ReturnType<typeof vi.fn>;
      captureSharedPointer?: (input: SharedGraphicPointerEdge, event: MouseEvent) => void;
      ruleDataChanged?: (patch: Record<string, unknown>, frame: number) => void;
      scheduleRule?: (work: TransitionLogicRuleWork) => void;
      inheritRules: ReturnType<typeof vi.fn>;
      settleText: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }>,
    readiness: new Map<string, Promise<void>>(),
  };
});

describe('coordinated path text data validation', () => {
  it('rejects an invalid update before changing output or retained controls, then accepts a valid update', async () => {
    const source = descriptor();
    const template = source.templates.find((item) => item.id === 'headline')!;
    template.descriptor = {
      ...template.descriptor,
      layers: [
        {
          id: 'title',
          name: 'Title',
          element: createTextElement(),
          effects: createLayerEffects(),
          isVisible: true,
          keyframes: [],
          animationTracks: {},
          bindings: [{ dataKey: 'headline', targetProperty: 'content' }],
          textPath: { sourceLayerId: 'path', startOffset: 0, alignment: 'start' },
        },
      ],
    };
    const graphic = await create('realtime', source);
    expect(await take(graphic, 'headline', { headline: 'VALID' }, true)).toEqual({
      statusCode: 200,
    });
    const before = graphic.getPlayoutSnapshot().slots.main!.current;
    expect(
      await graphic.updateAction({
        data: { slots: { main: { stateId: 'headline', data: { headline: 'مرحبا' } } } },
        skipAnimation: true,
      }),
    ).toMatchObject({ statusCode: 550 });
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toEqual(before);
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toMatchObject({
      statusCode: 200,
    });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe('VALID');
    expect(
      await graphic.updateAction({
        data: { slots: { main: { stateId: 'headline', data: { headline: 'RECOVERED' } } } },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe('RECOVERED');
  });
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

vi.mock('./transitionLogicRendering', () => ({
  sharedLayerKey: (instanceId: string, layerId: string) => JSON.stringify([instanceId, layerId]),
  mountTransitionLogicComposition: (options: {
    parent: InstanceType<typeof mock.Host>;
    descriptor: CompiledGraphicDescriptor;
    data: Record<string, unknown>;
    startFrame: number;
    ruleDataChanged?: (patch: Record<string, unknown>, frame: number) => void;
    scheduleRule?: (work: TransitionLogicRuleWork) => void;
    captureSharedPointer?: (input: SharedGraphicPointerEdge, event: MouseEvent) => void;
  }) => {
    const host = new mock.Host();
    options.parent.append(host);
    const layers = new Map(options.descriptor.layers.map(({ id }) => [id, new mock.Host()]));
    host.append(...layers.values());
    const ready = mock.readiness.get(String(options.data.resource ?? '')) ?? Promise.resolve();
    const mount = {
      host,
      layerElement: (id: string) => layers.get(id),
      data: structuredClone(options.data),
      startFrame: options.startFrame,
      ready,
      waitReady: vi.fn(async () => {
        await ready;
      }),
      disposed: false,
      setData: vi.fn((data: Record<string, unknown>) => {
        mount.data = structuredClone(data);
      }),
      prepareForTake: vi.fn((frame: number) => {
        mount.startFrame = frame;
      }),
      setOnAir: vi.fn(),
      fireLifecycle: vi.fn(),
      customAction: vi.fn(),
      applySharedPointerPosition: vi.fn(),
      applySharedPointerEdge: vi.fn(() => true),
      ...(options.captureSharedPointer
        ? { captureSharedPointer: options.captureSharedPointer }
        : {}),
      ...(options.ruleDataChanged ? { ruleDataChanged: options.ruleDataChanged } : {}),
      ...(options.scheduleRule ? { scheduleRule: options.scheduleRule } : {}),
      inheritRules: vi.fn(),
      settleText: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(() => {
        mount.disposed = true;
        layers.clear();
        host.remove();
      }),
    };
    mock.mounts.push(mount);
    return mount;
  },
}));

import { CoordinatedGraphicElement } from './CoordinatedGraphicElement';

const compiled: CompiledGraphicDescriptor = {
  width: 1920,
  height: 1080,
  backgroundColor: 'transparent',
  frameRate: 50,
  layers: [],
  keyframes: [],
  transitions: [],
  stepKeyframeIds: [],
  stepCount: 1,
  startKeyframeId: 'off',
  endKeyframeId: 'off',
  customActions: [],
};

function descriptor(): CompiledTransitionLogicDescriptor {
  return {
    version: 1,
    id: 'news',
    name: 'News',
    width: 1920,
    height: 1080,
    frameRate: 50,
    definition: {
      version: 1,
      id: 'logic',
      name: 'News',
      defaultTransitionId: 'dissolve',
      slots: [
        { id: 'main', name: 'Lower third', order: 0 },
        { id: 'ticker', name: 'Ticker', order: 1 },
      ],
      states: [
        {
          id: 'correspondent',
          name: 'Correspondent',
          slotId: 'main',
          templateId: 'correspondent',
          sharedValues: [
            { instanceId: 'panel', sourceLayerId: 'backing', property: 'opacity', value: 1 },
          ],
        },
        {
          id: 'headline',
          name: 'Headline',
          slotId: 'main',
          templateId: 'headline',
          sharedValues: [
            { instanceId: 'panel', sourceLayerId: 'backing', property: 'opacity', value: 1 },
          ],
        },
        {
          id: 'breaking',
          name: 'Breaking',
          slotId: 'main',
          templateId: 'breaking',
          sharedValues: [
            { instanceId: 'panel', sourceLayerId: 'backing', property: 'opacity', value: 1 },
          ],
        },
        { id: 'ticker', name: 'Ticker', slotId: 'ticker', templateId: 'ticker' },
      ],
      transitions: [
        {
          id: 'dissolve',
          name: 'Dissolve',
          durationFrames: 20,
          outgoingFrames: 20,
          incomingStartFrame: 0,
          incomingFrames: 20,
          sharedFrames: 20,
          easing: 'linear',
        },
      ],
      routes: [],
      sharedInstances: [
        {
          id: 'panel',
          name: 'Panel',
          componentAssetId: 'panel-asset',
          continuityKey: 'panel',
          slotId: 'main',
        },
      ],
      initialSharedValues: [
        { instanceId: 'panel', sourceLayerId: 'backing', property: 'opacity', value: 0 },
      ],
    },
    templates: ['correspondent', 'headline', 'breaking', 'ticker'].map((id) => ({
      id,
      name: id,
      descriptor: compiled,
      dataDefaults: { headline: id },
      sharedLayers:
        id === 'ticker'
          ? []
          : [{ layerId: 'proxy', instanceId: 'panel', sourceLayerId: 'backing' }],
      sharedDataBindings:
        id === 'ticker' ? [] : [{ instanceId: 'panel', fields: { panelHeadline: 'headline' } }],
    })),
    sharedInstances: [
      { id: 'panel', descriptor: compiled, dataDefaults: { panelHeadline: 'Default' } },
    ],
  };
}

const instances: CoordinatedGraphicElement[] = [];
async function create(renderType: LoadParams['renderType'] = 'realtime', source = descriptor()) {
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
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function tick(frame: number) {
  for (const player of mock.players) if (!player.disposed) player.renderFrame(frame);
  await flush();
}
const take = (
  graphic: CoordinatedGraphicElement,
  stateId: string,
  data = {},
  skipAnimation = false,
) =>
  graphic.customAction({
    id: 'transition.take',
    payload: { slotId: stateId === 'ticker' ? 'ticker' : 'main', stateId, data },
    skipAnimation,
  });
const live = () =>
  mock.mounts.filter((mount) => !mount.disposed && mount.host.dataset.ografTransitionState);
const visible = () => live().filter((mount) => Number(mount.host.style.opacity) > 0);
const shared = () =>
  mock.mounts.find(
    (mount) => !mount.disposed && mount.host.dataset.ografTransitionShared === 'panel',
  )!;
const pending = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  mock.players.length = 0;
  mock.mounts.length = 0;
  mock.readiness.clear();
});

it('relays a coordinated hit with its authored lane or shared instance and replays only that target', async () => {
  const graphic = await create();
  await take(graphic, 'headline', {}, true);
  await take(graphic, 'ticker', {}, true);
  const headline = live().find((mount) => mount.host.dataset.ografTransitionState === 'headline')!;
  const ticker = live().find((mount) => mount.host.dataset.ografTransitionState === 'ticker')!;
  const panel = shared();
  const send = vi.fn();
  graphic.setSharedInputHandler(send);
  const native = {
    isTrusted: true,
    clientX: 260,
    clientY: 310,
    type: 'click',
    detail: 1,
  } as MouseEvent;
  headline.captureSharedPointer?.({ type: 'click', target: { layerId: 'label' } }, native);
  panel.captureSharedPointer?.({ type: 'click', target: { layerId: 'backing' } }, native);
  const fromLane: SharedGraphicPointerEdge = {
    type: 'click',
    target: { layerId: 'label', slotId: 'main', stateId: 'headline' },
    position: { x: 0.25, y: 0.5 },
  };
  const fromPanel: SharedGraphicPointerEdge = {
    type: 'click',
    target: { layerId: 'backing', sharedKey: 'panel' },
    position: { x: 0.25, y: 0.5 },
  };
  expect(send.mock.calls).toEqual([[fromLane], [fromPanel]]);
  send.mockClear();
  expect(graphic.applySharedInput(fromLane)).toBe(true);
  expect(headline.applySharedPointerEdge).toHaveBeenCalledWith(fromLane, expect.any(Number));
  expect(ticker.applySharedPointerEdge).not.toHaveBeenCalled();
  expect(ticker.applySharedPointerPosition).toHaveBeenCalledWith({ clientX: 260, clientY: 310 });
  expect(graphic.applySharedInput(fromPanel)).toBe(true);
  expect(panel.applySharedPointerEdge).toHaveBeenCalledWith(fromPanel, expect.any(Number));
  expect(
    graphic.applySharedInput({ ...fromLane, target: { ...fromLane.target, stateId: 'breaking' } }),
  ).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

describe('coordinated export instances', () => {
  function keyedDescriptor(): CompiledTransitionLogicDescriptor {
    const source = descriptor();
    const layer = (
      id: string,
      exportKey?: string,
    ): CompiledGraphicDescriptor['layers'][number] => ({
      id,
      ...(exportKey ? { exportKey } : {}),
      isVisible: true,
      element: createRectangleLayer().element,
      effects: createLayerEffects(),
      keyframes: [{ id: 'base', frame: 0, easing: 'linear', transform: createDefaultTransform() }],
      animationTracks: {},
      bindings: [],
    });
    for (const template of source.templates) {
      template.descriptor = {
        ...template.descriptor,
        layers: [layer('score', 'scoreline'), layer('proxy', 'panel'), layer('unkeyed')],
      };
    }
    const sharedInstance = source.sharedInstances[0]!;
    sharedInstance.descriptor = { ...sharedInstance.descriptor, layers: [layer('backing')] };
    return source;
  }

  it('exposes rendered incoming and outgoing instances while omitting a pending mount', async () => {
    const graphic = await create('realtime', keyedDescriptor());
    expect(Object.keys(graphic.instances)).toEqual([]);
    await take(graphic, 'headline', {}, true);
    const headline = Object.values(graphic.instances)[0]!;
    expect(headline).toMatchObject({ templateId: 'headline', laneId: 'main' });
    expect(Object.keys(headline.layers)).toEqual(['scoreline', 'panel']);
    expect(headline.layers.scoreline).toBe(live()[0]!.layerElement('score'));
    expect(headline.layers.panel).toBe(shared().layerElement('backing'));

    const resource = pending();
    mock.readiness.set('next', resource.promise);
    const replacement = take(graphic, 'breaking', { resource: 'next' });
    await flush();
    expect(live().some((mount) => mount.host.dataset.ografTransitionState === 'breaking')).toBe(
      true,
    );
    expect(Object.keys(graphic.instances)).toEqual([headline.instanceId]);
    resource.resolve();
    await flush();
    await tick(10);

    const breaking = Object.values(graphic.instances).find(
      (item) => item.templateId === 'breaking',
    )!;
    expect(breaking.instanceId).not.toBe(headline.instanceId);
    expect(breaking.laneId).toBe('main');
    expect(breaking.layers.scoreline).not.toBe(headline.layers.scoreline);
    expect(breaking.layers.panel).toBe(headline.layers.panel);
    expect(graphic.instances[headline.instanceId]?.layers.scoreline).toBe(
      headline.layers.scoreline,
    );

    await tick(25);
    expect(await replacement).toEqual({ statusCode: 200 });
    expect(Object.keys(graphic.instances)).toEqual([breaking.instanceId]);
    await graphic.dispose();
    expect(Object.keys(graphic.instances)).toEqual([]);
  });

  it('keeps a logical instance ID and chooses the incoming wrapper during a same-state update', async () => {
    const graphic = await create('realtime', keyedDescriptor());
    await take(graphic, 'headline', { headline: 'Before' }, true);
    const before = Object.values(graphic.instances)[0]!;
    const update = take(graphic, 'headline', { headline: 'After' });
    await flush();
    await tick(10);

    const incoming = live().find((mount) => mount.data.headline === 'After')!;
    expect(live()).toHaveLength(2);
    expect(Object.keys(graphic.instances)).toEqual([before.instanceId]);
    expect(graphic.instances[before.instanceId]?.layers.scoreline).toBe(
      incoming.layerElement('score'),
    );
    expect(graphic.instances[before.instanceId]?.layers.scoreline).not.toBe(
      before.layers.scoreline,
    );

    await tick(25);
    expect(await update).toEqual({ statusCode: 200 });
    expect(Object.keys(graphic.instances)).toEqual([before.instanceId]);
  });
});

describe('in-place coordinated live data patches', () => {
  const patch = (
    graphic: CoordinatedGraphicElement,
    data: Record<string, unknown>,
    stateId?: string,
    skipAnimation = false,
  ) =>
    graphic.customAction({
      id: 'transition.patch',
      payload: { slotId: 'main', ...(stateId === undefined ? {} : { stateId }), data },
      skipAnimation,
    });

  it('retains mounts, request identities, opacity and clocks while applying normal data and shared bindings', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'Before', keep: 42 }, true);
    await tick(17);
    const before = graphic.getPlayoutSnapshot();
    const local = visible()[0]!;
    const count = mock.mounts.length;
    const starts = mock.mounts.map((mount) => mount.startFrame);
    const onAirCalls = local.setOnAir.mock.calls.length;
    const inherited = local.inheritRules.mock.calls.length;
    expect(await patch(graphic, { headline: 'After' }, 'headline')).toEqual({ statusCode: 200 });
    const after = graphic.getPlayoutSnapshot();
    expect(after.frame).toBe(before.frame);
    expect(after.slots.main!.transition).toBeNull();
    expect(after.slots.main!.current).toMatchObject({
      requestId: before.slots.main!.current!.requestId,
      instanceId: before.slots.main!.current!.instanceId,
      data: { headline: 'After', keep: 42 },
    });
    expect(mock.mounts).toHaveLength(count);
    expect(mock.mounts.map((mount) => mount.startFrame)).toEqual(starts);
    expect(local.host.style.opacity).toBe('1');
    expect(local.setOnAir).toHaveBeenCalledTimes(onAirCalls);
    expect(local.inheritRules).toHaveBeenCalledTimes(inherited);
    expect(shared().data.panelHeadline).toBe('After');
    graphic.pausePlayout();
    expect(await patch(graphic, { headline: 'Paused patch' }, '', true)).toEqual({
      statusCode: 200,
    });
    expect(graphic.getPlayoutSnapshot().paused).toBe(true);
    expect(local.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Paused patch' }),
      17,
      true,
    );
  });

  it('preserves an entering transition deadline and rejects Off, leaving or mismatched states without changes', async () => {
    const graphic = await create();
    expect((await patch(graphic, { headline: 'Off' })).statusCode).toBe(550);
    const entering = take(graphic, 'headline', { headline: 'Before' });
    await flush();
    await tick(5);
    const transition = graphic.getPlayoutSnapshot().slots.main!.transition;
    expect(await patch(graphic, { headline: 'During entry' }, 'headline')).toEqual({
      statusCode: 200,
    });
    expect(graphic.getPlayoutSnapshot().slots.main!.transition).toEqual(transition);
    expect((await patch(graphic, { headline: 'Wrong state' }, 'breaking')).statusCode).toBe(550);
    await tick(20);
    expect(await entering).toEqual({ statusCode: 200 });
    const leaving = outMain(graphic);
    await flush();
    const before = graphic.getPlayoutSnapshot();
    expect((await patch(graphic, { headline: 'During exit' })).statusCode).toBe(550);
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
    await tick(40);
    await leaving;
  });

  it('validates patch shape and bounded JSON before touching output', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'Valid' }, true);
    const before = graphic.getPlayoutSnapshot();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const invalid: unknown[] = [
      undefined,
      [],
      { price: NaN },
      cycle,
      { headline: 'x'.repeat(65537) },
      { values: Array.from({ length: 4097 }, () => 1) },
    ];
    for (const data of invalid)
      expect(
        (await graphic.customAction({ id: 'transition.patch', payload: { slotId: 'main', data } }))
          .statusCode,
      ).toBe(550);
    expect(
      (
        await graphic.customAction({
          id: 'transition.patch',
          payload: { slotId: 'main', stateId: null, data: {} },
        })
      ).statusCode,
    ).toBe(550);
    expect(
      (
        await graphic.customAction({
          id: 'transition.patch',
          payload: { slotId: 'main', data: {}, unexpected: true },
        })
      ).statusCode,
    ).toBe(550);
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
  });

  it('runs ordinary data-change rule work on the retained mount at the patch frame', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'Before' }, true);
    await tick(5);
    const local = visible()[0]!;
    const run = vi.fn(() => []);
    local.setData.mockImplementationOnce((data: Record<string, unknown>) => {
      local.data = structuredClone(data);
      local.scheduleRule!({ id: 'live-data-change', frame: 5, data, run });
    });
    expect(await patch(graphic, { headline: 'Rule input' })).toEqual({ statusCode: 200 });
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(graphic.getPlayoutSnapshot().slots.main!.current!.data.headline).toBe('Rule input');
    expect(local.disposed).toBe(false);
  });

  it('records sparse patches and replays them identically across backward seeks', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'Before', keep: 42 }, true);
    await tick(10);
    await patch(graphic, { headline: 'After' }, 'headline');
    const schedule = graphic.getRecordedActions();
    expect(schedule.at(-1)).toMatchObject({
      timestamp: 200,
      action: {
        type: 'customAction',
        params: { id: 'transition.patch', payload: { data: { headline: 'After' } } },
      },
    });
    const offline = await create('non-realtime');
    expect(await offline.setActionsSchedule({ schedule })).toEqual({ statusCode: 200 });
    expect(await offline.goToTime({ timestamp: 500 })).toEqual({ statusCode: 200 });
    const final = offline.getPlayoutSnapshot().slots.main!.current;
    expect(final!.data).toMatchObject({ headline: 'After', keep: 42 });
    expect(await offline.goToTime({ timestamp: 100 })).toEqual({ statusCode: 200 });
    expect(offline.getPlayoutSnapshot().slots.main!.current!.data.headline).toBe('Before');
    expect(await offline.goToTime({ timestamp: 500 })).toEqual({ statusCode: 200 });
    expect(offline.getPlayoutSnapshot().slots.main!.current).toEqual(final);
  });

  it('does not transiently write losing lane data into a global shared source', async () => {
    const source = descriptor();
    delete source.definition.sharedInstances[0]!.slotId;
    source.templates.find((template) => template.id === 'ticker')!.sharedDataBindings = [
      { instanceId: 'panel', fields: { panelHeadline: 'headline' } },
    ];
    const graphic = await create('realtime', source);
    await take(graphic, 'headline', { headline: 'Main' }, true);
    await tick(10);
    await take(graphic, 'ticker', { headline: 'Winning ticker' }, true);
    const panel = shared();
    panel.setData.mockClear();
    expect(await patch(graphic, { headline: 'Losing main' }, 'headline')).toEqual({
      statusCode: 200,
    });
    expect(panel.data.panelHeadline).toBe('Winning ticker');
    expect(panel.setData.mock.calls.some(([data]) => data.panelHeadline === 'Losing main')).toBe(
      false,
    );
  });
});

describe('coordinated ticker update commit timing', () => {
  it('inherits queued same-instance data at actual commit rather than its earlier preparation frame', async () => {
    const graphic = await create();
    const first = take(graphic, 'headline', { headline: 'Original' });
    await flush();
    await tick(5);
    const queued = take(graphic, 'headline', { headline: 'Queued revision' });
    await flush();
    const incoming = live().find((mount) => mount.data.headline === 'Queued revision')!;
    expect(incoming).toBeDefined();
    expect(graphic.getPlayoutSnapshot().slots.main!.transition?.startFrame).toBe(0);
    expect(incoming.inheritRules.mock.calls.at(-1)?.[2]).toBe(5);
    await tick(19);
    expect(incoming.setOnAir).not.toHaveBeenCalledWith(true, 19);
    expect(incoming.inheritRules.mock.calls.at(-1)?.[2]).toBe(5);
    await tick(20);
    expect(await first).toMatchObject({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.main!.transition?.startFrame).toBe(20);
    expect(incoming.inheritRules.mock.calls.at(-1)?.[2]).toBe(20);
    expect(incoming.setOnAir).toHaveBeenCalledWith(true, 20);
    await tick(40);
    expect(await queued).toMatchObject({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe('Queued revision');
  });
});

describe('bounded dormant coordinated preparation cache', () => {
  function source(count = 4, width = 1920, height = 1080) {
    const value = descriptor();
    const ids = Array.from({ length: count }, (_, index) => `state-${index}`);
    value.definition.states = ids.map((id) => ({
      id,
      name: id,
      slotId: 'main',
      templateId: id,
    }));
    value.definition.sharedInstances = [];
    value.definition.initialSharedValues = [];
    value.sharedInstances = [];
    value.templates = ids.map((id) => ({
      id,
      name: id,
      descriptor: {
        ...compiled,
        width,
        height,
        layers: [
          {
            id: 'local',
            element: createRectangleLayer().element,
            effects: createLayerEffects(),
            isVisible: true,
            bindings: [],
            keyframes: [],
            animationTracks: {},
          },
        ],
      },
      dataDefaults: { headline: id },
      sharedLayers: [],
      sharedDataBindings: [],
    }));
    value.dataDefaults = {
      slots: { main: { stateId: null, data: {} }, ticker: { stateId: null, data: {} } },
    };
    return value;
  }

  function idleOwner() {
    let number = 0;
    const callbacks = new Map<number, (deadline: IdleDeadline) => void>();
    const owner = {
      requestIdleCallback: vi.fn((callback: (deadline: IdleDeadline) => void) => {
        const id = ++number;
        callbacks.set(id, callback);
        return id;
      }),
      cancelIdleCallback: vi.fn((id: number) => callbacks.delete(id)),
    };
    return {
      owner,
      callbacks,
      async next(timeRemaining = 50) {
        const next = callbacks.entries().next().value;
        if (!next) return false;
        callbacks.delete(next[0]);
        next[1]({ didTimeout: false, timeRemaining: () => timeRemaining });
        await flush();
        return true;
      },
      async drain() {
        for (let i = 0; i < 32 && callbacks.size; i++) await this.next();
        expect(callbacks.size).toBe(0);
      },
    };
  }

  async function cachedGraphic(
    value = source(),
    renderType: LoadParams['renderType'] = 'realtime',
  ) {
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = value;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    const idle = idleOwner();
    Object.assign(graphic.ownerDocument, { defaultView: idle.owner });
    expect(await graphic.load({ renderType, renderCharacteristics: {}, data: {} })).toEqual({
      statusCode: 200,
    });
    return { graphic, idle };
  }

  const cachedTake = (graphic: CoordinatedGraphicElement, stateId: string, data = {}) =>
    graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'main', stateId, data },
      skipAnimation: true,
    });

  it('prepares dormant resources only when idle and consumes their actual DOM on a later Take', async () => {
    const { graphic, idle } = await cachedGraphic();
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(0);
    await idle.drain();
    expect(graphic.getPreparationCacheSnapshot()).toMatchObject({
      entries: 4,
      hits: 0,
      preparing: false,
      enabled: true,
    });
    const prepared = mock.mounts.find((mount) => mount.data.headline === 'state-2')!;
    expect(prepared.setOnAir).not.toHaveBeenCalled();
    expect(prepared.fireLifecycle).not.toHaveBeenCalled();
    expect(prepared.render).not.toHaveBeenCalled();
    expect(graphic.getPlayoutSnapshot()).toMatchObject({
      prepared: {},
      slots: { main: { current: null, pending: null, transition: null } },
    });
    const allocations = mock.mounts.length;
    await tick(37);
    expect((await cachedTake(graphic, 'state-2')).statusCode).toBe(200);
    expect(mock.mounts).toHaveLength(allocations);
    expect(prepared.prepareForTake).toHaveBeenCalledWith(37, undefined);
    expect(prepared.startFrame).toBe(37);
    expect(prepared.setOnAir).toHaveBeenCalledWith(true, 37);
    expect(graphic.getPreparationCacheSnapshot().hits).toBe(1);
    prepared.ruleDataChanged!({ headline: 'Changed by adopted rule' }, 38);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe(
      'Changed by adopted rule',
    );
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.requestId).toBe(
      prepared.host.dataset.ografTransitionSnapshot,
    );
    prepared.scheduleRule!({
      id: 'adopted-rule-clear',
      frame: 40,
      data: {},
      run: () => [{ type: 'playout', operation: 'clear', slotId: 'main' }],
    });
    await tick(39);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.stateId).toBe('state-2');
    await tick(40);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
  });

  it('never turns discarded active snapshots into reusable prepared instances', async () => {
    const { graphic, idle } = await cachedGraphic();
    await idle.drain();
    await cachedTake(graphic, 'state-0');
    const active = visible()[0]!;
    await cachedTake(graphic, 'state-1');
    expect(active.disposed).toBe(true);
    await idle.drain();
    const pristine = mock.mounts.find(
      (mount) => !mount.disposed && mount !== active && mount.data.headline === 'state-0',
    )!;
    expect(pristine).toBeDefined();
    await cachedTake(graphic, 'state-0');
    expect(pristine.prepareForTake).toHaveBeenCalledOnce();
    expect(active.prepareForTake).toHaveBeenCalledOnce();
    expect(active.disposed).toBe(true);
    expect(visible().includes(pristine)).toBe(true);
  });

  it('defers warmup when the available idle interval is too short', async () => {
    const { graphic, idle } = await cachedGraphic();
    expect(idle.callbacks.size).toBe(1);
    await idle.next(0);
    expect(mock.mounts).toHaveLength(0);
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(0);
    expect(idle.callbacks.size).toBe(1);
    await idle.next();
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(1);
  });

  it('reuses dormant shared probes while retaining the canonical on-air component', async () => {
    const value = descriptor();
    value.dataDefaults = {
      slots: { main: { stateId: null, data: {} }, ticker: { stateId: null, data: {} } },
    };
    const { graphic, idle } = await cachedGraphic(value);
    const canonical = shared();
    await idle.drain();
    const probe = mock.mounts.find(
      (mount) => mount !== canonical && mount.data.panelHeadline === 'headline',
    )!;
    expect(probe).toBeDefined();
    expect(probe.setOnAir).not.toHaveBeenCalled();
    expect(probe.fireLifecycle).not.toHaveBeenCalled();
    const allocations = mock.mounts.length;
    expect((await cachedTake(graphic, 'headline')).statusCode).toBe(200);
    // The request owns a lightweight local snapshot, while shared resources use the probe.
    expect(mock.mounts).toHaveLength(allocations + 1);
    expect(shared()).toBe(canonical);
    expect(probe.disposed).toBe(false);
    expect(graphic.getPreparationCacheSnapshot().hits).toBe(1);
    expect(
      (
        await graphic.customAction({
          id: 'transition.out',
          payload: { slotId: 'main' },
          skipAnimation: true,
        })
      ).statusCode,
    ).toBe(200);
    expect((await cachedTake(graphic, 'headline')).statusCode).toBe(200);
    expect(graphic.getPreparationCacheSnapshot().hits).toBe(2);
    expect(shared()).toBe(canonical);
    expect(probe.disposed).toBe(false);
    expect(probe.setOnAir).not.toHaveBeenCalled();
    expect(canonical.setOnAir).toHaveBeenCalledWith(true, 0);
  });

  it('does not return a pending shared probe from the old document after adoption', async () => {
    const value = descriptor();
    value.dataDefaults = {
      slots: { main: { stateId: null, data: {} }, ticker: { stateId: null, data: {} } },
    };
    const { graphic, idle } = await cachedGraphic(value);
    await idle.drain();
    const probe = mock.mounts.find((mount) => mount.data.panelHeadline === 'headline')!;
    const completion = pending();
    probe.waitReady.mockImplementationOnce(() => completion.promise);
    expect((await cachedTake(graphic, 'headline')).statusCode).toBe(200);
    graphic.adoptedCallback();
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(0);
    completion.resolve();
    await flush();
    expect(probe.disposed).toBe(true);
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(0);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.stateId).toBe('headline');
  });

  it('fits the entire wanted pool within both count and byte budgets without repeated eviction', async () => {
    const { graphic, idle } = await cachedGraphic(source(8, 3000, 2400));
    await idle.drain();
    const stats = graphic.getPreparationCacheSnapshot();
    expect(stats.entries).toBeGreaterThan(0);
    expect(stats.entries).toBeLessThanOrEqual(stats.maxEntries);
    expect(stats.estimatedBytes).toBeLessThanOrEqual(stats.maxEstimatedBytes);
    expect(stats.evictions).toBe(0);
    expect(mock.mounts).toHaveLength(stats.entries);
    const allocations = mock.mounts.length;
    await tick(50);
    await idle.drain();
    expect(mock.mounts).toHaveLength(allocations);
  });

  it('keeps edited Off-lane data out of stale cached defaults and adopts the latest prepared values', async () => {
    const { graphic, idle } = await cachedGraphic();
    await idle.drain();
    const stale = mock.mounts.find((mount) => mount.data.headline === 'state-1')!;
    expect(
      (
        await graphic.updateAction({
          data: {
            slots: { main: { stateId: 'state-1', data: { headline: 'Latest operator value' } } },
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    await idle.drain();
    expect(stale.disposed).toBe(true);
    const fresh = mock.mounts.find((mount) => mount.data.headline === 'Latest operator value')!;
    expect(fresh.setOnAir).not.toHaveBeenCalled();
    expect((await cachedTake(graphic, 'state-1')).statusCode).toBe(200);
    expect(fresh.prepareForTake).toHaveBeenCalledOnce();
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe(
      'Latest operator value',
    );
  });

  it('drops a failed speculative resource without failing on-air playout', async () => {
    const value = source();
    value.templates[0]!.dataDefaults = { headline: 'state-0', resource: 'failed-warm' };
    const failed = pending();
    mock.readiness.set('failed-warm', failed.promise);
    const { graphic, idle } = await cachedGraphic(value);
    await idle.next();
    const candidate = mock.mounts.find((mount) => mount.data.resource === 'failed-warm')!;
    expect(graphic.getPreparationCacheSnapshot().preparing).toBe(true);
    failed.reject(new Error('Speculative resource unavailable'));
    await flush();
    await idle.drain();
    expect(candidate.disposed).toBe(true);
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(3);
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
    expect((await cachedTake(graphic, 'state-1')).statusCode).toBe(200);
  });

  it('rejects stale warming after edits, Clear, reload, document adoption and disposal', async () => {
    const value = source();
    value.templates[0]!.dataDefaults = { headline: 'state-0', resource: 'pending-warm' };
    const resource = pending();
    mock.readiness.set('pending-warm', resource.promise);
    const { graphic, idle } = await cachedGraphic(value);
    await idle.next();
    const stale = mock.mounts[0]!;
    expect(graphic.getPreparationCacheSnapshot().preparing).toBe(true);
    await graphic.updateAction({ data: { slots: { main: { stateId: 'state-1' } } } });
    expect(stale.disposed).toBe(true);
    resource.resolve();
    await flush();
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(0);
    await graphic.customAction({ id: 'transition.clear', payload: {} });
    await idle.drain();
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    const old = mock.mounts.filter((mount) => !mount.disposed);
    graphic.adoptedCallback();
    expect(old.every((mount) => mount.disposed)).toBe(true);
    expect(graphic.getPreparationCacheSnapshot().entries).toBe(0);
    expect(
      await graphic.load({ renderType: 'realtime', renderCharacteristics: {}, data: {} }),
    ).toEqual({
      statusCode: 200,
    });
    await idle.drain();
    expect(graphic.getPreparationCacheSnapshot().entries).toBeGreaterThan(0);
    await graphic.dispose();
    expect(graphic.getPreparationCacheSnapshot()).toMatchObject({
      enabled: false,
      entries: 0,
      preparing: false,
    });
    expect(idle.callbacks.size).toBe(0);
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
  });

  it('keeps speculative preparation disabled for deterministic schedule rendering', async () => {
    const { graphic, idle } = await cachedGraphic(source(), 'non-realtime');
    await tick(50);
    expect(idle.owner.requestIdleCallback).not.toHaveBeenCalled();
    expect(graphic.getPreparationCacheSnapshot()).toMatchObject({ entries: 0, enabled: false });
    expect((await cachedTake(graphic, 'state-0')).statusCode).toBe(200);
    expect(graphic.getPreparationCacheSnapshot().hits).toBe(0);
  });
});

describe('exported coordinated field exposure', () => {
  function source() {
    const value = descriptor();
    for (const template of value.templates) {
      template.descriptor = {
        ...template.descriptor,
        dataExposure: { gain: { exposed: false, defaultValue: 0.4 } },
        dataDefaults: { gain: 0.4 },
        customActions: [{ id: 'probe', name: 'Probe', durationFrames: 0 }],
      };
    }
    return value;
  }

  async function exported(renderType: LoadParams['renderType']) {
    class Exported extends CoordinatedGraphicElement {
      static transitionDescriptor = source();
      protected resolveExternalTemplateData(
        templateId: string,
        data: Record<string, unknown>,
        current: Record<string, unknown>,
      ) {
        return this.filterPublicTemplateData(templateId, data, current);
      }
    }
    const graphic = new Exported();
    instances.push(graphic);
    expect(
      await graphic.load({
        renderType,
        renderCharacteristics: {},
        data: {
          slots: { main: { stateId: 'headline', data: { gain: 9, headline: 'Load headline' } } },
        },
      }),
    ).toEqual({ statusCode: 200 });
    return graphic;
  }

  it('blocks load/update/take/custom field writes while preserving internal Rules data', async () => {
    const graphic = await exported('realtime');
    expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data).toMatchObject({
      gain: 0.4,
      headline: 'Load headline',
    });
    let local = visible().find((mount) => mount.host.dataset.ografTransitionState === 'headline')!;
    expect(local.data).toMatchObject({ gain: 0.4, headline: 'Load headline' });
    expect(
      await graphic.updateAction({
        data: { slots: { main: { data: { gain: 8, headline: 'Public update' } } } },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    local = visible().find((mount) => mount.host.dataset.ografTransitionState === 'headline')!;
    expect(local.data).toMatchObject({ gain: 0.4, headline: 'Public update' });
    local.ruleDataChanged!({ gain: 1.6 }, 2);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.gain).toBe(1.6);
    expect(
      await graphic.customAction({
        id: 'transition.patch',
        payload: { slotId: 'main', data: { gain: 99, headline: 'Patched public' } },
      }),
    ).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data).toMatchObject({
      gain: 1.6,
      headline: 'Patched public',
    });
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: {
          slotId: 'main',
          actionId: 'probe',
          data: { gain: 7, headline: 'Custom public' },
        },
        skipAnimation: true,
      }),
    ).toEqual({ statusCode: 200 });
    expect(local.data).toMatchObject({ gain: 1.6, headline: 'Custom public' });
    expect(local.customAction).toHaveBeenCalledWith('probe', 0, true);
    expect(await take(graphic, 'headline', { gain: 6, headline: 'Taken public' }, true)).toEqual({
      statusCode: 200,
    });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data).toMatchObject({
      gain: 1.6,
      headline: 'Taken public',
    });
  });

  it('enforces hidden-field policy during deterministic schedules and backward replay', async () => {
    const graphic = await exported('non-realtime');
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
          {
            timestamp: 100,
            action: {
              type: 'updateAction',
              params: {
                data: { slots: { main: { data: { gain: 8, headline: 'Updated' } } } },
                skipAnimation: true,
              },
            },
          },
          {
            timestamp: 200,
            action: {
              type: 'customAction',
              params: {
                id: 'template.action',
                payload: {
                  slotId: 'main',
                  actionId: 'probe',
                  data: { gain: 7, headline: 'Custom' },
                },
                skipAnimation: true,
              },
            },
          },
          {
            timestamp: 300,
            action: {
              type: 'customAction',
              params: {
                id: 'transition.take',
                payload: {
                  slotId: 'main',
                  stateId: 'headline',
                  data: { gain: 6, headline: 'Taken' },
                },
                skipAnimation: true,
              },
            },
          },
        ],
      }),
    ).toEqual({ statusCode: 200 });
    for (const [timestamp, headline] of [
      [50, 'Load headline'],
      [150, 'Updated'],
      [250, 'Custom'],
      [350, 'Taken'],
      [50, 'Load headline'],
      [350, 'Taken'],
    ] as const) {
      expect(await graphic.goToTime({ timestamp })).toEqual({ statusCode: 200 });
      expect(graphic.getPlayoutSnapshot().slots.main!.current?.data).toMatchObject({
        gain: 0.4,
        headline,
      });
      expect(
        visible().find((mount) => mount.host.dataset.ografTransitionState === 'headline')!.data,
      ).toMatchObject({ gain: 0.4, headline });
    }
  });
});

function dependentDescriptor() {
  const value = descriptor();
  value.definition.slots.find((slot) => slot.id === 'ticker')!.parentSlotId = 'main';
  value.definition.slots.push({ id: 'bug', name: 'Independent bug', order: 2 });
  value.definition.states.push({ id: 'bug', name: 'Bug', slotId: 'bug', templateId: 'ticker' });
  return value;
}
const outMain = (graphic: CoordinatedGraphicElement, skipAnimation = false) =>
  graphic.customAction({ id: 'transition.out', payload: { slotId: 'main' }, skipAnimation });
const slotTake = (
  graphic: CoordinatedGraphicElement,
  slotId: string,
  stateId: string,
  skipAnimation = true,
  data = {},
) =>
  graphic.customAction({
    id: 'transition.take',
    payload: { slotId, stateId, data },
    skipAnimation,
  });

describe('coordinated template custom actions', () => {
  function sourceWithActions() {
    const value = descriptor();
    value.templates.find((entry) => entry.id === 'headline')!.descriptor = {
      ...compiled,
      customActions: [{ id: 'show_ad', name: 'Show Ad', durationFrames: 20 }],
    };
    return value;
  }

  it('targets only the active template and its retained shared hosts without replacing them', async () => {
    const graphic = await create('realtime', sourceWithActions());
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', {}, true);
    const count = mock.mounts.length;
    const local = visible().find(
      (mount) => mount.host.dataset.ografTransitionState === 'headline',
    )!;
    const unrelated = visible().find(
      (mount) => mount.host.dataset.ografTransitionState === 'ticker',
    )!;
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: 'show_ad', data: { headline: 'Updated' } },
      }),
    ).toEqual({ statusCode: 200 });
    expect(mock.mounts).toHaveLength(count);
    expect(local.data.headline).toBe('Updated');
    expect(shared().data.panelHeadline).toBe('Updated');
    expect(local.customAction).toHaveBeenCalledWith('show_ad', 0, false);
    expect(shared().customAction).toHaveBeenCalledWith('show_ad', 0, false);
    expect(unrelated.customAction).not.toHaveBeenCalled();
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe('Updated');
    expect(graphic.getRecordedActions().at(-1)?.action).toMatchObject({
      type: 'customAction',
      params: { id: 'template.action' },
    });
  });

  it('commits local and bound shared rule data to the current selection without losing its request', async () => {
    const graphic = await create('realtime', sourceWithActions());
    await take(graphic, 'headline', {}, true);
    const current = graphic.getPlayoutSnapshot().slots.main!.current!;
    const local = visible()[0]!;
    local.ruleDataChanged!({ advertising: true }, 3);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toMatchObject({
      requestId: current.requestId,
      data: { advertising: true },
    });
    shared().ruleDataChanged!({ panelHeadline: 'From shared Rules' }, 4);
    expect(local.data.headline).toBe('From shared Rules');
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toMatchObject({
      requestId: current.requestId,
      data: { headline: 'From shared Rules', advertising: true },
    });
    expect(graphic.getPlayoutSnapshot().slots.main!.transition).toBeNull();
  });

  it('rejects Off lanes, unknown actions and malformed payloads without poisoning playout', async () => {
    const graphic = await create('realtime', sourceWithActions());
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: 'show_ad' },
      }),
    ).toMatchObject({ statusCode: 550, statusMessage: expect.stringContaining('Off or leaving') });
    await take(graphic, 'headline', {}, true);
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: 'missing' },
      }),
    ).toMatchObject({
      statusCode: 550,
      statusMessage: expect.stringContaining('Unknown template custom action'),
    });
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: 'show_ad', extra: 1 },
      }),
    ).toMatchObject({ statusCode: 550 });
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: 'show_ad' },
      }),
    ).toEqual({ statusCode: 200 });
  });

  it('records and replays template actions at deterministic scheduled frames', async () => {
    const graphic = await create('non-realtime', sourceWithActions());
    await graphic.setActionsSchedule({
      schedule: [
        {
          timestamp: 0,
          action: {
            type: 'customAction',
            params: {
              id: 'transition.take',
              payload: { slotId: 'main', stateId: 'headline' },
              skipAnimation: true,
            },
          },
        },
        {
          timestamp: 200,
          action: {
            type: 'customAction',
            params: {
              id: 'template.action',
              payload: { slotId: 'main', actionId: 'show_ad', data: { headline: 'Ad ready' } },
            },
          },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 500 })).toEqual({ statusCode: 200 });
    expect(visible()[0]!.customAction).toHaveBeenCalledWith('show_ad', 10, false);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe('Ad ready');
    expect(await graphic.goToTime({ timestamp: 100 })).toEqual({ statusCode: 200 });
    expect(visible()[0]!.customAction).not.toHaveBeenCalled();
    expect(await graphic.goToTime({ timestamp: 500 })).toEqual({ statusCode: 200 });
    expect(visible()[0]!.customAction).toHaveBeenCalledWith('show_ad', 10, false);
  });

  it('bounds local set-data/custom-action chains with the existing causal cycle guard', async () => {
    const graphic = await create('realtime', sourceWithActions());
    await take(graphic, 'headline', {}, true);
    const local = visible()[0]!;
    const work: TransitionLogicRuleWork = {
      id: 'local-cycle',
      frame: 0,
      data: {},
      run: () => {
        local.scheduleRule!(work);
        return [];
      },
    };
    local.scheduleRule!(work);
    await flush();
    expect(graphic.getPlayoutSnapshot().error).toContain('Rules playout cycle stopped');
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: 'show_ad' },
      }),
    ).toMatchObject({ statusCode: 550 });
  });

  it('ignores a released snapshot data callback after Clear instead of restoring its state', async () => {
    const graphic = await create('realtime', sourceWithActions());
    await take(graphic, 'headline', {}, true);
    const local = visible()[0]!;
    await graphic.customAction({ id: 'transition.clear', payload: { slotId: 'main' } });
    local.ruleDataChanged!({ advertising: true }, 5);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.main!.desired).toBeNull();
  });
});

describe('coordinated timer action routing', () => {
  function timerSource(withProxy = true, secondInstance = false) {
    const value = descriptor();
    const timer = (id: string): CompiledGraphicDescriptor['layers'][number] => ({
      id,
      isVisible: true,
      element: createTextElement({
        clock: normalizeClockTimerSettings({ mode: 'count-up', autoStart: false }),
      }),
      effects: createLayerEffects(),
      bindings: [],
      keyframes: [],
      animationTracks: {},
    });
    const source = { ...compiled, layers: [timer('source-clock')] };
    value.sharedInstances[0]!.descriptor = source;
    for (const state of value.definition.states)
      for (const shared of state.sharedValues ?? []) shared.sourceLayerId = 'source-clock';
    for (const shared of value.definition.initialSharedValues)
      shared.sourceLayerId = 'source-clock';
    for (const template of value.templates.filter((entry) => entry.id !== 'ticker')) {
      template.descriptor = {
        ...compiled,
        layers: withProxy ? [timer('proxy-clock')] : [],
        customActions: withProxy
          ? [
              {
                id: clockTimerActionId('proxy-clock', 'start'),
                name: 'Timer start',
                durationFrames: 0,
              },
            ]
          : [],
      };
      template.sharedLayers = withProxy
        ? [{ layerId: 'proxy-clock', instanceId: 'panel', sourceLayerId: 'source-clock' }]
        : [];
    }
    if (secondInstance) {
      value.definition.sharedInstances.push({
        ...value.definition.sharedInstances[0]!,
        id: 'panel-two',
        continuityKey: 'panel-two',
      });
      value.sharedInstances.push({ id: 'panel-two', descriptor: source, dataDefaults: {} });
      value.definition.initialSharedValues.push({
        instanceId: 'panel-two',
        sourceLayerId: 'source-clock',
        property: 'opacity',
        value: 0,
      });
      for (const state of value.definition.states.filter((entry) => entry.slotId === 'main'))
        (state.sharedValues ??= []).push({
          instanceId: 'panel-two',
          sourceLayerId: 'source-clock',
          property: 'opacity',
          value: 1,
        });
      for (const template of value.templates.filter((entry) => entry.id !== 'ticker'))
        template.sharedDataBindings.push({ instanceId: 'panel-two', fields: {} });
    }
    return value;
  }

  it('remaps a public component proxy timer action to its retained source without changing another lane', async () => {
    const graphic = await create('realtime', timerSource());
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', {}, true);
    const unrelated = visible().find(
      (mount) => mount.host.dataset.ografTransitionState === 'ticker',
    )!;
    const id = clockTimerActionId('proxy-clock', 'start');
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: { slotId: 'main', actionId: id },
      }),
    ).toEqual({ statusCode: 200 });
    expect(shared().customAction).toHaveBeenCalledWith(
      clockTimerActionId('source-clock', 'start'),
      0,
      false,
    );
    expect(
      visible().find((mount) => mount.host.dataset.ografTransitionState === 'headline')!
        .customAction,
    ).toHaveBeenCalledWith(id, 0, false, false);
    expect(unrelated.customAction).not.toHaveBeenCalled();
  });

  it('targets a retained timer with its instance-qualified ID and rejects ambiguous source IDs', async () => {
    const graphic = await create('realtime', timerSource(false, true));
    await take(graphic, 'headline', {}, true);
    const other = mock.mounts.find(
      (mount) => mount.host.dataset.ografTransitionShared === 'panel-two',
    )!;
    const ambiguous = await graphic.customAction({
      id: 'template.action',
      payload: { slotId: 'main', actionId: clockTimerActionId('source-clock', 'start') },
    });
    expect(ambiguous).toMatchObject({
      statusCode: 550,
      statusMessage: expect.stringContaining('ambiguous'),
    });
    expect(shared().customAction).not.toHaveBeenCalled();
    expect(other.customAction).not.toHaveBeenCalled();
    expect(
      await graphic.customAction({
        id: 'template.action',
        payload: {
          slotId: 'main',
          actionId: clockTimerActionId(JSON.stringify(['panel-two', 'source-clock']), 'restart'),
        },
      }),
    ).toEqual({ statusCode: 200 });
    expect(other.customAction).toHaveBeenCalledWith(
      clockTimerActionId('source-clock', 'restart'),
      0,
      false,
    );
    expect(shared().customAction).not.toHaveBeenCalled();
  });

  it('replays shared timer routing at the scheduled frame after backward seeks', async () => {
    const graphic = await create('non-realtime', timerSource());
    const id = clockTimerActionId('proxy-clock', 'start');
    await graphic.setActionsSchedule({
      schedule: [
        {
          timestamp: 0,
          action: {
            type: 'customAction',
            params: {
              id: 'transition.take',
              payload: { slotId: 'main', stateId: 'headline' },
              skipAnimation: true,
            },
          },
        },
        {
          timestamp: 200,
          action: {
            type: 'customAction',
            params: { id: 'template.action', payload: { slotId: 'main', actionId: id } },
          },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 1000 })).toEqual({ statusCode: 200 });
    expect(shared().customAction).toHaveBeenCalledWith(
      clockTimerActionId('source-clock', 'start'),
      10,
      false,
    );
    expect(await graphic.goToTime({ timestamp: 100 })).toEqual({ statusCode: 200 });
    expect(shared().customAction).not.toHaveBeenCalled();
    expect(await graphic.goToTime({ timestamp: 1000 })).toEqual({ statusCode: 200 });
    expect(shared().customAction).toHaveBeenCalledWith(
      clockTimerActionId('source-clock', 'start'),
      10,
      false,
    );
  });
});

describe('independent loop commands', () => {
  it('routes discovered active groups without pausing the graphic clock or another lane', async () => {
    const graphic = await create();
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', {}, true);
    let paused = false;
    const control = vi.fn((action: string) => {
      if (action !== 'next') paused = action === 'pause';
      return true;
    });
    Object.assign(shared(), {
      getLoopGroups: () => [{ groupId: 'headlines', name: 'Headlines', paused }],
      controlLoop: control,
    });
    expect(graphic.getPlayoutSnapshot().loops).toEqual([
      { slotId: 'main', groupId: 'headlines', name: 'Headlines', paused: false },
    ]);
    expect(
      await graphic.customAction({
        id: 'loop.pause',
        payload: { slotId: 'main', groupId: 'headlines' },
      }),
    ).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().paused).toBe(false);
    expect(graphic.getPlayoutSnapshot().loops?.[0]?.paused).toBe(true);
    await tick(42);
    expect(graphic.getPlayoutSnapshot().slots.ticker?.current?.stateId).toBe('ticker');
    expect(
      await graphic.customAction({
        id: 'loop.next',
        payload: { slotId: 'main', groupId: 'headlines' },
      }),
    ).toEqual({ statusCode: 200 });
    expect(control).toHaveBeenLastCalledWith('next', 'headlines', 42);
    expect(
      await graphic.customAction({
        id: 'loop.resume',
        payload: { slotId: 'main', groupId: 'headlines' },
      }),
    ).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().loops?.[0]?.paused).toBe(false);
    expect(
      graphic
        .getRecordedActions()
        .filter(
          (entry) =>
            entry.action.type === 'customAction' &&
            (entry.action.params as { id: string }).id.startsWith('loop.'),
        ),
    ).toHaveLength(3);
    await outMain(graphic, true);
    expect(graphic.getPlayoutSnapshot().loops).toEqual([]);
    expect(
      await graphic.customAction({
        id: 'loop.pause',
        payload: { slotId: 'main', groupId: 'headlines' },
      }),
    ).toMatchObject({ statusCode: 550 });
  });

  it('rejects malformed transport actions before changing playout or accepting a schedule', async () => {
    const graphic = await create('non-realtime');
    const baseline = graphic.getPlayoutSnapshot();
    expect(
      await graphic.customAction({
        id: 'loop.pause',
        payload: { slotId: 'missing', groupId: 'x' },
      }),
    ).toMatchObject({ statusCode: 550 });
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          {
            timestamp: 0,
            action: {
              type: 'customAction',
              params: {
                id: 'loop.next',
                payload: { slotId: 'main', groupId: '', unexpected: true },
              },
            },
          },
        ],
      }),
    ).toMatchObject({ statusCode: 550 });
    expect(graphic.getPlayoutSnapshot()).toEqual(baseline);
  });
});

describe('dependent slot runtime lifecycle', () => {
  it('runs actual dependent exits, resets selection, retains editorial data, and leaves unrelated output on air', async () => {
    const graphic = await create('realtime', dependentDescriptor());
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', { headline: 'Retained optional content' }, true);
    await slotTake(graphic, 'bug', 'bug');
    const exiting = outMain(graphic);
    await flush();
    expect(graphic.getPlayoutSnapshot().slots.ticker!.transition).not.toBeNull();
    await tick(20);
    expect(await exiting).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.bug!.current?.stateId).toBe('bug');
    await take(graphic, 'headline', {}, true);
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
    await take(graphic, 'ticker', {}, true);
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current?.data.headline).toBe(
      'Retained optional content',
    );
  });
  it('waits for a slower dependent before completing parent Out or restarting the parent', async () => {
    const source = dependentDescriptor();
    source.definition.transitions.push({
      ...source.definition.transitions[0]!,
      id: 'slow',
      durationFrames: 40,
      outgoingFrames: 40,
    });
    source.definition.routes.push({
      id: 'slow-out',
      slotId: 'ticker',
      from: '*',
      to: null,
      transitionId: 'slow',
      priority: 0,
    });
    const graphic = await create('realtime', source);
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', {}, true);
    let completed = false;
    const exiting = outMain(graphic).then((result) => {
      completed = true;
      return result;
    });
    await flush();
    await tick(20);
    expect(completed).toBe(false);
    const returning = take(graphic, 'headline');
    await flush();
    expect(graphic.getPlayoutSnapshot().slots.main!.transition).toBeNull();
    const rejected = await take(graphic, 'ticker');
    expect(rejected.statusCode).toBe(550);
    await tick(40);
    expect(completed).toBe(true);
    expect(graphic.getPlayoutSnapshot().slots.main!.transition?.startFrame).toBe(40);
    await tick(60);
    expect((await returning).statusCode).toBe(200);
    expect((await exiting).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
  });
  it('invalidates staged preparation and stale asynchronous Takes on parent Clear', async () => {
    const graphic = await create('realtime', dependentDescriptor());
    await take(graphic, 'headline', {}, true);
    expect(
      (
        await graphic.prepareSlot({
          slotId: 'ticker',
          stateId: 'ticker',
          data: { headline: 'Prepared' },
        })
      ).statusCode,
    ).toBe(200);
    expect(Object.keys(graphic.getPlayoutSnapshot().prepared)).toContain('ticker');
    const resource = pending();
    mock.readiness.set('old', resource.promise);
    const stale = take(graphic, 'ticker', { resource: 'old' });
    await flush();
    expect(
      (await graphic.customAction({ id: 'transition.clear', payload: { slotId: 'main' } }))
        .statusCode,
    ).toBe(200);
    resource.resolve();
    await flush();
    expect((await stale).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().prepared).toEqual({});
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
    await take(graphic, 'headline', {}, true);
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
  });
  it('stages text updates during exit without reactivating a dependent', async () => {
    const graphic = await create('realtime', dependentDescriptor());
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', { headline: 'Before' }, true);
    const exiting = outMain(graphic);
    await flush();
    const update = graphic.updateAction({
      data: { slots: { ticker: { data: { headline: 'After' } } } },
    });
    await tick(20);
    expect((await exiting).statusCode).toBe(200);
    expect((await update).statusCode).toBe(200);
    await take(graphic, 'headline', {}, true);
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
    await take(graphic, 'ticker', {}, true);
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current?.data.headline).toBe('After');
  });
  it('replays cascaded Out and parent-only return deterministically from an exported schedule', async () => {
    const graphic = await create('non-realtime', dependentDescriptor());
    expect(
      (
        await graphic.setActionsSchedule({
          schedule: [
            {
              timestamp: 0,
              action: {
                type: 'customAction',
                params: { id: 'transition.take', payload: { slotId: 'main', stateId: 'headline' } },
              },
            },
            {
              timestamp: 500,
              action: {
                type: 'customAction',
                params: {
                  id: 'transition.take',
                  payload: { slotId: 'ticker', stateId: 'ticker', data: { headline: 'Optional' } },
                },
              },
            },
            {
              timestamp: 1000,
              action: {
                type: 'customAction',
                params: { id: 'transition.out', payload: { slotId: 'main' } },
              },
            },
            {
              timestamp: 1600,
              action: {
                type: 'customAction',
                params: { id: 'transition.take', payload: { slotId: 'main', stateId: 'headline' } },
              },
            },
          ],
        })
      ).statusCode,
    ).toBe(200);
    expect((await graphic.goToTime({ timestamp: 2200 })).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.stateId).toBe('headline');
    expect(graphic.getPlayoutSnapshot().slots.ticker!.current).toBeNull();
    const first = graphic.getPlayoutSnapshot();
    await graphic.goToTime({ timestamp: 700 });
    await graphic.goToTime({ timestamp: 2200 });
    expect(graphic.getPlayoutSnapshot()).toEqual(first);
  });
});

function takeoverDescriptor() {
  const value = descriptor();
  for (const [index, id] of ['subline', 'header', 'bug', 'locator', 'sidebar', 'alert'].entries())
    value.definition.slots.push({ id, name: id, order: index + 2 });
  for (const id of ['subline', 'header', 'bug', 'locator', 'sidebar'])
    value.definition.states.push({ id, name: id, slotId: id, templateId: 'ticker' });
  const breaking = value.definition.states.find((state) => state.id === 'breaking')!;
  breaking.slotId = 'alert';
  breaking.sharedValues = [];
  breaking.takeOutSlotIds = ['main', 'subline', 'header'];
  value.definition.transitions.push({
    ...value.definition.transitions[0]!,
    id: 'slow-out',
    durationFrames: 40,
    outgoingFrames: 40,
  });
  value.definition.routes.push({
    id: 'subline-out',
    slotId: 'subline',
    from: '*',
    to: null,
    transitionId: 'slow-out',
    priority: 0,
  });
  return value;
}

async function normalNews(graphic: CoordinatedGraphicElement) {
  await slotTake(graphic, 'main', 'headline', true, { headline: 'Retain headline' });
  for (const id of ['subline', 'header', 'bug', 'ticker', 'locator', 'sidebar'])
    expect((await slotTake(graphic, id, id, true, { headline: `Retain ${id}` })).statusCode).toBe(
      200,
    );
}

const breakingTake = (graphic: CoordinatedGraphicElement, skipAnimation = false, data = {}) =>
  slotTake(graphic, 'alert', 'breaking', skipAnimation, data);

describe('cross-lane takeover runtime', () => {
  it('accepts a prepared reciprocal headline during the Breaking exit barrier and never resurrects Breaking', async () => {
    const source = takeoverDescriptor();
    source.definition.states.find((state) => state.id === 'headline')!.takeOutSlotIds = ['alert'];
    const graphic = await create('realtime', source);
    await normalNews(graphic);
    const breaking = breakingTake(graphic);
    await flush();
    await tick(10);
    const normal = slotTake(graphic, 'main', 'headline', false, {
      headline: 'Latest normal headline',
    });
    await flush();
    await tick(80);
    expect((await normal).statusCode).toBe(200);
    expect((await breaking).statusCode).toBe(200);
    const slots = graphic.getPlayoutSnapshot().slots;
    expect(slots.main?.current?.data.headline).toBe('Latest normal headline');
    expect(slots.alert?.current).toBeNull();
    expect(slots.alert?.pending).toBeNull();
    for (const id of ['subline', 'header']) expect(slots[id]?.current).toBeNull();
    for (const id of ['bug', 'ticker', 'locator', 'sidebar'])
      expect(slots[id]?.current).not.toBeNull();
  });

  it('prepares Breaking before any Out, and a failed resource preserves all working graphics', async () => {
    const graphic = await create('realtime', takeoverDescriptor());
    await normalNews(graphic);
    const ready = pending();
    mock.readiness.set('breaking-resource', ready.promise);
    const taking = breakingTake(graphic, false, { resource: 'breaking-resource' });
    await flush();
    await tick(10);
    for (const id of ['main', 'subline', 'header', 'bug', 'ticker', 'locator', 'sidebar']) {
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).not.toBeNull();
      expect(graphic.getPlayoutSnapshot().slots[id]!.transition).toBeNull();
    }
    ready.reject(new Error('Breaking resource unavailable'));
    expect(await taking).toMatchObject({
      statusCode: 550,
      statusMessage: 'Breaking resource unavailable',
    });
    expect(graphic.getPlayoutSnapshot().slots.alert!.current).toBeNull();
    expect(visible()).toHaveLength(7);
  });

  it('waits for all authored Outs before Breaking enters, preserves other lanes, and never restores on Out', async () => {
    const graphic = await create('realtime', takeoverDescriptor());
    await normalNews(graphic);
    const unaffected = visible().filter((mount) =>
      ['bug', 'ticker', 'locator', 'sidebar'].includes(mount.host.dataset.ografTransitionState!),
    );
    const taking = breakingTake(graphic);
    await flush();
    expect(graphic.getPlayoutSnapshot().slots.alert!.transition).toBeNull();
    for (const id of ['main', 'subline', 'header'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.outgoing).not.toBeNull();
    await tick(20);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.subline!.transition).not.toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.alert!.transition).toBeNull();
    await tick(40);
    expect(graphic.getPlayoutSnapshot().slots.subline!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.alert!.transition?.startFrame).toBe(40);
    await tick(60);
    expect(await taking).toEqual({ statusCode: 200 });
    for (const mount of unaffected) {
      expect(mount.disposed).toBe(false);
      expect(mount.host.style.opacity).toBe('1');
    }
    const leaving = graphic.customAction({ id: 'transition.out', payload: { slotId: 'alert' } });
    await flush();
    await tick(80);
    expect(await leaving).toEqual({ statusCode: 200 });
    for (const id of ['main', 'subline', 'header', 'alert'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).toBeNull();
    await slotTake(graphic, 'main', 'headline');
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe('Retain headline');
    for (const id of ['subline', 'header'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).toBeNull();
  });

  it('cancels stale preparation, blocks target Takes during the barrier, and retains edited data', async () => {
    const graphic = await create('realtime', takeoverDescriptor());
    await normalNews(graphic);
    expect((await graphic.prepareSlot({ slotId: 'subline', stateId: 'subline' })).statusCode).toBe(
      200,
    );
    const delayed = pending();
    mock.readiness.set('stale-subline', delayed.promise);
    const stale = slotTake(graphic, 'subline', 'subline', false, {
      resource: 'stale-subline',
      headline: 'Retain pending edit',
    });
    await flush();
    const taking = breakingTake(graphic);
    await flush();
    expect(graphic.getPlayoutSnapshot().prepared).toEqual({});
    expect((await graphic.takePreparedSlot({ slotId: 'subline' })).statusCode).toBe(409);
    expect((await slotTake(graphic, 'header', 'header')).statusCode).toBe(550);
    const edit = graphic.updateAction({
      data: { slots: { header: { data: { headline: 'Retain while leaving' } } } },
    });
    delayed.resolve();
    await tick(40);
    await tick(60);
    expect((await taking).statusCode).toBe(200);
    expect((await stale).statusCode).toBe(200);
    expect((await edit).statusCode).toBe(200);
    await slotTake(graphic, 'subline', 'subline');
    expect(graphic.getPlayoutSnapshot().slots.subline!.current?.data.headline).toBe(
      'Retain pending edit',
    );
    await slotTake(graphic, 'header', 'header');
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.data.headline).toBe(
      'Retain while leaving',
    );
  });

  it('collapses the complete takeover barrier without moving unrelated lane clocks', async () => {
    const graphic = await create('realtime', takeoverDescriptor());
    await normalNews(graphic);
    const ticker = slotTake(graphic, 'ticker', 'ticker', false, { headline: 'New ticker' });
    await flush();
    await tick(5);
    expect((await breakingTake(graphic, true)).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().frame).toBe(5);
    expect(graphic.getPlayoutSnapshot().slots.alert!.current?.stateId).toBe('breaking');
    for (const id of ['main', 'subline', 'header'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.ticker!.transition?.progress).toBe(0.25);
    await tick(20);
    expect((await ticker).statusCode).toBe(200);
  });

  it('does not repeat takeover for an ordinary same-state data update', async () => {
    const graphic = await create('realtime', takeoverDescriptor());
    await normalNews(graphic);
    await breakingTake(graphic, true);
    await slotTake(graphic, 'main', 'headline');
    await breakingTake(graphic, true, { headline: 'Updated Breaking' });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.stateId).toBe('headline');
    expect(graphic.getPlayoutSnapshot().slots.alert!.current?.data.headline).toBe(
      'Updated Breaking',
    );
  });

  it('skips a queued takeover even when its barrier begins after an active transition settles', async () => {
    const source = takeoverDescriptor();
    source.definition.states.push({
      id: 'alert-teaser',
      name: 'Alert teaser',
      slotId: 'alert',
      templateId: 'breaking',
    });
    const graphic = await create('realtime', source);
    await normalNews(graphic);
    const teaser = slotTake(graphic, 'alert', 'alert-teaser', false);
    await flush();
    await tick(5);
    expect((await breakingTake(graphic, true)).statusCode).toBe(200);
    expect((await teaser).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().frame).toBe(5);
    expect(graphic.getPlayoutSnapshot().slots.alert!.current?.stateId).toBe('breaking');
    for (const id of ['main', 'subline', 'header'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).toBeNull();
  });

  it('uses prepared Breaking resources and repeated Takes retain only the latest incoming data', async () => {
    const graphic = await create('realtime', takeoverDescriptor());
    await normalNews(graphic);
    expect(
      (
        await graphic.prepareSlot({
          slotId: 'alert',
          stateId: 'breaking',
          data: { headline: 'Prepared Breaking' },
        })
      ).statusCode,
    ).toBe(200);
    const preparedMount = live().find((mount) => mount.data.headline === 'Prepared Breaking')!;
    const prepared = graphic.takePreparedSlot({ slotId: 'alert' });
    await flush();
    expect(graphic.getPlayoutSnapshot().slots.alert!.pending?.ready).toBe(true);
    const repeated = breakingTake(graphic, false, { headline: 'Latest Breaking' });
    await flush();
    await tick(40);
    expect(graphic.getPlayoutSnapshot().slots.alert!.transition?.startFrame).toBe(40);
    await tick(60);
    expect((await prepared).statusCode).toBe(200);
    expect((await repeated).statusCode).toBe(200);
    expect(preparedMount.disposed).toBe(true);
    expect(graphic.getPlayoutSnapshot().slots.alert!.current?.data.headline).toBe(
      'Latest Breaking',
    );
    expect(
      live().filter((mount) => mount.host.dataset.ografTransitionState === 'breaking'),
    ).toHaveLength(1);
  });

  it('Out and Clear cancel pending takeover without restoring outgoing normal graphics', async () => {
    for (const operation of ['transition.out', 'transition.clear']) {
      const graphic = await create('realtime', takeoverDescriptor());
      await normalNews(graphic);
      const taking = breakingTake(graphic);
      await flush();
      await tick(10);
      expect(
        (await graphic.customAction({ id: operation, payload: { slotId: 'alert' } })).statusCode,
      ).toBe(200);
      await tick(100);
      expect((await taking).statusCode).toBe(200);
      for (const id of ['main', 'subline', 'header', 'alert'])
        expect(graphic.getPlayoutSnapshot().slots[id]!.current).toBeNull();
      for (const id of ['bug', 'ticker', 'locator', 'sidebar'])
        expect(graphic.getPlayoutSnapshot().slots[id]!.current).not.toBeNull();
    }
  });

  it('records one Take command and replays the complete takeover and Out identically on seek', async () => {
    const source = takeoverDescriptor();
    const realtime = await create('realtime', source);
    await normalNews(realtime);
    await tick(50);
    const taking = breakingTake(realtime);
    await flush();
    await tick(90);
    await tick(110);
    expect((await taking).statusCode).toBe(200);
    const leaving = realtime.customAction({ id: 'transition.out', payload: { slotId: 'alert' } });
    await flush();
    await tick(130);
    expect((await leaving).statusCode).toBe(200);
    const schedule = realtime.getRecordedActions();
    expect(schedule.filter((entry) => entry.timestamp === 1000)).toHaveLength(1);
    expect(schedule.filter((entry) => entry.timestamp === 1000)[0]!.action.params).toMatchObject({
      id: 'transition.take',
      payload: { slotId: 'alert', stateId: 'breaking' },
    });
    const offline = await create('non-realtime', source);
    expect((await offline.setActionsSchedule({ schedule })).statusCode).toBe(200);
    expect((await offline.goToTime({ timestamp: 1300 })).statusCode).toBe(200);
    expect(offline.getPlayoutSnapshot().slots.alert!.transition).toBeNull();
    expect(offline.getPlayoutSnapshot().slots.alert!.pending?.stateId).toBe('breaking');
    expect((await offline.goToTime({ timestamp: 2600 })).statusCode).toBe(200);
    const ended = offline.getPlayoutSnapshot();
    for (const id of ['main', 'subline', 'header', 'alert'])
      expect(ended.slots[id]!.current).toBeNull();
    for (const id of ['bug', 'ticker', 'locator', 'sidebar'])
      expect(ended.slots[id]!.current).not.toBeNull();
    await offline.goToTime({ timestamp: 1800 });
    await offline.goToTime({ timestamp: 2600 });
    expect(offline.getPlayoutSnapshot()).toEqual(ended);
  });

  it('records a delayed barrier at its actual start boundary when realtime skips several frames', async () => {
    const source = takeoverDescriptor();
    source.definition.states.push({
      id: 'alert-teaser',
      name: 'Alert teaser',
      slotId: 'alert',
      templateId: 'breaking',
    });
    const graphic = await create('realtime', source);
    await normalNews(graphic);
    const teaser = slotTake(graphic, 'alert', 'alert-teaser', false);
    await flush();
    await tick(5);
    const taking = breakingTake(graphic);
    await flush();
    await tick(100);
    expect((await teaser).statusCode).toBe(200);
    expect((await taking).statusCode).toBe(200);
    const recorded = graphic
      .getRecordedActions()
      .filter(
        (entry) =>
          entry.action.type === 'customAction' &&
          (entry.action.params as { payload?: { stateId?: string } }).payload?.stateId ===
            'breaking',
      );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.timestamp).toBe(400);
    expect(graphic.getPlayoutSnapshot().slots.alert!.current?.stateId).toBe('breaking');
  });
});
afterEach(async () => {
  for (const graphic of instances.splice(0)) await graphic.dispose();
});

describe('coordinated hidden startup resources', () => {
  function startupSource() {
    const source = descriptor();
    source.definition.slots = [{ id: 'main', name: 'Main', order: 0 }];
    source.definition.states = source.definition.states.filter((state) =>
      ['headline', 'breaking'].includes(state.id),
    );
    for (const state of source.definition.states) delete state.sharedValues;
    source.definition.sharedInstances = [];
    source.definition.initialSharedValues = [];
    source.sharedInstances = [];
    source.templates = source.templates
      .filter((template) => ['headline', 'breaking'].includes(template.id))
      .map((template) => ({ ...template, sharedLayers: [], sharedDataBindings: [] }));
    return source;
  }

  it('prepares only selected local resources during Load and adopts them on first skipped Play', async () => {
    const graphic = await create('realtime', startupSource());
    const startup = live();
    expect(startup).toHaveLength(1);
    expect(startup[0]!.host.dataset.ografTransitionState).toBe('headline');
    expect(startup[0]!.host.style.visibility).toBe('hidden');
    expect(startup[0]!.host.style.opacity).toBe('0');
    expect(startup[0]!.waitReady).toHaveBeenCalledOnce();
    expect(startup[0]!.setOnAir).not.toHaveBeenCalled();
    expect(startup[0]!.fireLifecycle).not.toHaveBeenCalled();
    expect(graphic.getPlayoutSnapshot()).toMatchObject({
      prepared: {},
      slots: { main: { current: null, pending: null, transition: null } },
    });
    const count = mock.mounts.length;
    await tick(37);
    expect(startup[0]!.render).not.toHaveBeenCalled();
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    expect(mock.mounts).toHaveLength(count);
    expect(visible()).toEqual(startup);
    expect(startup[0]!.startFrame).toBe(37);
    expect(startup[0]!.setOnAir).toHaveBeenCalledWith(true, 37);
  });

  it('retains snapshot ownership for Rules data after adopting startup content', async () => {
    const graphic = await create('realtime', startupSource());
    const startup = live()[0]!;
    await graphic.playAction({ goto: 0, skipAnimation: true });
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.requestId).toBe(
      startup.host.dataset.ografTransitionSnapshot,
    );
    startup.ruleDataChanged!({ headline: 'Rule edited startup' }, 1);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.data.headline).toBe(
      'Rule edited startup',
    );
    const count = mock.mounts.length;
    await graphic.playAction({ goto: 0, skipAnimation: true });
    expect(mock.mounts).toHaveLength(count);
    expect(startup.data.headline).toBe('Rule edited startup');
  });

  it('keeps prepared resources through unchanged initial and empty data updates', async () => {
    const graphic = await create('realtime', startupSource());
    const startup = live()[0]!,
      count = mock.mounts.length;
    await graphic.updateAction({
      data: { slots: { main: { stateId: 'headline', data: { headline: 'headline' } } } },
    });
    await graphic.updateAction({ data: {} });
    await graphic.playAction({ skipAnimation: true });
    expect(mock.mounts).toHaveLength(count);
    expect(visible()).toEqual([startup]);
  });

  it('rechecks hidden draw readiness before committing the prepared Play', async () => {
    const graphic = await create('realtime', startupSource());
    const startup = live()[0]!,
      gate = pending();
    startup.waitReady.mockImplementation(() => gate.promise);
    const before = graphic.getPlayoutSnapshot();
    const play = graphic.playAction({ skipAnimation: true });
    await flush();
    await tick(5);
    expect(graphic.getPlayoutSnapshot().slots).toEqual(before.slots);
    expect(startup.setOnAir).not.toHaveBeenCalled();
    gate.reject(new Error('Prepared renderer draw failed'));
    expect(await play).toMatchObject({
      statusCode: 550,
      statusMessage: 'Prepared renderer draw failed',
    });
    expect(startup.disposed).toBe(true);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
  });

  it('does not turn conflicting initial controls into a new Load failure', async () => {
    const source = admissionDescriptor();
    source.dataDefaults = {
      slots: { main: { stateId: 'headline', data: {} }, alert: { stateId: 'breaking', data: {} } },
    };
    const graphic = await create('realtime', source);
    expect(live()).toHaveLength(0);
    const count = mock.mounts.length;
    expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({ statusCode: 550 });
    expect(mock.mounts).toHaveLength(count);
    expect(
      Object.values(graphic.getPlayoutSnapshot().slots).every(
        (slot) => slot.current === null && slot.pending === null,
      ),
    ).toBe(true);
  });

  it.each([
    ['data', { data: { headline: 'Edited while Off' } }, 'headline'],
    ['selector', { stateId: 'breaking', data: { headline: 'Edited while Off' } }, 'breaking'],
  ] as const)(
    'discards startup content after an Off %s edit',
    async (_label, selection, stateId) => {
      const graphic = await create('realtime', startupSource());
      const startup = live()[0]!;
      expect(await graphic.updateAction({ data: { slots: { main: selection } } })).toEqual({
        statusCode: 200,
      });
      expect(startup.disposed).toBe(true);
      expect(live()).toHaveLength(0);
      expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
      await graphic.playAction({ goto: 0, skipAnimation: true });
      expect(graphic.getPlayoutSnapshot().slots.main!.current).toMatchObject({
        stateId,
        data: { headline: 'Edited while Off' },
      });
      expect(visible()[0]).not.toBe(startup);
    },
  );

  it('releases a cleared startup and does not reuse activated mounts for a later Take', async () => {
    const graphic = await create('realtime', startupSource());
    const startup = live()[0]!;
    await graphic.customAction({ id: 'transition.clear', payload: {} });
    expect(startup.disposed).toBe(true);
    await graphic.playAction({ goto: 0, skipAnimation: true });
    const first = visible()[0]!;
    expect(first).not.toBe(startup);
    await graphic.stopAction({ skipAnimation: true });
    expect(first.disposed).toBe(true);
    await graphic.playAction({ goto: 0, skipAnimation: true });
    expect(visible()[0]).not.toBe(first);
  });

  it('keeps resource failures on Play and releases every failed hidden startup probe', async () => {
    const source = startupSource();
    source.templates[0]!.dataDefaults = { resource: 'startup-failure' };
    const gate = pending();
    mock.readiness.set('startup-failure', gate.promise);
    const loading = create('realtime', source);
    await flush();
    expect(mock.mounts).toHaveLength(1);
    expect(mock.mounts[0]!.host.style.visibility).toBe('hidden');
    expect(mock.mounts[0]!.setOnAir).not.toHaveBeenCalled();
    gate.reject(new Error('Startup texture unavailable'));
    const graphic = await loading;
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({
      statusCode: 550,
      statusMessage: 'Startup texture unavailable',
    });
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
    mock.readiness.delete('startup-failure');
    expect(await graphic.playAction({ skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
  });

  it('cancels pending startup preparation on disposal without revealing late resources', async () => {
    const source = startupSource();
    source.templates[0]!.dataDefaults = { resource: 'slow-startup' };
    const gate = pending();
    mock.readiness.set('slow-startup', gate.promise);
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = source;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    const loading = graphic.load({ renderType: 'realtime', renderCharacteristics: {} });
    await flush();
    expect(mock.mounts).toHaveLength(1);
    await graphic.dispose();
    expect(await loading).toMatchObject({ statusCode: 550 });
    gate.resolve();
    await flush();
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
    expect(mock.mounts.every((mount) => mount.setOnAir.mock.calls.length === 0)).toBe(true);
    expect(graphic.getPlayoutSnapshot().loaded).toBe(false);
  });

  it.each(['clear', 'stop'] as const)(
    'settles pending startup Load when %s cancels its hidden probes',
    async (command) => {
      const source = startupSource();
      source.templates[0]!.dataDefaults = { resource: 'cancel-startup' };
      const gate = pending();
      mock.readiness.set('cancel-startup', gate.promise);
      class Graphic extends CoordinatedGraphicElement {
        static transitionDescriptor = source;
      }
      const graphic = new Graphic();
      instances.push(graphic);
      const loading = graphic.load({ renderType: 'realtime', renderCharacteristics: {} });
      await flush();
      const startup = live()[0]!;
      expect(
        await (command === 'clear'
          ? graphic.customAction({ id: 'transition.clear', payload: {} })
          : graphic.stopAction({ skipAnimation: true })),
      ).toEqual({ statusCode: 200 });
      expect(await loading).toEqual({ statusCode: 200 });
      expect(startup.disposed).toBe(true);
      gate.resolve();
      await tick(10);
      expect(live()).toHaveLength(0);
      expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    },
  );

  it('adopts an in-progress startup only after readiness when Play overlaps Load', async () => {
    const source = startupSource();
    source.templates[0]!.dataDefaults = { resource: 'concurrent-startup' };
    const gate = pending();
    mock.readiness.set('concurrent-startup', gate.promise);
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = source;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    const loading = graphic.load({ renderType: 'realtime', renderCharacteristics: {} });
    await flush();
    const startup = live()[0]!,
      count = mock.mounts.length;
    const playing = graphic.playAction({ skipAnimation: true });
    await flush();
    expect(startup.setOnAir).not.toHaveBeenCalled();
    gate.resolve();
    expect(await loading).toEqual({ statusCode: 200 });
    expect(await playing).toEqual({ statusCode: 200, currentStep: 0 });
    expect(mock.mounts).toHaveLength(count);
    expect(visible()).toEqual([startup]);
  });

  it('keeps overlapping Play hidden through its second draw-readiness barrier after Load finishes', async () => {
    const source = startupSource();
    source.templates[0]!.dataDefaults = { resource: 'overlapping-draw-barrier' };
    const ready = pending(),
      draw = pending();
    mock.readiness.set('overlapping-draw-barrier', ready.promise);
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = source;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    const loading = graphic.load({ renderType: 'realtime', renderCharacteristics: {} });
    await flush();
    const startup = live()[0]!,
      count = mock.mounts.length;
    startup.waitReady
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => draw.promise);
    let completed = false;
    const playing = graphic.playAction({ skipAnimation: true }).then((result) => {
      completed = true;
      return result;
    });
    ready.resolve();
    expect(await loading).toEqual({ statusCode: 200 });
    await flush();
    expect(startup.waitReady).toHaveBeenCalledTimes(2);
    await tick(20);
    expect(completed).toBe(false);
    expect(startup.host.style.visibility).toBe('hidden');
    expect(startup.setOnAir).not.toHaveBeenCalled();
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    draw.resolve();
    expect(await playing).toEqual({ statusCode: 200, currentStep: 0 });
    expect(mock.mounts).toHaveLength(count);
    expect(startup.startFrame).toBe(20);
    expect(visible()).toEqual([startup]);
  });

  it('releases an older startup on reload and adopts only the replacement generation', async () => {
    const source = startupSource();
    source.templates[0]!.dataDefaults = { resource: 'old-startup' };
    const gate = pending();
    mock.readiness.set('old-startup', gate.promise);
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = source;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    const oldLoad = graphic.load({ renderType: 'realtime', renderCharacteristics: {} });
    await flush();
    const old = live()[0]!;
    Graphic.transitionDescriptor = startupSource();
    expect(await graphic.load({ renderType: 'realtime', renderCharacteristics: {} })).toEqual({
      statusCode: 200,
    });
    expect(await oldLoad).toMatchObject({ statusCode: 550 });
    gate.resolve();
    await flush();
    expect(old.disposed).toBe(true);
    const replacement = live()[0]!;
    await graphic.playAction({ skipAnimation: true });
    expect(visible()).toEqual([replacement]);
    expect(replacement.data.resource).toBeUndefined();
  });

  it('does not prepare realtime startup resources for non-realtime schedules', async () => {
    const graphic = await create('non-realtime', startupSource());
    expect(mock.mounts).toHaveLength(0);
    await graphic.setActionsSchedule({
      schedule: [{ timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } }],
    });
    await graphic.goToTime({ timestamp: 0 });
    expect(visible()).toHaveLength(1);
    await graphic.dispose();
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
  });
});

describe('coordinated realtime playout', () => {
  function contentAnimationSource() {
    const source = descriptor();
    source.definition.version = 5;
    const recipe = source.definition.transitions[0]!;
    recipe.incomingAnimation = { type: 'builtin', motion: { style: 'fly', direction: 'left' } };
    recipe.outgoingAnimation = { type: 'builtin', motion: { style: 'wipe', direction: 'right' } };
    const key = (frame: number, value: number) => ({
      id: String(frame),
      frame,
      value,
      easing: 'linear' as const,
    });
    const layer = {
      id: 'wrapper',
      element: createRectangleLayer().element,
      isVisible: true,
      effects: createLayerEffects(),
      bindings: [],
      keyframes: [
        {
          id: 'start',
          frame: 0,
          easing: 'linear' as const,
          transform: createDefaultTransform({ x: 0, y: 0, width: 1920, height: 1080 }),
        },
      ],
      animationTracks: {},
    };
    source.contentAnimations = {
      dissolve: {
        incoming: {
          durationFrames: 100,
          layer: { ...layer, animationTracks: { x: [key(0, -2000), key(100, 0)] } },
        },
        outgoing: {
          durationFrames: 100,
          layer: { ...layer, animationTracks: { clipRight: [key(100, 0), key(200, 1)] } },
        },
      },
    };
    return source;
  }

  it('plays independent wrapper presets without extra fades or changing retained shared morphs', async () => {
    const graphic = await create('realtime', contentAnimationSource());
    const panel = shared();
    const entering = take(graphic, 'headline');
    await flush();
    await tick(10);
    const content = visible()[0]!;
    expect(content.host.style.opacity).toBe('1');
    expect(content.host.style.transform).toBe('translate(-1000px, 0px) rotate(0deg) scale(1, 1)');
    expect(content.render.mock.lastCall?.[3]).toMatchObject({ phase: 'in', contentAtHold: true });
    expect(shared()).toBe(panel);
    expect(panel.host.style.transform).toBeUndefined();
    expect(panel.render.mock.lastCall?.[3].contentAtHold).toBeUndefined();
    expect(panel.render.mock.lastCall?.[1]).toContainEqual({
      instanceId: 'panel',
      sourceLayerId: 'backing',
      property: 'opacity',
      value: 0.5,
    });
    await tick(20);
    await entering;
    expect(content.host.style).toMatchObject({
      opacity: '1',
      transform: '',
      clipPath: '',
      filter: '',
    });
    const leaving = outMain(graphic);
    await flush();
    await tick(30);
    expect(content.host.style.opacity).toBe('1');
    expect(content.host.style.clipPath).toBe('inset(0% 50% 0% 0%)');
    expect(content.render.mock.lastCall?.[3]).toMatchObject({ phase: 'out', contentAtHold: true });
    await tick(40);
    await leaving;
    expect(content.disposed).toBe(true);
    expect(panel.host.style.visibility).toBe('hidden');
  });

  it('keeps same-instance edits at the on-air pose and crossfades data without replaying presets', async () => {
    const graphic = await create('realtime', contentAnimationSource());
    await take(graphic, 'headline', { headline: 'Before' }, true);
    const updating = take(graphic, 'headline', { headline: 'After' });
    await flush();
    await tick(10);
    expect(visible()).toHaveLength(2);
    for (const content of visible()) {
      expect(content.host.style.opacity).toBe('0.5');
      expect(content.host.style.transform).toBe('');
      expect(content.host.style.clipPath).toBe('');
      expect(content.render.mock.lastCall?.[3].phase).toBe('hold');
    }
    await tick(20);
    await updating;
  });

  it('gates delayed zero-duration presets as cuts without requiring baked tracks', async () => {
    const source = contentAnimationSource();
    source.definition.transitions[0]!.incomingFrames = 0;
    source.definition.transitions[0]!.incomingStartFrame = 5;
    source.definition.transitions[0]!.outgoingFrames = 0;
    delete source.contentAnimations;
    const graphic = await create('realtime', source);
    const entering = take(graphic, 'headline');
    await flush();
    await tick(4);
    expect(visible()).toHaveLength(0);
    await tick(5);
    expect(visible()[0]?.host.style).toMatchObject({ opacity: '1', transform: '', clipPath: '' });
    expect(visible()[0]?.render.mock.lastCall?.[3]).toMatchObject({ contentAtHold: true });
    await tick(20);
    await entering;
    const leaving = outMain(graphic);
    await flush();
    expect(visible()).toHaveLength(0);
    await tick(40);
    await leaving;
  });

  it('rejects a selected positive-duration preset whose baked artifact is absent', async () => {
    const source = contentAnimationSource();
    delete source.contentAnimations;
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = source;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    expect(
      await graphic.load({
        renderType: 'non-realtime',
        data: {},
        renderCharacteristics: { resolution: { width: 1920, height: 1080 }, frameRate: 50 },
      }),
    ).toMatchObject({
      statusCode: 550,
      statusMessage: expect.stringContaining('Missing compiled incoming animation'),
    });
  });

  it('uses explicit template animations without adding aggregate fades to content or shared objects', async () => {
    const source = descriptor();
    source.definition.version = 5;
    source.definition.transitions[0]!.incomingAnimation = { type: 'template' };
    source.definition.transitions[0]!.outgoingAnimation = { type: 'template' };
    const graphic = await create('realtime', source);
    const entering = take(graphic, 'headline');
    await flush();
    await tick(5);
    expect(visible()[0]!.host.style.opacity).toBe('1');
    expect(visible()[0]!.render.mock.lastCall?.[3].contentAtHold).toBeUndefined();
    expect(shared().host.style.opacity).toBe('1');
    expect(shared().render.mock.lastCall?.[1]).toContainEqual({
      instanceId: 'panel',
      sourceLayerId: 'backing',
      property: 'opacity',
      value: 1,
    });
    await tick(20);
    await entering;
    const leaving = outMain(graphic);
    await flush();
    await tick(25);
    expect(visible()[0]!.host.style.opacity).toBe('1');
    expect(shared().host.style.opacity).toBe('1');
    await tick(40);
    await leaving;
  });

  it('reproduces wrapper poses across backward and repeated non-realtime seeks', async () => {
    const graphic = await create('non-realtime', contentAnimationSource());
    const action = (
      timestamp: number,
      id: string,
      payload: Record<string, unknown>,
    ): ScheduledAction => ({
      timestamp,
      action: { type: 'customAction', params: { id, payload } },
    });
    await graphic.setActionsSchedule({
      schedule: [
        action(0, 'transition.take', { slotId: 'main', stateId: 'headline' }),
        action(600, 'transition.out', { slotId: 'main' }),
        action(1000, 'transition.take', { slotId: 'main', stateId: 'correspondent' }),
      ],
    });
    const snapshot = () =>
      visible().map((mount) => ({
        state: mount.host.dataset.ografTransitionState,
        style: { ...mount.host.style },
      }));
    await graphic.goToTime({ timestamp: 1200 });
    const reentered = snapshot();
    expect(reentered[0]?.style.transform).toBe('translate(-1000px, 0px) rotate(0deg) scale(1, 1)');
    await graphic.goToTime({ timestamp: 800 });
    expect(snapshot()[0]?.style.clipPath).toBe('inset(0% 50% 0% 0%)');
    await graphic.goToTime({ timestamp: 200 });
    expect(snapshot()[0]?.style.transform).toBe('translate(-1000px, 0px) rotate(0deg) scale(1, 1)');
    await graphic.goToTime({ timestamp: 1200 });
    expect(snapshot()).toEqual(reentered);
    await graphic.goToTime({ timestamp: 1200 });
    expect(snapshot()).toEqual(reentered);
  });

  it('plays authored layer tracks without an additional template or shared opacity fade', async () => {
    const source = descriptor();
    source.definition.transitions[0]!.contentMotion = 'authored';
    const graphic = await create('realtime', source);
    const entering = take(graphic, 'headline');
    await flush();
    await tick(5);
    expect(visible()[0]?.host.style.opacity).toBe('1');
    expect(shared().host.style.opacity).toBe('1');
    expect(shared().render.mock.lastCall?.[1]).toContainEqual({
      instanceId: 'panel',
      sourceLayerId: 'backing',
      property: 'opacity',
      value: 1,
    });
    await tick(20);
    await entering;
    const leaving = outMain(graphic);
    await flush();
    await tick(25);
    expect(visible()[0]?.host.style.opacity).toBe('1');
    expect(shared().host.style.opacity).toBe('1');
    expect(shared().render.mock.lastCall?.[1]).toContainEqual({
      instanceId: 'panel',
      sourceLayerId: 'backing',
      property: 'opacity',
      value: 1,
    });
    await tick(40);
    await leaving;
    expect(shared().host.style.visibility).toBe('hidden');
  });

  it('conceals the initial composition while asynchronous resources are loading', async () => {
    const ready = pending();
    mock.readiness.set('initial-font', ready.promise);
    const source = descriptor();
    source.sharedInstances[0]!.dataDefaults = { resource: 'initial-font' };
    const loading = create('realtime', source);
    await flush();
    const surface = instances.at(-1)!.shadowRoot?.children[0] as unknown as InstanceType<
      typeof mock.Host
    >;
    expect(surface.style.cssText).toContain('visibility:hidden');
    ready.resolve();
    await loading;
    expect(shared().host.style.visibility).toBe('hidden');
  });

  it('keeps every initial shared host hidden and avoids off-air frame/data work', async () => {
    const graphic = await create();
    const mount = shared();
    expect(mount.host.style.visibility).toBe('hidden');
    expect(mount.render).not.toHaveBeenCalled();
    const dataCalls = mount.setData.mock.calls.length;
    const onAirCalls = mount.setOnAir.mock.calls.length;
    for (const frame of [1, 2, 10, 50, 100]) await tick(frame);
    expect(mount.render).not.toHaveBeenCalled();
    expect(mount.setData).toHaveBeenCalledTimes(dataCalls);
    expect(mount.setOnAir).toHaveBeenCalledTimes(onAirCalls);
    expect(graphic.getPlayoutSnapshot().slots.main?.current).toBeNull();
  });

  it('uses stable shared-data snapshots while on air and skips repeated unchanged Takes', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'Stable headline' }, true);
    const mount = shared();
    const dataCalls = mount.setData.mock.calls.length;
    const mounts = mock.mounts.length;
    for (let frame = 1; frame <= 12; frame++) await tick(frame);
    expect(mount.setData).toHaveBeenCalledTimes(dataCalls);
    for (let count = 0; count < 12; count++)
      expect(await take(graphic, 'headline', { headline: 'Stable headline' }, true)).toEqual({
        statusCode: 200,
      });
    expect(mock.mounts).toHaveLength(mounts);
    expect(graphic.getPlayoutSnapshot().slots.main?.current?.data.headline).toBe('Stable headline');
    expect(mount.host.style.visibility).toBe('');
  });

  it('starts no transition when updateAction resends a lane unchanged', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'Stable', subline: 'Same' }, true);
    const onAir = visible();
    const mounts = mock.mounts.length;
    for (const data of [
      { headline: 'Stable', subline: 'Same' },
      // Hosts need not keep their fields in the order the lane first saw them.
      { subline: 'Same', headline: 'Stable' },
    ])
      expect(
        await graphic.updateAction({ data: { slots: { main: { stateId: 'headline', data } } } }),
      ).toEqual({ statusCode: 200 });
    expect(mock.mounts).toHaveLength(mounts);
    expect(visible()).toEqual(onAir);
  });

  it('reuses prepared shared resources when an active edit changes only plain text', async () => {
    const source = descriptor();
    source.sharedInstances[0]!.descriptor = {
      ...source.sharedInstances[0]!.descriptor,
      layers: [
        {
          id: 'backing',
          bindings: [{ dataKey: 'panelHeadline', targetProperty: 'content' }],
          element: createTextElement(),
          effects: createLayerEffects(),
          isVisible: true,
          keyframes: [],
          animationTracks: {},
        },
      ],
    };
    const graphic = await create('realtime', source);
    expect(await take(graphic, 'headline', { headline: 'Before' }, true)).toEqual({
      statusCode: 200,
    });
    const before = mock.mounts.length;
    await take(graphic, 'headline', { headline: 'After' }, true);
    expect(mock.mounts.length - before).toBe(1);
    expect(shared().data.panelHeadline).toBe('After');
  });

  it('waits for resource readiness and settles on the shared frame clock', async () => {
    const graphic = await create();
    const resource = pending();
    mock.readiness.set('image', resource.promise);
    let settled = false;
    const action = take(graphic, 'correspondent', { resource: 'image' }).then((result) => {
      settled = true;
      return result;
    });
    await tick(30);
    expect(visible()).toHaveLength(0);
    expect(settled).toBe(false);
    resource.resolve();
    await flush();
    await tick(40);
    expect(visible()[0]?.host.style.opacity).toBe('0.5');
    expect(settled).toBe(false);
    await tick(50);
    expect(await action).toEqual({ statusCode: 200 });
    expect(visible()[0]?.startFrame).toBe(30);
  });

  it('finishes the active transition and retains only the latest pending request', async () => {
    const graphic = await create();
    const first = take(graphic, 'correspondent', { headline: 'A' });
    await flush();
    await tick(5);
    const replaced = take(graphic, 'headline', { headline: 'B' });
    await flush();
    const latest = take(graphic, 'breaking', { headline: 'C' });
    await flush();
    expect(await replaced).toEqual({ statusCode: 200 });
    expect(live().map((mount) => mount.data.headline)).toEqual(['A', 'C']);
    await tick(20);
    expect(await first).toEqual({ statusCode: 200 });
    await tick(30);
    expect(visible().map((mount) => [mount.data.headline, mount.host.style.opacity])).toEqual([
      ['A', '0.5'],
      ['C', '0.5'],
    ]);
    await tick(40);
    expect(await latest).toEqual({ statusCode: 200 });
    expect(visible().map((mount) => mount.data.headline)).toEqual(['C']);
  });

  it('preserves the shared host and stages same-state data independently', async () => {
    const graphic = await create();
    const panel = shared();
    expect(await take(graphic, 'headline', { headline: 'Original' }, true)).toEqual({
      statusCode: 200,
    });
    const update = take(graphic, 'headline', { headline: 'Updated' });
    await flush();
    await tick(10);
    expect(visible().map((mount) => mount.data.headline)).toEqual(['Original', 'Updated']);
    expect(shared()).toBe(panel);
    expect(panel.data.panelHeadline).toBe('Updated');
    await tick(20);
    expect(await update).toEqual({ statusCode: 200 });
    expect(live()).toHaveLength(1);
  });

  it('clears pending preparation promptly and ignores stale resource completion', async () => {
    const graphic = await create();
    const resource = pending();
    mock.readiness.set('slow', resource.promise);
    const action = take(graphic, 'headline', { resource: 'slow' });
    await flush();
    expect(
      await graphic.customAction({ id: 'transition.clear', payload: { slotId: 'main' } }),
    ).toEqual({ statusCode: 200 });
    expect(await action).toEqual({ statusCode: 200 });
    resource.resolve();
    await tick(100);
    expect(live()).toHaveLength(0);
    expect(shared().data.panelHeadline).toBe('Default');
  });

  it('releases pending resource work on dispose and rejects its action', async () => {
    const graphic = await create();
    const resource = pending();
    mock.readiness.set('slow', resource.promise);
    const action = take(graphic, 'headline', { resource: 'slow' });
    await flush();
    expect(await graphic.dispose()).toEqual({ statusCode: 200 });
    expect(await action).toMatchObject({ statusCode: 550 });
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
    resource.resolve();
    await flush();
    expect(mock.mounts.every((mount) => mount.disposed)).toBe(true);
  });

  it('reports resource failure and leaves the previous content on air', async () => {
    const graphic = await create();
    await take(graphic, 'correspondent', { headline: 'Safe' }, true);
    const resource = pending();
    mock.readiness.set('broken', resource.promise);
    const action = take(graphic, 'breaking', { resource: 'broken' });
    await flush();
    resource.reject(new Error('Image missing'));
    expect(await action).toMatchObject({ statusCode: 550, statusMessage: 'Image missing' });
    expect(visible().map((mount) => mount.data.headline)).toEqual(['Safe']);
  });

  it('skipAnimation settles one slot without advancing another slot', async () => {
    const graphic = await create();
    const ticker = take(graphic, 'ticker');
    await flush();
    await tick(5);
    await take(graphic, 'headline', {}, true);
    expect(
      visible().find((mount) => mount.host.dataset.ografTransitionState === 'ticker')?.host.style
        .opacity,
    ).toBe('0.25');
    expect(
      visible().find((mount) => mount.host.dataset.ografTransitionState === 'headline')?.host.style
        .opacity,
    ).toBe('1');
    await tick(20);
    expect(await ticker).toEqual({ statusCode: 200 });
  });

  it('out removes only its own slot and hides the shared mount without sampling inactive content', async () => {
    const graphic = await create();
    await take(graphic, 'headline', {}, true);
    await take(graphic, 'ticker', {}, true);
    const out = graphic.customAction({ id: 'transition.out', payload: { slotId: 'main' } });
    await flush();
    await tick(20);
    expect(await out).toEqual({ statusCode: 200 });
    expect(visible().map((mount) => mount.host.dataset.ografTransitionState)).toEqual(['ticker']);
    expect(shared().host.style.visibility).toBe('hidden');
    const count = shared().render.mock.calls.length;
    await tick(100);
    expect(shared().render).toHaveBeenCalledTimes(count);
  });

  it('times out stalled resources and permits a later valid take', async () => {
    vi.useFakeTimers();
    try {
      const graphic = await create();
      mock.readiness.set('stalled', new Promise(() => {}));
      const action = take(graphic, 'headline', { resource: 'stalled' });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await action).toMatchObject({
        statusCode: 550,
        statusMessage: 'Graphic resources did not become ready within 30 seconds.',
      });
      expect(await take(graphic, 'breaking', {}, true)).toEqual({ statusCode: 200 });
      expect(visible().map((mount) => mount.host.dataset.ografTransitionState)).toEqual([
        'breaking',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects outstanding actions after a render failure and can reload cleanly', async () => {
    const graphic = await create();
    const action = take(graphic, 'headline');
    await flush();
    shared().render.mockImplementationOnce(() => {
      throw new Error('GPU unavailable');
    });
    await tick(5);
    expect(await action).toMatchObject({ statusCode: 550, statusMessage: 'GPU unavailable' });
    expect(await take(graphic, 'breaking', {}, true)).toMatchObject({ statusCode: 550 });
    expect(mock.players[0]?.disposed).toBe(true);
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 1920, height: 1080 }, frameRate: 50 },
        data: {},
      }),
    ).toEqual({ statusCode: 200 });
    expect(await take(graphic, 'breaking', {}, true)).toEqual({ statusCode: 200 });
  });
});

describe('coordinated offline schedules', () => {
  const custom = (timestamp: number, stateId: string, headline: string): ScheduledAction => ({
    timestamp,
    action: {
      type: 'customAction',
      params: { id: 'transition.take', payload: { slotId: 'main', stateId, data: { headline } } },
    },
  });
  const snapshot = () => ({
    content: visible().map((mount) => ({
      state: mount.host.dataset.ografTransitionState,
      data: mount.data,
      startFrame: mount.startFrame,
      opacity: mount.host.style.opacity,
    })),
    shared: shared().render.mock.lastCall?.[1] as TransitionLogicSharedValue[],
    sharedData: shared().data,
  });

  it('replays forward, backward and repeated seeks with identical snapshots', async () => {
    const graphic = await create('non-realtime');
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          custom(0, 'correspondent', 'A'),
          custom(600, 'headline', 'B'),
          custom(800, 'breaking', 'C'),
        ],
      }),
    ).toEqual({ statusCode: 200 });
    expect(await graphic.goToTime({ timestamp: 1300 })).toEqual({ statusCode: 200 });
    const end = snapshot();
    expect(end.content.map((entry) => entry.data.headline)).toEqual(['B', 'C']);
    expect(await graphic.goToTime({ timestamp: 200 })).toEqual({ statusCode: 200 });
    expect(snapshot().content).toMatchObject([{ state: 'correspondent', opacity: '0.5' }]);
    expect(await graphic.goToTime({ timestamp: 1300 })).toEqual({ statusCode: 200 });
    expect(snapshot()).toEqual(end);
    expect(await graphic.goToTime({ timestamp: 1300 })).toEqual({ statusCode: 200 });
    expect(snapshot()).toEqual(end);
  });

  it('retains the input order of simultaneous control and playout actions', async () => {
    const graphic = await create('non-realtime');
    await graphic.setActionsSchedule({
      schedule: [
        {
          timestamp: 0,
          action: {
            type: 'updateAction',
            params: {
              data: { slots: { main: { stateId: 'breaking', data: { headline: 'Before take' } } } },
            },
          },
        },
        { timestamp: 0, action: { type: 'playAction', params: { goto: 0 } } },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 400 })).toEqual({ statusCode: 200 });
    expect(
      visible().find((mount) => mount.host.dataset.ografTransitionState === 'breaking')?.data
        .headline,
    ).toBe('Before take');
  });

  it('starts pending shared timers at transition boundaries rather than the seek target', async () => {
    const graphic = await create('non-realtime');
    await graphic.setActionsSchedule({
      schedule: [custom(0, 'correspondent', 'A'), custom(100, 'headline', 'B')],
    });
    expect(await graphic.goToTime({ timestamp: 1000 })).toEqual({ statusCode: 200 });
    expect(shared().setOnAir.mock.calls).toContainEqual([true, 20]);
    expect(shared().setData.mock.calls).toContainEqual([{ panelHeadline: 'B' }, 20]);
    expect(visible().map((mount) => mount.startFrame)).toEqual([20]);
  });

  it('clears a scheduled slot, including its queued request', async () => {
    const graphic = await create('non-realtime');
    await graphic.setActionsSchedule({
      schedule: [
        custom(0, 'correspondent', 'A'),
        custom(100, 'breaking', 'B'),
        {
          timestamp: 200,
          action: {
            type: 'customAction',
            params: { id: 'transition.clear', payload: { slotId: 'main' } },
          },
        },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 1000 })).toEqual({ statusCode: 200 });
    expect(visible()).toHaveLength(0);
  });

  it('rejects invalid schedules without replacing the previous schedule', async () => {
    const graphic = await create('non-realtime');
    await graphic.setActionsSchedule({ schedule: [custom(0, 'headline', 'Valid')] });
    expect(
      await graphic.setActionsSchedule({ schedule: [custom(0, 'missing', 'Invalid')] }),
    ).toMatchObject({ statusCode: 550 });
    expect(await graphic.goToTime({ timestamp: 1000 })).toEqual({ statusCode: 200 });
    expect(visible().map((mount) => mount.data.headline)).toEqual(['Valid']);
  });

  it('rejects realtime scheduling and malformed data without poisoning playback', async () => {
    const graphic = await create();
    expect(await graphic.setActionsSchedule({ schedule: [] })).toMatchObject({ statusCode: 400 });
    expect(await graphic.goToTime({ timestamp: 0 })).toMatchObject({ statusCode: 400 });
    expect(await take(graphic, 'headline', { invalid: undefined }, true)).toMatchObject({
      statusCode: 550,
    });
    expect(await take(graphic, 'headline', { headline: 'Valid' }, true)).toEqual({
      statusCode: 200,
    });
  });
});

function admissionDescriptor() {
  const value = takeoverDescriptor();
  value.definition.version = 4;
  value.definition.states.find((state) => state.id === 'headline')!.takeOutSlotIds = ['alert'];
  for (const id of ['subline', 'header'])
    Object.assign(
      value.definition.slots.find((slot) => slot.id === id)!,
      {
        parentSlotId: 'main',
        admission: { requireOnSlotIds: ['main'], blockWhileActiveSlotIds: ['alert'] },
      },
    );
  return value;
}
describe('Take admission and completed dependency barriers', () => {
  it('rejects a ready queued Take when a conflicting lane is explicitly prepared later', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await slotTake(graphic, 'main', 'headline');
    const entering = slotTake(graphic, 'header', 'header', false);
    await flush();
    const queued = slotTake(graphic, 'header', 'header', false, { headline: 'Queued' });
    await flush();
    expect(graphic.getPlayoutSnapshot().slots.header!.pending?.ready).toBe(true);
    expect((await graphic.prepareSlot({ slotId: 'alert', stateId: 'breaking' })).statusCode).toBe(
      200,
    );
    expect(await queued).toMatchObject({
      statusCode: 550,
      statusMessage: expect.stringMatching(/alert must be fully Off/),
    });
    await tick(20);
    expect((await entering).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().slots.header!.pending).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.data.headline).not.toBe('Queued');
  });
  it('rechecks admission after asynchronous Take preparation without leaving a queued child', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await slotTake(graphic, 'main', 'headline');
    const resource = pending();
    mock.readiness.set('slow-child', resource.promise);
    const child = slotTake(graphic, 'header', 'header', false, { resource: 'slow-child' });
    await flush();
    expect((await graphic.prepareSlot({ slotId: 'alert', stateId: 'breaking' })).statusCode).toBe(
      200,
    );
    resource.resolve();
    expect(await child).toMatchObject({
      statusCode: 550,
      statusMessage: expect.stringMatching(/alert must be fully Off/),
    });
    expect(graphic.getPlayoutSnapshot().slots.header).toMatchObject({
      pending: null,
      current: null,
      readiness: 'failed',
    });
    await graphic.customAction({ id: 'transition.clear', payload: { slotId: 'alert' } });
    await tick(100);
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
  });
  it('rejects orphan and blocked Takes before controls, mount allocation, preparation or occupancy change', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    const initial = graphic.getPlayoutSnapshot();
    const count = mock.mounts.length;
    for (const id of ['header', 'subline']) {
      expect(await slotTake(graphic, id, id)).toMatchObject({
        statusCode: 550,
        statusMessage: expect.stringMatching(/must be On/),
      });
      expect(await graphic.prepareSlot({ slotId: id, stateId: id })).toMatchObject({
        statusCode: 550,
      });
    }
    expect(graphic.getPlayoutSnapshot()).toEqual(initial);
    expect(mock.mounts).toHaveLength(count);
    await slotTake(graphic, 'main', 'headline');
    for (const id of ['bug', 'ticker']) await slotTake(graphic, id, id);
    const resource = pending();
    mock.readiness.set('prepare-alert', resource.promise);
    const taking = breakingTake(graphic, false, { resource: 'prepare-alert' });
    await flush();
    const blocked = async () => {
      const before = graphic.getPlayoutSnapshot(),
        mounts = mock.mounts.length;
      for (const id of ['header', 'subline'])
        expect((await slotTake(graphic, id, id)).statusCode).toBe(550);
      expect(graphic.getPlayoutSnapshot()).toEqual(before);
      expect(mock.mounts).toHaveLength(mounts);
    };
    await blocked();
    resource.resolve();
    await flush();
    await blocked();
    await tick(20);
    await blocked();
    await tick(40);
    await taking;
    await blocked();
    const leaving = graphic.customAction({ id: 'transition.out', payload: { slotId: 'alert' } });
    await flush();
    await blocked();
    await tick(60);
    await leaving;
    await slotTake(graphic, 'main', 'headline');
    for (const id of ['header', 'subline'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).toBeNull();
    for (const id of ['bug', 'ticker'])
      expect(graphic.getPlayoutSnapshot().slots[id]!.current).not.toBeNull();
  });
  it('rechecks stale prepared Takes, blocks against explicit preparation, and Clear cancels it immediately', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await slotTake(graphic, 'main', 'headline');
    expect((await graphic.prepareSlot({ slotId: 'header', stateId: 'header' })).statusCode).toBe(
      200,
    );
    expect((await graphic.prepareSlot({ slotId: 'alert', stateId: 'breaking' })).statusCode).toBe(
      200,
    );
    const before = graphic.getPlayoutSnapshot();
    expect(await graphic.takePreparedSlot({ slotId: 'header' })).toMatchObject({
      statusCode: 550,
      statusMessage: expect.stringMatching(/alert must be fully Off/),
    });
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
    expect((await slotTake(graphic, 'subline', 'subline')).statusCode).toBe(550);
    expect((await graphic.customAction({ id: 'transition.clear', payload: {} })).statusCode).toBe(
      200,
    );
    expect(graphic.getPlayoutSnapshot().prepared).toEqual({});
    expect((await graphic.takePreparedSlot({ slotId: 'header' })).statusCode).toBe(409);
    await slotTake(graphic, 'main', 'headline');
    await slotTake(graphic, 'header', 'header');
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.stateId).toBe('header');
  });
  it('permits editing Off lanes but rejects a selected child whose parent is explicitly Off', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    expect(
      (
        await graphic.updateAction({
          data: {
            slots: {
              main: { stateId: null },
              header: { stateId: 'header', data: { headline: 'Next source' } },
            },
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    const before = graphic.getPlayoutSnapshot();
    expect((await graphic.playAction({})).statusCode).toBe(550);
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
  });
  it('returns Headline after orphan Takes from an old unguarded set without remaining Preparing', async () => {
    const source = takeoverDescriptor();
    source.definition.states.find((s) => s.id === 'headline')!.takeOutSlotIds = ['alert'];
    for (const id of ['header', 'subline'])
      source.definition.slots.find((s) => s.id === id)!.parentSlotId = 'main';
    const graphic = await create('realtime', source);
    for (const id of ['bug', 'ticker']) await slotTake(graphic, id, id);
    await breakingTake(graphic, true);
    for (const id of ['header', 'subline']) await slotTake(graphic, id, id);
    await graphic.customAction({
      id: 'transition.out',
      payload: { slotId: 'alert' },
      skipAnimation: true,
    });
    const returning = slotTake(graphic, 'main', 'headline', false);
    await flush();
    await tick(20);
    expect((await returning).statusCode).toBe(200);
    expect(graphic.getPlayoutSnapshot().slots.main!.current?.stateId).toBe('headline');
    expect(graphic.getPlayoutSnapshot().slots.main!.pending).toBeNull();
  });
  it('uses separate state presets for one template, while explicit and retained editorial values win', async () => {
    const source = takeoverDescriptor();
    source.definition.version = 4;
    source.definition.states.find((s) => s.id === 'header')!.dataDefaults = {
      headline: 'SOURCE',
      color: '#2676EF',
    };
    source.definition.states.push({
      id: 'developing',
      name: 'Developing',
      slotId: 'header',
      templateId: 'ticker',
      dataDefaults: { headline: 'DEVELOPING', color: '#D49B22' },
    });
    const graphic = await create('realtime', source);
    await slotTake(graphic, 'header', 'header');
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.data).toMatchObject({
      headline: 'SOURCE',
      color: '#2676EF',
    });
    await slotTake(graphic, 'header', 'developing');
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.data).toMatchObject({
      headline: 'DEVELOPING',
      color: '#D49B22',
    });
    await slotTake(graphic, 'header', 'developing', true, { headline: 'EDITED' });
    await graphic.customAction({
      id: 'transition.out',
      payload: { slotId: 'header' },
      skipAnimation: true,
    });
    await slotTake(graphic, 'header', 'header');
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.data.headline).toBe('SOURCE');
    await slotTake(graphic, 'header', 'developing');
    expect(graphic.getPlayoutSnapshot().slots.header!.current?.data).toMatchObject({
      headline: 'EDITED',
      color: '#D49B22',
    });
  });
});

describe('coordinated Play transactions and dependency stages', () => {
  const phase = (graphic: CoordinatedGraphicElement, id: string) => {
    const slot = graphic.getPlayoutSnapshot().slots[id]!;
    return slot.transition ? (slot.incoming ? 'entering' : 'leaving') : slot.current ? 'on' : 'off';
  };
  const normalData = {
    slots: {
      main: { stateId: 'headline' },
      subline: { stateId: 'subline' },
      header: { stateId: 'header' },
      alert: { stateId: null },
    },
  };
  async function selectNormal(graphic: CoordinatedGraphicElement, resource?: string) {
    expect(
      await graphic.updateAction({
        data: resource
          ? {
              ...normalData,
              slots: { ...normalData.slots, header: { stateId: 'header', data: { resource } } },
            }
          : normalData,
      }),
    ).toEqual({ statusCode: 200 });
  }
  async function settleWork() {
    for (let i = 0; i < 5; i++) await flush();
  }

  it('starts prerequisites first and awaits their On boundary before starting selected dependents', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    expect(phase(graphic, 'main')).toBe('entering');
    expect(graphic.getPlayoutSnapshot().slots.header!.pending).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.subline!.pending).toBeNull();
    await tick(19);
    await settleWork();
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    await tick(20);
    await settleWork();
    expect(phase(graphic, 'main')).toBe('on');
    expect(phase(graphic, 'header')).toBe('entering');
    expect(phase(graphic, 'subline')).toBe('entering');
    await tick(40);
    await settleWork();
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
    expect(phase(graphic, 'header')).toBe('on');
    expect(phase(graphic, 'subline')).toBe('on');
  });

  it('collapses the same dependency stages under skipAnimation without advancing the clock', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    expect(graphic.getPlayoutSnapshot().frame).toBe(0);
    for (const id of ['main', 'header', 'subline']) expect(phase(graphic, id)).toBe('on');
    const hosts = mock.mounts.filter((mount) => !mount.disposed);
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    expect(mock.mounts.filter((mount) => !mount.disposed)).toEqual(hosts);
  });

  it('keeps real-time dependency stages on their exact virtual boundaries when a frame is skipped', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    await tick(40);
    await settleWork();
    expect(phase(graphic, 'header')).toBe('on');
    expect(phase(graphic, 'subline')).toBe('on');
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
  });

  it('coalesces overlapping frame callbacks without rewinding or shifting child start times', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    const frames: number[] = [];
    const unsubscribe = graphic.subscribePlayout((snapshot) => frames.push(snapshot.frame));
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    for (const frame of [40, 60, 80])
      for (const player of mock.players) if (!player.disposed) player.renderFrame(frame);
    await settleWork();
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
    expect(graphic.getPlayoutSnapshot().frame).toBe(80);
    expect(frames.every((frame, index) => !index || frame >= frames[index - 1]!)).toBe(true);
    const childTake = graphic
      .getRecordedActions()
      .find(
        (entry) =>
          entry.action.type === 'customAction' &&
          (entry.action.params as { payload?: { slotId?: string } }).payload?.slotId === 'header',
      );
    expect(childTake?.timestamp).toBe(400);
    unsubscribe();
  });

  it('keeps a Clear authoritative while a skipped-frame barrier advance is pending', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    for (const player of mock.players) if (!player.disposed) player.renderFrame(40);
    const clear = graphic.customAction({ id: 'transition.clear', payload: {} });
    for (const player of mock.players) if (!player.disposed) player.renderFrame(80);
    expect(await clear).toEqual({ statusCode: 200 });
    await settleWork();
    expect(await play).toMatchObject({ statusCode: 409 });
    expect(graphic.getPlayoutSnapshot().frame).toBe(80);
    for (const id of ['main', 'header', 'subline']) expect(phase(graphic, id)).toBe('off');
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
  });

  it('rejects internally conflicting batches before changing working output, controls, or hosts', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    await graphic.playAction({ goto: 0, skipAnimation: true });
    await graphic.updateAction({ data: { slots: { alert: { stateId: 'breaking' } } } });
    const before = graphic.getPlayoutSnapshot(),
      hosts = mock.mounts.length;
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toMatchObject({
      statusCode: 550,
    });
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
    expect(mock.mounts).toHaveLength(hosts);
  });

  it('preserves every working lane if a later dependent resource fails before commit', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await slotTake(graphic, 'bug', 'bug');
    await selectNormal(graphic, 'broken-child');
    const failing = pending();
    mock.readiness.set('broken-child', failing.promise);
    const before = graphic.getPlayoutSnapshot();
    const play = graphic.playAction({ goto: 0, skipAnimation: true });
    await settleWork();
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
    failing.reject(new Error('Child texture could not load'));
    expect(await play).toMatchObject({
      statusCode: 550,
      statusMessage: 'Child texture could not load',
    });
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
    expect(
      mock.mounts.filter(
        (mount) => !mount.disposed && mount.host.dataset.ografTransitionState === 'header',
      ),
    ).toHaveLength(0);
  });

  it('does not consume the OGraf On step when hidden startup resources fail', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    const failing = pending();
    mock.readiness.set('initial-child-failure', failing.promise);
    await selectNormal(graphic, 'initial-child-failure');
    const first = graphic.playAction({ skipAnimation: true });
    await settleWork();
    failing.reject(new Error('Initial child failed'));
    expect(await first).toMatchObject({ statusCode: 550 });
    expect(
      await graphic.updateAction({
        data: { slots: { header: { data: { resource: 'fixed-child' } } } },
      }),
    ).toEqual({ statusCode: 200 });
    expect(await graphic.playAction({ skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    for (const id of ['main', 'header', 'subline']) expect(phase(graphic, id)).toBe('on');
  });

  it('waits for blockers selected Off before admitting a selected replacement and its children', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await breakingTake(graphic, true);
    const selection = selectNormal(graphic);
    await settleWork();
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    expect(phase(graphic, 'alert')).toBe('leaving');
    expect(graphic.getPlayoutSnapshot().slots.main!.current).toBeNull();
    await tick(20);
    await settleWork();
    await selection;
    expect(phase(graphic, 'alert')).toBe('off');
    expect(phase(graphic, 'main')).toBe('entering');
    await tick(40);
    await settleWork();
    await tick(60);
    await settleWork();
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
  });

  it('checks hidden renderer draw readiness after initial load before committing any stage', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await slotTake(graphic, 'bug', 'bug');
    const ready = pending();
    mock.readiness.set('late-renderer', ready.promise);
    await selectNormal(graphic, 'late-renderer');
    const before = graphic.getPlayoutSnapshot();
    const play = graphic.playAction({ goto: 0, skipAnimation: true });
    await settleWork();
    const child = mock.mounts.find((mount) => mount.data.resource === 'late-renderer')!;
    child.waitReady.mockImplementation(async () => {
      throw new Error('Renderer decode failed');
    });
    ready.resolve();
    expect(await play).toMatchObject({ statusCode: 550, statusMessage: 'Renderer decode failed' });
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
  });

  it('cancels hidden preparation on Clear without later reviving its selected children', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    const ready = pending();
    mock.readiness.set('slow-batch-child', ready.promise);
    await selectNormal(graphic, 'slow-batch-child');
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    expect(await graphic.customAction({ id: 'transition.clear', payload: {} })).toEqual({
      statusCode: 200,
    });
    ready.resolve();
    expect(await play).toMatchObject({ statusCode: 409 });
    await tick(100);
    await settleWork();
    expect(
      Object.keys(graphic.getPlayoutSnapshot().slots).every((id) => phase(graphic, id) === 'off'),
    ).toBe(true);
  });

  it('cancels future stages on Stop after the first stage has started', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    await tick(10);
    expect(await graphic.stopAction({ skipAnimation: true })).toEqual({ statusCode: 200 });
    expect(await play).toMatchObject({ statusCode: 409 });
    await tick(100);
    await settleWork();
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.subline!.current).toBeNull();
  });

  it('discards a cancelled resource probe after reload without corrupting the replacement session', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    const ready = pending();
    mock.readiness.set('old-batch-child', ready.promise);
    await selectNormal(graphic, 'old-batch-child');
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    expect(
      await graphic.load({ renderType: 'realtime', renderCharacteristics: {}, data: {} }),
    ).toEqual({ statusCode: 200 });
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    ready.resolve();
    expect(await play).toMatchObject({ statusCode: 409 });
    await tick(100);
    await settleWork();
    expect(phase(graphic, 'main')).toBe('on');
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    expect(graphic.getPlayoutSnapshot().slots.subline!.current).toBeNull();
  });

  it('lets a due Rules Clear cancel planned children at their parent barrier', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await selectNormal(graphic);
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    const main = mock.mounts.find(
      (mount) => !mount.disposed && mount.host.dataset.ografTransitionState === 'headline',
    )!;
    main.scheduleRule!({
      id: 'clear-parent-on-entry',
      frame: 20,
      data: {},
      run: () => [{ type: 'playout', operation: 'clear', slotId: 'main' }],
    });
    await tick(20);
    await settleWork();
    expect(await play).toMatchObject({ statusCode: 409 });
    await tick(100);
    await settleWork();
    for (const id of ['main', 'header', 'subline']) expect(phase(graphic, id)).toBe('off');
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
  });

  it('acknowledges final On completion before an authored Played In Rule clears its own lane', async () => {
    const graphic = await create('realtime', admissionDescriptor());
    await graphic.updateAction({
      data: {
        slots: {
          main: { stateId: 'headline' },
          header: { stateId: null },
          subline: { stateId: null },
          alert: { stateId: null },
        },
      },
    });
    const play = graphic.playAction({ goto: 0 });
    await settleWork();
    const main = mock.mounts.find(
      (mount) => !mount.disposed && mount.host.dataset.ografTransitionState === 'headline',
    )!;
    main.scheduleRule!({
      id: 'authored-clear-after-play',
      frame: 20,
      data: {},
      run: () => [{ type: 'playout', operation: 'clear', slotId: 'main' }],
    });
    await tick(20);
    await settleWork();
    expect(await play).toMatchObject({ statusCode: 200 });
    expect(phase(graphic, 'main')).toBe('off');
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
  });

  it('also rejects conflicting direct non-realtime Play before partially replacing a normal scene', async () => {
    const graphic = await create('non-realtime', admissionDescriptor());
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'updateAction', params: { data: normalData } } },
        { timestamp: 0, action: { type: 'playAction', params: { goto: 0, skipAnimation: true } } },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 0 })).toEqual({ statusCode: 200 });
    expect(
      await graphic.updateAction({ data: { slots: { alert: { stateId: 'breaking' } } } }),
    ).toEqual({ statusCode: 200 });
    const before = graphic.getPlayoutSnapshot();
    expect(await graphic.playAction({ goto: 0, skipAnimation: true })).toMatchObject({
      statusCode: 550,
    });
    expect(graphic.getPlayoutSnapshot()).toEqual(before);
  });

  it('non-realtime Stop cancels future planned Takes rather than reviving them at a later seek frame', async () => {
    const graphic = await create('non-realtime', admissionDescriptor());
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'updateAction', params: { data: normalData } } },
        { timestamp: 0, action: { type: 'playAction', params: { goto: 0 } } },
        { timestamp: 200, action: { type: 'stopAction', params: { skipAnimation: true } } },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 2000 })).toEqual({ statusCode: 200 });
    for (const id of ['main', 'header', 'subline']) expect(phase(graphic, id)).toBe('off');
  });

  it('replays dependency barriers on the same non-realtime timeline under forward and backward seeks', async () => {
    const graphic = await create('non-realtime', admissionDescriptor());
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'updateAction', params: { data: normalData } } },
        { timestamp: 0, action: { type: 'playAction', params: { goto: 0 } } },
      ],
    });
    expect(await graphic.goToTime({ timestamp: 200 })).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().frame).toBe(10);
    expect(phase(graphic, 'main')).toBe('entering');
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    expect(await graphic.goToTime({ timestamp: 400 })).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().frame).toBe(20);
    expect(phase(graphic, 'header')).toBe('entering');
    expect(await graphic.goToTime({ timestamp: 800 })).toEqual({ statusCode: 200 });
    const complete = graphic.getPlayoutSnapshot();
    expect(complete.slots.header!.current ? 'on' : 'off').toBe('on');
    expect(await graphic.goToTime({ timestamp: 100 })).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot().slots.header!.current).toBeNull();
    expect(await graphic.goToTime({ timestamp: 800 })).toEqual({ statusCode: 200 });
    expect(graphic.getPlayoutSnapshot()).toEqual(complete);
  });
});

describe('prepared skipped-stage presentation', () => {
  function source(dependent = false) {
    const value = descriptor();
    value.definition.version = 4;
    const ids = dependent ? ['a', 'b', 'c', 'd', 'e'] : ['a', 'b', 'c'];
    value.definition.slots = ids.map((id, order) => ({
      id,
      name: id,
      order,
      ...(dependent && ['d', 'e'].includes(id)
        ? { parentSlotId: 'a', admission: { requireOnSlotIds: ['a'] } }
        : {}),
    }));
    value.definition.states = ids.map((id) => ({ id, name: id, slotId: id, templateId: id }));
    value.definition.sharedInstances = [];
    value.definition.initialSharedValues = [];
    value.sharedInstances = [];
    value.templates = ids.map((id) => ({
      id,
      name: id,
      descriptor: compiled,
      sharedLayers: [],
      sharedDataBindings: [],
    }));
    value.dataDefaults = {
      slots: Object.fromEntries(ids.map((id) => [id, { stateId: id, data: {} }])),
    };
    return value;
  }
  const stateMount = (state: string) =>
    live().find((mount) => mount.host.dataset.ografTransitionState === state)!;
  const activeIds = (graphic: CoordinatedGraphicElement) =>
    Object.entries(graphic.getPlayoutSnapshot().slots)
      .filter(([, slot]) => slot.current !== null)
      .map(([id]) => id);
  const resetSpies = () => {
    for (const mount of mock.mounts) {
      mount.render.mockClear();
      mount.waitReady.mockClear();
    }
  };

  it('renders independent prepared lanes once and awaits one coherent visible-readiness pass', async () => {
    const graphic = await create('realtime', source());
    resetSpies();
    const poses: string[][] = [];
    for (const mount of live())
      mount.render.mockImplementation(() => poses.push(activeIds(graphic)));
    expect(await graphic.playAction({ skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
    for (const mount of live()) {
      expect(mount.render).toHaveBeenCalledOnce();
      // One hidden recheck before commit, one coherent presentation check afterwards.
      expect(mount.waitReady).toHaveBeenCalledTimes(2);
    }
    expect(poses).toEqual([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ]);
  });

  it('retains separate parent and child presentation/readiness barriers at the same skipped frame', async () => {
    const graphic = await create('realtime', source(true));
    resetSpies();
    const order: string[] = [];
    stateMount('a').render.mockImplementation(() => order.push('parent-present'));
    stateMount('d').setOnAir.mockImplementation(() => order.push('child-start'));
    await graphic.playAction({ skipAnimation: true });
    expect(stateMount('a').render).toHaveBeenCalledTimes(2);
    expect(stateMount('d').render).toHaveBeenCalledOnce();
    expect(stateMount('a').waitReady).toHaveBeenCalledTimes(3);
    expect(stateMount('d').waitReady).toHaveBeenCalledTimes(2);
    expect(order.indexOf('child-start')).toBeGreaterThan(order.indexOf('parent-present'));
    expect(activeIds(graphic)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(graphic.getPlayoutSnapshot().frame).toBe(0);
  });

  it('acknowledges a final skipped On before its Played In Rule clears its own lane', async () => {
    const graphic = await create('realtime', source());
    const first = stateMount('a'),
      order: string[] = [],
      draw = pending();
    first.render.mockImplementation(() => order.push('present'));
    stateMount('b')
      .waitReady.mockImplementationOnce(async () => {})
      .mockImplementationOnce(() =>
        draw.promise.then(() => {
          order.push('ready');
        }),
      );
    const play = graphic.playAction({ skipAnimation: true });
    await flush();
    first.scheduleRule!({
      id: 'clear-own-on',
      frame: 0,
      data: {},
      run: () => {
        order.push('rule');
        return [{ type: 'playout', operation: 'clear', slotId: 'a' }];
      },
    });
    await flush();
    expect(order).toEqual(['present']);
    draw.resolve();
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
    await flush();
    expect(activeIds(graphic)).toEqual(['b', 'c']);
    expect(order.indexOf('rule')).toBeGreaterThan(order.indexOf('present'));
    expect(order.slice(0, order.indexOf('rule')).at(-1)).toBe('ready');
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
  });

  it('runs due parent Rules after stage readiness and before requesting planned children', async () => {
    const graphic = await create('realtime', source(true));
    const first = stateMount('a'),
      children = [stateMount('d'), stateMount('e')],
      draw = pending();
    stateMount('b')
      .waitReady.mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => draw.promise);
    let childrenRequested = false;
    const unsubscribe = graphic.subscribePlayout((snapshot) => {
      if (snapshot.slots.d!.pending || snapshot.slots.e!.pending) childrenRequested = true;
    });
    const play = graphic.playAction({ skipAnimation: true });
    await flush();
    first.scheduleRule!({
      id: 'clear-before-children',
      frame: 0,
      data: {},
      run: () => [{ type: 'playout', operation: 'clear', slotId: 'a' }],
    });
    draw.resolve();
    expect(await play).toMatchObject({ statusCode: 409 });
    await flush();
    for (const child of children) expect(child.setOnAir).not.toHaveBeenCalled();
    expect(childrenRequested).toBe(false);
    unsubscribe();
    expect(activeIds(graphic)).toEqual(['b', 'c']);
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
  });

  it('keeps Play pending and queues RAFs until the complete skipped stage is draw-ready', async () => {
    const graphic = await create('realtime', source());
    resetSpies();
    const draw = pending(),
      slow = stateMount('b');
    slow.waitReady
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => draw.promise);
    let finished = false;
    const play = graphic.playAction({ skipAnimation: true }).then((result) => {
      finished = true;
      return result;
    });
    await flush();
    expect(slow.waitReady).toHaveBeenCalledTimes(2);
    await tick(20);
    expect(finished).toBe(false);
    expect(graphic.getPlayoutSnapshot().frame).toBe(0);
    for (const mount of live()) expect(mount.render).toHaveBeenCalledOnce();
    draw.resolve();
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
    await flush();
    expect(graphic.getPlayoutSnapshot().frame).toBe(20);
  });

  it('keeps Clear authoritative while final skipped presentation readiness is pending', async () => {
    const graphic = await create('realtime', source());
    const draw = pending(),
      previous = [...live()];
    stateMount('b')
      .waitReady.mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => draw.promise);
    const play = graphic.playAction({ skipAnimation: true });
    await flush();
    expect(await graphic.customAction({ id: 'transition.clear', payload: {} })).toEqual({
      statusCode: 200,
    });
    draw.resolve();
    expect(await play).toMatchObject({ statusCode: 409 });
    await tick(50);
    expect(activeIds(graphic)).toEqual([]);
    expect(previous.every((mount) => mount.disposed)).toBe(true);
    expect(await graphic.playAction({ skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
  });

  it('does not acknowledge final On before a late coherent draw failure is reported', async () => {
    const graphic = await create('realtime', source());
    const draw = pending();
    stateMount('b')
      .waitReady.mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => draw.promise);
    const play = graphic.playAction({ skipAnimation: true });
    await flush();
    draw.reject(new Error('Coherent stage draw failed'));
    expect(await play).toMatchObject({
      statusCode: 550,
      statusMessage: 'Coherent stage draw failed',
    });
    await graphic.customAction({ id: 'transition.clear', payload: {} });
    expect(await graphic.playAction({ skipAnimation: true })).toEqual({
      statusCode: 200,
      currentStep: 0,
    });
  });

  it('settles a skipped blocker-exit stage before presenting prepared replacement lanes', async () => {
    const value = source();
    value.definition.slots.push({ id: 'd', name: 'd', order: 3 });
    value.definition.states.push({ id: 'd', name: 'd', slotId: 'd', templateId: 'd' });
    value.templates.push({
      id: 'd',
      name: 'd',
      descriptor: compiled,
      sharedLayers: [],
      sharedDataBindings: [],
    });
    for (const id of ['c', 'd']) {
      value.definition.slots.find((slot) => slot.id === id)!.admission = {
        blockWhileActiveSlotIds: ['a', 'b'],
      };
      value.dataDefaults!.slots[id] = { stateId: null, data: {} };
    }
    const graphic = await create('realtime', value);
    await graphic.playAction({ skipAnimation: true });
    const outgoing = [stateMount('a'), stateMount('b')];
    const gate = pending();
    mock.readiness.set('replacement-stage', gate.promise);
    const changing = graphic.updateAction({
      data: {
        slots: {
          a: { stateId: null },
          b: { stateId: null },
          c: { stateId: 'c', data: { resource: 'replacement-stage' } },
          d: { stateId: 'd', data: { resource: 'replacement-stage' } },
        },
      },
    });
    await flush();
    expect(graphic.getPlayoutSnapshot().slots.a!.outgoing).not.toBeNull();
    const play = graphic.playAction({ goto: 0, skipAnimation: true });
    await flush();
    const incoming = [stateMount('c'), stateMount('d')];
    const blockersAtStart: string[][] = [];
    for (const mount of incoming)
      mount.setOnAir.mockImplementation((on: boolean) => {
        if (on) blockersAtStart.push(activeIds(graphic).filter((id) => ['a', 'b'].includes(id)));
      });
    gate.resolve();
    expect(await play).toEqual({ statusCode: 200, currentStep: 0 });
    expect(await changing).toEqual({ statusCode: 200 });
    expect(blockersAtStart).toEqual([[], []]);
    expect(outgoing.every((mount) => mount.disposed)).toBe(true);
    expect(activeIds(graphic)).toEqual(['c', 'd']);
    for (const mount of incoming) expect(mount.render).toHaveBeenCalledOnce();
    expect(graphic.getPlayoutSnapshot().frame).toBe(0);
  });

  it('retains individual presentation for direct Takes and animated Play', async () => {
    const graphic = await create('realtime', source());
    const a = stateMount('a');
    resetSpies();
    const play = graphic.playAction({ goto: 0 });
    await flush();
    expect(a.render.mock.calls.length).toBeGreaterThan(1);
    await tick(20);
    expect(await play).toMatchObject({ statusCode: 200 });
    await graphic.stopAction({ skipAnimation: true });
    await graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'a', stateId: 'a' },
      skipAnimation: true,
    });
    const direct = stateMount('a');
    direct.render.mockClear();
    await graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'b', stateId: 'b' },
      skipAnimation: true,
    });
    expect(direct.render).toHaveBeenCalledOnce();
    expect(stateMount('b').render).toHaveBeenCalledOnce();
  });
});

describe('coordinated authored frame cues', () => {
  function cueSource(): CompiledTransitionLogicDescriptor {
    const source = descriptor();
    Object.assign(source.definition.transitions[0]!, {
      outgoingFrames: 8,
      incomingStartFrame: 4,
      incomingFrames: 12,
    });
    for (const template of source.templates) {
      template.descriptor = {
        ...template.descriptor,
        keyframes: [
          { id: 'start', role: 'start', frame: 0 },
          { id: 'first', role: 'step', frame: 12 },
          { id: 'last', role: 'step', frame: 24 },
          { id: 'end', role: 'end', frame: 36 },
        ],
        stepKeyframeIds: ['first', 'last'],
        stepCount: 2,
        startKeyframeId: 'start',
        endKeyframeId: 'end',
        layers: [
          {
            id: `${template.id}-layer`,
            exportKey: 'score',
            element: createRectangleLayer().element,
            effects: createLayerEffects(),
            isVisible: true,
            keyframes: [],
            animationTracks: {},
            bindings: [],
          },
        ],
        frameCues: [
          { id: 'end', name: 'End', frame: 36 },
          { id: 'start', name: 'Start', frame: 0 },
          { id: 'mid-a', name: 'Mid A', frame: 6, payload: { score: 3 } },
          { id: 'mid-b', name: 'Mid B', frame: 6 },
          { id: 'first', name: 'First Step', frame: 12 },
          { id: 'between', name: 'Skipped later Step', frame: 20 },
          { id: 'last', name: 'Last Step anchor', frame: 24 },
          { id: 'out', name: 'Out', frame: 30 },
        ],
      };
    }
    return source;
  }

  function observeCues(graphic: CoordinatedGraphicElement) {
    const events: Array<{
      detail: import('./graphicInstances').StudioFrameCueDetail;
      hasLayer: boolean;
    }> = [];
    Object.defineProperty(graphic, 'dispatchEvent', {
      value: (event: CustomEvent<import('./graphicInstances').StudioFrameCueDetail>) => {
        if (event.type === 'ograf-studio-cue')
          events.push({
            detail: event.detail,
            hasLayer: Boolean(graphic.instances[event.detail.instanceId]?.layers.score),
          });
        return true;
      },
    });
    return events;
  }

  it('emits in crossing order for overlapping In/Out and keeps the terminal Out layer addressable', async () => {
    const graphic = await create('realtime', cueSource());
    const events = observeCues(graphic);
    expect(await graphic.prepareSlot({ slotId: 'main', stateId: 'headline' })).toMatchObject({
      statusCode: 200,
    });
    await tick(2);
    expect(events).toEqual([]);
    const first = graphic.takePreparedSlot({ slotId: 'main' });
    await flush();
    await tick(5);
    expect(events).toEqual([]);
    await tick(6);
    await tick(6);
    expect(events.map(({ detail }) => detail.id)).toEqual(['start']);
    await tick(22);
    expect(await first).toMatchObject({ statusCode: 200 });
    expect(events.map(({ detail }) => detail.id)).toEqual(['start', 'mid-a', 'mid-b', 'first']);
    expect(events[1]?.detail).toMatchObject({
      name: 'Mid A',
      frame: 6,
      payload: { score: 3 },
      templateId: 'headline',
      laneId: 'main',
    });
    const outgoing = events[0]!.detail.instanceId;
    events.length = 0;

    const replacement = take(graphic, 'breaking');
    await flush();
    await tick(42);
    expect(await replacement).toMatchObject({ statusCode: 200 });
    expect(events.map(({ detail }) => [detail.templateId, detail.id])).toEqual([
      ['headline', 'out'],
      ['breaking', 'start'],
      ['headline', 'end'],
      ['breaking', 'mid-a'],
      ['breaking', 'mid-b'],
      ['breaking', 'first'],
    ]);
    expect(events.every((event) => event.hasLayer)).toBe(true);
    expect(events[0]?.detail.instanceId).toBe(outgoing);
    expect(events[1]?.detail.instanceId).not.toBe(outgoing);
    expect(graphic.instances[outgoing]).toBeUndefined();
  });

  it('does not lose cues from a queued plan that starts and settles inside one clock tick', async () => {
    const graphic = await create('realtime', cueSource());
    const events = observeCues(graphic);
    const first = take(graphic, 'headline');
    await flush();
    await tick(3);
    const queued = take(graphic, 'breaking');
    await flush();
    await tick(45);
    expect(await first).toMatchObject({ statusCode: 200 });
    expect(await queued).toMatchObject({ statusCode: 200 });
    expect(events.map(({ detail }) => `${detail.templateId}:${detail.id}`)).toEqual([
      'headline:start',
      'headline:mid-a',
      'headline:mid-b',
      'headline:first',
      'headline:out',
      'breaking:start',
      'headline:end',
      'breaking:mid-a',
      'breaking:mid-b',
      'breaking:first',
    ]);
    expect(events.every((event) => event.hasLayer)).toBe(true);
  });

  it('emits through whole-graphic Play boundary splitting and ignores backward samples', async () => {
    const graphic = await create('realtime', cueSource());
    const events = observeCues(graphic);
    expect(
      await graphic.updateAction({ data: { slots: { main: { stateId: 'headline', data: {} } } } }),
    ).toMatchObject({ statusCode: 200 });
    const play = graphic.playAction({ goto: 0 });
    await flush();
    await tick(10);
    expect(events.map(({ detail }) => detail.frame)).toEqual([0, 0, 6, 6, 6, 6]);
    expect(new Set(events.map(({ detail }) => detail.laneId))).toEqual(new Set(['main', 'ticker']));
    await tick(9);
    await tick(10);
    expect(events).toHaveLength(6);
    await tick(25);
    expect(await play).toMatchObject({ statusCode: 200 });
    for (const lane of ['main', 'ticker'])
      expect(
        events.filter(({ detail }) => detail.laneId === lane).map(({ detail }) => detail.id),
      ).toEqual(['start', 'mid-a', 'mid-b', 'first']);
  });

  it('keeps cuts, cleared windows and offline schedule seeks silent', async () => {
    const graphic = await create('realtime', cueSource());
    const events = observeCues(graphic);
    expect(await take(graphic, 'headline', {}, true)).toMatchObject({ statusCode: 200 });
    await tick(2);
    const taking = take(graphic, 'breaking');
    await flush();
    await tick(3);
    expect(
      await graphic.customAction({ id: 'transition.clear', payload: { slotId: 'main' } }),
    ).toMatchObject({ statusCode: 200 });
    await tick(40);
    expect(await taking).toMatchObject({ statusCode: 200 });
    expect(events).toEqual([]);

    const offline = await create('non-realtime', cueSource());
    const offlineEvents = observeCues(offline);
    expect(
      await offline.setActionsSchedule({
        schedule: [
          {
            timestamp: 0,
            action: {
              type: 'customAction',
              params: { id: 'transition.take', payload: { slotId: 'main', stateId: 'headline' } },
            },
          },
          { timestamp: 600, action: { type: 'stopAction', params: {} } },
        ],
      }),
    ).toMatchObject({ statusCode: 200 });
    for (const timestamp of [1400, 200, 1400])
      expect(await offline.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
    expect(offlineEvents).toEqual([]);
  });
});
