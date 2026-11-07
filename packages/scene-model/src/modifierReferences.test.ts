import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { addLayerModifier, layerModifiersErrors } from './modifiers';
import {
  applyModifierSafeGroupChanges,
  assertModifierGroupCopySafe,
  assertModifierSourcesRemovable,
} from './modifierReferences';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
} from './factory';
import { materializeRepeater } from './repeaterRecipes';

function fixture() {
  const title = createLayerOfKind('text'),
    subtitle = createLayerOfKind('text'),
    panel = createLayerOfKind('rectangle');
  title.groupId = 'labels';
  subtitle.groupId = 'labels';
  addLayerModifier(panel, 'auto-size', { source: { kind: 'group', groupId: 'labels' } });
  return { title, subtitle, panel, layers: [title, subtitle, panel] };
}
describe('modifier reference lifecycle safety', () => {
  it('blocks removing a referenced layer or a group last member, but allows removing an owner or one member', () => {
    const f = fixture();
    expect(() => assertModifierSourcesRemovable(f, new Set([f.title.id]))).not.toThrow();
    expect(() => assertModifierSourcesRemovable(f, new Set([f.title.id, f.subtitle.id]))).toThrow(
      /referenced group/,
    );
    expect(() =>
      assertModifierSourcesRemovable(f, new Set(f.layers.map((layer) => layer.id))),
    ).not.toThrow();
    f.panel.modifiers![0]!.params = {
      ...f.panel.modifiers![0]!.params,
      source: { kind: 'layer', layerId: f.title.id },
    } as never;
    expect(() => assertModifierSourcesRemovable(f, new Set([f.title.id]))).toThrow(
      /referenced layer/,
    );
  });
  it('remaps an exact group identity rename atomically including draft proxies', () => {
    const f = fixture();
    const next = produce(f.layers, (draft) =>
      applyModifierSafeGroupChanges(
        draft,
        new Map([
          [f.title.id, 'renamed'],
          [f.subtitle.id, 'renamed'],
        ]),
      ),
    );
    expect(next[2]!.modifiers?.[0]).toMatchObject({ params: { source: { groupId: 'renamed' } } });
    expect(layerModifiersErrors(next)).toEqual([]);
    expect(f.layers[2]!.modifiers?.[0]).toMatchObject({
      params: { source: { groupId: 'labels' } },
    });
  });
  it('rejects ungroup and merge widening before changing group IDs or references', () => {
    const f = fixture(),
      before = structuredClone(f.layers);
    expect(() =>
      applyModifierSafeGroupChanges(
        f.layers,
        new Map([
          [f.title.id, null],
          [f.subtitle.id, null],
        ]),
      ),
    ).toThrow(/Retarget/);
    expect(f.layers).toEqual(before);
    expect(() =>
      applyModifierSafeGroupChanges(f.layers, new Map(f.layers.map((layer) => [layer.id, 'all']))),
    ).toThrow(/Retarget/);
    expect(f.layers).toEqual(before);
  });
  it('blocks introducing a group self-cycle even if the group ID remains present', () => {
    const f = fixture(),
      before = structuredClone(f.layers);
    expect(() =>
      applyModifierSafeGroupChanges(f.layers, new Map([[f.panel.id, 'labels']])),
    ).toThrow(/cycle/);
    expect(f.layers).toEqual(before);
  });
  it('preserves complete copied groups and rejects partial copies or flattening a referenced subgroup', () => {
    const f = fixture();
    expect(() => assertModifierGroupCopySafe(f, f.layers)).not.toThrow();
    expect(() => assertModifierGroupCopySafe(f, [f.title, f.panel])).toThrow(
      /complete referenced group/,
    );
    expect(() => assertModifierGroupCopySafe(f, f.layers, true)).toThrow(/widen/);
    expect(() => assertModifierGroupCopySafe(f, [f.title, f.subtitle], true)).not.toThrow();
  });
  it('rejects guide layer/group geometry or value sources that disappear in export', () => {
    const f = fixture();
    f.title.isGuide = true;
    expect(layerModifiersErrors(f.layers).join(' ')).toContain('guide artwork');
    f.panel.modifiers = [];
    addLayerModifier(f.panel, 'hide-empty', {
      source: { kind: 'layer', layerId: f.title.id, property: 'content' },
    });
    expect(layerModifiersErrors(f.layers).join(' ')).toContain('guide omitted');
  });
  it('retargets first repeater item group renames and keeps later item group targets independent', () => {
    const project = createProject(),
      composition = project.compositions[0]!;
    const title = createLayerOfKind('text'),
      panel = createLayerOfKind('rectangle');
    for (const layer of [title, panel])
      layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    title.groupId = 'original';
    panel.groupId = 'original';
    addLayerModifier(title, 'hide-empty', {
      source: { kind: 'layer', layerId: title.id, property: 'content' },
      target: { kind: 'group', groupId: 'original' },
    });
    composition.layers = [title, panel];
    const result = materializeRepeater(composition, {
      layerIds: [title.id, panel.id],
      items: [{ label: 'First' }, { label: 'Second' }],
    });
    expect(title.modifiers?.[0]).toMatchObject({
      params: { target: { groupId: result.items[0]!.groupId } },
    });
    const second = composition.layers.find(
      (layer) => layer.id === result.items[1]!.layers[title.id],
    )!;
    expect(second.modifiers?.[0]).toMatchObject({
      params: { target: { groupId: result.items[1]!.groupId } },
    });
    expect(result.items[0]!.groupId).not.toBe(result.items[1]!.groupId);
    expect(layerModifiersErrors(composition.layers, composition.dataFields)).toEqual([]);
  });
});
