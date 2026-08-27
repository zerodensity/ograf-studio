import gsap from 'gsap';
import { describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { createCornerRadii, createTextElement } from '@ograf-editor/scene-model';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';

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
  it('restores a transparent first-frame pose after seeking backwards from a visible frame', () => {
    const setSpy = vi.spyOn(gsap, 'set');
    const element = { style: {} } as unknown as HTMLElement;
    const timeline = buildRuntimeTimeline(descriptor(), new Map([['layer', element]]));
    const initialSetCalls = setSpy.mock.calls.length;

    timeline.seek(10 / 25, true);
    expect(gsapOpacity(element)).toBe(1);
    timeline.seek(0, true);

    expect(gsapOpacity(element)).toBe(0);
    expect(setSpy.mock.calls.length).toBeGreaterThan(initialSetCalls);
    timeline.kill();
    setSpy.mockRestore();
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
    const content = { style: {} };
    const element = {
      style: {},
      dataset: { ografBasePaint: JSON.stringify(fill) },
      firstElementChild: content,
    } as unknown as HTMLElement;

    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    timeline.seek(5 / 25, true);

    expect(content.style).toMatchObject({ background: expect.stringContaining('50%') });
    timeline.kill();
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
    timeline.seek(5 / 25, true);
    expect(content.style).toMatchObject({ webkitTextStrokeWidth: '4px' });
    timeline.seek(0, true);
    expect(content.style).toMatchObject({ webkitTextStrokeWidth: '0px' });
    timeline.kill();
  });
});

function gsapOpacity(element: HTMLElement): number {
  return Number((element as unknown as { opacity: number }).opacity ?? element.style.opacity);
}
