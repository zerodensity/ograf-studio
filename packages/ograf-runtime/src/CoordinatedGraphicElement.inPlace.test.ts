import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
} from '@ograf-editor/ograf-types';
import type { TransitionLogicDataStage, TransitionLogicRuleWork } from './transitionLogicRendering';

const mock = vi.hoisted(() => {
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    parent: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = { createElement: () => new Host(), defaultView: null };
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
      data: Record<string, unknown>;
      disposed: boolean;
      setData: ReturnType<typeof vi.fn>;
      stageData: ReturnType<typeof vi.fn>;
      updateSettled: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
      scheduleRule?: (work: TransitionLogicRuleWork) => void;
    }>,
    /** Answers stageData for the next data sets, keyed by their `image` value. */
    stages: new Map<string, unknown>(),
    /** Keeps a mount from being ready, keyed by its `resource` value. */
    readiness: new Map<string, Promise<void>>(),
    settled: null as Promise<void> | null,
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

vi.mock('./transitionLogicRendering', () => ({
  sharedLayerKey: (instanceId: string, layerId: string) => JSON.stringify([instanceId, layerId]),
  mountTransitionLogicComposition: (options: {
    parent: InstanceType<typeof mock.Host>;
    data: Record<string, unknown>;
    startFrame: number;
    scheduleRule?: (work: TransitionLogicRuleWork) => void;
  }) => {
    const host = new mock.Host();
    options.parent.append(host);
    const mount = {
      host,
      data: structuredClone(options.data),
      startFrame: options.startFrame,
      ready: mock.readiness.get(String(options.data.resource)) ?? Promise.resolve(),
      waitReady: vi.fn(async () => {}),
      disposed: false,
      setData: vi.fn((data: Record<string, unknown>) => {
        mount.data = structuredClone(data);
      }),
      stageData: vi.fn(
        (data: Record<string, unknown>) =>
          mock.stages.get(String(data.image)) ?? {
            takeRequired: false,
            loading: false,
            ready: Promise.resolve(),
          },
      ),
      updateSettled: vi.fn(() => mock.settled ?? Promise.resolve()),
      prepareForTake: vi.fn(),
      setOnAir: vi.fn(),
      fireLifecycle: vi.fn(),
      customAction: vi.fn(),
      ...(options.scheduleRule ? { scheduleRule: options.scheduleRule } : {}),
      inheritRules: vi.fn(),
      settleText: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(() => {
        mount.disposed = true;
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

function descriptor(
  updateMode: 'in-place' | 'transition' | null,
): CompiledTransitionLogicDescriptor {
  return {
    version: 1,
    id: 'news',
    name: 'News',
    width: 1920,
    height: 1080,
    frameRate: 50,
    definition: {
      version: 6,
      id: 'logic',
      name: 'News',
      defaultTransitionId: 'dissolve',
      slots: [{ id: 'main', name: 'Lower third', order: 0, ...(updateMode ? { updateMode } : {}) }],
      states: [
        { id: 'headline', name: 'Headline', slotId: 'main', templateId: 'headline' },
        { id: 'breaking', name: 'Breaking', slotId: 'main', templateId: 'breaking' },
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
      initialSharedValues: [],
    },
    templates: ['headline', 'breaking'].map((id) => ({
      id,
      name: id,
      descriptor: compiled,
      dataDefaults: { headline: id },
      sharedLayers: [{ layerId: 'proxy', instanceId: 'panel', sourceLayerId: 'backing' }],
      sharedDataBindings: [{ instanceId: 'panel', fields: { panelHeadline: 'headline' } }],
    })),
    sharedInstances: [
      { id: 'panel', descriptor: compiled, dataDefaults: { panelHeadline: 'Default' } },
    ],
  };
}

async function create(
  updateMode: 'in-place' | 'transition' | null = 'in-place',
  renderType: 'realtime' | 'non-realtime' = 'realtime',
) {
  const source = descriptor(updateMode);
  class Graphic extends CoordinatedGraphicElement {
    static transitionDescriptor = source;
  }
  const graphic = new Graphic();
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
  data: Record<string, unknown> = {},
  skipAnimation = false,
) =>
  graphic.customAction({
    id: 'transition.take',
    payload: { slotId: 'main', stateId, data },
    skipAnimation,
  });
const patch = (graphic: CoordinatedGraphicElement, data: Record<string, unknown>) =>
  graphic.customAction({ id: 'transition.patch', payload: { slotId: 'main', data } });
const out = (graphic: CoordinatedGraphicElement) =>
  graphic.customAction({ id: 'transition.out', payload: { slotId: 'main' } });
const local = () =>
  mock.mounts.filter((mount) => !mount.disposed && mount.host.dataset.ografTransitionState);
const shared = () =>
  mock.mounts.find((mount) => !mount.disposed && mount.host.dataset.ografTransitionShared)!;
const current = (graphic: CoordinatedGraphicElement) =>
  graphic.getPlayoutSnapshot().slots.main!.current;

/** Like the mount: once its image has loaded, staging the same data has nothing left to load. */
function stage(): TransitionLogicDataStage & { resolve(): void; reject(cause: Error): void } {
  let succeed!: () => void;
  let reject!: (cause: Error) => void;
  const ready = new Promise<void>((yes, no) => {
    succeed = yes;
    reject = no;
  });
  void ready.catch(() => undefined);
  const result = {
    takeRequired: false,
    loading: true,
    ready,
    resolve() {
      result.loading = false;
      succeed();
    },
    reject,
  };
  return result;
}

beforeEach(() => {
  mock.players.length = 0;
  mock.mounts.length = 0;
  mock.stages.clear();
  mock.readiness.clear();
  mock.settled = null;
});

describe('the guard that chooses an in-place update', () => {
  it('keeps the default lane on the authored update transition', async () => {
    const graphic = await create(null);
    await take(graphic, 'headline', { headline: 'One' }, true);
    const update = take(graphic, 'headline', { headline: 'Two' });
    await flush();
    expect(local()).toHaveLength(2);
    expect(graphic.getPlayoutSnapshot().slots.main!.transition).not.toBeNull();
    await tick(30);
    expect(await update).toEqual({ statusCode: 200 });
  });

  it('treats an explicit transition mode like the default', async () => {
    const graphic = await create('transition');
    await take(graphic, 'headline', { headline: 'One' }, true);
    void take(graphic, 'headline', { headline: 'Two' });
    await flush();
    expect(local()).toHaveLength(2);
  });

  it('changes an in-place lane on its mounted template, with motion and no new request', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One', keep: 1 }, true);
    await tick(7);
    const [mount] = local();
    const before = current(graphic)!;
    const count = mock.mounts.length;
    expect(await take(graphic, 'headline', { headline: 'Two' })).toEqual({ statusCode: 200 });
    expect(mock.mounts).toHaveLength(count);
    expect(mount!.disposed).toBe(false);
    const after = graphic.getPlayoutSnapshot().slots.main!;
    expect(after.transition).toBeNull();
    expect(after.current).toMatchObject({
      requestId: before.requestId,
      instanceId: before.instanceId,
      data: { headline: 'Two', keep: 1 },
    });
    expect(mount!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Two' }),
      7,
      false,
      { fallbackFrames: 20 },
    );
    expect(shared().setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ panelHeadline: 'Two' }),
      7,
      false,
      { fallbackFrames: 20 },
    );
  });

  it('applies updateAction in place too', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One', keep: 1 }, true);
    const count = mock.mounts.length;
    expect(
      await graphic.updateAction({
        data: { slots: { main: { stateId: 'headline', data: { headline: 'Two' } } } },
      }),
    ).toEqual({ statusCode: 200 });
    expect(mock.mounts).toHaveLength(count);
    expect(current(graphic)!.data).toEqual({ headline: 'Two', keep: 1 });
  });

  it('does nothing for the same data', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    const [mount] = local();
    const calls = mount!.setData.mock.calls.length;
    expect(await take(graphic, 'headline', { headline: 'One' })).toEqual({ statusCode: 200 });
    expect(mount!.setData).toHaveBeenCalledTimes(calls);
    expect(local()).toHaveLength(1);
  });

  it('settles the command only when the layers have arrived', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    let arrive!: () => void;
    mock.settled = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    let done = false;
    const update = take(graphic, 'headline', { headline: 'Two' }).then((result) => {
      done = true;
      return result;
    });
    await flush();
    expect(done).toBe(false);
    arrive();
    expect(await update).toEqual({ statusCode: 200 });
  });

  it('updates an entering lane with no motion, because the host fade covers it', async () => {
    const graphic = await create();
    const entering = take(graphic, 'headline', { headline: 'One' });
    await flush();
    await tick(5);
    const transition = graphic.getPlayoutSnapshot().slots.main!.transition;
    const count = mock.mounts.length;
    expect(await take(graphic, 'headline', { headline: 'Two' })).toEqual({ statusCode: 200 });
    expect(mock.mounts).toHaveLength(count);
    const slot = graphic.getPlayoutSnapshot().slots.main!;
    expect(slot.transition).toEqual(transition);
    expect(slot.incoming?.data).toMatchObject({ headline: 'Two' });
    expect(local().at(-1)!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Two' }),
      5,
      false,
    );
    await tick(30);
    expect(await entering).toEqual({ statusCode: 200 });
  });

  it('applies immediately while paused, because no frame would run the motion', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    graphic.pausePlayout();
    expect(await take(graphic, 'headline', { headline: 'Two' })).toEqual({ statusCode: 200 });
    expect(local()[0]!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Two' }),
      0,
      false,
    );
  });

  it('settles a skipped update on the settled lane without a transition', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    expect(await take(graphic, 'headline', { headline: 'Two' }, true)).toEqual({ statusCode: 200 });
    expect(local()[0]!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Two' }),
      0,
      true,
    );
  });
});

describe('falling back to a real Take', () => {
  it('uses a real Take to change state', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    void take(graphic, 'breaking', { headline: 'Two' });
    await flush();
    expect(local()).toHaveLength(2);
    expect(graphic.getPlayoutSnapshot().slots.main!.incoming?.stateId).toBe('breaking');
  });

  it('uses a real Take on an Off lane', async () => {
    const graphic = await create();
    void take(graphic, 'headline', { headline: 'One' });
    await flush();
    expect(local()).toHaveLength(1);
    expect(graphic.getPlayoutSnapshot().slots.main!.transition).not.toBeNull();
  });

  it('uses a real Take while the lane is leaving', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    void out(graphic);
    await flush();
    void take(graphic, 'headline', { headline: 'Back' });
    await flush();
    const slot = graphic.getPlayoutSnapshot().slots.main!;
    expect(slot.pending?.data).toMatchObject({ headline: 'Back' });
  });

  it('uses a real Take while another request is pending', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    mock.readiness.set('slow', new Promise(() => {}));
    void take(graphic, 'breaking', { headline: 'Next', resource: 'slow' });
    await flush();
    void take(graphic, 'breaking', { headline: 'Later', resource: 'slow' });
    await flush();
    const slot = graphic.getPlayoutSnapshot().slots.main!;
    expect(slot.pending?.data).toMatchObject({ headline: 'Later' });
    expect(slot.current?.stateId).toBe('headline');
  });

  it('uses a real Take to skip a running transition', async () => {
    const graphic = await create();
    void take(graphic, 'headline', { headline: 'One' });
    await flush();
    await tick(5);
    expect(await take(graphic, 'headline', { headline: 'Two' }, true)).toEqual({ statusCode: 200 });
    const slot = graphic.getPlayoutSnapshot().slots.main!;
    expect(slot.transition).toBeNull();
    expect(slot.current?.data.headline).toBe('Two');
    expect(slot.current?.requestId).not.toBe('take-1');
  });

  it('uses a real Take when a resource needs a mount of its own', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    const before = current(graphic)!.requestId;
    mock.stages.set('clip.webm', {
      takeRequired: true,
      loading: false,
      ready: Promise.resolve(),
    });
    const update = take(graphic, 'headline', { image: 'clip.webm' });
    await flush();
    expect(local()).toHaveLength(2);
    await tick(30);
    expect(await update).toEqual({ statusCode: 200 });
    expect(current(graphic)!.requestId).not.toBe(before);
    expect(current(graphic)!.data.image).toBe('clip.webm');
  });
});

