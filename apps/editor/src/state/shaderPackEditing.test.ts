import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EFFECTS,
  createMediaPaint,
  createFieldDefinition,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  getElementShaderPaint,
  getEffectStack,
  studioPluginReference,
  type Layer,
  type ShaderPackPluginSnapshot,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useRendererPluginSettingsStore } from './pluginSettingsStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import { useTestDataStore } from './testDataStore';
import { resolveDesignerElement } from './dataBinding';
import { encodeShaderResourceDrag, shaderPaintFromResourceDrag } from './shaderDrag';
import { shaderPaintWithPatch } from './shaderResources';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');

const gainSource = `#pragma ograf gain slider min(0.0) max(2.0) step(0.1)
const float gain = 1.0;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(vec3(gain), 1.0); }`;
function makePack(version = '1.0.0') {
  return createShaderPackPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'shader-pack',
      id: 'test.shader-pack',
      name: 'Test shaders',
      version,
      license: 'CC0-1.0',
      author: 'Test author',
    },
    licenseText: 'CC0-1.0 complete test notice',
    shaders: [
      {
        id: 'clouds',
        name: 'Soft clouds',
        targets: ['fill', 'outline'],
        paint: createShaderPaint({
          name: 'Soft clouds',
          fragmentSource: gainSource,
          parameters: { gain: 1.2 },
        }),
      },
      {
        id: 'signal',
        name: 'Signal glitch',
        targets: ['effect'],
        paint: createShaderPaint({
          name: 'Signal glitch',
          fragmentSource:
            'void mainImage(out vec4 color, in vec2 coord) { color = texture(iChannel0, coord / iResolution.xy); }',
        }),
      },
    ],
  });
}
const pack = makePack();
const ref = studioPluginReference(pack);
const entry = (snapshot: ShaderPackPluginSnapshot = pack) => ({
  snapshot,
  installedAt: '',
  enabled: true,
  trusted: true,
});
const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const layer = (id: string) => composition().layers.find((candidate) => candidate.id === id)!;
function alterLayer(id: string, mutate: (target: Layer) => void) {
  const project = structuredClone(useProjectStore.getState().project);
  mutate(project.compositions[0]!.layers.find((candidate) => candidate.id === id)!);
  useProjectStore.setState({ project });
}

