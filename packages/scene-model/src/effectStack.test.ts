import { describe, it, expect } from 'vitest';
import { createLayerOfKind, createLayerEffects } from './factory';
import {
  addEffect,
  updateEffect,
  removeEffect,
  duplicateEffect,
  reorderEffects,
  effectProperty,
  getEffectStack,
  sampleEffectStack,
  ensureLegacyEffects,
} from './effectStack';
import { layerEffectsToCssFilter } from './layerEffects';
import { effectStackToSvg } from './effectRendering';
import type { EffectParameterProperty } from './types';

describe('composable effects', () => {
  it('preserves old blur/shadow rendering and permits changing their order', () => {
    const l = createLayerOfKind('rectangle');
    l.effects = createLayerEffects({
      blur: 2,
      dropShadowEnabled: true,
      dropShadowColor: '#123456',
      dropShadowBlur: 9,
      dropShadowOffsetX: 3,
      dropShadowOffsetY: 4,
      dropShadowOpacity: 0.5,
    });
    expect(layerEffectsToCssFilter(l.effects)).toBe(
      'blur(2px) drop-shadow(3px 4px 9px rgba(18, 52, 86, 0.5))',
    );
    reorderEffects(l, ['base-shadow', 'base-blur']);
    expect(layerEffectsToCssFilter(l.effects)).toBe(
      'drop-shadow(3px 4px 9px rgba(18, 52, 86, 0.5)) blur(2px)',
    );
  });
  it('preserves stable parameter paths and keys through reorder and bypass', () => {
    const l = createLayerOfKind('rectangle'),
      a = addEffect(l, 'glow'),
      b = addEffect(l, 'contrast');
    const p = effectProperty(a, 'radius') as EffectParameterProperty;
    l.animationTracks[p] = [
      { id: 'key-a', frame: 0, value: 2, easing: 'linear' },
      { id: 'key-b', frame: 20, value: 12, easing: 'sine-in-out' },
    ];
    const tracks = structuredClone(l.animationTracks);
    reorderEffects(l, [b.id, a.id, 'base-shadow', 'base-blur']);
    updateEffect(l, a.id, { enabled: false });
    expect(l.animationTracks).toEqual(tracks);
    expect(layerEffectsToCssFilter(l.effects)).toBe('contrast(1)');
    expect(
      sampleEffectStack(l.effects, () => 7).stack!.find((e) => e.id === a.id)!.params.radius,
    ).toBe(7);
  });
  it('duplicates only owned animation and bindings and deletes only the selected instance', () => {
    const l = createLayerOfKind('rectangle'),
      a = addEffect(l, 'glow');
    const radius = effectProperty(a, 'radius') as EffectParameterProperty,
      color = effectProperty(a, 'color') as EffectParameterProperty;
    l.animationTracks[radius] = [
      { id: 'a', frame: 0, value: 2, easing: 'linear' },
      { id: 'b', frame: 20, value: 12, easing: 'sine-in-out' },
    ];
    l.animationTracks.x = [{ id: 'x', frame: 0, value: 10, easing: 'linear' }];
    l.designTokenBindings = [{ tokenId: 'brand', targetProperty: color }];
    l.bindings = [{ fieldId: 'color', targetProperty: color }];
    const copy = duplicateEffect(l, a.id),
      copyRadius = effectProperty(copy, 'radius') as EffectParameterProperty;
    expect(copy.id).not.toBe(a.id);
    expect(l.animationTracks[copyRadius]!.map((k) => [k.frame, k.value, k.easing])).toEqual([
      [0, 2, 'linear'],
      [20, 12, 'sine-in-out'],
    ]);
    expect(l.animationTracks[copyRadius]![0]!.id).not.toBe('a');
    removeEffect(l, a.id);
    expect(l.animationTracks[radius]).toBeUndefined();
    expect(l.animationTracks[copyRadius]).toHaveLength(2);
    expect(l.animationTracks.x![0]!.value).toBe(10);
    expect(l.bindings).toEqual([
      { fieldId: 'color', targetProperty: effectProperty(copy, 'color') },
    ]);
  });
  it('rejects malformed parameter edits and reorder lists atomically', () => {
    const l = createLayerOfKind('rectangle'),
      a = addEffect(l, 'glow'),
      before = structuredClone(l);
    expect(() => updateEffect(l, a.id, { enabled: false, params: { radius: -5 } })).toThrow();
    expect(l).toEqual(before);
    expect(() => updateEffect(l, a.id, { params: { notAParameter: 1 } })).toThrow();
    expect(l).toEqual(before);
    expect(() => reorderEffects(l, [a.id, a.id])).toThrow();
    expect(l).toEqual(before);
  });
  it('builds a sequential sRGB-compatible SVG chain and clamps eased numeric overshoot', () => {
    const l = createLayerOfKind('rectangle');
    l.effects.stack = [];
    addEffect(l, 'brightness', { params: { amount: 0.5 } });
    addEffect(l, 'contrast', { params: { amount: 2 } });
    addEffect(l, 'glow', { params: { color: '#ffaa0080', opacity: 0.5, radius: 8 } });
    const svg = effectStackToSvg(l.effects);
    expect(svg).toContain('in="SourceGraphic" result="fx-0"');
    expect(svg).toContain('in="fx-0" result="fx-1"');
    expect(svg).toContain('in="fx-1" result="fx-2"');
    expect(svg.indexOf('slope="0.5"')).toBeLessThan(svg.indexOf('slope="2"'));
    expect(sampleEffectStack(l.effects, () => 10000).stack!.at(-1)!.params.radius).toBe(256);
  });
  it('restores a removed compatibility slot when the legacy API edits it again', () => {
    const l = createLayerOfKind('rectangle');
    removeEffect(l, 'base-blur');
    l.effects = ensureLegacyEffects({ ...l.effects, blur: 5 }, { blur: 5 });
    expect(getEffectStack(l.effects).filter((e) => e.legacy === 'blur')).toHaveLength(1);
    expect(layerEffectsToCssFilter(l.effects)).toBe('blur(5px)');
  });
});
