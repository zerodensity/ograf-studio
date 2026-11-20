import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createRectangleLayer,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  /** The animations the timeline was asked for, oldest first, and how the test moves or ends them. */
  const animations: Array<{
    from: number;
    to: number;
    durationMs: number | undefined;
    state: 'running' | 'finished' | 'cut';
    moveTo(frame: number): void;
    finish(): void;
  }> = [];
  /** What the sound cues were told, in order. */
  const sounds: string[] = [];
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
  }
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return { animations, sounds };
});
vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 30,
      seek: (value: number) => {
        frame = value;
      },
      // An animation runs until the test finishes it, and can be cancelled, as the real player's can.
      animateTo: (
        value: number,
        options: {
          durationMs?: number;
          onUpdate?: () => void;
          onComplete?: () => void;
          onInterrupt?: () => void;
        },
      ) => {
        const animation: (typeof mock.animations)[number] = {
          from: frame,
          to: value,
          durationMs: options.durationMs,
          state: 'running',
          moveTo(next) {
            frame = next;
            options.onUpdate?.();
          },
          finish() {
            if (animation.state !== 'running') return;
            animation.state = 'finished';
            frame = value;
            options.onUpdate?.();
            options.onComplete?.();
          },
        };
        mock.animations.push(animation);
        return {
          cancel() {
            if (animation.state !== 'running') return;
            animation.state = 'cut';
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
vi.mock('./mediaCueRuntime', () => ({
  MediaCueRuntime: class {
    reset() {
      mock.sounds.push('rearm');
    }
    resumeBlocked() {}
    renderAtTime(timestampMs: number, options: { includeAudio?: boolean; jumped?: boolean } = {}) {
      if (options.includeAudio === false) return;
      const entry = `${options.jumped ? 'put at' : 'played to'} ${timestampMs}`;
      if (mock.sounds.at(-1) !== entry) mock.sounds.push(entry);
    }
    dispose() {}
  },
}));
vi.mock('./documentFonts', () => ({ registerDocumentFonts: async () => {} }));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: () => {},
  renderAnimatedElementAtTime: () => {},
  applyAnimatedPaint: () => {},
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: async () => {},
}));
import { GraphicElement } from './GraphicElement';

/**
 * Start at frame 0, two Steps at 10 and 20, End at 30, at ten frames a second. The Out is the last ten
 * frames, one second.
 */
