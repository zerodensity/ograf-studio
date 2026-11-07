import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import {
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createRectangleLayer,
  createShaderPaint,
  type Element,
} from '@ograf-editor/scene-model';

const SUSPENDED = 'data-ograf-presentation-suspended';

const mock = vi.hoisted(() => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    attributes = new Map<string, string>();
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
    querySelectorAll() {
      return [];
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    hasAttribute(name: string) {
      return this.attributes.has(name);
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
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    frames,
    content: vi.fn(),
    render: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    effects: vi.fn(),
    paintsReady: vi.fn(async () => {}),
  };
});
vi.mock('./mediaPaintRendering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mediaPaintRendering')>()),
  waitForMediaPaintContentReady: mock.paintsReady,
}));
vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let frame = 0;
    return {
      frame: () => frame,
      durationFrames: () => 30,
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
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./effectCompositing', () => ({
  applyLayerEffectsFilter: mock.effects,
  disposeLayerEffects: () => {},
  resumeLayerEffects: mock.resume,
  suspendLayerEffects: mock.suspend,
  waitForLayerEffectsReady: async () => {},
}));
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: mock.render,
  renderAnimatedElementAtTime: mock.content,
  applyAnimatedPaint: () => {},
  disposeElementContent: () => {},
  setLottieDeterministicRendering: () => {},
  waitForElementContentReady: async () => {},
}));
import { GraphicElement } from './GraphicElement';

