import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createComposition,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
  getLayerTransformAtFrame,
  instantiateComponentDefinition,
  TRANSITION_LOGIC_SHARED_PROPERTIES,
  transitionLogicErrors,
  type ComponentDefinition,
  type LayerTransform,
  type Project,
  type TransitionLogicDefinition,
  type TransitionLogicReferences,
  type TransitionLogicSharedValue,
} from '@ograf-editor/scene-model';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import {
  addElement,
  addPhaseException,
  addRoomRule,
  addTemplateToLayer,
  elementCellStatus,
  elementTemplateLayout,
  layersTopFirst,
  moveLayer,
  phaseExceptions,
  removePhaseException,
  resolveLayerPhase,
  resolveTransition,
  setElementValue,
  setPhaseTiming,
  setRoomOffset,
  syncElementToTemplates,
  templateSharedValues,
  type ChoreographyPhase,
  type ElementPropertyIdentity,
  type TemplateLookup,
} from './transitionChoreography';

const recipe = (id: string, frames: number) => ({
  id,
  name: id,
  durationFrames: frames,
  outgoingFrames: frames,
  incomingStartFrame: 0,
  incomingFrames: frames,
  sharedFrames: frames,
  easing: 'ease-in-out' as const,
});

function definition(): TransitionLogicDefinition {
  return {
    version: 3,
    id: 'logic',
    name: 'Test',
    defaultTransitionId: 'dissolve',
    slots: [
      { id: 'lower', name: 'Lower third', order: 0, defaultTransitionId: 'dissolve' },
      { id: 'ticker', name: 'Ticker', order: 1 },
    ],
    states: [
      { id: 'a', name: 'Correspondent', slotId: 'lower', templateId: 'ta' },
      { id: 'b', name: 'Headline', slotId: 'lower', templateId: 'tb' },
      { id: 't', name: 'Ticker', slotId: 'ticker', templateId: 'tt' },
    ],
    transitions: [recipe('dissolve', 24), recipe('out', 18)],
    // A catch-all route drives take in, update and switch at once.
    routes: [
      {
        id: 'catch-all',
        slotId: 'lower',
        from: '*',
        to: '*',
        transitionId: 'dissolve',
        priority: 0,
      },
      { id: 'out-route', slotId: 'lower', from: '*', to: null, transitionId: 'out', priority: 0 },
    ],
    sharedInstances: [
      { id: 'panel', name: 'Panel', componentAssetId: 'c', continuityKey: 'k', slotId: 'lower' },
    ],
    initialSharedValues: [{ instanceId: 'panel', sourceLayerId: 'bg', property: 'y', value: 900 }],
  };
}

const probes: Array<[string | null, string | null]> = [
  [null, 'a'],
  [null, 'b'],
  ['a', null],
  ['a', 'a'],
  ['a', 'b'],
  ['b', 'a'],
];

const timing = (logic: TransitionLogicDefinition, from: string | null, to: string | null) => {
  const found = resolveTransition(logic, 'lower', from, to).recipe;
  return found && { ...found, id: '', name: '' };
};

