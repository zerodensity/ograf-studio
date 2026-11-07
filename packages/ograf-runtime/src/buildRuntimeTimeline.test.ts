import { describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { createCornerRadii, createTextElement, createShaderPaint } from '@ograf-editor/scene-model';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';
import * as shaderAnimationRendering from './shaderAnimationRendering';

function descriptor(): CompiledGraphicDescriptor {
  const transform = {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 0,
    transformOriginX: 0.5,
    transformOriginY: 0.5,
  };
  const track = (property: keyof typeof transform) => [
    { id: `${property}-0`, frame: 0, value: transform[property], easing: 'linear' as const },
    {
      id: `${property}-10`,
      frame: 10,
      value: property === 'opacity' ? 1 : transform[property],
      easing: 'linear' as const,
    },
  ];
  return {
    width: 1920,
    height: 1080,
    backgroundColor: 'transparent',
    frameRate: 25,
    layers: [
      {
        id: 'layer',
        isVisible: true,
        element: {
          type: 'rectangle',
          fill: '#fff',
          strokeColor: 'transparent',
          strokeWidth: 0,
          borderRadius: createCornerRadii(),
        },
        effects: {
          blur: 0,
          dropShadowEnabled: false,
          dropShadowColor: '#000000',
          dropShadowOpacity: 0,
          dropShadowOffsetX: 0,
          dropShadowOffsetY: 0,
          dropShadowBlur: 0,
        },
        keyframes: [
          { id: 'start', frame: 0, transform, easing: 'linear' },
          { id: 'end', frame: 10, transform: { ...transform, opacity: 1 }, easing: 'linear' },
        ],
        animationTracks: {
          x: track('x'),
          y: track('y'),
          width: track('width'),
          height: track('height'),
          rotation: track('rotation'),
          opacity: track('opacity'),
          transformOriginX: track('transformOriginX'),
          transformOriginY: track('transformOriginY'),
        },
        bindings: [],
      },
    ],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'end', frame: 10, role: 'end' },
    ],
    transitions: [
      {
        fromKeyframeId: 'start',
        toKeyframeId: 'end',
        durationFrames: 10,
        easing: 'linear',
      },
    ],
    stepKeyframeIds: [],
    stepCount: 0,
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    customActions: [],
  };
}

describe('runtime timeline boundary seeking', () => {
  it('samples shader tracks through the uniform path', () => {
    const compiled = descriptor();
    compiled.layers[0]!.element = createTextElement({
      fill: createShaderPaint({
        fragmentSource: `#pragma ograf count slider min(0) max(10)
const int count = 2;
#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.5;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`,
      }),
    });
    const property = 'fill.parameters.gain';
    compiled.layers[0]!.animationTracks[property] = [
      { id: 'a', frame: 0, value: 0, easing: 'linear' },
      { id: 'b', frame: 10, value: 2, easing: 'linear' },
    ];
    compiled.layers[0]!.animationTracks['fill.parameters.count'] = [
      { id: 'c', frame: 0, value: 2, easing: 'linear' },
      { id: 'd', frame: 10, value: 8, easing: 'linear' },
    ];
    const spy = vi.spyOn(shaderAnimationRendering, 'applyShaderPaintTracks');
    const element = { style: {} } as unknown as HTMLElement;
    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    for (const frame of [5, 2, 5]) {
      timeline.seek(frame, true);
      expect(spy.mock.calls.at(-1)?.[1][property]?.[0]?.value).toBe(frame / 5);
      expect(spy.mock.calls.at(-1)?.[1]['fill.parameters.count']?.[0]?.value).toBe(2);
    }
    timeline.seek(10, true);
    expect(spy.mock.calls.at(-1)?.[1]['fill.parameters.count']?.[0]?.value).toBe(8);
    timeline.dispose();
    spy.mockRestore();
  });
  it('restores a transparent first-frame pose after seeking backwards from a visible frame', () => {
    const element = { style: {} } as unknown as HTMLElement;
    const timeline = buildRuntimeTimeline(descriptor(), new Map([['layer', element]]));

    timeline.seek(10, true);
    expect(Number(element.style.opacity)).toBe(1);
    timeline.seek(0, true);

    expect(Number(element.style.opacity)).toBe(0);
    timeline.dispose();
  });

  it('renders animated gradient stop offsets on deterministic seeks', () => {
    const compiled = descriptor();
    const fill = {
      type: 'linear' as const,
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 1 },
        { offset: 1, color: '#000000', opacity: 1 },
      ],
    };
    compiled.layers[0]!.element = {
      type: 'rectangle',
      fill,
      strokeColor: 'transparent',
      strokeWidth: 0,
      borderRadius: createCornerRadii(),
    };
    compiled.layers[0]!.animationTracks['fill.stops[0].offset'] = [
      { id: 'stop-0', frame: 0, value: 0, easing: 'linear' },
      { id: 'stop-10', frame: 10, value: 1, easing: 'linear' },
    ];
    const content = { style: {}, querySelector: () => null };
    const element = {
      style: {},
      dataset: { ografBasePaint: JSON.stringify(fill) },
      firstElementChild: content,
    } as unknown as HTMLElement;

    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    timeline.seek(5, true);

    expect(content.style).toMatchObject({ backgroundImage: expect.stringContaining('50%') });
    timeline.dispose();
  });

  it('renders animated text stroke width on deterministic forward and reverse seeks', () => {
    const compiled = descriptor();
    compiled.layers[0]!.element = createTextElement({
      content: 'Score',
      strokeColor: '#101820',
      strokeWidth: 0,
    });
    compiled.layers[0]!.animationTracks.strokeWidth = [
      { id: 'stroke-0', frame: 0, value: 0, easing: 'linear' },
      { id: 'stroke-10', frame: 10, value: 8, easing: 'linear' },
    ];
    const content = { style: {} };
    const contentHost = {
      dataset: {},
      firstElementChild: content,
      classList: { contains: (name: string) => name === 'layer-content-host' },
    };
    const element = {
      style: {},
      firstElementChild: contentHost,
    } as unknown as HTMLElement;

    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    timeline.seek(5, true);
    expect(content.style).toMatchObject({ webkitTextStrokeWidth: '4px' });
    timeline.seek(0, true);
    expect(content.style).toMatchObject({ webkitTextStrokeWidth: '0px' });
    timeline.dispose();
  });

  it('scales the layer and wipes its content on deterministic seeks', () => {
    const compiled = descriptor();
    compiled.layers[0]!.animationTracks.scale = [
      { id: 'scale-0', frame: 0, value: 0, easing: 'linear' },
      { id: 'scale-10', frame: 10, value: 1, easing: 'linear' },
    ];
    compiled.layers[0]!.animationTracks.clipRight = [
      { id: 'wipe-0', frame: 0, value: 1, easing: 'linear' },
      { id: 'wipe-10', frame: 10, value: 0, easing: 'linear' },
    ];
    const content = { style: {} as Record<string, string>, dataset: {} };
    const element = {
      style: {},
      dataset: {},
      firstElementChild: content,
    } as unknown as HTMLElement;

    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    expect(content.style.clipPath).toBe('inset(0% 100% 0% 0%)');
    timeline.seek(5, true);
    expect(element.style.transform).toContain('scale(0.5)');
    expect(content.style.clipPath).toBe('inset(0% 50% 0% 0%)');
    timeline.seek(10, true);
    expect(element.style.transform).toContain('scale(1)');
    expect(content.style.clipPath).toBe('');
    timeline.dispose();
  });
});