describe('the resource gate', () => {
  it('keeps the old data on air until the image has loaded', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png' }, true);
    const loading = stage();
    mock.stages.set('new.png', loading);
    const [mount] = local();
    const update = take(graphic, 'headline', { image: 'new.png' });
    await flush();
    expect(mount!.setData).not.toHaveBeenCalled();
    expect(current(graphic)!.data.image).toBe('old.png');
    loading.resolve();
    expect(await update).toEqual({ statusCode: 200 });
    expect(mount!.setData.mock.lastCall![0]).toMatchObject({ image: 'new.png' });
    expect(current(graphic)!.data.image).toBe('new.png');
    expect(local()).toHaveLength(1);
  });

  it('leaves the old image on air and restores Controls when the image fails', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png', headline: 'Keep' }, true);
    const loading = stage();
    mock.stages.set('broken.png', loading);
    const [mount] = local();
    const update = take(graphic, 'headline', { image: 'broken.png' });
    await flush();
    loading.reject(new Error('Image missing'));
    expect(await update).toEqual({ statusCode: 550, statusMessage: 'Image missing' });
    expect(mount!.setData).not.toHaveBeenCalled();
    expect(local()).toEqual([mount]);
    expect(current(graphic)!.data.image).toBe('old.png');
    // Controls say the same, so a later data-free Take finds nothing to change.
    expect(await take(graphic, 'headline')).toEqual({ statusCode: 200 });
    expect(mount!.setData).not.toHaveBeenCalled();
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
  });

  it('lets the newest Take win when an older image finishes later', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png' }, true);
    const slow = stage();
    mock.stages.set('slow.png', slow);
    const older = take(graphic, 'headline', { image: 'slow.png' });
    await flush();
    expect(await take(graphic, 'headline', { image: 'fast.png' })).toEqual({ statusCode: 200 });
    slow.resolve();
    expect(await older).toEqual({ statusCode: 200 });
    expect(current(graphic)!.data.image).toBe('fast.png');
  });

  it('ignores a failure from a Take that is no longer the latest', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png' }, true);
    const slow = stage();
    mock.stages.set('slow.png', slow);
    const older = take(graphic, 'headline', { image: 'slow.png' });
    await flush();
    expect(await take(graphic, 'headline', { image: 'fast.png' })).toEqual({ statusCode: 200 });
    slow.reject(new Error('Image missing'));
    expect(await older).toEqual({ statusCode: 200 });
    expect(current(graphic)!.data.image).toBe('fast.png');
  });

  it('lets an Out win over an update still loading its image', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png' }, true);
    const loading = stage();
    mock.stages.set('new.png', loading);
    const update = take(graphic, 'headline', { image: 'new.png' });
    await flush();
    const leaving = out(graphic);
    await flush();
    loading.resolve();
    expect(await update).toEqual({ statusCode: 200 });
    await tick(100);
    expect(await leaving).toEqual({ statusCode: 200 });
    expect(current(graphic)).toBeNull();
  });

  it('hands over to a real Take when something else moved the lane during the load', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png' }, true);
    const loading = stage();
    mock.stages.set('new.png', loading);
    const update = take(graphic, 'headline', { image: 'new.png' });
    await flush();
    const cleared = graphic.customAction({ id: 'transition.clear', payload: {} });
    await flush();
    await tick(100);
    expect(await cleared).toEqual({ statusCode: 200 });
    expect(current(graphic)).toBeNull();
    loading.resolve();
    await flush();
    await tick(200);
    expect(await update).toEqual({ statusCode: 200 });
    expect(current(graphic)!.data.image).toBe('new.png');
  });
});

