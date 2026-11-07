import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createProject,
  createTextLayer,
} from '@ograf-editor/scene-model';
import {
  addProjectSetAssetSlot,
  addProjectSetTemplate,
  bindProjectSetAsset,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  setProjectSetAssetBindingInherited,
  setProjectSetAssetSlotSource,
  validateProjectSetDocument,
} from './projectSet';
import {
  bindCurrentProjectSetAsset,
  replaceReviewedSharedAsset,
  sharedAssetImpact,
  sharedSourceReferences,
} from './sharedAssetImpact';

function fixture() {
  const first = createProject({ name: 'Headline' });
  const second = createProject({ name: 'Ticker' });
  const firstComp = first.compositions[0]!;
  const secondComp = second.compositions[0]!;
  const asset = (id: string, dataUri: string) =>
    createAsset({
      id,
      name: id,
      kind: 'image',
      mimeType: 'image/png',
      dataUri,
      byteSize: 3,
    });
  firstComp.assets.push(asset('logo-a', 'data:image/png;base64,AQID'));
  secondComp.assets.push(asset('logo-b', 'data:image/png;base64,BAUG'));
  let set = createProjectSet('News', first);
  const firstId = set.templates[0]!.id;
  set = addProjectSetTemplate(set, second);
  const secondId = set.templates[1]!.id;
  set = addProjectSetAssetSlot(set, firstId, firstComp.id, 'logo-a');
  const slot = set.assetSlots[0]!;
  set = bindProjectSetAsset(set, slot.id, secondId, secondComp.id, 'logo-b');
  set = addProjectSetAssetSlot(set, secondId, secondComp.id, 'logo-b');
  const otherSlot = set.assetSlots[1]!;
  // Keep the second slot linked to the same source but a separate local target.
  set = {
    ...set,
    assetSlots: set.assetSlots.map((item) =>
      item.id === otherSlot.id ? { ...item, bindings: [] } : item,
    ),
  };
  set = setProjectSetAssetSlotSource(set, otherSlot.id, slot.assetId);
  const binding = set.assetSlots[0]!.bindings.find((item) => item.templateId === secondId)!;
  set = setProjectSetAssetBindingInherited(set, slot.id, binding.id, false);
  return { set, slot, otherSlot, firstId, secondId, first, second, firstComp, secondComp, asset };
}