describe('transition choreography', () => {
  it('changes one layer moment without moving any other moment', () => {
    const before = definition();
    const after = setPhaseTiming(
      before,
      { kind: 'layer', slotId: 'lower', phase: 'switch' },
      {
        incomingStartFrame: 6,
        incomingFrames: 12,
      },
    );
    const switched = resolveLayerPhase(after, 'lower', 'switch').recipe!;
    expect(switched.incomingStartFrame).toBe(6);
    expect(switched.incomingFrames).toBe(12);
    expect(switched.durationFrames).toBe(24);
    for (const [from, to] of probes) {
      if (from && to && from !== to) continue;
      expect(timing(after, from, to)).toEqual(timing(before, from, to));
    }
    // The catch-all route can't separate update from switch, so it became layer defaults.
    expect(after.routes.some((route) => route.from === '*' && route.to === '*')).toBe(false);
  });

  it('keeps take in independent when only take in changes', () => {
    const after = setPhaseTiming(
      definition(),
      { kind: 'layer', slotId: 'lower', phase: 'enter' },
      {
        easing: 'ease-out',
      },
    );
    expect(resolveLayerPhase(after, 'lower', 'enter').recipe!.easing).toBe('ease-out');
    for (const phase of ['update', 'switch', 'exit'] as ChoreographyPhase[])
      expect(resolveLayerPhase(after, 'lower', phase).recipe!.easing).toBe('ease-in-out');
  });

  it('starts an exception from the current timing and removes it cleanly', () => {
    const { definition: added, routeId } = addPhaseException(definition(), 'lower', 'enter', 'b');
    expect(timing(added, null, 'b')).toEqual(timing(definition(), null, 'b'));
    expect(phaseExceptions(added, 'lower', 'enter').map((entry) => entry.label)).toEqual([
      'Headline',
    ]);
    const edited = setPhaseTiming(
      added,
      { kind: 'route', routeId, phase: 'enter' },
      {
        incomingFrames: 40,
      },
    );
    expect(resolveTransition(edited, 'lower', null, 'b').recipe!.incomingFrames).toBe(40);
    expect(resolveTransition(edited, 'lower', null, 'a').recipe!.incomingFrames).toBe(24);
    const removed = removePhaseException(edited, routeId);
    expect(resolveTransition(removed, 'lower', null, 'b').recipe!.incomingFrames).toBe(24);
    expect(removed.transitions).toHaveLength(definition().transitions.length);
  });

  it('reorders layers by swapping draw order', () => {
    const moved = moveLayer(definition(), 'lower', 1);
    expect(layersTopFirst(moved).map((slot) => slot.id)).toEqual(['lower', 'ticker']);
  });

  it('overrides an element per template and falls back to its off value', () => {
    const identity = { instanceId: 'panel', sourceLayerId: 'bg', property: 'y' as const };
    const set = setElementValue(definition(), identity, 'b', 820, 900);
    expect(set.states.find((state) => state.id === 'b')!.sharedValues).toEqual([
      { ...identity, value: 820 },
    ]);
    const cleared = setElementValue(set, identity, 'b', undefined, 900);
    expect(cleared.states.find((state) => state.id === 'b')!.sharedValues).toBeUndefined();
  });

  it('makes room in another layer while a layer is on air', () => {
    const { definition: added, ruleId } = addRoomRule(definition(), 'ticker', 'lower');
    const identity = { instanceId: 'panel', sourceLayerId: 'bg', property: 'y' as const };
    const offset = setRoomOffset(added, ruleId, identity, -62, 900);
    expect(offset.layoutRules![0]).toMatchObject({
      slotId: 'lower',
      whenSlotId: 'ticker',
      sharedOffsets: [{ ...identity, value: -62 }],
    });
    expect(
      setRoomOffset(offset, ruleId, identity, undefined, 900).layoutRules![0]!.sharedOffsets,
    ).toEqual([]);
  });
});

/* Northline-like set: the clock and glass panel sit differently in each lower-third template. */

function placeable(id: string, values: Partial<LayerTransform>) {
  const layer = createLayerOfKind('rectangle');
  layer.id = id;
  layer.name = id;
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform(values), { id: `${id}-pose` })];
  return layer;
}

const clockAsset: ComponentDefinition = {
  id: 'clock-asset',
  name: 'System clock',
  scope: 'set',
  dataFields: [],
  layers: [
    placeable('clock', { x: 1614, y: 982, width: 188, height: 28 }),
    placeable('clock-label', { x: 1534, y: 982, width: 70, height: 28 }),
  ],
};
const panelAsset: ComponentDefinition = {
  id: 'panel-asset',
  name: 'Glass panel',
  scope: 'set',
  dataFields: [],
  layers: [placeable('glass', { x: 96, y: 756, width: 1728, height: 274 })],
};
const assets = [clockAsset, panelAsset];

