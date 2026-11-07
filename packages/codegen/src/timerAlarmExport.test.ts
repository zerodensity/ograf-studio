import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  clockTimerActionId,
  createComposition,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerVisualRule,
  createProject,
  defaultTransformFor,
  instantiateComponentDefinition,
  normalizeClockTimerSettings,
  reconcileComponentInstances,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';
import { getExportProfile } from './exportProfiles';

const runtimeStub = 'class CoordinatedGraphicElement {}';
const dual = getExportProfile('dual');
const ajv = new Ajv2020({ strict: false, allErrors: true });
const base = 'https://ograf.ebu.io/v1/specification/json-schemas';
const schema = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/ograf-schema/${name}.json`, import.meta.url), 'utf8'),
  );
for (const [file, path] of [
  ['number', 'lib/constraints/number'],
  ['boolean', 'lib/constraints/boolean'],
  ['gdd-basic-types', 'gdd/basic-types'],
  ['gdd-types', 'gdd/gdd-types'],
  ['gdd-object', 'gdd/object'],
  ['action', 'lib/action'],
])
  ajv.addSchema(schema(file!), `${base}/${path}.json`);
const validateOfficialManifest = ajv.compile(schema('graphics-schema'));

function fixture(manual = false) {
  const timer = createLayerOfKind('clock');
  timer.id = 'question-timer';
  timer.keyframes = [createLayerKeyframe(0, defaultTransformFor('clock'))];
  if (timer.element.type !== 'text') throw new Error('Expected clock text.');
  timer.element.clock = normalizeClockTimerSettings({
    mode: 'count-down',
    source: manual ? 'manual' : 'automatic',
    initialValueMs: 10000,
    manualValue: 10000,
    autoStart: false,
  });
  const warning = createLayerOfKind('rectangle');
  warning.id = 'warning';
  warning.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
  warning.isVisible = false;
  const armed = createFieldDefinition('boolean', { id: 'armed', key: 'armed', defaultValue: true });
  const remaining = createFieldDefinition('number', {
    id: 'remaining',
    key: 'remaining',
    defaultValue: 10000,
  });
  if (manual) timer.bindings = [{ fieldId: remaining.id, targetProperty: 'clock.manualValue' }];
  warning.visualRules = [5000, 0].map((thresholdMs) =>
    createLayerVisualRule({
      id: thresholdMs ? 'five-seconds' : 'time-up',
      name: thresholdMs ? 'Five seconds' : 'Time up',
      trigger: 'timer-alarm',
      timerAlarm: { sourceLayerId: timer.id, thresholdMs, direction: 'down' },
      conditions: [{ fieldId: armed.id, sourcePath: [], operator: 'equals', value: true }],
      actions: [
        { type: 'visibility', visible: true },
        {
          type: 'property',
          targetProperty: 'fill',
          targetLayerId: timer.id,
          value: thresholdMs ? '#ff9900' : '#ff0000',
          transitionFrames: 6,
        },
      ],
    }),
  );
  const composition = createComposition({
    layers: [timer, warning],
    dataFields: [armed, remaining],
  });
  const project = createProject({ compositions: [composition], mainCompositionId: composition.id });
  const definition: TransitionLogicDefinition = {
    version: 4,
    id: 'timer-logic',
    name: 'Timer logic',
    defaultTransitionId: 'cut',
    slots: [{ id: 'game', name: 'Game', order: 0 }],
    states: [{ id: 'question', name: 'Question', slotId: 'game', templateId: 'question' }],
    transitions: [
      {
        id: 'cut',
        name: 'Cut',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
  const input: CoordinatedExportInput = {
    id: 'game-set',
    name: 'Game set',
    definition,
    templates: [{ id: 'question', name: 'Question', project }],
    componentAssets: [],
  };
  return { timer, warning, composition, project, input };
}

describe('timer alarm executable export contract', () => {
  it('compiles both alarm configurations, independent owner, guards and normal actions without mutating authored rules', () => {
    const { timer, warning, composition } = fixture();
    const before = structuredClone(composition);
    const descriptor = compileDescriptor(composition);
    const owner = descriptor.layers.find((layer) => layer.id === warning.id)!;
    expect(owner.visualRules).toHaveLength(2);
    expect(owner.visualRules?.map((rule) => rule.timerAlarm)).toEqual([
      { sourceLayerId: timer.id, thresholdMs: 5000, direction: 'down' },
      { sourceLayerId: timer.id, thresholdMs: 0, direction: 'down' },
    ]);
    expect(owner.visualRules?.[0]).toMatchObject({
      trigger: 'timer-alarm',
      conditions: [{ dataKey: 'armed', value: true }],
      actions: [
        { type: 'visibility', visible: true },
        { type: 'property', targetLayerId: timer.id, transitionFrames: 6 },
      ],
    });
    expect(composition).toEqual(before);
    expect(owner.visualRules?.[0]?.timerAlarm).not.toBe(warning.visualRules[0]?.timerAlarm);
  });

  it('omits empty-action authoring drafts without inventing runtime or manifest actions', () => {
    const { warning, composition, project } = fixture();
    warning.visualRules.push(
      createLayerVisualRule({
        id: 'draft',
        trigger: 'timer-alarm',
        timerAlarm: { sourceLayerId: 'question-timer', thresholdMs: 2000, direction: 'down' },
        actions: [],
      }),
    );
    const result = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
      dual,
    );
    expect(result.errors).toEqual([]);
    expect(
      result.descriptor!.layers.find((layer) => layer.id === warning.id)?.visualRules,
    ).toHaveLength(2);
    expect(result.manifest.customActions?.map((action) => action.id)).toEqual(
      (['start', 'pause', 'reset', 'restart'] as const).map((command) =>
        clockTimerActionId('question-timer', command),
      ),
    );
    expect(
      validateOfficialManifest(result.manifest),
      JSON.stringify(validateOfficialManifest.errors),
    ).toBe(true);
  });

  it.each([false, true])(
    'preserves two alarm Rules and manual data in a standard dual coordinated package (manual=%s)',
    (manual) => {
      const { timer, input } = fixture(manual);
      const before = structuredClone(input);
      const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub, dual);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(
        validateOfficialManifest(result.manifest),
        JSON.stringify(validateOfficialManifest.errors),
      ).toBe(true);
      expect(result.manifest).toMatchObject({
        supportsRealTime: true,
        supportsNonRealTime: true,
        main: 'main.js',
      });
      const template = result.transitionDescriptor!.templates[0]!;
      expect(
        template.descriptor.layers
          .flatMap((layer) => layer.visualRules ?? [])
          .map((rule) => rule.timerAlarm?.thresholdMs),
      ).toEqual([5000, 0]);
      expect(
        template.descriptor.layers.find((layer) => layer.id === timer.id)?.element,
      ).toMatchObject({ clock: { source: manual ? 'manual' : 'automatic' } });
      if (manual)
        expect(
          template.descriptor.layers.find((layer) => layer.id === timer.id)?.bindings,
        ).toContainEqual(
          expect.objectContaining({ dataKey: 'remaining', targetProperty: 'clock.manualValue' }),
        );
      expect(result.mainJs).toContain('"thresholdMs":5000');
      expect(result.mainJs).toContain('"thresholdMs":0');
      expect(result.manifest.customActions?.map((action) => action.id)).toEqual([
        'transition.patch',
        'transition.take',
        'transition.out',
        'transition.clear',
        'template.action',
      ]);
      const patch = result.manifest.customActions!.find(
        (action) => action.id === 'transition.patch',
      )!;
      const validatePatch = ajv.compile(patch.schema!);
      expect(
        validatePatch({ slotId: 'game', stateId: 'question', data: { remaining: 5000 } }),
      ).toBe(true);
      expect(
        validatePatch({ slotId: 'game', stateId: 'question', data: { remaining: 'bad' } }),
      ).toBe(false);
      expect(result.manifest.actionDurations).toContainEqual({
        type: 'customAction',
        customActionId: 'transition.patch',
        duration: 0,
      });
      const control = result.manifest.customActions!.find(
        (action) => action.id === 'template.action',
      )!;
      const validateAction = ajv.compile(control.schema!);
      for (const command of ['start', 'pause', 'reset', 'restart'] as const)
        expect(
          validateAction({ slotId: 'game', actionId: clockTimerActionId(timer.id, command) }),
        ).toBe(!manual || command === 'reset' || command === 'restart');
      expect(JSON.stringify(result.manifest.customActions)).not.toContain('timer-alarm');
      expect(input).toEqual(before);
    },
  );

  it('remaps both alarm source and action targets when component instances are flattened into coordinated templates', () => {
    const { timer, warning, composition, input } = fixture(true);
    const definition = buildComponentDefinition(
      composition,
      [timer.id, warning.id],
      'Question timer',
    );
    composition.components.push(definition);
    const instance = instantiateComponentDefinition(composition, definition);
    composition.layers = instance.layers;
    composition.dataFields.push(...instance.dataFields);
    reconcileComponentInstances(composition);
    input.componentAssets = [definition];
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub, dual);
    expect(result.errors).toEqual([]);
    const compiled = result.transitionDescriptor!.templates[0]!.descriptor;
    const owner = compiled.layers.find((layer) => layer.id === instance.layerIds[warning.id])!;
    expect(owner.visualRules).toHaveLength(2);
    for (const rule of owner.visualRules ?? []) {
      expect(rule.timerAlarm?.sourceLayerId).toBe(instance.layerIds[timer.id]);
      expect(rule.actions[1]).toMatchObject({ targetLayerId: instance.layerIds[timer.id] });
      expect(rule.conditions?.[0]?.dataKey).toMatch(/^armed/);
    }
    expect(
      validateOfficialManifest(result.manifest),
      JSON.stringify(validateOfficialManifest.errors),
    ).toBe(true);
  });

  it('keeps alarms attached to the canonical timer when a component is retained as a shared coordinated instance', () => {
    const { timer, warning, composition, input } = fixture(true);
    const definition = buildComponentDefinition(
      composition,
      [timer.id, warning.id],
      'Retained timer',
    );
    composition.components.push(definition);
    const instance = instantiateComponentDefinition(composition, definition);
    composition.layers = instance.layers;
    composition.dataFields.push(...instance.dataFields);
    reconcileComponentInstances(composition);
    input.componentAssets = [definition];
    input.definition.sharedInstances.push({
      id: 'retained-timer',
      name: 'Retained timer',
      componentAssetId: definition.id,
      continuityKey: 'retained-timer',
      slotId: 'game',
    });
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub, dual);
    expect(result.errors).toEqual([]);
    const shared = result.transitionDescriptor!.sharedInstances[0]!.descriptor;
    const owner = shared.layers.find((layer) => layer.id === warning.id)!;
    expect(owner.visualRules).toHaveLength(2);
    expect(owner.visualRules!.map((rule) => rule.timerAlarm?.sourceLayerId)).toEqual([
      timer.id,
      timer.id,
    ]);
    expect(owner.visualRules![0]?.actions[1]).toMatchObject({ targetLayerId: timer.id });
    expect(shared.layers.find((layer) => layer.id === timer.id)?.bindings).toContainEqual(
      expect.objectContaining({ targetProperty: 'clock.manualValue' }),
    );
    expect(result.transitionDescriptor!.templates[0]!.sharedLayers).toContainEqual({
      layerId: instance.layerIds[timer.id],
      sourceLayerId: timer.id,
      instanceId: 'retained-timer',
    });
    const control = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const validateAction = ajv.compile(control.schema!);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const)
      expect(
        validateAction({
          slotId: 'game',
          actionId: clockTimerActionId(instance.layerIds[timer.id]!, command),
        }),
      ).toBe(command === 'reset' || command === 'restart');
    expect(
      validateOfficialManifest(result.manifest),
      JSON.stringify(validateOfficialManifest.errors),
    ).toBe(true);
  });
});
