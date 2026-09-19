import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createShaderPaint,
  createTextElement,
  type LayerAnimationTracks,
} from '@ograf-editor/scene-model';
const mocks = vi.hoisted(() => ({ paint: vi.fn(), legacy: vi.fn() }));
vi.mock('./shaderPaintRendering', () => ({ updateShaderPaintUniforms: mocks.paint }));
vi.mock('./shaderRendering', () => ({ updateShaderParameters: mocks.legacy }));
import {
  applyShaderPaintTracks,
  forgetShaderAnimationBase,
  rememberShaderAnimationBase,
} from './shaderAnimationRendering';

const fragmentSource = `#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.5;
#pragma ograf tint color
const vec3 tint = vec3(0.1, 0.2, 0.3);
#pragma ograf offset vector2 min(-2.0) max(2.0)
const vec2 offset = vec2(0.0);
void mainImage(out vec4 color, in vec2 coord) { color = vec4(tint * gain, 1.0); }`;
const paint = createShaderPaint({ fragmentSource });
const key = (id: string, frame: number, value: number) => ({
  id,
  frame,
  value,
  easing: 'linear' as const,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.paint.mockReturnValue(true);
  mocks.legacy.mockReturnValue(true);
});

describe('mounted shader animation baseline', () => {
  it('overlays independent components on data and restores unkeyed data without accumulating old samples', () => {
    const host = {} as HTMLElement;
    const element = createTextElement({
      fill: { ...paint, parameters: { tint: [0.1, 0.6, 0.7] } },
      strokePaint: { ...paint, parameters: { gain: 0.9 } },
    });
    rememberShaderAnimationBase(host, element);
    const tracks: LayerAnimationTracks = {
      'fill.parameters.tint.r': [key('a', 0, 0), key('b', 10, 1)],
      'fill.parameters.offset.x': [key('c', 0, -1), key('d', 10, 1)],
      'strokePaint.parameters.gain': [key('e', 0, 0.2), key('f', 10, 1.2)],
    };
    applyShaderPaintTracks(host, tracks, 5);
    expect(mocks.paint.mock.calls.at(-1)?.[1]).toMatchObject({
      fill: { parameters: { tint: [0.5, 0.6, 0.7], offset: [0, 0] } },
      strokePaint: { parameters: { gain: 0.7 } },
    });
    const first = structuredClone(mocks.paint.mock.calls.at(-1)?.[1]);
    applyShaderPaintTracks(host, tracks, 1);
    applyShaderPaintTracks(host, tracks, 5);
    expect(mocks.paint.mock.calls.at(-1)?.[1]).toEqual(first);
    applyShaderPaintTracks(host, {}, 5);
    expect(mocks.paint.mock.calls.at(-1)?.[1]).toEqual(element);
    const calls = mocks.paint.mock.calls.length;
    applyShaderPaintTracks(host, {}, 100);
    expect(mocks.paint).toHaveBeenCalledTimes(calls);
    expect(element.fill).toMatchObject({ parameters: { tint: [0.1, 0.6, 0.7] } });
    forgetShaderAnimationBase(host);
  });

  it('replaces the baseline on a data update while retaining the keyed component', () => {
    const host = {} as HTMLElement;
    const tracks: LayerAnimationTracks = { 'fill.parameters.tint.r': [key('r', 0, 0.8)] };
    rememberShaderAnimationBase(host, createTextElement({ fill: paint }));
    applyShaderPaintTracks(host, tracks, 0);
    rememberShaderAnimationBase(
      host,
      createTextElement({ fill: { ...paint, parameters: { tint: [0.9, 0.4, 0.5], gain: 1.2 } } }),
    );
    applyShaderPaintTracks(host, tracks, 0);
    expect(mocks.paint.mock.calls.at(-1)?.[1]).toMatchObject({
      fill: { parameters: { tint: [0.8, 0.4, 0.5], gain: 1.2 } },
    });
    forgetShaderAnimationBase(host);
    applyShaderPaintTracks(host, tracks, 0);
    expect(mocks.paint).toHaveBeenCalledTimes(2);
  });

  it('does not upload unused defaults, retries a failed upload, and supports legacy shader elements', () => {
    const host = {} as HTMLElement;
    rememberShaderAnimationBase(host, paint);
    applyShaderPaintTracks(host, {}, 0);
    expect(mocks.legacy).not.toHaveBeenCalled();
    const tracks: LayerAnimationTracks = { 'fill.parameters.gain': [key('g', 0, 1.5)] };
    mocks.legacy.mockReturnValueOnce(false);
    applyShaderPaintTracks(host, tracks, 0);
    applyShaderPaintTracks(host, tracks, 0);
    applyShaderPaintTracks(host, tracks, 0);
    expect(mocks.legacy).toHaveBeenCalledTimes(2);
    expect(mocks.legacy.mock.calls.at(-1)?.[1]).toMatchObject({ parameters: { gain: 1.5 } });
    rememberShaderAnimationBase(host, createTextElement());
    applyShaderPaintTracks(host, tracks, 0);
    expect(mocks.legacy).toHaveBeenCalledTimes(2);
  });
});