beforeEach(() => {
  useProjectStore.getState().newProject();
  useSelectionStore.getState().select(null);
  useTestDataStore.getState().resetAll();
  useTimelineStore.getState().setAutoKeyframe(false);
  useRendererPluginSettingsStore.setState({ installed: [entry()], defaultProvider: null });
  history.resetHistory();
});
afterEach(() => {
  history.resetHistory();
  useTestDataStore.getState().resetAll();
  useRendererPluginSettingsStore.setState({ installed: [], defaultProvider: null });
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shader pack copy authoring', () => {
  it('applies a selected group in one undo, preserving playhead, selection, loops and unrelated objects', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text')];
    const untouched = store.addLayer('ellipse');
    store.setLayerLoop(ids[0]!, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(ids[0]!, 'y', [
      { id: 'a', frame: 0, value: 100, easing: 'linear' },
      { id: 'b', frame: 10, value: 130, easing: 'linear' },
    ]);
    useSelectionStore.getState().selectMany(ids);
    useTimelineStore.getState().setCurrentFrame(7);
    const before = structuredClone(useProjectStore.getState().project);
    history.resetHistory();
    history.runDiscreteHistoryStep(
      () => store.applyShaderPackPreset(ids, ref, 'clouds', 'fill'),
      'Apply clouds',
    );
    const after = structuredClone(useProjectStore.getState().project);
    // The source paint is a complete editable copy, not a renderer or live plugin reference.
    expect(getElementShaderPaint(layer(ids[0]!).element)).toMatchObject({
      fragmentSource: gainSource,
      parameters: { gain: 1.2 },
      packProvenance: {
        reference: ref,
        presetId: 'clouds',
        license: 'CC0-1.0',
        licenseText: pack.licenseText,
      },
    });
    expect(layer(ids[0]!).loop).toEqual(before.compositions[0]!.layers[0]!.loop);
    expect(layer(untouched)).toEqual(before.compositions[0]!.layers[2]);
    expect(after.shaders).toHaveLength(1);
    expect(after.shaders[0]!.paint).toEqual(getElementShaderPaint(layer(ids[0]!).element));
    expect(composition().rendererPlugins).toEqual(before.compositions[0]!.rendererPlugins);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(ids);
    expect(useTimelineStore.getState().currentFrame).toBe(7);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    // Installed pack removal does not block restoring or editing an applied shader copy.
    useRendererPluginSettingsStore.setState({ installed: [] });
    history.redo();
    expect(useProjectStore.getState().project).toEqual(after);
    store.updateLayerShaderParameter(ids[0]!, 7, 'fill', 'gain', 1.4);
    expect(getElementShaderPaint(layer(ids[0]!).element)?.parameters.gain).toBe(1.4);
    expect(getElementShaderPaint(layer(ids[1]!).element)?.parameters.gain).toBe(1.2);
    expect(pack.shaders[0]!.paint.parameters.gain).toBe(1.2);
  });

  it('applies Outline only to text and keeps content, existing fill and stroke width', () => {
    const store = useProjectStore.getState();
    const text = store.addLayer('text');
    store.updateLayerElement(text, { content: 'Editable headline' });
    store.updateLayerTextStroke(text, 0, { strokeWidth: 6 });
    const before = structuredClone(layer(text));
    store.applyShaderPackPreset(text, ref, 'clouds', 'outline');
    expect(layer(text).element).toMatchObject({ content: 'Editable headline', strokeWidth: 6 });
    expect(getElementShaderPaint(layer(text).element, 'stroke')?.packProvenance?.reference).toEqual(
      ref,
    );
    expect(getElementShaderPaint(layer(text).element, 'fill')).toEqual(
      getElementShaderPaint(before.element, 'fill'),
    );
    const rectangle = store.addLayer('rectangle');
    const snapshot = JSON.stringify(useProjectStore.getState().project);
    expect(() => store.applyShaderPackPreset([text, rectangle], ref, 'clouds', 'outline')).toThrow(
      /only.*text/,
    );
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(snapshot);
  });

  it('adds an enabled shared shader effect without replacing Media or copying the preview texture', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text')];
    const media = createMediaPaint({ source: { kind: 'live', tag: 'camera:test' } });
    store.updateLayerPaint(ids[0]!, 0, media);
    const before = structuredClone(layer(ids[0]!).element);
    store.applyShaderPackPreset(ids, ref, 'signal', 'effect');
    const effects = ids.map((id) =>
      getEffectStack(layer(id).effects).find((effect) => effect.type === 'shader')!,
    );
    expect(layer(ids[0]!).element).toEqual(before);
    expect(effects[0]!.id).toBe(effects[1]!.id);
    expect(effects[0]).toMatchObject({
      enabled: true,
      blendMode: 'normal',
      blendOpacity: 1,
      shader: { packProvenance: { presetId: 'signal', reference: ref } },
    });
    expect(effects.every((effect) => !effect.shader?.inputImage)).toBe(true);
    expect(effects[0]!.shader).not.toBe(effects[1]!.shader);
    expect(useProjectStore.getState().project.shaders).toHaveLength(1);
    expect(useProjectStore.getState().project.shaders[0]!.paint.inputImage).toBeUndefined();
  });

  it('preflights all effects capacity before changing any member of a selection', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text')];
    while (getEffectStack(layer(ids[1]!).effects).length < MAX_EFFECTS)
      store.addLayerEffect(ids[1]!, 'glow');
    const before = JSON.stringify(useProjectStore.getState().project);
    expect(() => store.applyShaderPackPreset(ids, ref, 'signal', 'effect')).toThrow(
      /maximum.*effects/,
    );
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
  });

  it('rejects empty, missing, locked or incompatible targets without partial application', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text')];
    alterLayer(ids[1]!, (target) => {
      target.isLocked = true;
    });
    const before = JSON.stringify(useProjectStore.getState().project);
    for (const selected of [[], ['missing'], ids])
      expect(() => store.applyShaderPackPreset(selected, ref, 'clouds', 'fill')).toThrow();
    expect(() => store.applyShaderPackPreset(ids[0]!, ref, 'signal', 'fill')).toThrow();
    expect(() => store.applyShaderPackPreset(ids[0]!, ref, 'missing', 'fill')).toThrow();
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
  });

  it('requires the exact installed, reviewed and enabled bytes, with no newer-version substitution', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const before = JSON.stringify(useProjectStore.getState().project);
    const tampered = structuredClone(pack);
    tampered.shaders[0]!.paint.fragmentSource += '\n// tamper';
    for (const installed of [
      [],
      [{ ...entry(), enabled: false }],
      [{ ...entry(), trusted: false }],
      [entry(makePack('1.0.1'))],
      [entry(tampered)],
    ]) {
      useRendererPluginSettingsStore.setState({ installed });
      expect(() => store.applyShaderPackPreset(id, ref, 'clouds', 'fill')).toThrow();
      expect(() => store.importShaderPackPreset(ref, 'clouds', 'fill')).toThrow();
      expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
    }
  });

  it('reconciles shader fields and removes obsolete channels while unmasking changed defaults', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.updateLayerPaint(
      id,
      0,
      createShaderPaint({
        fragmentSource: `#pragma ograf retired slider min(0.0) max(4.0) step(0.1)\nconst float retired = 2.0;\n${gainSource}`,
        parameters: { gain: 0.4, retired: 2 },
      }),
    );
    const oldGain = composition().dataFields.find(
      (field) => field.generatedShaderParameter?.name === 'gain',
    )!;
    const oldRetired = composition().dataFields.find(
      (field) => field.generatedShaderParameter?.name === 'retired',
    )!;
    useTestDataStore.getState().setValue(oldGain.id, 0.2);
    useTestDataStore.getState().setValue(oldRetired.id, 3);
    store.setLayerLoop(id, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(id, 'fill.parameters.retired', [
      { id: 'retired-key', frame: 0, value: 1, easing: 'linear' },
    ]);
    store.setLayerLoopPropertyTrack(id, 'fill.parameters.gain', [
      { id: 'gain-key', frame: 0, value: 1, easing: 'linear' },
    ]);
    store.applyShaderPackPreset(id, ref, 'clouds', 'fill');
    expect(layer(id).loop?.tracks['fill.parameters.retired']).toBeUndefined();
    expect(layer(id).loop?.tracks['fill.parameters.gain']).toHaveLength(1);
    expect(
      composition().dataFields.some((field) => field.generatedShaderParameter?.name === 'retired'),
    ).toBe(false);
    expect(composition().dataFields.find((field) => field.id === oldGain.id)?.defaultValue).toBe(
      1.2,
    );
    expect(useTestDataStore.getState().values[oldGain.id]).toBeUndefined();
    expect(useTestDataStore.getState().values[oldRetired.id]).toBeUndefined();
    expect(
      resolveDesignerElement(
        layer(id),
        useTestDataStore.getState().values,
        composition().dataFields,
      ),
    ).toMatchObject({ fill: { parameters: { gain: 1.2 } } });
    store.updateLayerShaderParameter(id, 0, 'fill', 'gain', 1.6);
    expect(getElementShaderPaint(layer(id).element)?.parameters.gain).toBe(1.6);
  });

  it('imports standalone and effect resources with source/defaults/attribution and deduplicated copies', () => {
    const store = useProjectStore.getState();
    const before = structuredClone(composition());
    history.resetHistory();
    const target = history.runDiscreteHistoryStep(
      () => store.importShaderPackPreset(ref, 'clouds', 'fill'),
      'Import shader',
    );
    expect(composition()).toEqual(before);
    expect(store.project.shaders).toEqual([]);
    const project = useProjectStore.getState().project;
    expect(project.shaders).toHaveLength(1);
    const paint = shaderPaintFromResourceDrag(
      project,
      encodeShaderResourceDrag(project.id, target),
    );
    expect(paint.packProvenance).toMatchObject({ presetId: 'clouds', reference: ref });
    expect(paint.fragmentSource).toBe(gainSource);
    expect(paint.parameters.gain).toBe(1.2);
    history.undo();
    expect(useProjectStore.getState().project.shaders).toEqual([]);
    expect(() => store.importShaderPackPreset(ref, 'signal', 'fill')).toThrow();
    const effectTarget = store.importShaderPackPreset(ref, 'signal', 'effect');
    const effectPaint = useProjectStore.getState().project.shaders[0]!.paint;
    expect(effectPaint.fragmentSource).toContain('iChannel0');
    expect(effectPaint.inputImage).toBeUndefined();
    expect(store.importShaderPackPreset(ref, 'signal', 'effect')).toEqual(effectTarget);
    expect(useProjectStore.getState().project.shaders).toHaveLength(1);
  });

  it('preserves an explicitly chosen user field and unrelated preview values while changing its shader default', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.updateLayerPaint(
      id,
      0,
      createShaderPaint({ fragmentSource: gainSource, parameters: { gain: 0.4 } }),
    );
    const field = createFieldDefinition('number', { key: 'user_gain', defaultValue: 0.4 });
    const unrelated = createFieldDefinition('number', { key: 'other_preview', defaultValue: 10 });
    const project = structuredClone(useProjectStore.getState().project);
    const comp = project.compositions[0]!;
    comp.dataFields.push(field, unrelated);
    const first = comp.layers.find((item) => item.id === id)!;
    first.bindings = first.bindings.filter(
      (binding) => binding.targetProperty !== 'fill.parameters.gain',
    );
    first.bindings.push({ fieldId: field.id, targetProperty: 'fill.parameters.gain' });
    useProjectStore.setState({ project });
    useTestDataStore.getState().setValue(field.id, 0.2);
    useTestDataStore.getState().setValue(unrelated.id, 15);
    store.applyShaderPackPreset(id, ref, 'clouds', 'fill');
    expect(layer(id).bindings).toContainEqual({
      fieldId: field.id,
      targetProperty: 'fill.parameters.gain',
    });
    expect(composition().dataFields.find((item) => item.id === field.id)?.defaultValue).toBe(1.2);
    expect(
      composition().dataFields.find((item) => item.id === field.id)?.generatedShaderParameter,
    ).toBeUndefined();
    expect(useTestDataStore.getState().values[field.id]).toBeUndefined();
    expect(useTestDataStore.getState().values[unrelated.id]).toBe(15);
    store.updateLayerShaderParameter(id, 0, 'fill', 'gain', 1.6);
    expect(composition().dataFields.find((item) => item.id === field.id)?.defaultValue).toBe(1.6);
    expect(layer(id).bindings).toContainEqual({
      fieldId: field.id,
      targetProperty: 'fill.parameters.gain',
    });
  });

  it('keeps immutable copied attribution through normal Properties and saved-resource edits', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.applyShaderPackPreset(id, ref, 'clouds', 'fill');
    const before = getElementShaderPaint(layer(id).element)!.packProvenance!;
    useRendererPluginSettingsStore.setState({ installed: [] });
    store.updateShaderResource(
      { compositionId: composition().id, layerId: id, slot: 'fill' },
      {
        name: 'Edited copy',
        fragmentSource: `${gainSource}\n// designer edit`,
        parameters: { gain: 1.5 },
      },
    );
    expect(getElementShaderPaint(layer(id).element)?.packProvenance).toEqual(before);
    useRendererPluginSettingsStore.setState({ installed: [entry()] });
    const saved = store.importShaderPackPreset(ref, 'clouds', 'fill');
    store.updateShaderResource(saved, { name: 'Library copy', parameters: { gain: 1.6 } });
    const paint = useProjectStore
      .getState()
      .project.shaders.find((resource) => resource.id === saved.shaderId)!.paint;
    expect(paint.packProvenance).toEqual(before);
    const edited = shaderPaintWithPatch(paint, { speed: 0.5 });
    expect(edited.packProvenance).toEqual(before);
    expect(edited.packProvenance).not.toBe(paint.packProvenance);
    expect(edited.packProvenance!.reference).not.toBe(paint.packProvenance!.reference);
    expect(() => shaderPaintWithPatch(paint, { packProvenance: {} } as never)).toThrow(/Unknown/);
  });
});
