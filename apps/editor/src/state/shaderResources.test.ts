import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createComposition,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createShaderPaint,
  getElementShaderPaint,
  migrateProject,
  MAX_SHADER_NAME_LENGTH,
  syncShaderParameterFields,
} from '@ograf-editor/scene-model';
import {
  collectShaderResources,
  collectStoredShaderResources,
  isStoredShaderResourceTarget,
  defaultShaderResourceName,
  shaderResourceTarget,
  resolveShaderResource,
  shaderPaintWithPatch,
  shaderResourceKey,
  shaderResourcePatchBetween,
  type ShaderResourceTarget,
  type ShaderUsageTarget,
} from './shaderResources';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';

function inlineShaderResources(project: Parameters<typeof collectShaderResources>[0]) {
  return collectShaderResources(project).filter(
    (resource): resource is Extract<typeof resource, ShaderUsageTarget> =>
      !isStoredShaderResourceTarget(resource),
  );
}

const source = `#pragma ograf gain slider min(0) max(1) step(0.1)
const float gain = 0.5;
#pragma ograf removed slider min(0) max(1)
const float removed = 0.2;
#pragma ograf tint color
vec3 tint = vec3(0.1,0.2,0.3);
void mainImage(out vec4 c, in vec2 p) { c = vec4(tint * gain + removed, 1.0); }`;

function fixture() {
  const project = createProject();
  const main = project.compositions[0]!;
  main.name = 'Main';
  const other = createComposition({ name: 'Second' });
  project.compositions.push(other);
  for (const composition of [main, other]) {
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.id = 'same-local-id';
    layer.name = `${composition.name} headline`;
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    layer.element.fill = createShaderPaint({
      fragmentSource: source,
      parameters: { gain: 0.7, removed: 0.2, tint: [0.123, 0.4, 0.9] },
    });
    layer.element.strokePaint = createShaderPaint({
      fragmentSource: source,
      parameters: { gain: 0.3 },
    });
    composition.layers = [layer];
    syncShaderParameterFields(composition, layer);
  }
  main.components.push(
    buildComponentDefinition(main, [main.layers[0]!.id], 'Reusable title', 'saved-title'),
  );
  return project;
}