/** A template placing each asset with per-source-layer pose changes; null leaves an asset out. */
function northlineTemplate(
  id: string,
  poses: Record<string, Partial<LayerTransform> | null>,
  animateClockIn = false,
): Project {
  const composition = createComposition({ id: `comp-${id}`, components: structuredClone(assets) });
  const step = composition.keyframes.find((key) => key.role === 'step')!;
  const stepFrame = computeKeyframeFrames(composition).find(
    (entry) => entry.keyframeId === step.id,
  )!.frame;
  for (const asset of assets) {
    if (asset.layers.some((layer) => poses[layer.id] === null)) continue;
    const { layers } = instantiateComponentDefinition(composition, asset, { x: 0, y: 0 });
    for (const layer of layers) {
      const values = poses[layer.componentLink!.sourceLayerId] ?? {};
      for (const [property, value] of Object.entries(values)) {
        for (const key of layer.keyframes)
          (key.transform as unknown as Record<string, number>)[property] = value;
        for (const key of layer.animationTracks[property as keyof LayerTransform] ?? [])
          key.value = value;
      }
      // The template's own take-in: the coordinator holds the pose of the on-air step.
      if (animateClockIn && layer.componentLink!.sourceLayerId === 'clock') {
        const rest = getLayerTransformAtFrame(layer, 0);
        layer.animationTracks.x = [
          createLayerPropertyKeyframe(0, 2000),
          createLayerPropertyKeyframe(stepFrame, rest.x),
        ];
        layer.animationTracks.opacity = [
          createLayerPropertyKeyframe(0, 0),
          createLayerPropertyKeyframe(stepFrame, rest.opacity),
        ];
      }
    }
    composition.layers.push(...layers);
  }
  return createProject({
    id: `project-${id}`,
    mainCompositionId: composition.id,
    compositions: [composition],
  });
}

const correspondentPoses = {
  glass: { width: 1530, y: 788, height: 242 },
  clock: { x: 1416 },
  'clock-label': { x: 1336 },
};

