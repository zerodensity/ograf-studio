import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createTextElement,
  type Element,
  type LayerUpdateTransition,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    parent: Host | null = null;
    shadowRoot: Host | null = null;
    src = '';
    complete = false;
    naturalWidth = 0;
    animations: Array<{ frames: unknown; options: unknown; cancelled: boolean }> = [];
    listeners = new Map<string, () => void>();
    ownerDocument = {
      createElement: () => {
        const element = new Host();
        mock.created.push(element);
        return element;
      },
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
    getAttribute() {
      return null;
    }
    querySelectorAll(selector: string): Host[] {
      const children = this.children.flatMap((child) => [
        child,
        ...child.querySelectorAll(selector),
      ]);
      return selector === 'canvas[data-ograf-media-canvas="true"]'
        ? children.filter((child) => child.dataset.ografMediaCanvas === 'true')
        : [];
    }
    animate(frames: unknown, options: unknown) {
      const animation = { frames, options, cancelled: false };
      this.animations.push(animation);
      return { cancel: () => (animation.cancelled = true) };
    }
    addEventListener(name: string, listener: () => void) {
      this.listeners.set(name, listener);
    }
    removeEventListener() {}
    finish(naturalWidth: number) {
      this.complete = true;
      this.naturalWidth = naturalWidth;
      this.listeners.get(naturalWidth ? 'load' : 'error')?.();
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }
  return {
    Host,
    created: [] as Host[],
    render: vi.fn(),
    ready: vi.fn(async () => {}),
    shaderEffects: new Map<string, { media: boolean; opacity: string }>(),
  };
});
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./autoLayoutRendering', () => ({ applyCompiledAutoLayout() {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks() {} }));
vi.mock('./motionPathRendering', () => ({ applyCompiledMotionPaths() {} }));
vi.mock('./shaderRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shaderRendering')>()),
  waitForShadersComplete: async () => {},
}));
vi.mock('./backdropEffectRendering', () => ({
  compositionHasBackdropBlur: () => false,
  setCompositionBackdropRoot() {},
}));
vi.mock('./loopRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./loopRendering')>()),
  applyCompiledLayerVisualState(host: InstanceType<typeof mock.Host>) {
    const effect = mock.shaderEffects.get(host.dataset.transitionLayerId!);
    if (!effect) return;
    const content = host.children[0]!;
    let output = host.children.find((child) => child.dataset.ografShaderEffectOutput === 'true');
    if (!output) {
      output = new mock.Host();
      output.dataset.ografShaderEffectOutput = 'true';
      host.append(output);
      if (effect.media) {
        const media = new mock.Host();
        media.dataset.ografMediaCanvas = 'true';
        content.append(media);
      }
    }
    // A real effect commit keeps its input hidden and writes the output's resting opacity.
    if (!effect.media) content.style.opacity = '0';
    output.style.opacity = effect.opacity;
  },
  applyCompiledClipPaths() {},
}));
vi.mock('./textAnimationRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./textAnimationRendering')>()),
  renderTextAnimationAtFrame() {},
  setTextAnimationPrevious() {},
}));
vi.mock('./renderElement', async (importOriginal) => {
  const original = await importOriginal<typeof import('./renderElement')>();
  return {
    ...original,
    // A real render replaces the layer's content element, so these tests do too.
    renderElementContent: (
      host: InstanceType<typeof mock.Host>,
      element: Element,
      frame: number,
      options: unknown,
    ) => {
      host.replaceChildren(new mock.Host());
      mock.render(host, element, frame, options);
    },
    renderAnimatedElementAtTime() {},
    disposeElementContent() {},
    setLottieDeterministicRendering() {},
    waitForElementContentReady: mock.ready,
  };
});

import {
  mountTransitionLogicComposition,
  type TransitionLogicRuleWork,
} from './transitionLogicRendering';

type Host = InstanceType<typeof mock.Host>;

