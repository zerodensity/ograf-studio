import { describe, expect, it } from 'vitest';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  createCornerRadii,
  createLayerEffects,
  createLayerLoopClip,
  createTextElement,
  createLayerOfKind,
  addEffect,
  effectProperty,
  effectParameterValue,
  type EffectParameterProperty,
} from '@ograf-editor/scene-model';
import {
  compiledLoopElapsedFrames,
  interpolateCompiledLayerVisualState,
  sampleCompiledLayerVisualState,
} from './loopRendering';
import { resolveBoundElement, resolveBoundEffects } from './renderElement';

function layer(): CompiledLayer {
  return {
    id: 'pulse',
    isVisible: true,
    element: {
      type: 'rectangle',
      fill: '#fff',
      strokeColor: 'transparent',
      strokeWidth: 0,
      borderRadius: createCornerRadii(),
    },
    effects: createLayerEffects(),
    keyframes: [
      {
        id: 'base',
        frame: 0,
        easing: 'linear',
        transform: {
          x: 100,
          y: 100,
          width: 400,
          height: 120,
          rotation: 0,
          opacity: 1,
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        },
      },
    ],
    animationTracks: {},
    loop: createLayerLoopClip({
      durationFrames: 20,
      tracks: {
        opacity: [
          { id: 'a', frame: 0, value: 0.2, easing: 'linear' },
          { id: 'b', frame: 10, value: 1, easing: 'sine-in-out' },
          { id: 'c', frame: 20, value: 0.2, easing: 'sine-in-out' },
        ],
        width: [
          { id: 'd', frame: 0, value: 400, easing: 'linear' },
          { id: 'e', frame: 10, value: 440, easing: 'back-out' },
          { id: 'f', frame: 20, value: 400, easing: 'quad-in' },
        ],
      },
    }),
    bindings: [],
  };
}