function shaderDescriptor(): CompiledGraphicDescriptor {
  const authored = createRectangleLayer();
  if (authored.element.type !== 'rectangle') throw Error('Expected rectangle');
  const fill = createShaderPaint({
    fragmentSource: `#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.4;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`,
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
        element: { ...authored.element, fill },
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
        bindings: [{ dataKey: 'gain', targetProperty: 'fill.parameters.gain' }],
        loop: createLayerLoopClip({
          durationFrames: 20,
          activation: { type: 'step', stepKeyframeId: 'step1' },
          tracks: {
            'fill.parameters.gain': [
              { id: 'g0', frame: 0, value: 0, easing: 'linear' },
              { id: 'g1', frame: 20, value: 2, easing: 'linear' },
            ],
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
    transitions: [],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1', 'step2'],
    stepCount: 2,
    customActions: [],
  };
}

/** Nothing here draws per frame: no paint, no loop, no animated content. */
function staticDescriptor(): CompiledGraphicDescriptor {
  const source = shaderDescriptor();
  const authored = createRectangleLayer();
  return {
    ...source,
    layers: [
      {
        ...source.layers[0]!,
        id: 'static',
        element: authored.element as CompiledGraphicDescriptor['layers'][number]['element'],
        bindings: [],
        loop: null,
      },
    ],
  };
}

async function loaded(compiled: CompiledGraphicDescriptor) {
  class Graphic extends GraphicElement {
    static descriptor = compiled;
  }
  const graphic = new Graphic();
  graphic.connectedCallback();
  expect(
    await graphic.load({
      renderType: 'realtime',
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      data: { gain: 0.5 },
    }),
  ).toMatchObject({ statusCode: 200 });
  return graphic;
}

function runFrames(now: number): void {
  const pending = [...mock.frames.values()];
  mock.frames.clear();
  for (const callback of pending) callback(now);
}

function renderedGain(): unknown {
  const element = mock.render.mock.calls.at(-1)?.[1] as Element;
  if (element.type !== 'rectangle' || typeof element.fill === 'string')
    throw Error('Expected a painted rectangle');
  return element.fill.type === 'shader' ? element.fill.parameters.gain : undefined;
}

/** Compared by hand: a matcher printing the fake host trips the DOM pretty-printer. */
function lastResume(graphic: GraphicElement) {
  const [root, framesParked] = mock.resume.mock.calls.at(-1) as [unknown, boolean];
  return { onShadowRoot: root === graphic.shadowRoot, framesParked };
}

let now = 1000;
beforeEach(() => {
  vi.clearAllMocks();
  mock.frames.clear();
  mock.resume.mockReturnValue(async () => {});
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('suspended graphic presentation', () => {
  it('stops every frame loop and keeps the transport and data working', async () => {
    const graphic = await loaded(shaderDescriptor());
    expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({
      statusCode: 200,
      currentStep: 0,
    });
    expect(mock.frames.size).toBeGreaterThan(1);

    graphic.setPresentationSuspended(true);
    expect(mock.frames.size).toBe(0);
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);
    expect(mock.suspend.mock.calls.at(-1)?.[0] === graphic.shadowRoot).toBe(true);
    const drawn = mock.content.mock.calls.length;

    expect(await graphic.playAction({ skipAnimation: true })).toMatchObject({
      statusCode: 200,
      currentStep: 1,
    });
    expect(await graphic.updateAction({ data: { gain: 1.5 }, skipAnimation: true })).toMatchObject({
      statusCode: 200,
    });
    expect(renderedGain()).toBe(1.5);
    expect(mock.frames.size).toBe(0);
    expect(mock.content.mock.calls.length).toBe(drawn);

    expect(await graphic.stopAction({ skipAnimation: true })).toMatchObject({ statusCode: 200 });
    expect(mock.frames.size).toBe(0);
    await graphic.dispose();
  });

  it('resumes on the current time, and reveals only after the refreshed picture commits', async () => {
    const graphic = await loaded(shaderDescriptor());
    const epoch = now;
    graphic.setPresentationSuspended(true);
    now = epoch + 60_000;

    let commit!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    );
    mock.resume.mockReturnValue(refresh);
    graphic.setPresentationSuspended(false);
    expect(lastResume(graphic)).toEqual({ onShadowRoot: true, framesParked: true });
    expect(mock.frames.size).toBe(2);
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);

    const drawn = mock.content.mock.calls.length;
    runFrames(now);
    // The content loop draws first, on the live clock, so the refresh captures its output.
    expect(mock.content.mock.calls.length).toBeGreaterThan(drawn);
    expect(mock.content.mock.calls.at(-1)?.[2]).toBe(60_000);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mock.content.mock.invocationCallOrder.at(-1)).toBeLessThan(
      refresh.mock.invocationCallOrder[0]!,
    );
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);

    commit();
    await vi.waitFor(() => expect(graphic.hasAttribute(SUSPENDED)).toBe(false));
    expect(mock.frames.size).toBe(1);
    await graphic.dispose();
  });

  it('holds the reveal and the capture until the resumed paints have drawn', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    let painted!: () => void;
    mock.paintsReady.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        painted = resolve;
      }),
    );
    const refresh = vi.fn(async () => {});
    mock.resume.mockReturnValue(refresh);
    graphic.setPresentationSuspended(false);
    runFrames(now);
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);

    painted();
    await vi.waitFor(() => expect(graphic.hasAttribute(SUSPENDED)).toBe(false));
    expect(refresh).toHaveBeenCalledOnce();
    await graphic.dispose();
  });

  it('holds the reveal for those paints on a graphic with no effect stack', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    let painted!: () => void;
    mock.paintsReady.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        painted = resolve;
      }),
    );
    mock.resume.mockReturnValue(null);
    graphic.setPresentationSuspended(false);
    runFrames(now);
    await Promise.resolve();
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);
    painted();
    await vi.waitFor(() => expect(graphic.hasAttribute(SUSPENDED)).toBe(false));
    await graphic.dispose();
  });

  it('reveals even when a paint fails', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    mock.paintsReady.mockRejectedValueOnce(new Error('decoder failed'));
    graphic.setPresentationSuspended(false);
    runFrames(now);
    await vi.waitFor(() => expect(graphic.hasAttribute(SUSPENDED)).toBe(false));
    await graphic.dispose();
  });

  it('shows a graphic with nothing stale straight away', async () => {
    const graphic = await loaded(staticDescriptor());
    expect(mock.frames.size).toBe(0);
    graphic.setPresentationSuspended(true);
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);

    mock.resume.mockReturnValue(null);
    graphic.setPresentationSuspended(false);
    expect(lastResume(graphic)).toEqual({ onShadowRoot: true, framesParked: false });
    expect(graphic.hasAttribute(SUSPENDED)).toBe(false);
    expect(mock.frames.size).toBe(0);
    await graphic.dispose();
  });

  it('stays blank when hidden again before the refreshed picture commits', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    let commit!: () => void;
    mock.resume.mockReturnValue(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    );
    graphic.setPresentationSuspended(false);
    runFrames(now);
    await vi.waitFor(() => expect(commit).toBeDefined());
    graphic.setPresentationSuspended(true);
    commit();
    await new Promise((resolve) => setTimeout(resolve));
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);
    expect(mock.frames.size).toBe(0);
    await graphic.dispose();
  });

  it('cancels a pending reveal when hidden again before its frame', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    const refresh = vi.fn(async () => {});
    mock.resume.mockReturnValue(refresh);
    graphic.setPresentationSuspended(false);
    graphic.setPresentationSuspended(true);
    expect(mock.frames.size).toBe(0);
    mock.resume.mockReturnValue(async () => {});
    graphic.setPresentationSuspended(false);
    expect(mock.frames.size).toBe(2);
    runFrames(now);
    expect(refresh).not.toHaveBeenCalled();
    await graphic.dispose();
  });

  it('never leaves the graphic blank when a capture does not finish', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    mock.resume.mockReturnValue(() => new Promise<void>(() => {}));
    graphic.setPresentationSuspended(false);
    runFrames(now);
    await vi.advanceTimersByTimeAsync(999);
    expect(graphic.hasAttribute(SUSPENDED)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(graphic.hasAttribute(SUSPENDED)).toBe(false);
    await graphic.dispose();
  });

  it('keeps parked frames parked through a window move, and resumes them on the new window', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    graphic.adoptedCallback();
    expect(mock.frames.size).toBe(0);
    graphic.setPresentationSuspended(false);
    expect(mock.frames.size).toBe(2);
    await graphic.dispose();
  });

  it('holds frames for a graphic loaded while suspended, and draws them when shown', async () => {
    class Graphic extends GraphicElement {
      static descriptor = shaderDescriptor();
    }
    const graphic = new Graphic();
    graphic.setPresentationSuspended(true);
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: { gain: 0.5 },
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(mock.frames.size).toBe(0);
    const drawn = mock.content.mock.calls.length;
    graphic.setPresentationSuspended(false);
    runFrames(now);
    expect(mock.content.mock.calls.length).toBeGreaterThan(drawn);
    await graphic.dispose();
  });

  it('drops parked frames on dispose so a late resume cannot revive them', async () => {
    const graphic = await loaded(shaderDescriptor());
    graphic.setPresentationSuspended(true);
    await graphic.dispose();
    mock.resume.mockReturnValue(null);
    graphic.setPresentationSuspended(false);
    expect(mock.frames.size).toBe(0);
    expect(lastResume(graphic).framesParked).toBe(false);
  });
});