function layer(
  id: string,
  element: Element,
  dataKey?: string,
  updateTransition?: LayerUpdateTransition,
  targetProperty = 'content',
): CompiledLayer {
  return {
    id,
    isVisible: true,
    element,
    effects: createLayerEffects(),
    bindings: dataKey ? [{ dataKey, targetProperty }] : [],
    keyframes: [
      {
        id: 'start',
        frame: 0,
        easing: 'linear',
        transform: createDefaultTransform({ width: 400, height: 80 }),
      },
    ],
    animationTracks: {},
    ...(updateTransition ? { updateTransition } : {}),
  } as CompiledLayer;
}
const text = () => createTextElement({ content: 'Default' });
const image = (src: string | null) => ({ type: 'image', src, fit: 'contain' }) as Element;

function mount(
  layers: CompiledLayer[],
  options: Partial<Parameters<typeof mountTransitionLogicComposition>[0]> = {},
  updateTransitionFrames?: number,
) {
  const descriptor: CompiledGraphicDescriptor = {
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
    ...(updateTransitionFrames === undefined ? {} : { updateTransitionFrames }),
  };
  const rendered = mountTransitionLogicComposition({
    parent: new mock.Host() as unknown as HTMLElement,
    descriptor,
    startFrame: 0,
    data: { headline: 'Old', other: 'Rest' },
    ...options,
  });
  rendered.setOnAir(true, 0);
  return rendered;
}
const contentOf = (rendered: ReturnType<typeof mount>, id: string): Host => {
  const surface = (rendered.host as unknown as Host).shadowRoot!.children[0]!;
  return surface.children.find((child) => child.dataset.transitionLayerId === id)!.children[0]!;
};
const shownText = (id: string) =>
  mock.render.mock.calls
    .filter(([host]) => (host as Host).dataset.transitionLayerId === id)
    .at(-1)![1].content;
const render = (rendered: ReturnType<typeof mount>, frame: number) =>
  rendered.render(frame, [], true);
const motion = { fallbackFrames: 20 };

beforeEach(() => {
  mock.render.mockClear();
  mock.created.length = 0;
  mock.shaderEffects.clear();
});

describe('update motion on shader-effect output', () => {
  it.each([false, true])(
    'moves the visible effect output and preserves its input (Media=%s)',
    (media) => {
      mock.shaderEffects.set('effect', { media, opacity: '0.6' });
      const rendered = mount([
        layer('effect', text(), 'headline', {
          style: 'slide-left',
          durationFrames: 20,
          distance: 40,
        }),
      ]);
      const host = (rendered.host as unknown as Host).shadowRoot!.children[0]!.children[0]!;
      const output = () =>
        host.children.find((child) => child.dataset.ografShaderEffectOutput === 'true')!;
      render(rendered, 0);
      rendered.setData({ headline: 'New' }, 0, false, motion);
      render(rendered, 5);
      expect(contentOf(rendered, 'effect').style.opacity).toBe(media ? '0.5' : '0');
      expect(output().animations.at(-1)).toMatchObject({
        frames: [
          { opacity: 0.3, translate: '-20px 0px' },
          { opacity: 0.3, translate: '-20px 0px' },
        ],
        options: { duration: 0, fill: 'forwards' },
        cancelled: false,
      });
      render(rendered, 10);
      expect(output().animations.at(-1)).toMatchObject({
        frames: [
          { opacity: 0, translate: '-40px 0px' },
          { opacity: 0, translate: '-40px 0px' },
        ],
      });
      render(rendered, 20);
      expect(output().animations.every((animation) => animation.cancelled)).toBe(true);
      expect(output().style.opacity).toBe('0.6');
      if (!media) expect(contentOf(rendered, 'effect').style.opacity).toBe('0');
      rendered.dispose();
    },
  );

  it.each(['skip', 'off-air', 'dispose'])(
    'releases an effect-output hold when finishing early through %s',
    (finish) => {
      mock.shaderEffects.set('effect', { media: false, opacity: '1' });
      const rendered = mount([layer('effect', text(), 'headline')]);
      render(rendered, 0);
      rendered.setData({ headline: 'New' }, 0, false, motion);
      render(rendered, 5);
      const host = (rendered.host as unknown as Host).shadowRoot!.children[0]!.children[0]!;
      const output = host.children.find(
        (child) => child.dataset.ografShaderEffectOutput === 'true',
      )!;
      const hold = output.animations.at(-1)!;
      expect(hold.cancelled).toBe(false);
      if (finish === 'skip') rendered.setData({ headline: 'Skip' }, 6, true);
      else if (finish === 'off-air') rendered.setOnAir(false, 6);
      else rendered.dispose();
      expect(hold.cancelled).toBe(true);
      rendered.dispose();
    },
  );
});