describe('compiled loop sampling', () => {
  it('samples stacked effect keys, loops, live overrides and direct exits deterministically', () => {
    const authored = createLayerOfKind('rectangle'),
      fx = addEffect(authored, 'glow'),
      p = effectProperty(fx, 'radius') as EffectParameterProperty;
    const compiled = layer();
    compiled.effects = authored.effects;
    compiled.animationTracks[p] = [
      { id: 'a', frame: 0, value: 10, easing: 'linear' },
      { id: 'b', frame: 20, value: 30, easing: 'linear' },
    ];
    compiled.loop!.tracks[p] = [
      { id: 'la', frame: 0, value: 2, easing: 'linear' },
      { id: 'lb', frame: 10, value: 20, easing: 'linear' },
      { id: 'lc', frame: 20, value: 2, easing: 'linear' },
    ];
    const peak = sampleCompiledLayerVisualState(compiled, 0, 10),
      repeat = sampleCompiledLayerVisualState(compiled, 0, 30);
    expect(effectParameterValue(peak.effects, p)).toBe(20);
    expect(repeat).toEqual(peak);
    expect(effectParameterValue(sampleCompiledLayerVisualState(compiled, 0, 0).effects, p)).toBe(2);
    const exit = interpolateCompiledLayerVisualState(
      compiled,
      peak,
      sampleCompiledLayerVisualState(compiled, 20),
      0.5,
      20,
    );
    expect(effectParameterValue(exit.effects, p)).toBe(25);
    compiled.bindings = [
      { dataKey: 'softness', targetProperty: p },
      { dataKey: 'accent', targetProperty: effectProperty(fx, 'color') },
    ];
    const live = sampleCompiledLayerVisualState(compiled, 0, 10, {
      softness: 7,
      accent: '#ff9900',
    });
    expect(effectParameterValue(live.effects, p)).toBe(7);
    expect(effectParameterValue(live.effects, effectProperty(fx, 'color'))).toBe('#ff9900');
  });
  it('recolors gradient stops, outlines and animated shadows without modifying source data or loop time', () => {
    const compiled = layer();
    if (compiled.element.type !== 'rectangle') throw Error();
    compiled.element.fill = {
      type: 'linear',
      angle: 110,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 0 },
        { offset: 1, color: '#ffffff', opacity: 1 },
      ],
    };
    compiled.bindings = [
      { dataKey: 'accent', targetProperty: 'fill.stops[1].color' },
      { dataKey: 'accent', targetProperty: 'strokeColor' },
      { dataKey: 'accent', targetProperty: 'dropShadowColor' },
    ];
    const before = structuredClone(compiled),
      data = { accent: '#aabbcc' };
    expect(resolveBoundElement(compiled, data)).toHaveProperty('fill.stops.1.color', '#aabbcc');
    expect(resolveBoundElement(compiled, data)).toHaveProperty('fill.stops.0.opacity', 0);
    expect(resolveBoundElement(compiled, data)).toHaveProperty('strokeColor', '#aabbcc');
    expect(resolveBoundEffects(compiled, data).dropShadowColor).toBe('#aabbcc');
    expect(sampleCompiledLayerVisualState(compiled, 0, 10, data).effects.dropShadowColor).toBe(
      '#aabbcc',
    );
    expect(sampleCompiledLayerVisualState(compiled, 0, 10, data).transform).toEqual(
      sampleCompiledLayerVisualState(compiled, 0, 10).transform,
    );
    expect(compiled).toEqual(before);
  });
  it('resolves lifecycle and Step loop activation windows', () => {
    const compiled = layer();
    const descriptor = {
      keyframes: [
        { id: 'start', frame: 0, role: 'start' },
        { id: 'step-1', frame: 10, role: 'step' },
        { id: 'step-2', frame: 20, role: 'step' },
        { id: 'end', frame: 30, role: 'end' },
      ],
    } as CompiledGraphicDescriptor;

    expect(compiledLoopElapsedFrames(descriptor, compiled, 9)).toBeUndefined();
    expect(compiledLoopElapsedFrames(descriptor, compiled, 12, 3)).toBe(5);
    expect(compiledLoopElapsedFrames(descriptor, compiled, 30)).toBeUndefined();

    compiled.loop!.activation = { type: 'step', stepKeyframeId: 'step-2' };
    expect(compiledLoopElapsedFrames(descriptor, compiled, 19)).toBeUndefined();
    expect(compiledLoopElapsedFrames(descriptor, compiled, 24, 2)).toBe(6);
    expect(compiledLoopElapsedFrames(descriptor, compiled, 30)).toBeUndefined();
  });

  it('combines independent loop properties over the finite base pose', () => {
    const compiled = layer();
    const atPeak = sampleCompiledLayerVisualState(compiled, 0, 10);
    expect(atPeak.transform.opacity).toBe(1);
    expect(atPeak.transform.width).toBe(440);
    expect(atPeak.transform.x).toBe(100);
    expect(sampleCompiledLayerVisualState(compiled, 0, 30)).toEqual(atPeak);
  });

  it('interpolates an exit directly without exposing intervening lifecycle states', () => {
    const compiled = layer();
    compiled.loop = null;
    compiled.animationTracks = {
      x: [
        { id: 'x-start', frame: 0, value: 100, easing: 'linear' },
        { id: 'x-step-1', frame: 10, value: 100, easing: 'linear' },
        { id: 'x-step-2', frame: 20, value: 900, easing: 'linear' },
        { id: 'x-end', frame: 30, value: 100, easing: 'linear' },
      ],
      opacity: [
        { id: 'opacity-start', frame: 0, value: 0, easing: 'linear' },
        { id: 'opacity-step-1', frame: 10, value: 0, easing: 'linear' },
        { id: 'opacity-step-2', frame: 20, value: 1, easing: 'linear' },
        { id: 'opacity-end', frame: 30, value: 0, easing: 'linear' },
      ],
    };

    const source = sampleCompiledLayerVisualState(compiled, 10);
    const target = sampleCompiledLayerVisualState(compiled, 30);
    const halfway = interpolateCompiledLayerVisualState(compiled, source, target, 0.5, 30);

    expect(sampleCompiledLayerVisualState(compiled, 20).transform).toMatchObject({
      x: 900,
      opacity: 1,
    });
    expect(halfway.transform).toMatchObject({ x: 100, opacity: 0 });
  });

  it('samples and directly interpolates text stroke width across lifecycle and local loops', () => {
    const compiled = layer();
    compiled.element = createTextElement({
      content: 'Score',
      strokeColor: '#101820',
      strokeWidth: 0,
    });
    compiled.animationTracks.strokeWidth = [
      { id: 'stroke-start', frame: 0, value: 0, easing: 'linear' },
      { id: 'stroke-end', frame: 10, value: 8, easing: 'linear' },
    ];
    compiled.loop!.tracks.strokeWidth = [
      { id: 'stroke-loop-start', frame: 0, value: 2, easing: 'linear' },
      { id: 'stroke-loop-peak', frame: 10, value: 6, easing: 'linear' },
      { id: 'stroke-loop-end', frame: 20, value: 2, easing: 'linear' },
    ];

    expect(sampleCompiledLayerVisualState(compiled, 5).paintTracks.strokeWidth?.[0]?.value).toBe(4);
    expect(
      sampleCompiledLayerVisualState(compiled, 5, 10).paintTracks.strokeWidth?.[0]?.value,
    ).toBe(6);

    compiled.loop = null;
    const source = sampleCompiledLayerVisualState(compiled, 0);
    const target = sampleCompiledLayerVisualState(compiled, 10);
    expect(
      interpolateCompiledLayerVisualState(compiled, source, target, 0.5, 10).paintTracks
        .strokeWidth?.[0]?.value,
    ).toBe(4);
  });

  it('resolves multiple compiled bindings on independent element properties', () => {
    const compiled = layer();
    compiled.element = createTextElement({
      content: 'Default',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      fontSize: 48,
      fontWeight: 600,
      textAlign: 'left',
      autoFit: 'fixed',
    });
    compiled.bindings = [
      { dataKey: 'headline', targetProperty: 'content' },
      { dataKey: 'headlineColor', targetProperty: 'color' },
    ];

    expect(
      resolveBoundElement(compiled, {
        headline: 'Multiple bindings',
        headlineColor: '#ff3366',
      }),
    ).toMatchObject({ content: 'Multiple bindings', color: '#ff3366' });
  });

  it('resolves nested object and indexed collection binding paths', () => {
    const compiled = layer();
    compiled.element = createTextElement({ content: 'Default' });
    compiled.bindings = [
      {
        dataKey: 'leaderboard',
        targetProperty: 'content',
        sourcePath: ['team', 'name'],
        itemIndex: 1,
      },
    ];
    expect(
      resolveBoundElement(compiled, {
        leaderboard: [{ team: { name: 'First' } }, { team: { name: 'Second' } }],
      }),
    ).toMatchObject({ content: 'Second' });
    expect(resolveBoundElement(compiled, { leaderboard: [] })).toMatchObject({
      content: 'Default',
    });
  });
});