describe('transition.patch with a changing image, on any lane', () => {
  it.each([[null], ['in-place' as const]])(
    'never blanks while loading, and a failed image leaves the old one (%s)',
    async (mode) => {
      const graphic = await create(mode);
      await take(graphic, 'headline', { image: 'old.png', headline: 'Keep' }, true);
      const [mount] = local();
      const calls = mount!.setData.mock.calls.length;
      const failing = stage();
      mock.stages.set('broken.png', failing);
      const broken = patch(graphic, { image: 'broken.png' });
      await flush();
      expect(mount!.setData).toHaveBeenCalledTimes(calls);
      failing.reject(new Error('Image missing'));
      expect(await broken).toEqual({ statusCode: 550, statusMessage: 'Image missing' });
      expect(current(graphic)!.data).toEqual({ image: 'old.png', headline: 'Keep' });
      expect(mount!.setData).toHaveBeenCalledTimes(calls);

      const loading = stage();
      mock.stages.set('new.png', loading);
      const update = patch(graphic, { image: 'new.png' });
      await flush();
      expect(mount!.setData).toHaveBeenCalledTimes(calls);
      loading.resolve();
      expect(await update).toEqual({ statusCode: 200 });
      expect(current(graphic)!.data).toEqual({ image: 'new.png', headline: 'Keep' });
    },
  );

  it('keeps later patches behind an image that is loading', async () => {
    const graphic = await create(null);
    await take(graphic, 'headline', { image: 'old.png', headline: 'One' }, true);
    const loading = stage();
    mock.stages.set('new.png', loading);
    const first = patch(graphic, { image: 'new.png' });
    await flush();
    const second = patch(graphic, { headline: 'Two' });
    await flush();
    expect(current(graphic)!.data).toEqual({ image: 'old.png', headline: 'One' });
    loading.resolve();
    expect(await first).toEqual({ statusCode: 200 });
    expect(await second).toEqual({ statusCode: 200 });
    expect(current(graphic)!.data).toEqual({ image: 'new.png', headline: 'Two' });
  });

  it('keeps a patch behind an in-place Take that is loading an image', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png', headline: 'One' }, true);
    const loading = stage();
    mock.stages.set('new.png', loading);
    const update = take(graphic, 'headline', { image: 'new.png', headline: 'One' });
    await flush();
    const later = patch(graphic, { headline: 'Two' });
    await flush();
    loading.resolve();
    expect(await update).toEqual({ statusCode: 200 });
    expect(await later).toEqual({ statusCode: 200 });
    expect(current(graphic)!.data).toEqual({ image: 'new.png', headline: 'Two' });
  });

  it('applies a patch that loads nothing synchronously', async () => {
    const graphic = await create(null);
    await take(graphic, 'headline', { headline: 'One' }, true);
    const [mount] = local();
    void patch(graphic, { headline: 'Two' });
    expect(mount!.setData.mock.lastCall![0]).toMatchObject({ headline: 'Two' });
    expect(mount!.setData.mock.lastCall).toHaveLength(3);
  });
});