function descriptor(): CompiledGraphicDescriptor {
  return {
    width: 640,
    height: 360,
    frameRate: 10,
    backgroundColor: 'transparent',
    layers: [
      {
        id: 'box',
        isVisible: true,
        element: createRectangleLayer().element,
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
        bindings: [],
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
  } as CompiledGraphicDescriptor;
}

async function loaded(): Promise<GraphicElement> {
  const source = descriptor();
  class Graphic extends GraphicElement {
    static descriptor = source;
  }
  const graphic = new Graphic();
  graphic.connectedCallback();
  expect(
    await graphic.load({ renderType: 'realtime', renderCharacteristics: {}, data: {} }),
  ).toMatchObject({ statusCode: 200 });
  return graphic;
}

/** Lets everything that can run without an animation finishing do so. */
const settle = async () => {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
};

/** Each animation asked for so far: from, to and how it stands. */
const asked = () =>
  mock.animations.map((animation) => [animation.from, animation.to, animation.state]);

beforeEach(() => {
  mock.animations.length = 0;
  mock.sounds.length = 0;
});

describe('a Take out while the graphic animates in', () => {
  it('cuts the Take in short and goes out from the frame it stopped at', async () => {
    const graphic = await loaded();
    const takeIn = graphic.playAction({});
    await settle();
    mock.animations[0]!.moveTo(4);

    const takeOut = graphic.stopAction({});

    // The Take in answers at once. It never arrived, so it names no Step.
    expect(await takeIn).toEqual({ statusCode: 200, statusMessage: 'A Take out cut this short.' });
    await settle();
    expect(asked()).toEqual([
      [0, 10, 'cut'],
      [4, 30, 'running'],
    ]);
    // The Out takes its own second, not the time the rest of the timeline would.
    expect(mock.animations[1]!.durationMs).toBe(1000);
    mock.animations[1]!.finish();
    expect(await takeOut).toMatchObject({ statusCode: 200 });
  });

  it('leaves the sounds the Out skips silent', async () => {
    const graphic = await loaded();
    void graphic.playAction({});
    await settle();
    mock.animations[0]!.moveTo(4);
    mock.sounds.length = 0;

    const takeOut = graphic.stopAction({});
    await settle();
    // Halfway from frame 4 to the End is halfway through the Out's own ten frames, 20 to 30.
    mock.animations[1]!.moveTo(17);
    mock.animations[1]!.finish();
    await takeOut;

    // The playhead is put just past where the Out begins, then played through the Out alone. Played
    // through frames 4 to 20 instead, every sound of both Steps would start within that second.
    expect(mock.sounds).toEqual([
      'played to 400',
      'put at 2050',
      'played to 2500',
      'played to 3000',
    ]);
  });

  it('plays from the Start keyframe when taken in after it', async () => {
    const graphic = await loaded();
    void graphic.playAction({});
    await settle();
    mock.animations[0]!.moveTo(4);
    const takeOut = graphic.stopAction({});
    await settle();
    mock.animations[1]!.finish();
    await takeOut;
    mock.sounds.length = 0;

    const takeIn = graphic.playAction({});
    await settle();

    expect(asked().at(-1)).toEqual([0, 10, 'running']);
    expect(mock.sounds[0]).toBe('rearm');
    mock.animations.at(-1)!.finish();
    expect(await takeIn).toMatchObject({ statusCode: 200, currentStep: 0 });
  });

  it('cuts to the End at once when it has no animation, so a Replay starts over', async () => {
    const graphic = await loaded();
    const takeIn = graphic.playAction({});
    await settle();
    mock.animations[0]!.moveTo(4);

    const takeOut = graphic.stopAction({ skipAnimation: true });
    const again = graphic.playAction({});
    await takeIn;
    await takeOut;
    await settle();

    expect(asked()).toEqual([
      [0, 10, 'cut'],
      [0, 10, 'running'],
    ]);
    mock.animations[1]!.finish();
    expect(await again).toMatchObject({ statusCode: 200, currentStep: 0 });
  });
});

describe('a Take out while the graphic animates to its next Step', () => {
  it('cuts the Step change short and leaves the graphic on the Step it came from', async () => {
    const graphic = await loaded();
    await graphic.playAction({ skipAnimation: true });
    const next = graphic.playAction({});
    await settle();
    mock.animations[0]!.moveTo(15);

    const takeOut = graphic.stopAction({});

    expect(await next).toEqual({
      statusCode: 200,
      statusMessage: 'A Take out cut this short.',
      currentStep: 0,
    });
    await settle();
    expect(asked()).toEqual([
      [10, 20, 'cut'],
      [15, 30, 'running'],
    ]);
    mock.animations[1]!.finish();
    await takeOut;
  });

  it('lets a Step change that was waiting behind it show nothing', async () => {
    const graphic = await loaded();
    await graphic.playAction({ skipAnimation: true });
    void graphic.playAction({});
    await settle();
    const waiting = graphic.playAction({});

    const takeOut = graphic.stopAction({});

    expect(await waiting).toMatchObject({ statusMessage: 'A Take out cut this short.' });
    await settle();
    // No third animation: the waiting Step change gave way to the Take out.
    expect(asked()).toEqual([
      [10, 20, 'cut'],
      [10, 30, 'running'],
    ]);
    mock.animations[1]!.finish();
    await takeOut;
  });
});

describe('what a Take out still waits for', () => {
  it('lets a Take out that is already animating finish', async () => {
    const graphic = await loaded();
    await graphic.playAction({ skipAnimation: true });
    const first = graphic.stopAction({});
    await settle();

    const second = graphic.stopAction({});
    await settle();

    expect(asked()).toEqual([[10, 30, 'running']]);
    mock.animations[0]!.finish();
    await first;
    await settle();
    for (const animation of mock.animations) animation.finish();
    await second;
  });
});
