import gsap from 'gsap';
import { describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { createCornerRadii, createTextElement, createShaderPaint } from '@ograf-editor/scene-model';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';
import * as shaderAnimationRendering from './shaderAnimationRendering';
import { applyCompiledMasks } from './maskRendering';
import { sampleCompiledLayerVisualState } from './loopRendering';
import * as loopRendering from './loopRendering';
import { resolveFrameExpressions } from './expressionRendering';
import * as effectCompositing from './effectCompositing';
import * as elementRendering from './renderElement';

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
  it('refreshes ordinary auto-size text after initial state and animation writes', () => {
    const compiled = descriptor();
    compiled.layers[0]!.element = { ...createTextElement(), autoFit: 'auto-size' };
    const element = { style: {} } as HTMLElement;
    const fit = vi.spyOn(elementRendering, 'applyAnimatedPaint').mockImplementation((host) => {
      host.style.width = '240px';
      host.style.height = '60px';
    });
    try {
      const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
      expect(fit).toHaveBeenCalled();
      expect(element.style.width).toBe('240px');
      expect(timeline.eventCallback('onUpdate')).toBeTypeOf('function');
      fit.mockClear();
      timeline.time(0.2, false);
      expect(fit).toHaveBeenCalled();
      expect(element.style.width).toBe('240px');
      timeline.kill();
    } finally {
      fit.mockRestore();
    }
  });
  it('shares authored samples within a frame but refreshes them after edits', () => {
    const compiled = descriptor();
    const layer = compiled.layers[0]!;
    layer.name = 'Title';
    layer.expressions = {
      x: 'thisLayer.property("width").valueAtTime(0.2)',
      width: 'sourceRectAtTime(0.2).width',
    };
    compiled.scripting = {
      enabled: true,
      modules: [],
      source: 'layer("Title").y = layer("Title").property("width").valueAtTime(0.2);',
    };
    const states = new Map([['layer', sampleCompiledLayerVisualState(layer, 0)]]);
    const sample = vi.spyOn(loopRendering, 'sampleCompiledLayerVisualState');
    try {
      expect(resolveFrameExpressions(compiled, states).get('layer')!.transform).toMatchObject({
        x: 100,
        y: 100,
        width: 100,
      });
      expect(sample).toHaveBeenCalledTimes(1);
      layer.animationTracks.width = [{ id: 'width', frame: 0, value: 200, easing: 'linear' }];
      expect(resolveFrameExpressions(compiled, states).get('layer')!.transform).toMatchObject({
        x: 200,
        y: 200,
        width: 200,
      });
      expect(sample).toHaveBeenCalledTimes(2);
    } finally {
      sample.mockRestore();
    }
  });

  it('samples authored values and local bounds at fractional seconds without evaluating expressions', () => {
    const compiled = descriptor();
    const layer = compiled.layers[0]!;
    layer.name = 'Title';
    layer.animationTracks.x = [
      { id: 'x0', frame: 0, value: 0, easing: 'linear' },
      { id: 'x1', frame: 10, value: 100, easing: 'linear' },
    ];
    layer.animationTracks.width = [
      { id: 'w0', frame: 0, value: 100, easing: 'linear' },
      { id: 'w1', frame: 10, value: 200, easing: 'linear' },
    ];
    layer.expressions = {
      x: 'valueAtTime(0.1) + thisProperty.valueAtTime(0.1)',
      y: 'layer("Title").property("x").valueAtTime(0.1)',
      width: 'sourceRectAtTime(0.2).width',
      height:
        'thisLayer.sourceRectAtTime(0.2).left + layerById(thisLayer.id).sourceRectAtTime(0.2).height',
    };
    const states = new Map([['layer', sampleCompiledLayerVisualState(layer, 8)]]);
    const before = JSON.stringify(states.get('layer'));
    const diagnostics: Parameters<typeof resolveFrameExpressions>[3] = [];
    expect(
      resolveFrameExpressions(compiled, states, {}, diagnostics).get('layer')!.transform,
    ).toMatchObject({ x: 50, y: 25, width: 150, height: 50 });
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(states.get('layer'))).toBe(before);
    compiled.scripting = {
      enabled: true,
      modules: [],
      source:
        'layer("Title").x = layer("Title").property("x").valueAtTime(99); layer("Title").y = layer("Title").property("x").valueAtTime(-1);',
    };
    expect(resolveFrameExpressions(compiled, states).get('layer')!.transform).toMatchObject({
      x: 100,
      y: 0,
    });
  });

  it.each([
    'valueAtTime(NaN)',
    'valueAtTime("1")',
    'sourceRectAtTime(Infinity)',
    'sourceRectAtTime(0, 1)',
    'thisLayer.property("unknown").valueAtTime(0)',
  ])('reports invalid sampling arguments without changing the sampled pose: %s', (source) => {
    const compiled = descriptor();
    compiled.layers[0]!.expressions = { width: source };
    const states = new Map([['layer', sampleCompiledLayerVisualState(compiled.layers[0]!, 0)]]);
    const diagnostics: Parameters<typeof resolveFrameExpressions>[3] = [];
    expect(
      resolveFrameExpressions(compiled, states, {}, diagnostics).get('layer')!.transform.width,
    ).toBe(100);
    expect(diagnostics).toHaveLength(1);
  });

  it('shares structured data and property metadata between expressions and composition scripts', () => {
    const compiled = descriptor();
    compiled.layers[0]!.name = 'Title';
    compiled.layers[0]!.expressions = {
      width:
        'data.visible === true && thisProperty.name === "width" ? value + data.rows[0].padding : 0',
    };
    compiled.scripting = {
      enabled: true,
      modules: [],
      source:
        'const title = layer("Title"); layerById(title.id).x = title.width + data.rows[0].padding;',
    };
    const states = new Map([['layer', sampleCompiledLayerVisualState(compiled.layers[0]!, 0)]]);
    const data = { visible: true, rows: [{ padding: 20 }] };
    const diagnostics: Parameters<typeof resolveFrameExpressions>[3] = [];
    expect(
      resolveFrameExpressions(compiled, states, data, diagnostics).get('layer')!.transform,
    ).toMatchObject({ width: 120, x: 140 });
    expect(diagnostics).toEqual([]);
    compiled.scripting.source = 'layer("Title").x = 999; data.rows[0].padding = 999;';
    expect(
      resolveFrameExpressions(compiled, states, data, diagnostics).get('layer')!.transform,
    ).toMatchObject({ width: 120, x: 0 });
    expect(data.rows[0]!.padding).toBe(20);
    expect(diagnostics[0]?.property).toBe('script');
  });

  it('uses updated auto-size text bounds for expressions without changing authored dimensions', () => {
    const compiled = descriptor();
    const text = compiled.layers[0]!;
    text.name = 'Title';
    text.element = { ...createTextElement(), autoFit: 'auto-size' };
    const rectangle = structuredClone(text);
    rectangle.id = 'background';
    rectangle.name = 'Background';
    rectangle.element = descriptor().layers[0]!.element;
    rectangle.expressions = { width: 'layer("Title").width + 20' };
    compiled.layers.push(rectangle);
    const host = { style: { width: '200px', height: '40px' } } as HTMLElement;
    const background = { style: {} } as HTMLElement;
    const elements = new Map([
      ['layer', host],
      ['background', background],
    ]);
    const states = new Map(
      compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)]),
    );
    for (const width of [200, 480, 120]) {
      host.style.width = `${width}px`;
      applyCompiledMasks(compiled, elements, states);
      expect(Number(gsap.getProperty(background, 'width'))).toBe(width + 20);
      expect(states.get('layer')!.transform.width).toBe(100);
    }
    text.expressions = { width: '300' };
    applyCompiledMasks(compiled, elements, states);
    expect(Number(gsap.getProperty(background, 'width'))).toBe(320);
  });

  it('publishes runtime diagnostics on data changes and clears disabled expressions', () => {
    const compiled = descriptor();
    compiled.layers[0]!.expressions = { x: 'data.position' };
    const element = { style: {} } as HTMLElement;
    let data: Record<string, unknown> = {};
    const diagnostics = vi.fn();
    const timeline = buildRuntimeTimeline(
      compiled,
      new Map([['layer', element]]),
      () => data,
      diagnostics,
    );
    expect(diagnostics.mock.calls.at(-1)![0]).toEqual([
      expect.objectContaining({ layerId: 'layer', property: 'x', source: 'data.position' }),
    ]);
    data = { position: 123 };
    timeline.seek(0.2, true);
    expect(diagnostics.mock.calls.at(-1)![0]).toEqual([]);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(123);
    data = { position: 'invalid' };
    timeline.seek(0, true);
    expect(diagnostics.mock.calls.at(-1)![0]).toHaveLength(1);
    compiled.layers[0]!.expressionsEnabled = { x: false };
    timeline.seek(0.2, true);
    expect(diagnostics.mock.calls.at(-1)![0]).toEqual([]);
    timeline.kill();
  });

  it('clips against expression-resolved parent and child geometry in every render pass', () => {
    const compiled = descriptor();
    const parent = compiled.layers[0]!;
    parent.expressions = { width: '400' };
    const child = structuredClone(parent);
    child.id = 'child';
    child.clipParentId = parent.id;
    child.expressions = { x: '50' };
    compiled.layers.push(child);
    const elements = new Map(
      compiled.layers.map((layer) => [layer.id, { style: {} } as HTMLElement]),
    );
    const target = elements.get(child.id)!;
    const clip = 'path("M -50 0 L 350 0 L 350 50 L -50 50 Z")';
    applyCompiledMasks(
      compiled,
      elements,
      new Map(compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)])),
    );
    expect(target.style.clipPath).toBe(clip);
    const timeline = buildRuntimeTimeline(compiled, elements);
    for (const frame of [5, 10, 0, 5]) {
      timeline.seek(frame / compiled.frameRate, true);
      expect(target.style.clipPath).toBe(clip);
    }
    parent.expressionsEnabled = { width: false };
    timeline.seek(0, true);
    expect(target.style.clipPath).toBe('path("M -50 0 L 50 0 L 50 50 L -50 50 Z")');
    timeline.kill();
  });

  it('does not repaint animated effects or shader parameters when applying expressions', () => {
    const compiled = descriptor();
    compiled.layers[0]!.expressions = { x: 'frame + 10' };
    const element = { style: {} } as HTMLElement;
    const effects = vi.spyOn(effectCompositing, 'applyLayerEffectsFilter');
    const paint = vi.spyOn(elementRendering, 'applyAnimatedPaint');
    try {
      applyCompiledMasks(
        compiled,
        new Map([['layer', element]]),
        new Map([['layer', sampleCompiledLayerVisualState(compiled.layers[0]!, 5)]]),
      );
      expect(Number(gsap.getProperty(element, 'x'))).toBe(15);
      expect(effects).not.toHaveBeenCalled();
      expect(paint).not.toHaveBeenCalled();
    } finally {
      effects.mockRestore();
      paint.mockRestore();
    }
  });

  it.each([
    [10, 10, 20],
    [20, 20, 29],
    [10, 90, 100],
  ])('follows authored Step boundaries %s/%s/%s on seek and playback', (first, last, end) => {
    const compiled = descriptor();
    compiled.keyframes = [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'first', frame: first, role: 'step' },
      ...(last !== first ? [{ id: 'last', frame: last, role: 'step' as const }] : []),
      { id: 'end', frame: end, role: 'end' },
    ];
    compiled.layers[0]!.expressions = {
      x: `if (frame < timeline.firstStepFrame)
        return 100 * clamp(frame / timeline.firstStepFrame, 0, 1);
        return 100 * (1 - clamp((frame - timeline.lastStepFrame) /
          (timeline.endFrame - timeline.lastStepFrame), 0, 1));`,
    };
    const element = { style: {} } as HTMLElement;
    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    const samples = [
      [0, 0],
      [first / 4, 25],
      [first, 100],
      [(first + last) / 2, 100],
      [last, 100],
      [(last + end) / 2, 50],
      [end, 0],
      [first / 4, 25],
    ];
    for (const [frame, expected] of samples) {
      timeline.seek(frame! / compiled.frameRate, true);
      expect(Number(gsap.getProperty(element, 'x'))).toBeCloseTo(expected!);
    }
    timeline.time((last + (end - last) / 4) / compiled.frameRate, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBeCloseTo(75);
    timeline.kill();
  });

  it('evaluates numeric data fields in position expressions on seek and playback', () => {
    const compiled = descriptor();
    compiled.keyframes.at(-1)!.frame = 100;
    const layer = compiled.layers[0]!;
    layer.expressions = { x: 'thisLayer.x + data.xPos', y: 'thisLayer.y + data.yPos' };
    const element = { style: {} } as HTMLElement;
    let data = { xPos: 30, yPos: -5 };
    const timeline = buildRuntimeTimeline(compiled, new Map([[layer.id, element]]), () => data);
    timeline.seek(50 / 25, true);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(30);
    expect(Number(gsap.getProperty(element, 'y'))).toBe(-5);
    data = { xPos: 75, yPos: 20 };
    timeline.time(60 / 25, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(75);
    expect(Number(gsap.getProperty(element, 'y'))).toBe(20);
    timeline.kill();
  });
  it('applies a composition-only script to the DOM on seeks and data updates', () => {
    const compiled = descriptor();
    compiled.scripting = {
      enabled: true,
      modules: [{ fileName: 'helpers.js', source: 'export const offset = x => x + 10;' }],
      source: 'layerById("layer").x = helpers.offset(frame) + data.gap;',
    };
    const element = { style: {} } as HTMLElement;
    let data = { gap: 5 };
    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]), () => data);
    timeline.seek(5 / 25, true);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(20);
    data = { gap: 20 };
    timeline.time(8 / 25, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(38);
    timeline.seek(5 / 25, true);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(35);
    timeline.kill();
  });
  it('combines numeric preview fields with another layer position', () => {
    const compiled = descriptor();
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.animationTracks.x = rectangle.animationTracks.x!.map((keyframe) => ({
      ...keyframe,
      value: 100,
    }));
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.expressions = {
      x: 'layer("Rectangle").x + data.xPos',
      y: 'layer("Rectangle").y + data.yPos',
    };
    compiled.layers = [rectangle, text];
    const states = new Map(
      compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)]),
    );
    const result = resolveFrameExpressions(compiled, states, { xPos: 30, yPos: 20 });
    expect(result.get('text')!.transform.x).toBe(130);
    expect(result.get('text')!.transform.y).toBe(20);
  });
  it('updates a numeric expression when a select field changes during playback', () => {
    const compiled = descriptor();
    compiled.keyframes.at(-1)!.frame = 100;
    const layer = compiled.layers[0]!;
    layer.expressions = { x: 'data.Alphabet == "Latin" ? 100 : 200' };
    const element = { style: {} } as HTMLElement;
    let data = { Alphabet: 'Latin' };
    const timeline = buildRuntimeTimeline(compiled, new Map([[layer.id, element]]), () => data);
    timeline.seek(50 / 25, true);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(100);
    data = { Alphabet: 'Arabic' };
    timeline.time(60 / 25, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(200);
    timeline.kill();
  });
  it('turns opacity animation off with boolean data while retaining movement', () => {
    const compiled = descriptor();
    const layer = compiled.layers[0]!;
    layer.expressions = {
      x: 'x + 100',
      opacity: 'if (data.fade == 0) return 1; return clamp(frame / 10, 0, 1);',
    };
    const states = new Map([[layer.id, sampleCompiledLayerVisualState(layer, 0)]]);
    const enabled = resolveFrameExpressions(compiled, states, { fade: true }).get(
      layer.id,
    )!.transform;
    const disabled = resolveFrameExpressions(compiled, states, { fade: false }).get(
      layer.id,
    )!.transform;
    expect(enabled.opacity).toBe(0);
    expect(disabled.opacity).toBe(1);
    expect(disabled.x).toBe(enabled.x);
  });
  it('falls back on circular property dependencies without breaking unrelated properties', () => {
    const compiled = descriptor();
    const a = compiled.layers[0]!;
    a.name = 'A';
    const b = structuredClone(a);
    b.id = 'b';
    b.name = 'B';
    a.expressions = { x: 'layer("B").x + 1', y: '42' };
    b.expressions = { x: 'layer("A").x + 1' };
    for (const layers of [
      [a, b],
      [b, a],
    ]) {
      compiled.layers = layers;
      const sampled = new Map(
        layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)]),
      );
      const result = resolveFrameExpressions(compiled, sampled);
      expect(result.get(a.id)!.transform).toMatchObject({ x: 0, y: 42 });
      expect(result.get(b.id)!.transform.x).toBe(0);
    }
  });
  it('applies expressions after keyed tweens on playback and backward seeks', () => {
    const compiled = descriptor();
    compiled.layers[0]!.expressions = { x: 'frame * 2', opacity: '0.5' };
    const target = { style: {} } as HTMLElement;
    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', target]]));
    for (const frame of [0, 5, 10, 2]) {
      timeline.time(frame / compiled.frameRate, false);
      expect(Number(gsap.getProperty(target, 'x'))).toBe(frame * 2);
      expect(Number(gsap.getProperty(target, 'opacity'))).toBe(0.5);
    }
    timeline.kill();
  });
  it('resolves layer references in the shared editor pass and timeline seeking', () => {
    const compiled = descriptor();
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.animationTracks.x = [
      { id: 'r0', frame: 0, value: 40, easing: 'linear' },
      { id: 'r10', frame: 10, value: 140, easing: 'linear' },
    ];
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.expressions = {
      x: 'layer("Rectangle").x + layer("Rectangle").width + 100',
      y: 'thisLayer.y + 20',
    };
    compiled.layers.push(text);
    const target = { style: {} } as HTMLElement;
    const elements = new Map([
      ['layer', { style: {} } as HTMLElement],
      ['text', target],
    ]);
    const spy = vi.spyOn(gsap, 'set');
    const verify = (x: number, y = 20) => {
      const calls = spy.mock.calls.filter(([element]) => element === target);
      expect(calls.at(-1)?.[1]).toMatchObject({ x, y });
    };
    // This is the pass used by Stage, including stopped-frame edits.
    applyCompiledMasks(
      compiled,
      elements,
      new Map(compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)])),
    );
    verify(240);
    const timeline = buildRuntimeTimeline(compiled, elements);
    for (const frame of [5, 10, 0, 5]) {
      timeline.seek(frame / 25, true);
      verify(240 + frame * 10);
    }
    text.expressionsEnabled = { x: false };
    timeline.seek(0, true);
    verify(40);
    timeline.kill();
    spy.mockRestore();
  });
  it('samples shader tracks through the uniform path instead of GSAP numeric targets', () => {
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
      timeline.seek(frame / 25, true);
      expect(spy.mock.calls.at(-1)?.[1][property]?.[0]?.value).toBe(frame / 5);
      expect(spy.mock.calls.at(-1)?.[1]['fill.parameters.count']?.[0]?.value).toBe(2);
    }
    timeline.seek(10 / 25, true);
    expect(spy.mock.calls.at(-1)?.[1]['fill.parameters.count']?.[0]?.value).toBe(8);
    expect(timeline.getChildren().some((tween) => property in tween.vars)).toBe(false);
    timeline.kill();
    spy.mockRestore();
  });
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
    const content = { style: {}, querySelector: () => null };
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
      style: {},
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
