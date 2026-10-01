import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, ScheduledAction } from '@ograf-editor/ograf-types';
import {
  applyShaderAnimationValues,
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createRectangleLayer,
  createShaderPaint,
  resolveShaderParameters,
  sampleShaderAnimationValues,
  type Element,
  type LayerAnimationTracks,
  type MaskRenderState,
} from '@ograf-editor/scene-model';
import { resolveFrameExpressions } from './expressionRendering';
import { applyCompiledMasks } from './maskRendering';

const mock = vi.hoisted(() => {
  class Host {
    style = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
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
  }
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  return { paint: vi.fn(), content: vi.fn(), timelineTime: 0 };
});
vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let seconds = 0;
    return {
      time: () => seconds,
      seek: (value: number) => {
        seconds = value;
        mock.timelineTime = value;
      },
      kill() {},
      pause() {},
      tweenTo: (value: number, options: { duration?: number; onComplete?: () => void }) => {
        seconds = value;
        mock.timelineTime = value;
        options.onComplete?.();
        return { kill() {} };
      },
    };
  },
}));
vi.mock('./documentFonts', () => ({ registerDocumentFonts: async () => {} }));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: vi.fn() }));
vi.mock('./renderElement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./renderElement')>();
  return {
    ...actual,
    renderElementContent: (host: HTMLElement, element: Element) => {
      host.dataset.ografRenderedElement = JSON.stringify(element);
    },
    renderAnimatedElementAtTime: mock.content,
    applyAnimatedPaint: mock.paint,
    disposeElementContent: () => {},
    setLottieDeterministicRendering: () => {},
    waitForElementContentReady: async () => {},
  };
});
import { GraphicElement } from './GraphicElement';

