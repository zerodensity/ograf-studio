import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createRectangleLayer,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  /** Where the playhead was put (`seek`) and what it was played through (`play`: from, to). */
  const moves: Array<{ seek: number } | { play: [number, number] }> = [];
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
  return { moves, sounds };
});
vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 30,
      seek: (value: number) => {
        frame = value;
        mock.moves.push({ seek: value });
      },
      animateTo: (value: number, options: { onUpdate?: () => void; onComplete?: () => void }) => {
        mock.moves.push({ play: [frame, value] });
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
vi.mock('./mediaCueRuntime', () => ({
  MediaCueRuntime: class {
    reset() {
      mock.sounds.push('rearm');
    }
    resumeBlocked() {}
    renderAtTime(timestampMs: number, options: { includeAudio?: boolean; jumped?: boolean } = {}) {
      if (options.includeAudio === false) return;
      mock.sounds.push(`${options.jumped ? 'put at' : 'played to'} ${timestampMs}`);
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

/** Start at frame 0, two Steps at 10 and 20, End at 30, at ten frames a second. */
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
    transitions: [],
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

beforeEach(() => {
  mock.moves.length = 0;
  mock.sounds.length = 0;
});

describe('taking a graphic in again', () => {
  it('plays the In from the Start keyframe, with its sounds armed again', async () => {
    const graphic = await loaded();
    await graphic.playAction({});
    await graphic.stopAction({});
    mock.moves.length = 0;
    mock.sounds.length = 0;

    expect(await graphic.playAction({})).toMatchObject({ statusCode: 200, currentStep: 0 });

    // Without the return to Start the playhead would run from the End back to the Step.
    expect(mock.moves).toEqual([{ seek: 0 }, { play: [0, 10] }]);
    // The return itself is silent, and the sounds are armed before anything plays.
    expect(mock.sounds[0]).toBe('rearm');
    expect(mock.sounds.slice(1).every((entry) => entry === 'played to 1000')).toBe(true);
    expect(mock.sounds.length).toBeGreaterThan(1);
  });

  it('carries on from where it stands on the way to the next Step', async () => {
    const graphic = await loaded();
    await graphic.playAction({});
    mock.moves.length = 0;
    mock.sounds.length = 0;

    expect(await graphic.playAction({})).toMatchObject({ statusCode: 200, currentStep: 1 });

    expect(mock.moves).toEqual([{ play: [10, 20] }]);
    expect(mock.sounds).not.toContain('rearm');
  });

  it('starts again from the Start keyframe after an Out without animation', async () => {
    const graphic = await loaded();
    await graphic.playAction({});
    await graphic.stopAction({ skipAnimation: true });
    mock.moves.length = 0;

    await graphic.playAction({});

    expect(mock.moves).toEqual([{ seek: 0 }, { play: [0, 10] }]);
  });
});

describe('putting the playhead somewhere', () => {
  it('tells the sound cues it was put there, not played there', async () => {
    const graphic = await loaded();
    mock.sounds.length = 0;

    await graphic.playAction({ skipAnimation: true });
    expect(mock.sounds).toEqual(['put at 1000']);

    mock.sounds.length = 0;
    await graphic.goToTime({ timestamp: 1500 });
    expect(mock.sounds).toEqual(['rearm', 'put at 1500']);
  });
});