describe('moving changed layers around one data change', () => {
  it('moves only the changed layer, and leaves an unchanged one at rest', () => {
    const rendered = mount([layer('changed', text(), 'headline'), layer('unchanged', text())]);
    render(rendered, 10);
    rendered.setData({ headline: 'New', other: 'Rest' }, 10, false, motion);
    render(rendered, 10);
    expect(contentOf(rendered, 'changed').style.opacity).toBe('1');
    render(rendered, 15);
    expect(Number(contentOf(rendered, 'changed').style.opacity)).toBeCloseTo(0.5, 5);
    expect(contentOf(rendered, 'unchanged').style.opacity).toBeUndefined();
    expect(shownText('changed')).toBe('Old');
    // Half of 20 frames out, so the data changes at frame 20 at the layer's lowest.
    render(rendered, 20);
    expect(shownText('changed')).toBe('New');
    expect(contentOf(rendered, 'changed').style.opacity).toBe('0');
    render(rendered, 25);
    expect(Number(contentOf(rendered, 'changed').style.opacity)).toBeCloseTo(0.5, 5);
    render(rendered, 30);
    expect(contentOf(rendered, 'changed').style.opacity).toBe('');
    expect(contentOf(rendered, 'changed').style.translate).toBe('');
    expect(contentOf(rendered, 'unchanged').style.opacity).toBeUndefined();
  });

  it('lets a layer choose its own style and length over the fallback', () => {
    const rendered = mount([
      layer('slide', text(), 'headline', {
        style: 'slide-left',
        durationFrames: 10,
        distance: 40,
      }),
    ]);
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 5);
    expect(shownText('slide')).toBe('New');
    expect(contentOf(rendered, 'slide').style.opacity).toBe('0');
    expect(contentOf(rendered, 'slide').style.translate).toBe('-40px 0px');
    render(rendered, 10);
    expect(contentOf(rendered, 'slide').style.translate).toBe('');
  });

  it('prefers the composition length to the recipe fallback', () => {
    const rendered = mount([layer('text', text(), 'headline')], {}, 4);
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 2);
    expect(shownText('text')).toBe('New');
  });

  it('waits for the slowest layer before changing the data for all', () => {
    const rendered = mount([
      layer('quick', text(), 'headline', { style: 'crossfade', durationFrames: 4, distance: 0 }),
      layer('slow', text(), 'headline', { style: 'crossfade', durationFrames: 20, distance: 0 }),
    ]);
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 5);
    expect(contentOf(rendered, 'quick').style.opacity).toBe('0');
    expect(shownText('quick')).toBe('Old');
    render(rendered, 10);
    expect(shownText('quick')).toBe('New');
    expect(shownText('slow')).toBe('New');
    render(rendered, 11);
    expect(Number(contentOf(rendered, 'quick').style.opacity)).toBeCloseTo(0.5, 5);
  });

  it('cuts a layer set to update instantly, at the shared data change', () => {
    const rendered = mount([
      layer('fading', text(), 'headline'),
      layer('cutting', text(), 'headline', { style: 'none', durationFrames: 0, distance: 0 }),
    ]);
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 5);
    expect(contentOf(rendered, 'cutting').style.opacity).toBeUndefined();
    expect(shownText('cutting')).toBe('Old');
    render(rendered, 10);
    expect(shownText('cutting')).toBe('New');
  });

  it('applies at once when nothing has to move', () => {
    const rendered = mount([
      layer('cutting', text(), 'headline', { style: 'none', durationFrames: 0, distance: 0 }),
    ]);
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    expect(shownText('cutting')).toBe('New');
  });

  it('applies at once with no motion requested, and when the lane is cut', () => {
    const plain = mount([layer('text', text(), 'headline')]);
    plain.setData({ headline: 'New' }, 0);
    expect(shownText('text')).toBe('New');
    mock.render.mockClear();
    const cut = mount([layer('text', text(), 'headline')]);
    cut.setData({ headline: 'New' }, 0, false, { fallbackFrames: 0 });
    expect(shownText('text')).toBe('New');
  });

  it('gives a self-animating element only an authored length', () => {
    const replaying = {
      ...text(),
      textAnimation: { type: 'typewriter', replayOnUpdate: true },
    } as Element;
    const rendered = mount([layer('fx', replaying, 'headline')]);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    expect(shownText('fx')).toBe('New');
    mock.render.mockClear();
    const authored = mount([
      layer('fx', replaying, 'headline', { style: 'crossfade', durationFrames: 10, distance: 0 }),
    ]);
    authored.setData({ headline: 'New' }, 0, false, motion);
    expect(shownText('fx')).toBe('Old');
  });

  it('moves a layer whose bound position changes', () => {
    const rendered = mount([layer('moved', text(), 'x', undefined, 'layer.x')], {
      data: { x: 1 },
    });
    render(rendered, 0);
    rendered.setData({ x: 2 }, 0, false, motion);
    render(rendered, 5);
    expect(Number(contentOf(rendered, 'moved').style.opacity)).toBeCloseTo(0.5, 5);
  });

  it('skips hidden shared proxies, whose retained instance owns the pixels', () => {
    const rendered = mount(
      [layer('proxy', text(), 'headline'), layer('real', text(), 'headline')],
      {
        hiddenLayers: new Set(['proxy']),
      },
    );
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 5);
    expect(contentOf(rendered, 'proxy').style.opacity).toBeUndefined();
    expect(Number(contentOf(rendered, 'real').style.opacity)).toBeCloseTo(0.5, 5);
  });
});

