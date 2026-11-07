import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompiledGraphicDescriptor,
  CompiledLayer,
  CompiledTransitionLogicDescriptor,
} from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createTextElement,
  normalizeClockTimerSettings,
} from '@ograf-editor/scene-model';
import type { TransitionLogicMount } from './transitionLogicRendering';

const mock = vi.hoisted(() => {
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    parent: Host | null = null;
    shadowRoot: Host | null = null;
    textContent = '';
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
    mounts: [] as Array<{
      mount: TransitionLogicMount;
      snapshots: Record<string, unknown>[];
    }>,
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
  async waitForElementContentReady() {},
}));
vi.mock('./textAnimationRendering', async (original) => ({
  ...(await original<typeof import('./textAnimationRendering')>()),
  renderTextAnimationAtFrame(host: HTMLElement, element: CompiledLayer['element']) {
    if (element.type === 'text') host.textContent = element.content;
  },
  setTextAnimationPrevious() {},
}));
vi.mock('./transitionLogicRendering', async (original) => {
  const runtime = await original<typeof import('./transitionLogicRendering')>();
  return {
    ...runtime,
    mountTransitionLogicComposition(
      options: Parameters<typeof runtime.mountTransitionLogicComposition>[0],
    ) {
      const mount = runtime.mountTransitionLogicComposition(options);
      const snapshots = [structuredClone(options.data)];
      const setData = mount.setData.bind(mount);
      mount.setData = (data, frame, skip) => {
        snapshots.push(structuredClone(data));
        setData(data, frame, skip);
      };
      mock.mounts.push({ mount, snapshots });
      return mount;
    },
  };
});
import { CoordinatedGraphicElement } from './CoordinatedGraphicElement';

