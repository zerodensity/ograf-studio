import { describe, expect, it } from 'vitest';
import {
  createLayerOfKind,
  addEffect,
  updateEffect,
  duplicateEffect,
  effectStackNeedsCompositing,
  effectStackToSvg,
  layerEffectsToCssFilter,
  migrateProject,
  createProject,
} from './index';

describe('per-effect compositing', () => {
  it('starts new effects bypassed and selects a mode without touching animation', () => {
    const layer = createLayerOfKind('rectangle');
    const effect = addEffect(layer, 'glow');
    const tracks = structuredClone(layer.animationTracks);
    expect(effect.enabled).toBe(false);
    expect(layerEffectsToCssFilter(layer.effects)).toBe('none');
    expect(effectStackNeedsCompositing(layer.effects)).toBe(false);
    updateEffect(layer, effect.id, { blendMode: 'screen', blendOpacity: 0.6 });
    expect(effectStackNeedsCompositing(layer.effects)).toBe(true);
    expect(layer.animationTracks).toEqual(tracks);
    expect(duplicateEffect(layer, effect.id)).toMatchObject({
      enabled: true,
      blendMode: 'screen',
      blendOpacity: 0.6,
    });
    for (const entry of layer.effects.stack!) updateEffect(layer, entry.id, { enabled: false });
    expect(effectStackToSvg(layer.effects)).toBe('');
    expect(effectStackNeedsCompositing(layer.effects)).toBe(false);
  });
  it('retains old enabled effects without blending fields on migration', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [
      { id: 'old', name: 'Blur', type: 'blur', enabled: true, params: { radius: 5 } },
    ];
    project.compositions[0]!.layers.push(layer);
    const loaded = migrateProject(project).compositions[0]!.layers[0]!;
    expect(layerEffectsToCssFilter(loaded.effects)).toBe('blur(5px)');
    expect(effectStackNeedsCompositing(loaded.effects)).toBe(false);
  });
  it('mixes adjustment results in premultiplied RGBA and chains the mixed result', () => {
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'brightness', {
      blendMode: 'multiply',
      blendOpacity: 0.25,
      params: { amount: 0.5 },
    });
    addEffect(layer, 'blur', { blendMode: 'normal', params: { radius: 3 } });
    const svg = effectStackToSvg(layer.effects);
    expect(svg).toContain('<feBlend in="fx-0" in2="SourceGraphic" mode="multiply"');
    expect(svg).toContain('k2="0.25" k3="0.75"');
    expect(svg).toContain('in="fx-0-mix" result="fx-1"');
  });
  it('isolates generated glow/shadow and makes zero strength a no-op', () => {
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    const glow = addEffect(layer, 'glow', { blendMode: 'add' });
    const svg = effectStackToSvg(layer.effects);
    expect(svg).toContain('<feFlood');
    expect(svg).toContain('operator="in"');
    expect(svg).not.toContain('<feDropShadow');
    expect(svg).toContain('k2="1" k3="1"');
    updateEffect(layer, glow.id, { blendOpacity: 0 });
    expect(effectStackToSvg(layer.effects)).toBe('');
    expect(layerEffectsToCssFilter(layer.effects)).toBe('none');
    expect(effectStackNeedsCompositing(layer.effects)).toBe(false);
  });
  it('rejects invalid blend settings without partially mutating the effect', () => {
    const layer = createLayerOfKind('rectangle'),
      effect = addEffect(layer, 'blur');
    const before = structuredClone(layer);
    expect(() => updateEffect(layer, effect.id, { blendOpacity: 2 })).toThrow();
    expect(layer).toEqual(before);
    expect(() => updateEffect(layer, effect.id, { blendMode: 'invalid' as 'normal' })).toThrow();
    expect(layer).toEqual(before);
  });
});