describe('data that arrives during an update', () => {
  it('replaces the data the layers are leaving for, with one data change', () => {
    const rendered = mount([layer('text', text(), 'headline')]);
    render(rendered, 0);
    rendered.setData({ headline: 'First' }, 0, false, motion);
    render(rendered, 5);
    rendered.setData({ headline: 'Second' }, 5, false, motion);
    render(rendered, 10);
    expect(shownText('text')).toBe('Second');
    expect(mock.render.mock.calls.some(([, element]) => element.content === 'First')).toBe(false);
  });

  it('lets a plain patch join the pending change, without moving anything sooner', () => {
    const rendered = mount([layer('text', text(), 'headline')]);
    render(rendered, 0);
    rendered.setData({ headline: 'First' }, 0, false, motion);
    rendered.setData({ headline: 'Patched' }, 2);
    render(rendered, 5);
    expect(shownText('text')).toBe('Old');
    render(rendered, 10);
    expect(shownText('text')).toBe('Patched');
  });

  it('can go back to what is on screen while the layer is still leaving', () => {
    const rendered = mount([layer('text', text(), 'headline')]);
    render(rendered, 0);
    rendered.setData({ headline: 'First' }, 0, false, motion);
    rendered.setData({ headline: 'Old', other: 'Rest' }, 2, false, motion);
    render(rendered, 10);
    expect(shownText('text')).toBe('Old');
    render(rendered, 20);
    expect(contentOf(rendered, 'text').style.opacity).toBe('');
  });

  it('leaves from where an arriving layer has got to', () => {
    const rendered = mount([layer('text', text(), 'headline')]);
    render(rendered, 0);
    rendered.setData({ headline: 'First' }, 0, false, motion);
    render(rendered, 15);
    const reached = Number(contentOf(rendered, 'text').style.opacity);
    expect(reached).toBeCloseTo(0.5, 5);
    rendered.setData({ headline: 'Second' }, 15, false, motion);
    render(rendered, 15);
    expect(Number(contentOf(rendered, 'text').style.opacity)).toBeCloseTo(reached, 5);
    render(rendered, 20);
    expect(Number(contentOf(rendered, 'text').style.opacity)).toBeCloseTo(reached / 2, 5);
    expect(shownText('text')).toBe('First');
    render(rendered, 25);
    expect(shownText('text')).toBe('Second');
  });

  it('keeps pending data when a Rule sets a field during the wait', async () => {
    const work: TransitionLogicRuleWork[] = [];
    const changed = vi.fn();
    const rule = layer('rule', text(), 'other');
    rule.visualRules = [
      {
        id: 'set',
        name: 'Set',
        enabled: true,
        trigger: 'data',
        dataKey: 'other',
        conditions: [{ dataKey: 'other', sourcePath: [], operator: 'equals', value: 'Go' }],
        sourcePath: [],
        operator: 'equals',
        value: 'Go',
        actions: [{ type: 'set-data', fieldId: 'rule', dataKey: 'count', mode: 'set', value: 1 }],
      },
    ] as NonNullable<CompiledLayer['visualRules']>;
    const rendered = mount([layer('text', text(), 'headline'), rule], {
      data: { headline: 'Old', other: '' },
      scheduleRule: (entry) => work.push(entry),
      ruleDataChanged: changed,
    });
    render(rendered, 0);
    work.length = 0;
    rendered.setData({ headline: 'New', other: 'Go' }, 0);
    expect(work).toHaveLength(1);
    rendered.setData({ headline: 'Newer', other: 'Go' }, 1, false, motion);
    expect(shownText('text')).toBe('New');
    work.shift()!.run();
    expect(changed).toHaveBeenCalledWith({ count: 1 }, 0);
    render(rendered, 11);
    expect(shownText('text')).toBe('Newer');
  });
});