function layer(id: string, element = createTextElement()): CompiledLayer {
  return {
    id,
    element,
    isVisible: true,
    effects: createLayerEffects(),
    bindings: [],
    keyframes: [
      {
        id: 'pose',
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
function descriptor(): CompiledTransitionLogicDescriptor {
  const title = layer('title', createTextElement({ content: 'Source fallback' }));
  title.bindings = [
    {
      dataKey: '__ograf_shared_binding_1',
      targetProperty: 'content',
      sourcePath: ['payload', 'headline'],
      valueMap: { a: 'ALPHA' },
    },
    {
      dataKey: '__ograf_shared_binding_2',
      targetProperty: 'content',
      sourcePath: ['news', 'current', 'title'],
      valueMap: { b: 'BRAVO' },
    },
  ];
  title.loop = createLayerLoopClip({
    durationFrames: 200,
    tracks: {
      x: [
        { id: 'x0', frame: 0, value: 0, easing: 'linear' },
        { id: 'x1', frame: 200, value: 100, easing: 'linear' },
      ],
    },
  });
  const timer = layer(
    'timer',
    createTextElement({
      clock: normalizeClockTimerSettings({ mode: 'count-up', format: 'ss.SSS', autoStart: true }),
    }),
  );
  const source = composition([title, timer]);
  return {
    version: 1,
    id: 'profiles',
    name: 'Shared binding profiles',
    width: 1920,
    height: 1080,
    frameRate: 50,
    definition: {
      version: 1,
      id: 'logic',
      name: 'Profiles',
      defaultTransitionId: 'cut',
      slots: [{ id: 'main', name: 'Main', order: 0 }],
      states: ['A', 'B', 'unbound'].map((id) => ({
        id,
        name: id,
        slotId: 'main',
        templateId: id,
        sharedValues: [
          { instanceId: 'panel', sourceLayerId: 'title', property: 'opacity', value: 1 },
        ],
      })),
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
        { instanceId: 'panel', sourceLayerId: 'title', property: 'opacity', value: 0 },
      ],
    },
    templates: ['A', 'B', 'unbound'].map((id) => ({
      id,
      name: id,
      descriptor: composition([]),
      dataDefaults: {},
      sharedLayers: [{ layerId: 'proxy', instanceId: 'panel', sourceLayerId: 'title' }],
      sharedDataBindings: [
        {
          instanceId: 'panel',
          fields:
            id === 'A'
              ? { __ograf_shared_binding_1: 'headlineA' }
              : id === 'B'
                ? { __ograf_shared_binding_2: 'headlineB' }
                : {},
        },
      ],
    })),
    sharedInstances: [{ id: 'panel', descriptor: source, dataDefaults: {} }],
  };
}
function descendants(host: InstanceType<typeof mock.Host>): InstanceType<typeof mock.Host>[] {
  return [
    host,
    ...host.children.flatMap(descendants),
    ...(host.shadowRoot ? descendants(host.shadowRoot) : []),
  ];
}
const instances: CoordinatedGraphicElement[] = [];
afterEach(async () => {
  for (const graphic of instances.splice(0)) await graphic.dispose();
  mock.players.length = 0;
  mock.mounts.length = 0;
});

describe('retained shared binding profiles', () => {
  it('routes keys to on-air templates and one retained shared source, excluding prepared/outgoing/deterministic output', async () => {
    const source = descriptor();
    source.definition.slots.push({ id: 'side', name: 'Side', order: 1 });
    source.definition.states.push({ id: 'side', name: 'Side', slotId: 'side', templateId: 'side' });
    const rule = (id: string) => ({
      id,
      name: id,
      enabled: true,
      trigger: 'key-down' as const,
      keyboard: { key: 'F9', repeat: false },
      dataKey: '',
      sourcePath: [],
      operator: 'equals' as const,
      actions: [
        {
          type: 'set-data' as const,
          fieldId: 'count',
          dataKey: 'count',
          mode: 'increase' as const,
          value: 1,
        },
      ],
    });
    const sharedLayer = source.sharedInstances[0]!.descriptor.layers[0]!;
    sharedLayer.visualRules = [rule('shared-key')];
    source.sharedInstances[0]!.dataDefaults = { count: 0 };
    const proxy = layer('proxy');
    proxy.visualRules = [rule('duplicate-proxy')];
    const local = layer('local');
    local.visualRules = [rule('local-key')];
    source.templates[0]!.descriptor = composition([proxy, local]);
    source.templates[0]!.dataDefaults = { count: 0, sharedCount: 0 };
    // A shared source has one mapping per template; combine the test counter into the existing profile.
    source.templates[0]!.sharedDataBindings[0]!.fields.count = 'sharedCount';
    const side = layer('side-rule');
    side.visualRules = [rule('side-key')];
    source.templates.push({
      id: 'side',
      name: 'Side',
      descriptor: composition([side]),
      dataDefaults: { count: 0 },
      sharedLayers: [],
      sharedDataBindings: [],
    });
    Object.assign(source.definition.transitions[0]!, {
      durationFrames: 20,
      outgoingFrames: 20,
      incomingFrames: 20,
      sharedFrames: 20,
    });
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = source;
    }
    const graphic = new Graphic();
    instances.push(graphic);
    const load = (renderType: 'realtime' | 'non-realtime') =>
      graphic.load({
        renderType,
        renderCharacteristics: { resolution: { width: 1920, height: 1080 }, frameRate: 50 },
        data: {},
      });
    expect(await load('realtime')).toEqual({ statusCode: 200 });
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(false);
    await graphic.prepareSlot({ slotId: 'main', stateId: 'A' });
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(false);
    await graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'main', stateId: 'A' },
      skipAnimation: true,
    });
    await graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'side', stateId: 'side' },
      skipAnimation: true,
    });
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(true);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const snapshot = graphic.getPlayoutSnapshot();
    expect(snapshot.slots.main!.current!.data).toMatchObject({ count: 1, sharedCount: 1 });
    expect(snapshot.slots.side!.current!.data.count).toBe(1);
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9', repeat: true })).toBe(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(graphic.getPlayoutSnapshot().slots.main!.current!.data).toMatchObject({
      count: 1,
      sharedCount: 1,
    });
    const leaving = graphic.customAction({ id: 'transition.out', payload: { slotId: 'main' } });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(true);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(graphic.getPlayoutSnapshot().slots.main!.outgoing!.data).toMatchObject({
      count: 1,
      sharedCount: 1,
    });
    expect(graphic.getPlayoutSnapshot().slots.side!.current!.data.count).toBe(2);
    for (const player of mock.players) if (!player.disposed) player.renderFrame(25);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    await leaving;
    graphic.pausePlayout();
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(true);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(graphic.getPlayoutSnapshot().paused).toBe(true);
    await graphic.customAction({ id: 'transition.clear', payload: {} });
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(false);
    await load('non-realtime');
    await graphic.customAction({
      id: 'transition.take',
      payload: { slotId: 'main', stateId: 'A' },
      skipAnimation: true,
    });
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(false);
    await graphic.dispose();
    expect(graphic.handleKeyboardInput('key-down', { key: 'F9' })).toBe(false);
  });
  it('switches A → B → unbound on the same live DOM, clearing private keys without resetting clock or loop', async () => {
    class Graphic extends CoordinatedGraphicElement {
      static transitionDescriptor = descriptor();
    }
    const graphic = new Graphic();
    instances.push(graphic);
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 1920, height: 1080 }, frameRate: 50 },
        data: {},
      }),
    ).toEqual({ statusCode: 200 });
    const take = async (stateId: string, data: Record<string, unknown>) => {
      expect(
        await graphic.customAction({
          id: 'transition.take',
          payload: { slotId: 'main', stateId, data },
          skipAnimation: true,
        }),
      ).toEqual({ statusCode: 200 });
    };
    const tick = async (frame: number) => {
      for (const player of mock.players) if (!player.disposed) player.renderFrame(frame);
      for (let index = 0; index < 20; index++) await Promise.resolve();
    };
    await take('A', { headlineA: { payload: { headline: 'a' } } });
    const shared = mock.mounts.find(
      ({ mount }) => mount.host.dataset.ografTransitionShared === 'panel',
    )!;
    const nodes = descendants(shared.mount.host as unknown as InstanceType<typeof mock.Host>);
    const title = nodes.find((node) => node.dataset.transitionLayerId === 'title')!;
    const timer = nodes.find((node) => node.dataset.transitionLayerId === 'timer')!;
    expect(title.textContent).toBe('ALPHA');
    await tick(50);
    expect(title.style.transform).toBe('translateX(25px)');
    expect(timer.textContent).toBe('01.000');
    expect(shared.snapshots.at(-1)).toEqual({
      __ograf_shared_binding_1: { payload: { headline: 'a' } },
    });

    await take('B', { headlineB: { news: { current: { title: 'b' } } } });
    expect(title.textContent).toBe('BRAVO');
    expect(shared.snapshots.at(-1)).toEqual({
      __ograf_shared_binding_2: { news: { current: { title: 'b' } } },
    });
    await tick(100);
    expect(title.style.transform).toBe('translateX(50px)');
    expect(timer.textContent).toBe('02.000');

    await take('unbound', {
      headlineA: { payload: { headline: 'a' } },
      headlineB: { news: { current: { title: 'b' } } },
    });
    expect(title.textContent).toBe('Source fallback');
    expect(shared.snapshots.at(-1)).toEqual({});
    await tick(150);
    expect(title.style.transform).toBe('translateX(75px)');
    expect(timer.textContent).toBe('03.000');
    const active = mock.mounts.filter(
      ({ mount }) =>
        mount.host.dataset.ografTransitionShared === 'panel' &&
        (mount.host as unknown as InstanceType<typeof mock.Host>).parent !== null,
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.mount).toBe(shared.mount);
    expect(
      descendants(shared.mount.host as unknown as InstanceType<typeof mock.Host>).some(
        (node) => node === title,
      ),
    ).toBe(true);
    expect(
      descendants(shared.mount.host as unknown as InstanceType<typeof mock.Host>).some(
        (node) => node === timer,
      ),
    ).toBe(true);
  });
});