describe('project shader resources', () => {
  it('normalizes custom names, preserves them through save/load, and keeps usage and field names independent', () => {
    useProjectStore.getState().loadProject(fixture());
    const target = inlineShaderResources(useProjectStore.getState().project)[0]!;
    const fieldsBefore = JSON.stringify(
      useProjectStore.getState().project.compositions[0]!.dataFields,
    );
    useProjectStore.getState().updateShaderResource(target, { name: '  Blue shimmer  ' });
    expect(inlineShaderResources(useProjectStore.getState().project)[0]).toMatchObject({
      label: 'Blue shimmer',
      usageLabel: 'Main headline · Fill',
      key: target.key,
    });
    useProjectStore.getState().setProjectMeta({ name: 'Renamed project' });
    expect(inlineShaderResources(useProjectStore.getState().project)[0]).toMatchObject({
      label: 'Blue shimmer',
      usageLabel: 'Main headline · Fill',
      key: target.key,
    });
    useProjectStore.getState().renameLayer(target.layerId, 'Updated headline');
    expect(inlineShaderResources(useProjectStore.getState().project)[0]).toMatchObject({
      label: 'Blue shimmer',
      usageLabel: 'Updated headline · Fill',
      key: target.key,
    });
    expect(JSON.stringify(useProjectStore.getState().project.compositions[0]!.dataFields)).toBe(
      fieldsBefore,
    );
    const roundtrip = migrateProject(
      JSON.parse(JSON.stringify(useProjectStore.getState().project)),
    );
    expect(resolveShaderResource(roundtrip, target).paint.name).toBe('Blue shimmer');
    expect(createShaderPaint({ name: '  Trimmed  ' }).name).toBe('Trimmed');
    expect(createShaderPaint({ name: '  ' })).not.toHaveProperty('name');
    useProjectStore.getState().updateShaderResource(target, { name: '' });
    expect(inlineShaderResources(useProjectStore.getState().project)[0]!.label).toBe(
      'Updated headline · Fill',
    );
    expect(
      resolveShaderResource(useProjectStore.getState().project, target).paint,
    ).not.toHaveProperty('name');
    expect(() =>
      useProjectStore
        .getState()
        .updateShaderResource(target, { name: 'x'.repeat(MAX_SHADER_NAME_LENGTH + 1) }),
    ).toThrow(/at most 128/);
  });

  it('builds an explicit-save delta without overwriting concurrently changed untouched controls', () => {
    useProjectStore.getState().loadProject(fixture());
    const target = inlineShaderResources(useProjectStore.getState().project)[0]!;
    const baseline = structuredClone(target.paint);
    const draft = shaderPaintWithPatch(baseline, { name: 'Saved name', parameters: { gain: 0.8 } });
    useProjectStore.getState().updateShaderResource(target, {
      resolutionScale: 0.5,
      parameters: { removed: 0.9, tint: [0.8, 0.7, 0.6] },
    });
    const patch = shaderResourcePatchBetween(baseline, draft);
    expect(patch).toEqual({ name: 'Saved name', parameters: { gain: 0.8 } });
    useProjectStore.getState().updateShaderResource(target, patch);
    expect(resolveShaderResource(useProjectStore.getState().project, target).paint).toMatchObject({
      name: 'Saved name',
      resolutionScale: 0.5,
      parameters: { gain: 0.8, removed: 0.9, tint: [0.8, 0.7, 0.6] },
    });
    expect(shaderResourcePatchBetween(baseline, structuredClone(baseline))).toEqual({});
    expect(
      shaderResourcePatchBetween({ ...baseline, name: 'Old' }, { ...baseline, name: ' ' }),
    ).toEqual({ name: '' });
  });

  it('diffs source edits against adapted defaults and excludes removed or stale opening parameters', () => {
    const baseline = createShaderPaint({
      fragmentSource: source,
      parameters: { gain: 0.7, removed: 0.2, tint: [0.123, 0.4, 0.9] },
    });
    const nextSource = `#pragma ograf gain slider min(0) max(0.6)
const float gain = 0.4;
#pragma ograf count slider min(1) max(5)
const int count = 2;
void mainImage(out vec4 c, in vec2 p) { c = vec4(gain * float(count)); }`;
    const draft = shaderPaintWithPatch(baseline, { fragmentSource: nextSource });
    draft.parameters.count = 4;
    const patch = shaderResourcePatchBetween(baseline, draft);
    expect(patch).toEqual({ fragmentSource: nextSource, parameters: { count: 4 } });
    const latest = shaderPaintWithPatch(baseline, { parameters: { gain: 0.3 } });
    expect(shaderPaintWithPatch(latest, patch).parameters).toEqual({ gain: 0.3, count: 4 });
    const rawSourceDraft = { ...baseline, fragmentSource: nextSource };
    expect(shaderResourcePatchBetween(baseline, rawSourceDraft)).toEqual({
      fragmentSource: nextSource,
    });
    const changedTypeSource =
      '#pragma ograf gain toggle\nconst bool gain = true;\nvoid mainImage(out vec4 c,in vec2 p) { c=vec4(gain ? 1.0 : 0.0); }';
    expect(
      shaderResourcePatchBetween(baseline, { ...baseline, fragmentSource: changedTypeSource }),
    ).toEqual({ fragmentSource: changedTypeSource });
  });

  it('copies, diffs and removes an embedded shader image input independently', () => {
    const baseline = createShaderPaint();
    const inputImage = {
      source: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'noise.png',
      wrap: 'repeat' as const,
      filter: 'linear' as const,
    };
    const draft = shaderPaintWithPatch(baseline, { inputImage });
    expect(draft.inputImage).toEqual(inputImage);
    expect(draft.inputImage).not.toBe(inputImage);
    expect(shaderResourcePatchBetween(baseline, draft)).toEqual({ inputImage });
    expect(shaderPaintWithPatch(draft, { inputImage: undefined })).not.toHaveProperty('inputImage');
  });
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
  });

  it('collects every live and saved usage with distinct stable keys and correct slots', () => {
    const project = fixture();
    project.compositions[0]!.components[0]!.layers[0]!.isLocked = true;
    const before = JSON.stringify(project);
    const resources = inlineShaderResources(project);
    expect(resources).toHaveLength(6);
    expect(new Set(resources.map((resource) => resource.key)).size).toBe(6);
    expect(resources.filter((resource) => resource.componentId)).toHaveLength(2);
    expect(resources.filter((resource) => resource.locked)).toHaveLength(2);
    expect(resources.map((resource) => resource.label)).toEqual([
      'Main headline · Fill',
      'Main headline · Outline',
      'Main headline · Fill',
      'Main headline · Outline',
      'Second headline · Fill',
      'Second headline · Outline',
    ]);
    expect(resources[2]).toMatchObject({
      componentName: 'Reusable title',
      compositionName: 'Main',
      componentId: 'saved-title',
    });
    const target = resources[0]!;
    project.compositions[0]!.layers[0]!.name = 'Renamed';
    expect(inlineShaderResources(project)[0]!.key).toBe(target.key);
    project.compositions[0]!.layers[0]!.name = 'Main headline';
    expect(JSON.stringify(project)).toBe(before);
    expect(shaderResourceKey(target)).toBe(target.key);
  });

  it('edits an inactive composition outline without changing fill, selection, active composition, or time', () => {
    const project = fixture();
    useProjectStore.getState().loadProject(project);
    useSelectionStore.getState().select('same-local-id');
    useTimelineStore.getState().setCurrentFrame(12);
    const activeBefore = useProjectStore.getState().activeCompositionId;
    const keyframeBefore = useProjectStore.getState().activeKeyframeId;
    const mainBefore = JSON.stringify(useProjectStore.getState().project.compositions[0]);
    const target: ShaderResourceTarget = {
      compositionId: project.compositions[1]!.id,
      layerId: 'same-local-id',
      slot: 'stroke',
    };
    useProjectStore.getState().updateShaderResource(target, { parameters: { gain: 0.9 } });
    const state = useProjectStore.getState();
    const resolved = resolveShaderResource(state.project, target);
    expect(resolved.paint.parameters.gain).toBe(0.9);
    expect(getElementShaderPaint(resolved.layer.element)?.parameters.gain).toBe(0.7);
    expect(state.activeCompositionId).toBe(activeBefore);
    expect(state.activeKeyframeId).toBe(keyframeBefore);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['same-local-id']);
    expect(useTimelineStore.getState().currentFrame).toBe(12);
    expect(JSON.stringify(state.project.compositions[0])).toBe(mainBefore);
  });

  it('merges minimal edits into current paint and preserves compatible controls when replacing source', () => {
    useProjectStore.getState().loadProject(fixture());
    const target = inlineShaderResources(useProjectStore.getState().project)[0]!;
    const snapshot = target.paint;
    useProjectStore.getState().updateShaderResource(target, { parameters: { gain: 0.8 } });
    useProjectStore.getState().updateShaderResource(target, { resolutionScale: 0.5 });
    const latest = resolveShaderResource(useProjectStore.getState().project, target).paint;
    expect(snapshot.parameters.gain).toBe(0.7);
    expect(latest.parameters.gain).toBe(0.8);
    const nextSource = source
      .replace('max(1) step(0.1)', 'max(0.6) step(0.1)')
      .replace('const float gain = 0.5;', 'const float gain = 0.4;');
    useProjectStore.getState().updateShaderResource(target, { fragmentSource: nextSource });
    const edited = resolveShaderResource(useProjectStore.getState().project, target).paint;
    expect(edited.parameters.gain).toBe(0.6);
    expect(edited.parameters.tint).toEqual([0.123, 0.4, 0.9]);
    expect(edited.resolutionScale).toBe(0.5);
  });

  it('updates only a saved component and cleans removed controls inside its own field scope', () => {
    useProjectStore.getState().loadProject(fixture());
    const state = useProjectStore.getState();
    const resource = inlineShaderResources(state.project).find(
      (item) => item.componentId && item.slot === 'fill',
    )!;
    const liveBefore = JSON.stringify(state.project.compositions[0]!.layers);
    const fieldsBefore = JSON.stringify(state.project.compositions[0]!.dataFields);
    const outline = resolveShaderResource(state.project, { ...resource, slot: 'stroke' }).paint;
    const outlineBefore = JSON.stringify(outline);
    const nextSource = `#pragma ograf gain toggle
const bool gain = true;
#pragma ograf count slider min(1) max(5)
const int count = 2;
void mainImage(out vec4 c, in vec2 p) { c = vec4(gain ? float(count) : 0.0); }`;
    useProjectStore.getState().updateShaderResource(resource, { fragmentSource: nextSource });
    const updated = resolveShaderResource(useProjectStore.getState().project, resource);
    expect(updated.paint.parameters).toEqual({ gain: true, count: 2 });
    expect(updated.component!.dataFields).toHaveLength(5);
    expect(
      updated
        .component!.dataFields.filter(
          (field) => field.generatedShaderParameter?.paintSlot === 'fill',
        )
        .map((field) => field.generatedShaderParameter?.name),
    ).toEqual(['gain', 'count']);
    expect(JSON.stringify(updated.composition.layers)).toBe(liveBefore);
    expect(JSON.stringify(updated.composition.dataFields)).toBe(fieldsBefore);
    expect(
      JSON.stringify(
        resolveShaderResource(useProjectStore.getState().project, { ...resource, slot: 'stroke' })
          .paint,
      ),
    ).toBe(outlineBefore);
  });

  it('rejects locked, deleted, and no-longer-shader targets instead of recreating them', () => {
    const project = fixture();
    project.compositions[0]!.components[0]!.layers[0]!.isLocked = true;
    useProjectStore.getState().loadProject(project);
    const resources = inlineShaderResources(useProjectStore.getState().project);
    const live = resources[0]!;
    const locked = resources.find((resource) => resource.locked)!;
    const before = JSON.stringify(useProjectStore.getState().project);
    expect(() =>
      useProjectStore.getState().updateShaderResource(locked, { resolutionScale: 0.5 }),
    ).toThrow(/locked/);
    expect(() =>
      useProjectStore.getState().updateShaderResource({ ...live, compositionId: 'gone' }, {}),
    ).toThrow(/composition no longer exists/);
    expect(() =>
      useProjectStore.getState().updateShaderResource({ ...live, layerId: 'gone' }, {}),
    ).toThrow(/object no longer exists/);
    expect(() =>
      useProjectStore.getState().updateShaderResource({ ...locked, componentId: 'gone' }, {}),
    ).toThrow(/component no longer exists/);
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
    useProjectStore.getState().updateLayerPaint(live.layerId, 0, '#ffffff');
    expect(() =>
      useProjectStore.getState().updateShaderResource(live, { resolutionScale: 0.5 }),
    ).toThrow(/no longer uses a shader/);
  });

  it('fails invalid source or parameter edits atomically', () => {
    useProjectStore.getState().loadProject(fixture());
    const target = inlineShaderResources(useProjectStore.getState().project)[0]!;
    const before = JSON.stringify(useProjectStore.getState().project);
    expect(() =>
      useProjectStore.getState().updateShaderResource(target, { fragmentSource: 'not GLSL' }),
    ).toThrow(/mainImage/);
    expect(() =>
      useProjectStore.getState().updateShaderResource(target, { parameters: { typo: 1 } }),
    ).toThrow(/Unknown shader parameter/);
    expect(() =>
      useProjectStore.getState().updateShaderResource(target, { parameters: { gain: 2 } }),
    ).toThrow(/outside its range/);
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
    expect(() => shaderPaintWithPatch(target.paint, { type: 'rectangle' } as never)).toThrow(
      /cannot change/,
    );
  });

  it('creates a standalone shader without adding objects, fields or changing selection and timeline', () => {
    const before = useProjectStore.getState();
    const compositions = before.project.compositions;
    const selection = [...useSelectionStore.getState().selectedLayerIds];
    useTimelineStore.getState().setCurrentFrame(12);
    const target = before.createShaderResource();
    const state = useProjectStore.getState();
    expect(isStoredShaderResourceTarget(target)).toBe(true);
    expect(state.project.shaders).toHaveLength(1);
    expect(state.project.shaders[0]).toMatchObject({
      id: target.shaderId,
      paint: { name: 'New Shader', type: 'shader' },
    });
    expect(state.project.compositions).toBe(compositions);
    expect(state.project.compositions[0]!.layers).toHaveLength(0);
    expect(state.project.compositions[0]!.dataFields).toHaveLength(0);
    expect(state.activeCompositionId).toBe(before.activeCompositionId);
    expect(state.activeKeyframeId).toBe(before.activeKeyframeId);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(selection);
    expect(useTimelineStore.getState().currentFrame).toBe(12);
    const resource = collectShaderResources(state.project)[0]!;
    expect(resource).toMatchObject({
      label: 'New Shader',
      usageLabel: 'Project shader',
      compositionName: 'Project library',
      locked: false,
    });
    expect(shaderResourceTarget(resource)).toEqual(target);
    expect(resource.key).toBe(shaderResourceKey(target));
  });

  it('keeps library names unique by default and lists saved resources before inline usages', () => {
    const project = fixture();
    const existing = getElementShaderPaint(project.compositions[0]!.layers[0]!.element)!;
    existing.name = 'new shader';
    useProjectStore.getState().loadProject(project);
    expect(defaultShaderResourceName(useProjectStore.getState().project)).toBe('New Shader 2');
    const first = useProjectStore.getState().createShaderResource();
    const second = useProjectStore
      .getState()
      .createShaderResource(createShaderPaint({ name: '  ' }));
    const resources = collectShaderResources(useProjectStore.getState().project);
    expect(resources).toHaveLength(8);
    expect(resources.slice(0, 2).map((resource) => resource.label)).toEqual([
      'New Shader 2',
      'New Shader 3',
    ]);
    expect(resources.slice(0, 2).every(isStoredShaderResourceTarget)).toBe(true);
    expect(first.shaderId).not.toBe(second.shaderId);
    expect(inlineShaderResources(useProjectStore.getState().project)).toHaveLength(6);
    expect(defaultShaderResourceName(useProjectStore.getState().project)).toBe('New Shader 4');
  });

  it('keeps applied shader copies out of the saved-resource collection', () => {
    const project = fixture();
    const first = createShaderPaint({ name: 'Saved look' });
    useProjectStore.getState().loadProject(project);
    useProjectStore.getState().createShaderResource(first);
    const stored = collectStoredShaderResources(useProjectStore.getState().project);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ label: 'Saved look', usageLabel: 'Project shader' });
    expect(stored.every(isStoredShaderResourceTarget)).toBe(true);
    expect(inlineShaderResources(useProjectStore.getState().project)).toHaveLength(6);
  });

  it('clones, serializes, reloads and minimally edits stored shader settings independently', () => {
    const supplied = createShaderPaint({
      name: '  Library look  ',
      fragmentSource: source,
      speed: 0.75,
      resolutionScale: 0.5,
      parameters: { gain: 0.7, tint: [0.123, 0.4, 0.9] },
    });
    const target = useProjectStore.getState().createShaderResource(supplied);
    (supplied.parameters.tint as number[])[0] = 0.9;
    const stored = resolveShaderResource(useProjectStore.getState().project, target);
    expect(stored.scope).toBe('library');
    expect(stored.paint).toMatchObject({
      name: 'Library look',
      speed: 0.75,
      resolutionScale: 0.5,
      parameters: { tint: [0.123, 0.4, 0.9] },
    });
    const saved = JSON.parse(JSON.stringify(useProjectStore.getState().project));
    useProjectStore.getState().loadProject(saved);
    expect(resolveShaderResource(useProjectStore.getState().project, target).paint).toEqual(
      stored.paint,
    );
    const compositions = useProjectStore.getState().project.compositions;
    useProjectStore
      .getState()
      .updateShaderResource(target, { parameters: { gain: 0.8 }, name: 'Renamed look' });
    expect(resolveShaderResource(useProjectStore.getState().project, target).paint).toMatchObject({
      name: 'Renamed look',
      speed: 0.75,
      resolutionScale: 0.5,
      parameters: { gain: 0.8, tint: [0.123, 0.4, 0.9] },
    });
    expect(useProjectStore.getState().project.compositions).toBe(compositions);
    useProjectStore.getState().updateShaderResource(target, { name: '' });
    expect(collectShaderResources(useProjectStore.getState().project)[0]!.label).toBe(
      'Project shader',
    );
    useProjectStore.getState().removeShaderResource(target);
    expect(useProjectStore.getState().project.shaders).toHaveLength(0);
    expect(useProjectStore.getState().project.compositions).toBe(compositions);
    expect(() => useProjectStore.getState().updateShaderResource(target, {})).toThrow(
      /no longer exists/,
    );
    expect(() => useProjectStore.getState().removeShaderResource(target)).toThrow(
      /no longer exists/,
    );
  });

  it('rejects invalid stored shader creation and edits atomically', () => {
    const before = JSON.stringify(useProjectStore.getState().project);
    expect(() =>
      useProjectStore
        .getState()
        .createShaderResource(createShaderPaint({ fragmentSource: 'invalid source' })),
    ).toThrow(/mainImage/);
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
    const target = useProjectStore.getState().createShaderResource();
    const created = JSON.stringify(useProjectStore.getState().project);
    expect(() =>
      useProjectStore.getState().updateShaderResource(target, { fragmentSource: 'invalid source' }),
    ).toThrow(/mainImage/);
    expect(() =>
      useProjectStore.getState().updateShaderResource(target, { parameters: { unknown: 1 } }),
    ).toThrow(/Unknown shader parameter/);
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(created);
  });
});
