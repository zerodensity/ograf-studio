import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
} from './factory';
import { createShaderPaint, getElementShaderPaint } from './shader';
import {
  applyShaderAnimationValues,
  getShaderAnimatableProperties,
  getShaderAnimationValue,
  getShaderTrackValueAtFrame,
  parseShaderAnimationProperty,
  sampleShaderAnimationTracks,
  sampleShaderAnimationValues,
  shaderAnimationPropertySpec,
} from './shaderAnimation';
import {
  animatablePropertyLabel,
  getLayerAnimatableProperties,
  getLayerPropertyValueAtFrame,
  getResolvedLayerAnimationTracks,
} from './layerAnimation';
import { applyElementDataValue } from './boundPaint';
import { getLoopPropertyValueAtElapsed } from './loopAnimation';
import { getLayerPropertyWithLighting } from './patternLighting';
import { syncShaderParameterFields } from './shaderFields';
import { migrateProject } from './migrations';
import { validateProject } from '@ograf-editor/validation';

const source = `#pragma ograf yaw slider min(-2) max(2) step(0.1)
const float yaw = 0.25;
#pragma ograf count slider min(1) max(10) step(1)
const int count = 2;
#pragma ograf enabled toggle
const bool enabled = true;
#pragma ograf offset vector2 min(-3) max(3)
const vec2 offset = vec2(1.0,2.0);
#pragma ograf tint color
const vec4 tint = vec4(0.2,0.3,0.4,0.5);
void mainImage(out vec4 c,in vec2 p) { c=tint+vec4(yaw+float(count)+offset.x+(enabled?1.0:0.0)); }`;

function fixture() {
  const layer = createLayerOfKind('text');
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  layer.element.fill = createShaderPaint({ fragmentSource: source });
  layer.element.strokePaint = createShaderPaint({ fragmentSource: source });
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  return layer;
}
const keys = (from: number, to: number) => [
  createLayerPropertyKeyframe(0, from),
  createLayerPropertyKeyframe(10, to, { easing: 'linear' }),
];