function northlineSet(projects: Record<string, Project> = {}) {
  const templates: Record<string, Project> = {
    correspondent: northlineTemplate('correspondent', correspondentPoses),
    headline: northlineTemplate('headline', {}),
    ticker: northlineTemplate('ticker', { clock: null, glass: null }),
    ...projects,
  };
  const lookup: TemplateLookup = (templateId) => templates[templateId];
  const references: TransitionLogicReferences = {
    templateIds: Object.keys(templates),
    componentLayers: Object.fromEntries(
      assets.map((asset) => [asset.id, asset.layers.map((layer) => layer.id)]),
    ),
  };
  const logic: TransitionLogicDefinition = {
    version: 3,
    id: 'northline',
    name: 'Northline',
    defaultTransitionId: 'replace',
    slots: [
      { id: 'lower', name: 'Lower third', order: 0, defaultTransitionId: 'replace' },
      { id: 'ticker', name: 'Ticker', order: 1 },
    ],
    states: [
      { id: 'name', name: 'Correspondent', slotId: 'lower', templateId: 'correspondent' },
      { id: 'headline', name: 'Headline', slotId: 'lower', templateId: 'headline' },
      { id: 'ticker', name: 'Ticker', slotId: 'ticker', templateId: 'ticker' },
    ],
    transitions: [recipe('replace', 32)],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
  return { logic, lookup, references };
}

/** The editor's Off pose: the canonical component at rest, hidden while its layer is off. */
function offPose(asset: ComponentDefinition): TransitionLogicSharedValue[] {
  return asset.layers.flatMap((layer) => {
    const pose = getLayerTransformAtFrame(layer, 0);
    return TRANSITION_LOGIC_SHARED_PROPERTIES.map((property) => ({
      instanceId: 'new',
      sourceLayerId: layer.id,
      property,
      value: property === 'opacity' ? 0 : pose[property],
    }));
  });
}

function keep(
  asset: ComponentDefinition,
  { logic, lookup, references }: ReturnType<typeof northlineSet>,
) {
  return addElement(
    logic,
    { name: asset.name, componentAssetId: asset.id, slotId: 'lower' },
    offPose(asset),
    references,
    lookup,
  );
}

const valuesOf = (logic: TransitionLogicDefinition, stateId: string, sourceLayerId: string) =>
  Object.fromEntries(
    (logic.states.find((state) => state.id === stateId)!.sharedValues ?? [])
      .filter((value) => value.sourceLayerId === sourceLayerId)
      .map((value) => [value.property, value.value]),
  );

const statusIn = (
  logic: TransitionLogicDefinition,
  set: ReturnType<typeof northlineSet>,
  identity: ElementPropertyIdentity,
  stateId: string,
) =>
  elementCellStatus(
    logic,
    elementTemplateLayout(logic, identity.instanceId, set.lookup, set.references),
    identity,
    stateId,
    1614,
  );

describe('template-derived element values', () => {
  it('reads where a template places a component at its first on-air step', () => {
    const project = northlineTemplate('correspondent', correspondentPoses, true);
    const values = templateSharedValues({ id: 'any', componentAssetId: 'clock-asset' }, project);
    const clock = Object.fromEntries(
      values
        .filter((value) => value.sourceLayerId === 'clock')
        .map((value) => [value.property, value.value]),
    );
    // Frame 0 has the clock off to the right and transparent; the held step pose is the layout.
    expect(clock).toEqual({ x: 1416, y: 982, width: 188, height: 28, opacity: 1, rotation: 0 });
    expect(values.every((value) => value.instanceId === 'any')).toBe(true);
    expect(
      templateSharedValues(
        { id: 'any', componentAssetId: 'clock-asset' },
        northlineTemplate('ticker', { clock: null }),
      ),
    ).toEqual([]);
  });

  it('morphs the clock between Correspondent and Headline with no typing', () => {
    const set = northlineSet();
    const { definition, instanceId } = keep(clockAsset, set);
    expect(valuesOf(definition, 'name', 'clock')).toEqual({ x: 1416, opacity: 1 });
    expect(valuesOf(definition, 'headline', 'clock')).toEqual({ x: 1614, opacity: 1 });
    expect(valuesOf(definition, 'name', 'clock-label')).toEqual({ x: 1336, opacity: 1 });
    expect(valuesOf(definition, 'headline', 'clock-label')).toEqual({ x: 1534, opacity: 1 });
    // The ticker is another layer; it never controls a lower-third element.
    expect(definition.states.find((state) => state.id === 'ticker')!.sharedValues).toBeUndefined();
    const layout = elementTemplateLayout(definition, instanceId, set.lookup, set.references);
    const key = (sourceLayerId: string, property: string) =>
      JSON.stringify([instanceId, sourceLayerId, property]);
    expect(layout.morphing.has(key('clock', 'x'))).toBe(true);
    expect(layout.morphing.has(key('clock', 'y'))).toBe(false);
    const x = { instanceId, sourceLayerId: 'clock', property: 'x' };
    expect(statusIn(definition, set, x, 'name')).toEqual({ kind: 'template', value: 1416 });
    expect(statusIn(definition, set, x, 'headline')).toEqual({ kind: 'template', value: 1614 });
  });

  it('reshapes the panel from each template layout', () => {
    const { definition } = keep(panelAsset, northlineSet());
    expect(valuesOf(definition, 'name', 'glass')).toEqual({
      y: 788,
      width: 1530,
      height: 242,
      opacity: 1,
    });
    expect(valuesOf(definition, 'headline', 'glass')).toEqual({
      y: 756,
      width: 1728,
      height: 274,
      opacity: 1,
    });
  });

  it('fills a template added to the layer, and the values it newly makes differ', () => {
    const set = northlineSet();
    set.logic.states = set.logic.states.filter((state) => state.id !== 'name');
    const { definition: kept } = keep(clockAsset, set);
    // Alone, Headline places the clock exactly as designed; only visibility differs from Off.
    expect(valuesOf(kept, 'headline', 'clock')).toEqual({ opacity: 1 });
    const added = addTemplateToLayer(
      kept,
      'lower',
      'correspondent',
      'Correspondent',
      set.references,
      set.lookup,
    );
    const correspondent = added.states.find((state) => state.templateId === 'correspondent')!;
    expect(valuesOf(added, correspondent.id, 'clock')).toEqual({ opacity: 1, x: 1416 });
    expect(valuesOf(added, 'headline', 'clock')).toEqual({ opacity: 1, x: 1614 });
  });

  it('keeps overrides through syncs and can return to the template value', () => {
    const set = northlineSet();
    const { definition: kept, instanceId } = keep(clockAsset, set);
    const x: ElementPropertyIdentity = { instanceId, sourceLayerId: 'clock', property: 'x' };
    const overridden = setElementValue(kept, x, 'name', 1450, 1614, set.references, {
      override: true,
    });
    expect(statusIn(overridden, set, x, 'name')).toEqual({
      kind: 'override',
      value: 1450,
      template: 1416,
    });
    const synced = syncElementToTemplates(overridden, instanceId, set.lookup, set.references);
    expect(valuesOf(synced, 'name', 'clock').x).toBe(1450);
    const reverted = setElementValue(synced, x, 'name', 1416, 1614, set.references);
    expect(statusIn(reverted, set, x, 'name')).toEqual({ kind: 'template', value: 1416 });
    expect(
      reverted.states
        .find((state) => state.id === 'name')!
        .sharedValues!.find((value) => value.sourceLayerId === 'clock' && value.property === 'x'),
    ).toEqual({ ...x, value: 1416 });
  });

  it('flags drift when a template moves, and puts it back on the layout in one step', () => {
    const set = northlineSet();
    const { definition, instanceId } = keep(clockAsset, set);
    const x: ElementPropertyIdentity = { instanceId, sourceLayerId: 'clock', property: 'x' };
    const pinned = setElementValue(definition, x, 'name', 1416, 1614, set.references, {
      override: true,
    });
    // The designer later moves the Headline clock in its template; the stored 1614 is stale.
    const moved = northlineSet({ headline: northlineTemplate('headline', { clock: { x: 1590 } }) });
    expect(statusIn(pinned, moved, x, 'headline')).toEqual({
      kind: 'drift',
      value: 1614,
      template: 1590,
    });
    const fixed = syncElementToTemplates(pinned, instanceId, moved.lookup, moved.references);
    expect(valuesOf(fixed, 'headline', 'clock').x).toBe(1590);
    expect(statusIn(fixed, moved, x, 'headline').kind).toBe('template');
    expect(statusIn(fixed, moved, x, 'name').kind).toBe('override');
  });

  it('flags hand-typed values that disagree with the template layout', () => {
    const set = northlineSet();
    const { definition, instanceId } = keep(clockAsset, set);
    const x: ElementPropertyIdentity = { instanceId, sourceLayerId: 'clock', property: 'x' };
    // The real set was typed as 1416/1614/1614 by hand; one wrong cell is an unmarked value.
    const typed = setElementValue(definition, x, 'name', 1614, 1614, set.references);
    expect(statusIn(typed, set, x, 'name')).toEqual({
      kind: 'drift',
      value: 1614,
      template: 1416,
    });
  });

  it('accepts only a true override marker', () => {
    const { definition, instanceId } = keep(clockAsset, northlineSet());
    definition.states
      .find((state) => state.id === 'name')!
      .sharedValues!.push({
        instanceId,
        sourceLayerId: 'clock',
        property: 'y',
        value: 990,
        override: false as unknown as true,
      });
    expect(transitionLogicErrors(definition).join(' ')).toContain('override marker must be true');
  });

  it('reproduces the hand-typed Northline example from its template layouts', () => {
    const example = createTransitionLogicNewsExample(0);
    const typed = example.transitionLogic!;
    const lookup: TemplateLookup = (templateId) =>
      example.templates.find((template) => template.id === templateId)?.project;
    const references: TransitionLogicReferences = {
      templateIds: example.templates.map((template) => template.id),
      componentLayers: Object.fromEntries(
        example.componentAssets!.map((asset) => [asset.id, asset.layers.map((layer) => layer.id)]),
      ),
    };
    const blank: TransitionLogicDefinition = {
      ...structuredClone(typed),
      sharedInstances: [],
      initialSharedValues: [],
      states: typed.states.map(({ sharedValues: _typed, ...state }) => state),
    };
    delete blank.layoutRules;
    const clock = example.componentAssets!.find((asset) => asset.id === 'news-clock-asset')!;
    const { definition } = addElement(
      blank,
      { name: clock.name, componentAssetId: clock.id, slotId: 'lower-third' },
      offPose(clock),
      references,
      lookup,
    );
    const stateIds = ['name', 'headline', 'breaking'];
    const typedX = stateIds.map(
      (stateId) =>
        typed.states
          .find((state) => state.id === stateId)!
          .sharedValues!.find(
            (value) => value.sourceLayerId === 'news-clock' && value.property === 'x',
          )!.value,
    );
    expect(typedX).toEqual([1416, 1614, 1614]);
    expect(stateIds.map((stateId) => valuesOf(definition, stateId, 'news-clock').x)).toEqual(
      typedX,
    );
  });
});
