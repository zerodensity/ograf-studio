import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createTextElement,
  type Element,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  /** The animations the timeline has been asked for, oldest first: finished by the test, or cut short. */
  const running: Array<{ to: number; cut: boolean; finish: () => void }> = [];
  /** Update fades the content has been asked for and not yet finished. */
  const fades: Array<() => void> = [];
  const hooks: { holdFades: boolean; loading: Promise<void> | null } = {
    holdFades: false,
    loading: null,
  };
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
    querySelectorAll() {
      return [];
    }
    setAttribute() {}
    removeAttribute() {}
    hasAttribute() {
      return false;
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
    animate(_keyframes: unknown, options: { duration: number }) {
      if (options.duration === 0 || !hooks.holdFades)
        return { finished: Promise.resolve(), cancel() {} };
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      fades.push(finish);
      return { finished, cancel() {} };
    }
  }
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return { Host, running, fades, hooks };
});
type Host = InstanceType<typeof mock.Host>;

vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 30,
      seek: (value: number) => {
        frame = value;
      },
      // An animation runs until the test finishes it, as a long Take in runs for its author's time.
      animateTo: (
        value: number,
        options: { onUpdate?: () => void; onComplete?: () => void; onInterrupt?: () => void },
      ) => {
        const animation = {
          to: value,
          cut: false,
          finish: () => {
            frame = value;
            options.onUpdate?.();
            options.onComplete?.();
          },
        };
        mock.running.push(animation);
        return {
          cancel() {
            animation.cut = true;
            options.onInterrupt?.();
          },
        };
      },
      dispose() {},
      pause() {},
      setClockOwner() {},
    };
  },
}));
vi.mock('./documentFonts', () => ({
  registerDocumentFonts: async () => {
    await mock.hooks.loading;
  },
}));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: (host: Host, element: Element) => {
    host.dataset.shows = (element as { content?: string }).content ?? '';
    host.firstElementChild ??= new mock.Host();
  },
  renderAnimatedElementAtTime: () => {},
  applyAnimatedPaint: () => {},
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: async () => {},
}));
vi.mock('./textAnimationRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./textAnimationRendering')>()),
  renderTextAnimationAtFrame: () => {},
  setTextAnimationPrevious: () => {},
}));
import { GraphicElement } from './GraphicElement';

/** One text layer that shows the `title` field. Start at 0, Step at 10, End at 30, ten frames a second. */
function descriptor(updateTransitionFrames: number): CompiledGraphicDescriptor {
  const layer = {
    id: 'title',
    isVisible: true,
    element: createTextElement({ content: 'title' }),
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
    bindings: [{ dataKey: 'title', targetProperty: 'content' }],
  } as CompiledLayer;
  return {
    width: 640,
    height: 360,
    frameRate: 10,
    backgroundColor: 'transparent',
    updateTransitionFrames,
    layers: [layer],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'step1', frame: 10, role: 'step' },
      { id: 'end', frame: 30, role: 'end' },
    ],
    transitions: [],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1'],
    stepCount: 1,
    customActions: [],
  } as CompiledGraphicDescriptor;
}

function created(updateTransitionFrames = 0): GraphicElement {
  const source = descriptor(updateTransitionFrames);
  class Graphic extends GraphicElement {
    static descriptor = source;
  }
  const graphic = new Graphic();
  graphic.connectedCallback();
  return graphic;
}

async function loaded(updateTransitionFrames = 0): Promise<GraphicElement> {
  const graphic = created(updateTransitionFrames);
  expect(
    await graphic.load({
      renderType: 'realtime',
      renderCharacteristics: {},
      data: { title: 'old' },
    }),
  ).toMatchObject({ statusCode: 200 });
  return graphic;
}

/** What the title layer shows now. */
function shown(graphic: GraphicElement): string | undefined {
  const search = (hosts: Host[]): Host | undefined => {
    for (const host of hosts) {
      if (host.dataset.ografLayerId === 'title') return host;
      const nested = search(host.children);
      if (nested) return nested;
    }
    return undefined;
  };
  return search((graphic.shadowRoot as unknown as Host).children)?.dataset.shows;
}