describe('finishing an update early', () => {
  const started = () => {
    const rendered = mount([layer('text', text(), 'headline')]);
    render(rendered, 0);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 5);
    return rendered;
  };

  it('applies at once and clears the pose for a skip', () => {
    const rendered = started();
    rendered.setData({ headline: 'Skipped' }, 6, true);
    expect(shownText('text')).toBe('Skipped');
    expect(contentOf(rendered, 'text').style.opacity || '').toBe('');
  });

  it('settles with the rest of the text when a skip render comes through', () => {
    const rendered = started();
    rendered.settleText();
    expect(shownText('text')).toBe('New');
    expect(contentOf(rendered, 'text').style.opacity || '').toBe('');
  });

  it('settles before a successor inherits, and when going off air', () => {
    const rendered = started();
    const successor = mount([layer('text', text(), 'headline')], { data: { headline: 'New' } });
    successor.inheritRules(rendered, { headline: 'New' }, 6);
    expect(shownText('text')).toBe('New');
    const leaving = started();
    leaving.setOnAir(false, 6);
    expect(contentOf(leaving, 'text').style.opacity || '').toBe('');
  });

  it('resolves waiters when it arrives, finishes or is disposed, and has none when idle', async () => {
    const arrives = started();
    let done = false;
    void arrives.updateSettled!().then(() => {
      done = true;
    });
    render(arrives, 19);
    await Promise.resolve();
    expect(done).toBe(false);
    render(arrives, 20);
    await Promise.resolve();
    expect(done).toBe(true);
    await arrives.updateSettled!();
    const finished = started();
    const finishing = finished.updateSettled!();
    finished.finishUpdate!(6);
    await finishing;
    const disposed = started();
    const disposing = disposed.updateSettled!();
    disposed.dispose();
    await disposing;
  });
});

describe('Rules and replay during an update', () => {
  function ruleLayer() {
    const host = layer('text', text(), 'headline');
    host.visualRules = [
      {
        id: 'changed',
        name: 'Changed',
        enabled: true,
        trigger: 'data',
        dataKey: 'headline',
        conditions: [{ dataKey: 'headline', sourcePath: [], operator: 'equals', value: 'New' }],
        sourcePath: [],
        operator: 'equals',
        value: 'New',
        actions: [],
      },
    ] as NonNullable<CompiledLayer['visualRules']>;
    return host;
  }

  it('fires data Rules once, when the data changes on the template', () => {
    const work: TransitionLogicRuleWork[] = [];
    const rendered = mount([ruleLayer()], { scheduleRule: (entry) => work.push(entry) });
    render(rendered, 0);
    work.length = 0;
    rendered.setData({ headline: 'New' }, 0, false, motion);
    render(rendered, 9);
    expect(work).toHaveLength(0);
    render(rendered, 10);
    expect(work.map((entry) => entry.frame)).toEqual([10]);
    render(rendered, 15);
    expect(work).toHaveLength(1);
  });

  it('gives replay the frame of the data change, on and off air', () => {
    const rendered = mount([ruleLayer()]);
    rendered.setData({ headline: 'New' }, 0, false, motion);
    expect(rendered.nextAlarmFrame!(0)).toBe(10);
    expect(rendered.nextAlarmFrame!(10)).toBeUndefined();
    render(rendered, 10);
    expect(rendered.nextAlarmFrame!(0)).toBeUndefined();
  });

  it('lands on the same pose whichever frames ran, so replay matches live', () => {
    const live = mount([layer('text', text(), 'headline')]);
    live.setData({ headline: 'New' }, 0, false, motion);
    for (let frame = 0; frame <= 13; frame++) render(live, frame);
    const seeking = mount([layer('text', text(), 'headline')]);
    seeking.setData({ headline: 'New' }, 0, false, motion);
    render(seeking, 13);
    expect(contentOf(seeking, 'text').style.opacity).toBe(contentOf(live, 'text').style.opacity);
  });
});