describe('shader parameter animation', () => {
  it('discovers scalar/channel paths independently for both paints without inventing default tracks', () => {
    const layer = fixture();
    const properties = getShaderAnimatableProperties(layer.element);
    expect(properties).toHaveLength(18);
    expect(properties).toEqual(
      expect.arrayContaining([
        'fill.parameters.yaw',
        'fill.parameters.offset.x',
        'fill.parameters.tint.a',
        'strokePaint.parameters.tint.r',
        'strokePaint.parameters.enabled',
      ]),
    );
    expect(getLayerAnimatableProperties(layer)).toEqual(expect.arrayContaining(properties));
    expect(
      Object.keys(getResolvedLayerAnimationTracks(layer)).some((property) =>
        parseShaderAnimationProperty(property),
      ),
    ).toBe(false);
    expect(getLayerPropertyValueAtFrame(layer, 'fill.parameters.yaw', 7)).toBe(0.25);
    expect(getShaderAnimationValue(layer.element, 'fill.parameters.enabled')).toBe(1);
    expect(animatablePropertyLabel('strokePaint.parameters.tint.r', layer)).toBe(
      'Outline shader · Tint · R',
    );
    expect(shaderAnimationPropertySpec(layer.element, 'fill.parameters.offset.r')).toBeUndefined();
    expect(shaderAnimationPropertySpec(layer.element, 'fill.parameters.yaw.x')).toBeUndefined();
    expect(shaderAnimationPropertySpec(layer.element, 'fill.parameters.tint.a')).toMatchObject({
      min: 0,
      max: 1,
      discrete: false,
      component: 'a',
    });
  });

  it('uses deterministic easing for floats and holds outgoing integer and toggle keys', () => {
    const layer = fixture();
    layer.animationTracks['fill.parameters.yaw'] = [
      createLayerPropertyKeyframe(0, -1),
      createLayerPropertyKeyframe(20, 1, { easing: 'quad-in' }),
    ];
    expect(getLayerPropertyValueAtFrame(layer, 'fill.parameters.yaw', 10)).toBeCloseTo(-0.5);
    const count = keys(2, 9);
    expect(
      [0, 5, 9.99, 10, 5].map((frame) =>
        getShaderTrackValueAtFrame(layer.element, 'fill.parameters.count', count, frame),
      ),
    ).toEqual([2, 2, 2, 9, 2]);
    const toggle = keys(1, 0);
    expect(getShaderTrackValueAtFrame(layer.element, 'fill.parameters.enabled', toggle, 9)).toBe(1);
    expect(getShaderTrackValueAtFrame(layer.element, 'fill.parameters.enabled', toggle, 10)).toBe(
      0,
    );
    const color = keys(0, 1);
    color[1]!.easing = 'back-out';
    expect(getShaderTrackValueAtFrame(layer.element, 'fill.parameters.tint.r', color, 6)).toBe(1);
  });

  it('lets only keyed components override data and preserves all remaining values immutably', () => {
    const layer = fixture();
    const dataBound = applyElementDataValue(layer.element, 'fill.parameters.tint', '#11223344');
    layer.animationTracks['fill.parameters.tint.r'] = keys(0.8, 1);
    const sampled = sampleShaderAnimationTracks(dataBound, layer.animationTracks, 0);
    expect(getElementShaderPaint(sampled)?.parameters.tint).toEqual([
      0.8,
      34 / 255,
      51 / 255,
      68 / 255,
    ]);
    expect(getElementShaderPaint(dataBound)?.parameters.tint).toEqual([
      17 / 255,
      34 / 255,
      51 / 255,
      68 / 255,
    ]);
    expect(getShaderAnimationValue(sampled, 'strokePaint.parameters.tint.r')).toBe(0.2);
    expect(sampleShaderAnimationValues(dataBound, {}, 10)).toEqual({});
    expect(sampleShaderAnimationTracks(dataBound, {}, 10)).toBe(dataBound);
    const clamped = applyShaderAnimationValues(sampled, {
      'fill.parameters.offset.x': 50,
      'strokePaint.parameters.enabled': 0,
    });
    expect(getShaderAnimationValue(clamped, 'fill.parameters.offset.x')).toBe(3);
    expect(getShaderAnimationValue(clamped, 'fill.parameters.offset.y')).toBe(2);
    expect(getElementShaderPaint(clamped, 'stroke')?.parameters.enabled).toBe(false);
  });

  it('samples shader loops from absolute elapsed time, including repeat end and discrete values', () => {
    const layer = fixture();
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: {
        'fill.parameters.yaw': [
          createLayerPropertyKeyframe(0, 0),
          createLayerPropertyKeyframe(5, 2),
          createLayerPropertyKeyframe(10, 0),
        ],
        'strokePaint.parameters.count': keys(2, 9),
      },
    });
    expect(
      [2.5, 7.5, 12.5, 2.5].map((elapsed) =>
        getLoopPropertyValueAtElapsed(
          layer.loop!,
          'fill.parameters.yaw',
          elapsed,
          0.25,
          layer.element,
        ),
      ),
    ).toEqual([1, 1, 1, 1]);
    expect(getLayerPropertyWithLighting(layer, [], 'strokePaint.parameters.count', 0, 9.5)).toBe(2);
    layer.loop.repeatCount = 1;
    expect(
      getLoopPropertyValueAtElapsed(
        layer.loop,
        'strokePaint.parameters.count',
        10,
        2,
        layer.element,
      ),
    ).toBe(9);
  });

  it('prunes removed source channels in both track sets while retaining other paint motion', () => {
    const project = createProject();
    const layer = fixture();
    project.compositions[0]!.layers = [layer];
    layer.animationTracks['fill.parameters.yaw'] = keys(0, 1);
    layer.animationTracks['strokePaint.parameters.yaw'] = keys(1, 2);
    layer.animationTracks['fill.parameters.tint.a'] = keys(0, 1);
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: { 'fill.parameters.yaw': keys(0, 1), 'strokePaint.parameters.count': keys(2, 5) },
    });
    getElementShaderPaint(layer.element)!.fragmentSource = source
      .replace('#pragma ograf yaw slider min(-2) max(2) step(0.1)', '')
      .replace('const vec4 tint = vec4(0.2,0.3,0.4,0.5);', 'const vec3 tint = vec3(0.2,0.3,0.4);')
      .replace('c=tint+', 'c=vec4(tint,1.0)+');
    syncShaderParameterFields(project.compositions[0]!, layer);
    expect(layer.animationTracks['fill.parameters.yaw']).toBeUndefined();
    expect(layer.animationTracks['fill.parameters.tint.a']).toBeUndefined();
    expect(layer.loop.tracks['fill.parameters.yaw']).toBeUndefined();
    expect(layer.animationTracks['strokePaint.parameters.yaw']).toHaveLength(2);
    expect(layer.loop.tracks['strokePaint.parameters.count']).toHaveLength(2);
    expect(
      migrateProject(project).compositions[0]!.layers[0]!.animationTracks[
        'strokePaint.parameters.yaw'
      ],
    ).toEqual(layer.animationTracks['strokePaint.parameters.yaw']);
  });

  it('validates unknown targets, integer/toggle keys and authored ranges without requiring unkeyed tracks', () => {
    const project = createProject();
    const layer = fixture();
    project.compositions[0]!.layers = [layer];
    expect(validateProject(project).errors).toEqual([]);
    layer.animationTracks['fill.parameters.count'] = keys(2, 3.5);
    layer.animationTracks['fill.parameters.enabled'] = keys(0, 0.5);
    layer.animationTracks['fill.parameters.yaw'] = keys(0, 5);
    layer.animationTracks['fill.parameters.missing'] = keys(0, 1);
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: { 'strokePaint.parameters.enabled': keys(0, 0.3) },
    });
    const errors = validateProject(project).errors.join(' ');
    expect(errors).toContain('signed 32-bit integers');
    expect(errors).toContain('must be 0 or 1');
    expect(errors).toContain('outside its declared range');
    expect(errors).toContain('missing shader animation property');
  });
});