/** Lets everything that can run without the timeline or a fade finishing do so. */
const settle = async () => {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
};

beforeEach(() => {
  mock.running.length = 0;
  mock.fades.length = 0;
  mock.hooks.holdFades = false;
  mock.hooks.loading = null;
});

describe('a data update while the graphic animates', () => {
  it('shows during a Take in that is still running', async () => {
    const graphic = await loaded();
    let taken = false;
    const takeIn = graphic.playAction({}).then(() => {
      taken = true;
    });
    await settle();
    expect(mock.running).toHaveLength(1);

    expect(await graphic.updateAction({ data: { title: 'new' } })).toMatchObject({
      statusCode: 200,
    });

    expect(shown(graphic)).toBe('new');
    expect(taken).toBe(false);
    mock.running[0]!.finish();
    await takeIn;
    expect(shown(graphic)).toBe('new');
  });

  it('shows during a Take out that is still running', async () => {
    const graphic = await loaded();
    await graphic.playAction({ skipAnimation: true });
    const takeOut = graphic.stopAction({});
    await settle();
    expect(mock.running).toHaveLength(1);

    await graphic.updateAction({ data: { title: 'new' } });

    expect(shown(graphic)).toBe('new');
    mock.running[0]!.finish();
    await takeOut;
  });

  it('still lets the fade of the update before it finish first', async () => {
    const graphic = await loaded(4);
    await graphic.playAction({ skipAnimation: true });
    mock.hooks.holdFades = true;
    const first = graphic.updateAction({ data: { title: 'first' } });
    const second = graphic.updateAction({ data: { title: 'second' } });
    await settle();
    // The first update is fading the old title out; the second has not touched the graphic.
    expect(shown(graphic)).toBe('old');
    expect(mock.fades).toHaveLength(1);

    mock.hooks.holdFades = false;
    mock.fades[0]!();
    await first;
    await second;
    expect(shown(graphic)).toBe('second');
  });
});

describe('what a data update still waits for', () => {
  it('waits for the graphic to load', async () => {
    let finishLoading = () => {};
    mock.hooks.loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    const graphic = created();
    const loading = graphic.load({
      renderType: 'realtime',
      renderCharacteristics: {},
      data: { title: 'old' },
    });
    let updated = false;
    const update = graphic.updateAction({ data: { title: 'new' } }).then(() => {
      updated = true;
    });
    await settle();
    expect(updated).toBe(false);

    finishLoading();
    await loading;
    await update;
    expect(shown(graphic)).toBe('new');
  });
});

describe('what waits for a data update', () => {
  it('a Take in asked after an update starts once that update has faded in', async () => {
    const graphic = await loaded(4);
    await graphic.playAction({ skipAnimation: true });
    await graphic.stopAction({ skipAnimation: true });
    mock.hooks.holdFades = true;
    const update = graphic.updateAction({ data: { title: 'new' } });
    const takeIn = graphic.playAction({});
    await settle();
    expect(mock.running).toHaveLength(0);

    mock.hooks.holdFades = false;
    for (const finish of mock.fades) finish();
    await update;
    await settle();
    expect(mock.running).toHaveLength(1);
    mock.running[0]!.finish();
    await takeIn;
  });

  it('a Take out asked during a Take in cuts it short, and keeps an update sent meanwhile', async () => {
    const graphic = await loaded();
    const takeIn = graphic.playAction({});
    await settle();
    const update = graphic.updateAction({ data: { title: 'new' } });
    const takeOut = graphic.stopAction({});
    await takeIn;
    await update;
    await settle();
    // The Take in was cut short and the Take out is animating: nothing waited for the In's length.
    expect(mock.running.map((animation) => [animation.to, animation.cut])).toEqual([
      [10, true],
      [30, false],
    ]);
    expect(shown(graphic)).toBe('new');
    mock.running[1]!.finish();
    await takeOut;
  });
});