describe('staging resources', () => {
  const stagedOption = (id = 'photo') =>
    mock.render.mock.calls
      .filter(([host]) => (host as Host).dataset.transitionLayerId === id)
      .at(-1)![3] as { stagedImage?: { src: string } };

  it('retains every image in one nine-image update through the staging retry and adoption', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `photo-${index}`);
    const rendered = mount(
      ids.map((id) => layer(id, image(`old-${id}.png`), id, undefined, 'src')),
      { data: Object.fromEntries(ids.map((id) => [id, `old-${id}.png`])) },
    );
    const next = Object.fromEntries(ids.map((id) => [id, `new-${id}.png`]));
    const stage = rendered.stageData!(next);
    const loaded = mock.created.filter((entry) => entry.src.startsWith('new-'));
    expect(loaded).toHaveLength(9);
    loaded.forEach((entry) => entry.finish(10));
    await stage.ready;
    const before = mock.created.length;
    const retry = rendered.stageData!(next);
    expect(retry.loading).toBe(false);
    expect(mock.created.length).toBe(before);
    rendered.setData(next, 0);
    ids.forEach((id, index) =>
      expect(stagedOption(id).stagedImage).toMatchObject({ src: next[id], image: loaded[index] }),
    );
    rendered.dispose();
  });

  it('loads a new image first, then adopts it instead of fetching again', async () => {
    const rendered = mount([layer('photo', image('old.png'), 'photo', undefined, 'src')], {
      data: { photo: 'old.png' },
    });
    const stage = rendered.stageData!({ photo: 'new.png' });
    expect(stage).toMatchObject({ takeRequired: false, loading: true });
    const loaded = mock.created.at(-1)!;
    expect(loaded.src).toBe('new.png');
    loaded.finish(10);
    await stage.ready;
    expect(rendered.stageData!({ photo: 'new.png' })).toMatchObject({ loading: false });
    rendered.setData({ photo: 'new.png' }, 0);
    expect(stagedOption().stagedImage).toMatchObject({ src: 'new.png', image: loaded });
  });

  it('rejects when an image fails, keeps the old one, and tries again next time', async () => {
    const rendered = mount([layer('photo', image('old.png'), 'photo', undefined, 'src')], {
      data: { photo: 'old.png' },
    });
    const calls = mock.render.mock.calls.length;
    const stage = rendered.stageData!({ photo: 'broken.png' });
    mock.created.at(-1)!.finish(0);
    await expect(stage.ready).rejects.toThrow('image');
    expect(mock.render).toHaveBeenCalledTimes(calls);
    const before = mock.created.length;
    rendered.stageData!({ photo: 'broken.png' });
    expect(mock.created.length).toBe(before + 1);
  });

  it('shares one load between repeated requests for the same image', () => {
    const rendered = mount([layer('photo', image('old.png'), 'photo', undefined, 'src')], {
      data: { photo: 'old.png' },
    });
    rendered.stageData!({ photo: 'new.png' });
    const before = mock.created.length;
    rendered.stageData!({ photo: 'new.png' });
    expect(mock.created.length).toBe(before);
  });

  it('needs nothing when an image does not change or is cleared', () => {
    const rendered = mount([layer('photo', image('old.png'), 'photo', undefined, 'src')], {
      data: { photo: 'old.png' },
    });
    const before = mock.created.length;
    expect(rendered.stageData!({ photo: 'old.png' })).toMatchObject({
      takeRequired: false,
      loading: false,
    });
    expect(rendered.stageData!({ photo: '' })).toMatchObject({ loading: false });
    expect(mock.created.length).toBe(before);
  });

  it('asks for a Take for a resource it cannot stage, unless a hidden proxy holds it', () => {
    const lottie = (url: string) =>
      layer('anim', image(url), 'clip', undefined, 'src') as CompiledLayer;
    const sequence = {
      ...lottie('a.png'),
      element: { type: 'image', src: 'a.png', fit: 'contain', fill: { type: 'media' } },
    } as unknown as CompiledLayer;
    const rendered = mount([sequence], { data: { clip: 'a.png' } });
    expect(rendered.stageData!({ clip: 'b.png' }).takeRequired).toBe(true);
    const proxy = mount([sequence], {
      data: { clip: 'a.png' },
      hiddenLayers: new Set(['anim']),
    });
    expect(proxy.stageData!({ clip: 'b.png' }).takeRequired).toBe(false);
  });

  it('stages against the data still waiting to apply', () => {
    const rendered = mount(
      [
        layer('photo', image('old.png'), 'photo', undefined, 'src'),
        layer('text', text(), 'headline'),
      ],
      { data: { photo: 'old.png', headline: 'Old' } },
    );
    rendered.setData({ photo: 'old.png', headline: 'New' }, 0, false, motion);
    // Same data as pending, so no image load and no Take are needed for it.
    expect(rendered.stageData!({ photo: 'old.png', headline: 'New' })).toMatchObject({
      takeRequired: false,
      loading: false,
    });
  });

  it('keeps an image pending data still needs while a newer one loads', async () => {
    const rendered = mount(
      [
        layer('photo', image('old.png'), 'photo', undefined, 'src'),
        layer('text', text(), 'headline'),
      ],
      { data: { photo: 'old.png', headline: 'Old' } },
    );
    const first = rendered.stageData!({ photo: 'b.png', headline: 'New' });
    const loaded = mock.created.at(-1)!;
    loaded.finish(10);
    await first.ready;
    rendered.setData({ photo: 'b.png', headline: 'New' }, 0, false, motion);
    rendered.stageData!({ photo: 'c.png', headline: 'New' });
    render(rendered, 10);
    expect(stagedOption().stagedImage).toMatchObject({ src: 'b.png', image: loaded });
  });

  it('lets images that lost to newer data go, and never a recent one', async () => {
    const rendered = mount([layer('photo', image('old.png'), 'photo', undefined, 'src')], {
      data: { photo: 'old.png' },
    });
    const first = rendered.stageData!({ photo: 'first.png' });
    const loaded = mock.created.at(-1)!;
    loaded.finish(10);
    await first.ready;
    // A competing request staging its own image must not take this one from under it.
    rendered.stageData!({ photo: 'second.png' });
    rendered.setData({ photo: 'first.png' }, 0);
    expect(stagedOption().stagedImage).toMatchObject({ src: 'first.png', image: loaded });
    // Past the cap the oldest goes, so a feed of new images cannot build up.
    for (let index = 0; index < 8; index++) rendered.stageData!({ photo: `feed-${index}.png` });
    const before = mock.created.length;
    rendered.stageData!({ photo: 'feed-7.png' });
    expect(mock.created.length).toBe(before);
    rendered.stageData!({ photo: 'second.png' });
    expect(mock.created.length).toBe(before + 1);
  });

  it('rejects a load still running when the mount is disposed', async () => {
    const rendered = mount([layer('photo', image('old.png'), 'photo', undefined, 'src')], {
      data: { photo: 'old.png' },
    });
    const image_ = rendered.stageData!({ photo: 'new.png' });
    const failure = expect(image_.ready).rejects.toThrow();
    const entry = mock.created.at(-1)!;
    rendered.dispose();
    entry.listeners.get('error')?.();
    await failure;
  });
});