describe('Rules and replay of an in-place update', () => {
  const rule = (id: string, run: TransitionLogicRuleWork['run']): TransitionLogicRuleWork => ({
    id,
    frame: 0,
    data: {},
    run,
  });

  it('runs a Rule Update in place and keeps its cause for cycle detection', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    const [mount] = local();
    const count = mock.mounts.length;
    mount!.scheduleRule!(
      rule('update', () => [
        { type: 'playout', operation: 'update', slotId: 'main', data: { headline: 'Two' } },
      ]),
    );
    await flush();
    expect(mock.mounts).toHaveLength(count);
    expect(current(graphic)!.data.headline).toBe('Two');
    expect(graphic.getPlayoutSnapshot().error).toBeNull();
    // The data Rule that update fires runs with the cause the update kept on its mount.
    mount!.scheduleRule!(rule('update', () => []));
    await flush();
    expect(graphic.getPlayoutSnapshot().error).toMatch(/cycle/);
  });

  it('keeps the cause when a Rule on an in-place lane needs a real Take', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    const [mount] = local();
    mount!.scheduleRule!(
      rule('chain', () => [
        {
          type: 'playout',
          operation: 'take',
          slotId: 'main',
          stateId: 'breaking',
          data: { headline: 'Two' },
        },
      ]),
    );
    await flush();
    await tick(30);
    const successor = local().at(-1)!;
    expect(successor).not.toBe(mount);
    // A Rule's identity includes its state, so the chain has to come back round to be a cycle.
    successor.scheduleRule!(
      rule('chain', () => [
        {
          type: 'playout',
          operation: 'take',
          slotId: 'main',
          stateId: 'headline',
          data: { headline: 'Three' },
        },
      ]),
    );
    await flush();
    await tick(60);
    const back = local().at(-1)!;
    expect(back).not.toBe(successor);
    back.scheduleRule!(rule('chain', () => []));
    await flush();
    expect(graphic.getPlayoutSnapshot().error).toMatch(/cycle/);
  });

  it('keeps the cause when the real Take only comes after a load', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { image: 'old.png' }, true);
    const loading = stage();
    mock.stages.set('new.png', loading);
    const [mount] = local();
    mount!.scheduleRule!(
      rule('chain', () => [
        { type: 'playout', operation: 'update', slotId: 'main', data: { image: 'new.png' } },
      ]),
    );
    await flush();
    void graphic.customAction({ id: 'transition.clear', payload: {} });
    await flush();
    await tick(100);
    loading.resolve();
    await flush();
    const successor = local().at(-1)!;
    expect(successor).not.toBe(mount);
    successor.scheduleRule!(rule('chain', () => []));
    await flush();
    expect(graphic.getPlayoutSnapshot().error).toMatch(/cycle/);
  });

  it('records an operator update once, and not one caused by a Rule', async () => {
    const graphic = await create();
    await take(graphic, 'headline', { headline: 'One' }, true);
    const [mount] = local();
    const before = graphic.getRecordedActions().length;
    await take(graphic, 'headline', { headline: 'Two' });
    expect(graphic.getRecordedActions()).toHaveLength(before + 1);
    expect(graphic.getRecordedActions().at(-1)!.action).toMatchObject({
      type: 'customAction',
      params: { id: 'transition.take', payload: { slotId: 'main', stateId: 'headline' } },
    });
    mount!.scheduleRule!(
      rule('update', () => [
        { type: 'playout', operation: 'update', slotId: 'main', data: { headline: 'Three' } },
      ]),
    );
    await flush();
    expect(graphic.getRecordedActions()).toHaveLength(before + 1);
  });

  it('replays a scheduled update in place, on the same frames', async () => {
    const graphic = await create('in-place', 'non-realtime');
    expect(
      await graphic.setActionsSchedule({
        schedule: [
          {
            timestamp: 0,
            action: {
              type: 'customAction',
              params: {
                id: 'transition.take',
                payload: { slotId: 'main', stateId: 'headline', data: { headline: 'One' } },
                skipAnimation: true,
              },
            },
          },
          {
            timestamp: 200,
            action: {
              type: 'customAction',
              params: {
                id: 'transition.take',
                payload: { slotId: 'main', stateId: 'headline', data: { headline: 'Two' } },
              },
            },
          },
        ],
      }),
    ).toEqual({ statusCode: 200 });
    expect(await graphic.goToTime({ timestamp: 400 })).toEqual({ statusCode: 200 });
    const [mount] = local();
    expect(local()).toHaveLength(1);
    expect(mount!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Two' }),
      10,
      false,
      { fallbackFrames: 20 },
    );
  });
});
