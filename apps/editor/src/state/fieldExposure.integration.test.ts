import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  buildComponentDefinition,
  createCustomActionDefinition,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerVisualRule,
  createProject,
  defaultTransformFor,
  getElementShaderPaint,
  instantiateComponentDefinition,
  migrateProject,
  reconcileComponentInstances,
  syncCompositionShaderParameterFields,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime, compileDataSchema } from '@ograf-editor/codegen';
import {
  addProjectSetControl,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  setProjectSetControlValue,
} from './projectSet';
import { importOgrafData } from './importOgraf';
import { parseProjectSource } from './studioDocument';
import { restoreFieldExposureDefinition } from './fieldExposure';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { resetHistory } from './historyStore';

const shaderSource = `#pragma ograf gain slider min(0.0) max(1.0) step(0.1)
const float gain = 0.4;
#pragma ograf offset vector2 min(-1.0) max(1.0) step(0.1)
const vec2 offset = vec2(0.2, 0.6);
void mainImage(out vec4 c, in vec2 p) { c = vec4(gain, offset.x, offset.y, 1.0); }`;

function fixture() {
  const project = createProject({ name: 'Shader exposure persistence' });
  const composition = project.compositions[0]!;
  const layer = createLayerOfKind('shader');
  layer.name = 'Bound shader';
  getElementShaderPaint(layer.element)!.fragmentSource = shaderSource;
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('shader'))];
  layer.animationTracks['fill.parameters.gain'] = [
    { id: 'gain-start', frame: 0, value: 0.2, easing: 'linear' },
    { id: 'gain-end', frame: 12, value: 0.8, easing: 'linear' },
  ];
  composition.layers.push(layer);
  syncCompositionShaderParameterFields(composition);
  const gain = composition.dataFields.find(
    (field) => field.generatedShaderParameter?.name === 'gain',
  )!;
  const offset = composition.dataFields.find(
    (field) => field.generatedShaderParameter?.name === 'offset',
  )!;
  gain.exposeToOgraf = false;
  gain.required = true;
  offset.properties.find((field) => field.key === 'x')!.exposeToOgraf = false;
  composition.customActions.push(
    createCustomActionDefinition({ actionId: 'raise-gain', name: 'Raise gain' }),
  );
  layer.visualRules.push(
    createLayerVisualRule({
      trigger: 'custom-action',
      eventId: 'raise-gain',
      actions: [{ type: 'set-data', fieldId: gain.id, mode: 'set', value: 0.9 }],
    }),
  );
  return { project, composition, layer, gain, offset };
}

function signature(project: ReturnType<typeof createProject>) {
  const c = project.compositions[0]!;
  return {
    fields: c.dataFields,
    bindings: c.layers.map((layer) => layer.bindings),
    animations: c.layers.map((layer) =>
      Object.fromEntries(Object.entries(layer.animationTracks).filter(([, keys]) => keys?.length)),
    ),
    rules: c.layers.map((layer) => layer.visualRules),
    customActions: c.customActions,
  };
}