function descriptor(): CompiledGraphicDescriptor {
  const authored = createRectangleLayer();
  if (authored.element.type !== 'rectangle') throw Error('Expected rectangle');
  const paint = createShaderPaint({
    fragmentSource: `#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.4;
#pragma ograf count slider min(0) max(10)
const int count = 3;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`,
  });
  const key = (id: string, frame: number, value: number) => ({
    id,
    frame,
    value,
    easing: 'linear' as const,
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
        element: { ...authored.element, fill: paint },
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
        bindings: [
          { dataKey: 'gain', targetProperty: 'fill.parameters.gain' },
          { dataKey: 'count', targetProperty: 'fill.parameters.count' },
        ],
        loop: createLayerLoopClip({
          durationFrames: 20,
          activation: { type: 'step', stepKeyframeId: 'step1' },
          tracks: {
            'fill.parameters.gain': [key('g0', 0, 0), key('g1', 10, 2), key('g2', 20, 0)],
            'fill.parameters.count': [key('c0', 0, 2), key('c1', 10, 8), key('c2', 20, 2)],
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
    transitions: [
      { fromKeyframeId: 'step2', toKeyframeId: 'end', durationFrames: 10, easing: 'linear' },
    ],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1', 'step2'],
    stepCount: 2,
    customActions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.timelineTime = 0;
});

describe('scheduled shader lifecycle replay', () => {
  it('isolates module state between instances of the same graphic and resets it on reload', async () => {
    class Graphic extends GraphicElement {
      static descriptor = descriptor();
    }
    Graphic.descriptor.scripting = {
      enabled: true,
      source: 'layerById("shader").x = counter.next();',
      modules: [{ fileName: 'counter.js', source: 'let n = 0; export const next = () => ++n;' }],
    };
    const a = new Graphic(),
      b = new Graphic();
    const load = async (graphic: Graphic) => {
      graphic.connectedCallback();
      await graphic.load({
        renderType: 'non-realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
      });
      return vi.mocked(applyCompiledMasks).mock.calls.at(-1)!;
    };
    const first = await load(a);
    const second = await load(b);
    const evaluate = (call: typeof first) =>
      resolveFrameExpressions(call[0], call[2], call[3]).get('shader')!.transform.x;
    expect(first[0].scripting).not.toBe(second[0].scripting);
    expect(evaluate(first)).toBe(1);
    expect(evaluate(first)).toBe(2);
    expect(evaluate(second)).toBe(1);
    await a.dispose();
    expect(evaluate(await load(a))).toBe(1);
    await a.dispose();
    await b.dispose();
  });

  it('keeps composition-frame semantics when stopAction exits from an earlier Step', async () => {
    class Graphic extends GraphicElement {
      static descriptor = descriptor();
    }
    Graphic.descriptor.layers[0]!.expressions = {
      x: 'frame',
      y: 'clamp((frame - timeline.lastStepFrame) / (timeline.endFrame - timeline.lastStepFrame), 0, 1)',
      width: 'timeline.exitProgress',
    };
    Graphic.descriptor.scripting = {
      enabled: true,
      modules: [],
      source: 'layerById("shader").height = frame + timeline.exitProgress;',
    };
    const graphic = new Graphic();
    graphic.connectedCallback();
    await graphic.load({
      renderType: 'non-realtime',
      renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
    });
    await graphic.setActionsSchedule({
      schedule: [
        { timestamp: 0, action: { type: 'playAction', params: {} } },
        { timestamp: 3000, action: { type: 'stopAction', params: {} } },
      ],
    });
    for (const [timestamp, expectedFrame, exitProgress, lifecycleExit] of [
      [2500, 10, 0, 0],
      [3000, 10, 0, 0],
      [3500, 20, 0, 0.5],
      [3750, 25, 0.5, 0.75],
      [4000, 30, 1, 1],
      [3500, 20, 0, 0.5],
    ]) {
      await graphic.goToTime({ timestamp: timestamp! });
      const [compiled, , states, data] = vi.mocked(applyCompiledMasks).mock.calls.at(-1)!;
      const result = resolveFrameExpressions(
        compiled,
        states as Map<string, MaskRenderState>,
        data,
      );
      expect(result.get('shader')!.transform).toMatchObject({
        x: expectedFrame,
        y: exitProgress,
        width: lifecycleExit,
        height: expectedFrame! + lifecycleExit!,
      });
    }
    await graphic.dispose();
  });

  it.each(['stopAction', 'playAction'] as const)(
    'drives expression time from OGraf Steps, holds and %s rather than schedule elapsed time',
    async (exitAction) => {
      class Graphic extends GraphicElement {
        static descriptor = descriptor();
      }
      Graphic.descriptor.layers[0]!.expressions = {
        x: 'frame',
        y: 'time',
        width: 'timeline.firstStepFrame',
        height: 'timeline.lastStepFrame',
      };
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'non-realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        }),
      ).toMatchObject({ statusCode: 200 });
      expect(
        await graphic.setActionsSchedule({
          schedule: [
            { timestamp: 0, action: { type: 'playAction', params: {} } },
            { timestamp: 3000, action: { type: 'playAction', params: {} } },
            { timestamp: 5000, action: { type: exitAction, params: {} } },
          ],
        }),
      ).toMatchObject({ statusCode: 200 });
      for (const [timestamp, expectedFrame] of [
        [0, 0],
        [500, 5],
        [1000, 10],
        [2500, 10],
        [3500, 15],
        [4000, 20],
        [4500, 20],
        [5500, 25],
        [6000, 30],
        [500, 5],
        [2500, 10],
        [5500, 25],
      ]) {
        expect(await graphic.goToTime({ timestamp: timestamp! })).toMatchObject({
          statusCode: 200,
        });
        const [compiled, , states, data] = vi.mocked(applyCompiledMasks).mock.calls.at(-1)!;
        const result = resolveFrameExpressions(
          compiled,
          states as Map<string, MaskRenderState>,
          data,
        );
        expect(result.get('shader')!.transform).toMatchObject({
          x: expectedFrame,
          y: expectedFrame! / 10,
          width: 10,
          height: 20,
        });
      }
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    },
  );

  it.each(['stopAction', 'playAction'] as const)(
    'preserves held loop phase and discrete uniforms through %s and backward replay',
    async (action) => {
      class Graphic extends GraphicElement {
        static descriptor = descriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'non-realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: { gain: 0.8, count: 5 },
        }),
      ).toMatchObject({ statusCode: 200 });
      const schedule: ScheduledAction[] = [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 250,
          action: {
            type: 'updateAction',
            params: { data: { gain: 0.6, count: 4 }, skipAnimation: true },
          },
        },
        { timestamp: 500, action: { type: action, params: {} } },
      ];
      await graphic.setActionsSchedule({ schedule });
      const sample = async (timestamp: number) => {
        expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
        const [host, tracks, frame] = mock.paint.mock.calls.at(-1) as [
          HTMLElement,
          LayerAnimationTracks,
          number,
        ];
        const base = JSON.parse(host.dataset.ografRenderedElement!) as Element;
        const animated = applyShaderAnimationValues(
          base,
          sampleShaderAnimationValues(base, tracks, frame),
        );
        if (
          !('fill' in animated) ||
          !animated.fill ||
          typeof animated.fill === 'string' ||
          animated.fill.type !== 'shader'
        )
          throw Error('Expected shader fill');
        return resolveShaderParameters(animated.fill);
      };
      const first = await sample(1000);
      expect(first).toMatchObject({ gain: 0.8, count: 2 });
      expect(await sample(100)).toMatchObject({ gain: 0.2, count: 2 });
      expect(await sample(1000)).toEqual(first);
      expect(await sample(1500)).toMatchObject({ gain: 0.6, count: 4 });
      await graphic.setActionsSchedule({ schedule: [] });
      expect(await sample(1000)).toMatchObject({ gain: 0.6, count: 4 });
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    },
  );
});