describe('shared asset replacement impact', () => {
  it('reports every slot sharing the source, distinguishing local fallback and current unsaved asset name', () => {
    const f = fixture();
    const current = structuredClone(f.first);
    current.compositions[0]!.assets[0]!.name = 'Renamed live logo';
    const impact = sharedAssetImpact(f.set, f.slot.id, true, {
      templateId: f.firstId,
      project: current,
    });
    expect(impact.map((item) => item.slot.id)).toEqual([f.slot.id, f.otherSlot.id]);
    expect(impact[0]!.bindings).toMatchObject([
      { templateName: 'Headline', assetName: 'Renamed live logo', inherit: true },
      { templateName: 'Ticker', assetName: 'logo-b', inherit: false },
    ]);
    expect(sharedAssetImpact(f.set, f.slot.id, false)).toHaveLength(1);
  });

  it('replaces all users without changing local fallbacks, or creates an independent source for one slot', () => {
    const f = fixture();
    const replacement = f.asset('ignored-id', 'data:image/png;base64,BwgJ');
    const changed = replaceReviewedSharedAsset(f.set, f.slot.id, replacement, 'all', 'unused-id');
    expect(changed.assets.find((item) => item.id === f.slot.assetId)?.dataUri).toBe(
      replacement.dataUri,
    );
    expect(changed.assetSlots[1]!.assetId).toBe(f.slot.assetId);
    expect(resolveProjectSetTemplate(changed, f.firstId).compositions[0]!.assets[0]!.dataUri).toBe(
      replacement.dataUri,
    );
    expect(resolveProjectSetTemplate(changed, f.secondId).compositions[0]!.assets[0]!.dataUri).toBe(
      'data:image/png;base64,BAUG',
    );
    const separate = replaceReviewedSharedAsset(
      f.set,
      f.slot.id,
      replacement,
      'slot',
      'independent-source',
    );
    expect(separate.assetSlots[0]!.assetId).toBe('independent-source');
    expect(separate.assetSlots[1]!.assetId).toBe(f.slot.assetId);
    expect(separate.assets.find((item) => item.id === f.slot.assetId)?.dataUri).toBe(
      'data:image/png;base64,AQID',
    );
    expect(f.set.assets.find((item) => item.id === f.slot.assetId)?.dataUri).toBe(
      'data:image/png;base64,AQID',
    );
    expect(() =>
      replaceReviewedSharedAsset(f.set, f.slot.id, replacement, 'slot', f.slot.assetId!),
    ).toThrow(/already in use/);
  });

  it('identifies shared controls referring directly to the source', () => {
    const f = fixture();
    f.set.controls.push({
      field: createFieldDefinition('image-url', { key: 'logo', label: 'Main logo' }),
      value: `asset:${f.slot.assetId}`,
      bindings: [],
    });
    expect(sharedSourceReferences(f.set, f.slot.assetId!).controls).toEqual(['Main logo']);
  });

  it('detects an invalid source change for a directly referenced control before publishing', () => {
    const f = fixture();
    const field = createFieldDefinition('image-url', { key: 'logo', label: 'Main logo' });
    f.set.templates[0]!.project.compositions[0]!.dataFields.push(field);
    f.set.controls.push({
      field,
      value: `asset:${f.slot.assetId}`,
      bindings: [
        { templateId: f.firstId, compositionId: f.firstComp.id, fieldId: field.id, inherit: true },
      ],
    });
    expect(() => validateProjectSetDocument(f.set)).not.toThrow();
    const separate = replaceReviewedSharedAsset(
      f.set,
      f.slot.id,
      f.asset('new', 'data:image/png;base64,BwgJ'),
      'slot',
      'independent-source',
    );
    expect(() => validateProjectSetDocument(separate)).toThrow(/not linked/);
    expect(f.set.assetSlots[0]!.assetId).toBe(f.slot.assetId);
  });

  it('links a newly imported active-template asset and preserves unsaved scene edits and fallback', () => {
    const f = fixture();
    const live = resolveProjectSetTemplate(f.set, f.firstId);
    const comp = live.compositions[0]!;
    const newAsset = f.asset('newly-imported', 'data:image/png;base64,CgsM');
    const layer = createTextLayer();
    layer.name = 'Unsaved headline';
    comp.assets.push(newAsset);
    comp.layers.push(layer);
    const updated = bindCurrentProjectSetAsset(f.set, f.slot.id, f.firstId, comp.id, newAsset.id, {
      templateId: f.firstId,
      project: live,
    });
    expect(
      updated.assetSlots[0]!.bindings.find((item) => item.templateId === f.firstId)
        ?.templateAssetId,
    ).toBe(newAsset.id);
    const savedComp = updated.templates[0]!.project.compositions[0]!;
    expect(savedComp.layers.some((item) => item.id === layer.id)).toBe(true);
    expect(savedComp.assets.find((item) => item.id === newAsset.id)?.dataUri).toBe(
      newAsset.dataUri,
    );
    expect(savedComp.assets.find((item) => item.id === 'logo-a')?.dataUri).toBe(
      'data:image/png;base64,AQID',
    );
    expect(() => validateProjectSetDocument(updated)).not.toThrow();
  });

  it('retains the reviewed replacement and local fallback through a compact set save and reopen', async () => {
    const f = fixture();
    const replacement = f.asset('new', 'data:image/png;base64,BwgJ');
    const changed = replaceReviewedSharedAsset(f.set, f.slot.id, replacement, 'all', 'unused');
    const archive = await createProjectSetArchive(changed);
    const restored = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
    expect(resolveProjectSetTemplate(restored, f.firstId).compositions[0]!.assets[0]!.dataUri).toBe(
      replacement.dataUri,
    );
    expect(
      resolveProjectSetTemplate(restored, f.secondId).compositions[0]!.assets[0]!.dataUri,
    ).toBe('data:image/png;base64,BAUG');
    expect(restored.assetSlots.find((item) => item.id === f.otherSlot.id)?.assetId).toBe(
      f.slot.assetId,
    );
  });
});