describe('OGraf field exposure persistence', () => {
  it('publishes generated-field checkbox edits as complete project changes for the MCP bridge', () => {
    vi.stubGlobal('window', {
      clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    });
    const { project, gain } = fixture();
    delete gain.exposeToOgraf;
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().loadProject(project);
    const previousProject = useProjectStore.getState().project;
    const updates: string[] = [];
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project !== previous.project) updates.push(JSON.stringify(state.project));
    });
    try {
      useProjectStore.getState().updateDataField(gain.id, { exposeToOgraf: false });
      const current = useProjectStore.getState().project;
      expect(current).not.toBe(previousProject);
      expect(
        current.compositions[0]!.dataFields.find((field) => field.id === gain.id)?.exposeToOgraf,
      ).toBe(false);
      expect(updates).toHaveLength(1);
      expect(
        JSON.parse(updates[0]!).compositions[0].dataFields.find(
          (field: { id: string }) => field.id === gain.id,
        ).exposeToOgraf,
      ).toBe(false);
      expect(compileDataSchema(current.compositions[0]!).properties).not.toHaveProperty(gain.key);
      useProjectStore.getState().updateDataField(gain.id, { exposeToOgraf: true });
      expect(
        useProjectStore
          .getState()
          .project.compositions[0]!.dataFields.find((field) => field.id === gain.id)?.exposeToOgraf,
      ).toBe(true);
    } finally {
      unsubscribe();
      resetHistory();
      vi.unstubAllGlobals();
    }
  });

  it('keeps hidden generated controls through source/default reconciliation and type changes', () => {
    const { composition, layer, gain, offset } = fixture();
    const originalId = gain.id;
    gain.defaultValue = 0.7;
    syncCompositionShaderParameterFields(composition);
    expect(gain).toMatchObject({ id: originalId, exposeToOgraf: false, defaultValue: 0.7 });
    expect(offset.properties.find((field) => field.key === 'x')?.exposeToOgraf).toBe(false);
    getElementShaderPaint(layer.element)!.parameters.offset = [0.8, 0.1];
    syncCompositionShaderParameterFields(composition);
    expect(offset.defaultValue).toEqual({ x: 0.8, y: 0.1 });
    expect(offset.properties.find((field) => field.key === 'x')?.exposeToOgraf).toBe(false);
    getElementShaderPaint(layer.element)!.fragmentSource = shaderSource
      .replace(
        '#pragma ograf gain slider min(0.0) max(1.0) step(0.1)\nconst float gain = 0.4;',
        '#pragma ograf gain toggle\nconst bool gain = true;',
      )
      .replace('vec4(gain,', 'vec4(gain ? 1.0 : 0.0,');
    syncCompositionShaderParameterFields(composition);
    expect(gain).toMatchObject({ id: originalId, type: 'boolean', exposeToOgraf: false });
    expect(layer.bindings.some((binding) => binding.fieldId === originalId)).toBe(true);
  });

  it('retains exposure, bindings, animations and Rules through standalone JSON source', () => {
    const { project } = fixture();
    const reopened = migrateProject(parseProjectSource(JSON.stringify(project)));
    expect(signature(reopened)).toEqual(signature(project));
  });

  it.each(['compact', 'compatible'] as const)(
    'round-trips %s sets without losing the control policy',
    async (archiveMode) => {
      const { project } = fixture();
      const set = createProjectSet('Exposure set', project);
      const archive = await createProjectSetArchive(set, { archiveMode });
      const reopened = await openProjectSetArchive(await archive.arrayBuffer());
      const restored = resolveProjectSetTemplate(reopened, reopened.templates[0]!.id);
      expect(signature(restored)).toEqual(signature(project));
      const schema = compileDataSchema(restored.compositions[0]!);
      const [gain, offset] = restored.compositions[0]!.dataFields;
      expect(schema.properties).not.toHaveProperty(gain!.key);
      expect(schema.properties[offset!.key]!.properties).not.toHaveProperty('x');
    },
  );

  it('keeps a local exposure choice while a shared control continues inheriting values', async () => {
    const { project, composition, gain } = fixture();
    delete gain.exposeToOgraf;
    let set = createProjectSet('Shared exposure', project);
    const templateId = set.templates[0]!.id;
    set = addProjectSetControl(set, templateId, composition.id, gain.id);
    const edited = resolveProjectSetTemplate(set, templateId);
    edited.compositions[0]!.dataFields.find((field) => field.id === gain.id)!.exposeToOgraf = false;
    set = saveProjectSetTemplateEdits(set, templateId, edited);
    set = setProjectSetControlValue(set, set.controls[0]!.field.id, 0.95);
    const reopened = await openProjectSetArchive(
      await (await createProjectSetArchive(set)).arrayBuffer(),
    );
    const restored = resolveProjectSetTemplate(reopened, templateId);
    expect(
      restored.compositions[0]!.dataFields.find((field) => field.id === gain.id),
    ).toMatchObject({
      defaultValue: 0.95,
      exposeToOgraf: false,
    });
    expect(reopened.controls[0]!.bindings[0]!.inherit).toBe(true);
    expect(restored.compositions[0]!.layers[0]!.bindings).toEqual(
      edited.compositions[0]!.layers[0]!.bindings,
    );
  });

  it('does not accidentally pin inherited exposure when only a different field changes', () => {
    const { project, composition, gain } = fixture();
    delete gain.exposeToOgraf;
    let set = createProjectSet('Inherited exposure', project);
    const templateId = set.templates[0]!.id;
    set = addProjectSetControl(set, templateId, composition.id, gain.id);
    set.controls[0]!.field.exposeToOgraf = false;
    const edited = resolveProjectSetTemplate(set, templateId);
    edited.compositions[0]!.dataFields.find((field) => field.id !== gain.id)!.label =
      'Changed label';
    set = saveProjectSetTemplateEdits(set, templateId, edited);
    expect(
      set.templates[0]!.project.compositions[0]!.dataFields.find((field) => field.id === gain.id)
        ?.exposeToOgraf,
    ).toBeUndefined();
    set.controls[0]!.field.exposeToOgraf = true;
    expect(
      resolveProjectSetTemplate(set, templateId).compositions[0]!.dataFields.find(
        (field) => field.id === gain.id,
      )?.exposeToOgraf,
    ).toBe(true);
  });

  it('keeps a nested exposure override while shared vector defaults change', () => {
    const { project, composition, offset } = fixture();
    delete offset.properties.find((field) => field.key === 'x')!.exposeToOgraf;
    let set = createProjectSet('Shared vector exposure', project);
    const templateId = set.templates[0]!.id;
    set = addProjectSetControl(set, templateId, composition.id, offset.id);
    const edited = resolveProjectSetTemplate(set, templateId);
    edited.compositions[0]!.dataFields.find((field) => field.id === offset.id)!.properties.find(
      (field) => field.key === 'x',
    )!.exposeToOgraf = false;
    set = saveProjectSetTemplateEdits(set, templateId, edited);
    set = setProjectSetControlValue(set, set.controls[0]!.field.id, { x: 0.8, y: 0.9 });
    const restored = resolveProjectSetTemplate(set, templateId).compositions[0]!.dataFields.find(
      (field) => field.id === offset.id,
    )!;
    expect(restored.defaultValue).toEqual({ x: 0.8, y: 0.9 });
    expect(restored.properties.find((field) => field.key === 'x')?.exposeToOgraf).toBe(false);
    expect(restored.properties.find((field) => field.key === 'y')?.exposeToOgraf).toBeUndefined();
  });

  it('preserves local exposure while component parent fields and animations update', () => {
    const { composition, layer, gain } = fixture();
    delete gain.exposeToOgraf;
    const definition = buildComponentDefinition(composition, [layer.id], 'Reusable shader');
    composition.components.push(definition);
    const instance = instantiateComponentDefinition(composition, definition, { x: 100, y: 0 });
    composition.layers.push(...instance.layers);
    composition.dataFields.push(...instance.dataFields);
    reconcileComponentInstances(composition);
    const instanceGainId = instance.fieldIds[gain.id]!;
    composition.dataFields.find((field) => field.id === instanceGainId)!.exposeToOgraf = false;
    reconcileComponentInstances(composition);
    definition.dataFields.find((field) => field.id === gain.id)!.defaultValue = 0.75;
    definition.layers[0]!.animationTracks['fill.parameters.gain']![1]!.value = 0.95;
    reconcileComponentInstances(composition);
    expect(composition.dataFields.find((field) => field.id === instanceGainId)).toMatchObject({
      exposeToOgraf: false,
      defaultValue: 0.75,
    });
    const instanceLayer = composition.layers.find(
      (child) => child.id === instance.layerIds[layer.id],
    )!;
    expect(instanceLayer.animationTracks['fill.parameters.gain']![1]!.value).toBe(0.95);
    expect(instanceLayer.bindings.some((binding) => binding.fieldId === instanceGainId)).toBe(true);
    expect(instanceLayer.visualRules[0]!.actions[0]).toMatchObject({
      type: 'set-data',
      fieldId: instanceGainId,
    });
  });

  it('recovers hidden generated field ownership and nested policy from a compiled package', async () => {
    const { project, composition, gain, offset, layer } = fixture();
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.errors).toEqual([]);
    const zip = new JSZip();
    zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest));
    zip.file('main.js', artifacts.mainJs);
    for (const resource of artifacts.resources)
      zip.file(resource.path, resource.data, { base64: resource.base64 });
    const restored = await importOgrafData(
      'private-shader.ograf.zip',
      await zip.generateAsync({ type: 'uint8array' }),
    );
    const imported = restored.project.compositions[0]!;
    expect(imported.dataFields.find((field) => field.key === offset.key)?.defaultValue).toEqual(
      offset.defaultValue,
    );
    syncCompositionShaderParameterFields(imported);
    expect(imported.dataFields).toHaveLength(2);
    expect(imported.dataFields.find((field) => field.key === gain.key)).toMatchObject({
      exposeToOgraf: false,
      generatedShaderParameter: { layerId: layer.id, name: 'gain' },
    });
    expect(
      imported.dataFields
        .find((field) => field.key === offset.key)
        ?.properties.find((field) => field.key === 'x')?.exposeToOgraf,
    ).toBe(false);
    expect(imported.layers[0]!.animationTracks['fill.parameters.gain']).toEqual(
      layer.animationTracks['fill.parameters.gain'],
    );
    const schema = compileDataSchema(imported);
    expect(schema.properties).not.toHaveProperty(gain.key);
    expect(schema.properties[offset.key]!.properties).not.toHaveProperty('x');
  });

  it('restores only hidden nested defaults and preserves public manifest edits', () => {
    const source = createFieldDefinition('object', {
      key: 'settings',
      defaultValue: { public: 1, hidden: 2 },
      properties: [
        createFieldDefinition('number', { key: 'public', defaultValue: 1 }),
        createFieldDefinition('number', { key: 'hidden', defaultValue: 2, exposeToOgraf: false }),
      ],
    });
    const publicField = createFieldDefinition('object', {
      key: 'settings',
      label: 'New label',
      defaultValue: { public: 42 },
      properties: [createFieldDefinition('number', { key: 'public', defaultValue: 42 })],
    });
    const restored = restoreFieldExposureDefinition(source, publicField);
    expect(restored.label).toBe('New label');
    expect(restored.defaultValue).toEqual({ public: 42, hidden: 2 });
    expect(restored.properties.find((field) => field.key === 'hidden')).toMatchObject({
      exposeToOgraf: false,
    });
    expect(publicField.properties).toHaveLength(1);
    expect(source.defaultValue).toEqual({ public: 1, hidden: 2 });
  });
});
