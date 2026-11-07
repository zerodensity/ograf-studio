import { describe, expect, it } from 'vitest';
import {
  transitionLogicErrors,
  type TransitionLogicDefinition,
  type TransitionLogicRecipe,
  type TransitionLogicReferences,
} from '@ograf-editor/scene-model';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import {
  layerStates,
  setElementValue,
  type ChoreographyPhase,
  type TimingPatch,
} from './transitionChoreography';
import { createDefaultTransitionLogic } from './transitionLogicEditing';
import {
  applyCellTiming,
  applyRoom,
  applyTemplateValues,
  buildPlayoutSetup,
  cellElementMotions,
  cellPhase,
  cellTiming,
  elementDriftChecks,
  keepElementValues,
  defaultShow,
  landingBoxes,
  layoutChecks,
  setLanding,
  showPlan,
  showEndsOnAir,
  laneCells,
  overlapWithRoom,
  proposeLanes,
  resetCell,
  roomSetting,
  speedFrames,
  speedOf,
  stageSchedule,
  stylePatch,
  styleOf,
  templateLayouts,
  templateLookup,
  transitionChecks,
  TRANSITION_SPEEDS,
  TRANSITION_STYLES,
  type TransitionCell,
} from './transitionsDesign';

function northline() {
  const set = createTransitionLogicNewsExample(0);
  const components = set.componentAssets!;
  const references: TransitionLogicReferences = {
    templateIds: set.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      components.map((asset) => [asset.id, asset.layers.map((layer) => layer.id)]),
    ),
  };
  return { set, definition: set.transitionLogic!, components, references };
}

const recipe = (patch: Partial<TransitionLogicRecipe> = {}): TransitionLogicRecipe => ({
  id: 'r',
  name: 'r',
  durationFrames: 32,
  outgoingFrames: 12,
  incomingStartFrame: 14,
  incomingFrames: 18,
  sharedFrames: 32,
  easing: 'ease-in-out',
  ...patch,
});

/** What setPhaseTiming would store for these fields. */
function withPatch(base: TransitionLogicRecipe, patch: TimingPatch): TransitionLogicRecipe {
  const {
    layoutPhase,
    holdFrames: _hold,
    contentMotion,
    incomingAnimation,
    outgoingAnimation,
    ...fields
  } = patch;
  const next: TransitionLogicRecipe = { ...base, ...fields };
  if (contentMotion === null || contentMotion === 'fade') delete next.contentMotion;
  else if (contentMotion) next.contentMotion = contentMotion;
  if (layoutPhase === null) delete next.layoutPhase;
  else if (layoutPhase) next.layoutPhase = layoutPhase;
  if (incomingAnimation === null) delete next.incomingAnimation;
  else if (incomingAnimation) next.incomingAnimation = incomingAnimation;
  if (outgoingAnimation === null) delete next.outgoingAnimation;
  else if (outgoingAnimation) next.outgoingAnimation = outgoingAnimation;
  return next;
}

describe('lane grid', () => {
  it('reads Off as take in and take out, and a template to itself as an update', () => {
    expect(cellPhase({ from: null, to: 'a' })).toBe('enter');
    expect(cellPhase({ from: 'a', to: null })).toBe('exit');
    expect(cellPhase({ from: 'a', to: 'a' })).toBe('update');
    expect(cellPhase({ from: 'a', to: 'b' })).toBe('switch');
  });

  it('lays out Off plus every template as rows and every template plus Off as columns', () => {
    const { definition } = northline();
    const states = layerStates(definition, 'lower-third');
    const cells = laneCells(definition, 'lower-third');
    expect(cells).toHaveLength(states.length + 1);
    expect(cells[0]![states.length]).toBeNull();
    expect(cells[1]![0]).toEqual({ slotId: 'lower-third', from: states[0]!.id, to: states[0]!.id });
    expect(cells[1]![states.length]).toEqual({
      slotId: 'lower-third',
      from: states[0]!.id,
      to: null,
    });
  });
});

describe('styles and speeds', () => {
  it('names the example’s timings', () => {
    const { definition } = northline();
    const states = layerStates(definition, 'lower-third');
    const cell = (from: string | null, to: string | null): TransitionCell => ({
      slotId: 'lower-third',
      from,
      to,
    });
    const switching = cellTiming(definition, cell(states[0]!.id, states[1]!.id));
    expect(styleOf(switching.recipe!, 'switch')).toBe('morph');
    expect(speedOf(switching.recipe!, 'switch', 50)).toBe('natural');
    expect(styleOf(cellTiming(definition, cell(null, states[0]!.id)).recipe!, 'enter')).toBe(
      'morph',
    );
    expect(styleOf(cellTiming(definition, cell(states[0]!.id, null)).recipe!, 'exit')).toBe(
      'morph',
    );
  });

  it('round-trips every style and speed through the recipe fields', () => {
    for (const phase of ['enter', 'update', 'switch', 'exit'] as ChoreographyPhase[])
      for (const { style } of TRANSITION_STYLES)
        for (const { speed } of TRANSITION_SPEEDS) {
          const patch = stylePatch(phase, style, speedFrames(speed, 50));
          const result = withPatch(recipe(), patch);
          expect(styleOf(result, phase), `${phase} ${style} ${speed}`).toBe(style);
          if (style !== 'cut') expect(speedOf(result, phase, 50)).toBe(speed);
        }
  });

  it('keeps a take in that makes room first revealing after the room opens', () => {
    const current = recipe({
      outgoingFrames: 0,
      incomingStartFrame: 30,
      incomingFrames: 20,
      sharedFrames: 30,
      layoutPhase: { startFrame: 0, durationFrames: 30 },
    });
    expect(styleOf(current, 'enter')).toBe('dissolve');
    const patch = stylePatch('enter', 'morph', 32, current);
    expect(patch.incomingStartFrame).toBe(30 + 12);
    expect(styleOf(withPatch(current, patch), 'enter')).toBe('morph');
  });
});

describe('editing a cell', () => {
  it('changes the whole lane or only one pair', () => {
    const { definition, references } = northline();
    const [a, b, c] = layerStates(definition, 'lower-third');
    const ab: TransitionCell = { slotId: 'lower-third', from: a!.id, to: b!.id };
    const bc: TransitionCell = { slotId: 'lower-third', from: b!.id, to: c!.id };
    const snappy = stylePatch('switch', 'morph', speedFrames('snappy', 50));

    const lane = applyCellTiming(definition, ab, snappy, 'lane', references);
    expect(speedOf(cellTiming(lane, ab).recipe!, 'switch', 50)).toBe('snappy');
    expect(speedOf(cellTiming(lane, bc).recipe!, 'switch', 50)).toBe('snappy');
    expect(cellTiming(lane, ab).custom).toBe(false);

    const pair = applyCellTiming(definition, ab, snappy, 'pair', references);
    expect(cellTiming(pair, ab).custom).toBe(true);
    expect(speedOf(cellTiming(pair, ab).recipe!, 'switch', 50)).toBe('snappy');
    expect(speedOf(cellTiming(pair, bc).recipe!, 'switch', 50)).toBe('natural');

    const reset = resetCell(pair, ab, references);
    expect(cellTiming(reset, ab).custom).toBe(false);
    expect(transitionLogicErrors(reset, references)).toEqual([]);
  });

  it('lists the shared-element properties that move between two templates', () => {
    const { definition, components } = northline();
    const [a, b] = layerStates(definition, 'lower-third');
    const motions = cellElementMotions(definition, components, {
      slotId: 'lower-third',
      from: a!.id,
      to: b!.id,
    });
    expect(motions.some((motion) => motion.property === 'width')).toBe(true);
    for (const motion of motions) expect(motion.from).not.toBe(motion.to);
  });
});

describe('template layouts', () => {
  it('puts overlapping lower thirds in one lane and the ticker in its own, drawn on top', () => {
    const { set } = northline();
    const layouts = templateLayouts(set);
    const lanes = proposeLanes(set, layouts);
    expect(lanes).toHaveLength(2);
    const [lower, top] = lanes;
    expect(lower!.templateIds).toHaveLength(3);
    expect(lower!.name).toBe('Lower third');
    expect(lower!.componentIds.length).toBeGreaterThan(0);
    expect(top!.templateIds).toHaveLength(1);
  });

  it('flags a clash between lanes until room is made', () => {
    const { definition, components, references, set } = northline();
    const layouts = templateLayouts(set);
    const withoutRoom: TransitionLogicDefinition = structuredClone(definition);
    delete withoutRoom.layoutRules;
    const clash = transitionChecks(withoutRoom, layouts).find((check) =>
      check.id.startsWith('clash:'),
    );
    expect(clash?.tone).toBe('warning');
    const { triggerSlotId, affectedSlotId } = clash!.room!;

    const room = applyRoom(
      withoutRoom,
      components,
      triggerSlotId,
      affectedSlotId,
      null,
      40,
      'move',
      references,
    );
    expect(roomSetting(room, triggerSlotId, affectedSlotId)).toMatchObject({
      amount: 40,
      mode: 'move',
    });
    expect(transitionChecks(room, layouts).some((check) => check.id.startsWith('room:'))).toBe(
      true,
    );
    const cleared = applyRoom(
      room,
      components,
      triggerSlotId,
      affectedSlotId,
      null,
      0,
      'move',
      references,
    );
    expect(roomSetting(cleared, triggerSlotId, affectedSlotId).ruleId).toBeNull();

    const lower = layerStates(withoutRoom, affectedSlotId)[0]!;
    const ticker = layerStates(withoutRoom, triggerSlotId)[0]!;
    const before = overlapWithRoom(
      withoutRoom,
      components,
      layouts,
      lower.id,
      ticker.id,
      0,
      'move',
    );
    const after = overlapWithRoom(
      withoutRoom,
      components,
      layouts,
      lower.id,
      ticker.id,
      400,
      'move',
    );
    expect(before).not.toBeNull();
    expect(after!).toBeLessThan(before!);
  });
});

describe('first run', () => {
  it('builds lanes, shared elements and one house style from the templates', () => {
    const { set, components, references } = northline();
    const bare = structuredClone(set);
    delete bare.transitionLogic;
    const layouts = templateLayouts(bare);
    const lanes = proposeLanes(bare, layouts);
    const definition = buildPlayoutSetup(createDefaultTransitionLogic(bare), {
      set: bare,
      lanes,
      components,
      templates: templateLookup(bare),
      references,
      style: 'morph',
      speed: 'snappy',
      frameRate: 50,
    });
    expect(transitionLogicErrors(definition, references)).toEqual([]);
    expect(definition.slots.map((slot) => slot.name)).toEqual(lanes.map((lane) => lane.name));
    const lower = definition.slots.find((slot) => slot.name === 'Lower third')!;
    expect(layerStates(definition, lower.id)).toHaveLength(3);
    expect(definition.sharedInstances.filter((entry) => entry.slotId === lower.id)).toHaveLength(
      lanes[0]!.componentIds.length,
    );
    const [a, b] = layerStates(definition, lower.id);
    const switching = cellTiming(definition, { slotId: lower.id, from: a!.id, to: b!.id });
    expect(styleOf(switching.recipe!, 'switch')).toBe('morph');
    expect(speedOf(switching.recipe!, 'switch', 50)).toBe('snappy');
  });
});

describe('stage schedule', () => {
  it('settles the from side, then runs the moment after a short lead', () => {
    const schedule = stageSchedule({ slotId: 'l', from: 'a', to: 'b' }, 50);
    expect(schedule).toEqual([
      {
        timestamp: 0,
        action: {
          type: 'customAction',
          params: {
            id: 'transition.take',
            payload: { slotId: 'l', stateId: 'a' },
            skipAnimation: true,
          },
        },
      },
      {
        timestamp: 40,
        action: {
          type: 'customAction',
          params: { id: 'transition.take', payload: { slotId: 'l', stateId: 'b' } },
        },
      },
    ]);
    expect(stageSchedule({ slotId: 'l', from: 'a', to: null }, 50)[1]!.action.params.id).toBe(
      'transition.out',
    );
  });
});

describe('drift from template layouts', () => {
  it('flags a moved element and offers both fixes', () => {
    const { set, references } = northline();
    const templates = templateLookup(set);
    const clock = {
      instanceId: 'news-clock-asset-on-air',
      sourceLayerId: 'news-clock',
      property: 'x',
    };
    const base = set.transitionLogic!;
    const state = layerStates(base, 'lower-third')[0]!;
    const clean = elementDriftChecks(base, set, templates, references).filter(
      (check) => check.drift?.instanceId === clock.instanceId,
    );
    expect(clean).toEqual([]);

    const drifted = setElementValue(base, clock, state.id, 1200, 1614, references);
    const [check] = elementDriftChecks(drifted, set, templates, references).filter(
      (entry) => entry.drift?.instanceId === clock.instanceId,
    );
    expect(check?.tone).toBe('warning');
    expect(check?.detail).toContain(state.name);

    const restored = applyTemplateValues(drifted, clock.instanceId, templates, references);
    expect(
      elementDriftChecks(restored, set, templates, references).some(
        (entry) => entry.drift?.instanceId === clock.instanceId,
      ),
    ).toBe(false);

    const kept = keepElementValues(drifted, set, clock.instanceId, templates, references);
    expect(
      elementDriftChecks(kept, set, templates, references).some(
        (entry) => entry.drift?.instanceId === clock.instanceId,
      ),
    ).toBe(false);
    const stored = kept.states
      .find((entry) => entry.id === state.id)!
      .sharedValues!.find(
        (value) =>
          value.instanceId === clock.instanceId &&
          value.sourceLayerId === clock.sourceLayerId &&
          value.property === 'x',
      );
    expect(stored).toMatchObject({ value: 1200, override: true });
    expect(transitionLogicErrors(kept, references)).toEqual([]);
  });
});

describe('rundown rehearsal', () => {
  it('times each step with its real transition and skips steps that change nothing', () => {
    const { definition } = northline();
    const steps = defaultShow(definition);
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.at(-1)!.stateId).toBeNull();
    const plan = showPlan(definition, [steps.at(-1)!, ...steps], 50);
    expect(plan.starts[0]).toBe(-1);
    expect(plan.schedule).toHaveLength(steps.length);
    expect(plan.starts[1]).toBe(2);
    for (let index = 2; index < plan.starts.length; index += 1)
      expect(plan.starts[index]!).toBeGreaterThan(plan.starts[index - 1]!);
    expect(plan.totalFrames).toBeGreaterThan(plan.starts.at(-1)!);
  });
});

describe('dragging where an element lands', () => {
  it('stores the dragged pose as a deliberate difference', () => {
    const { definition, components, references } = northline();
    const state = layerStates(definition, 'lower-third')[1]!;
    const box = landingBoxes(definition, components, 'lower-third', state.id).find(
      (entry) => entry.sourceLayerId === 'news-clock',
    )!;
    const moved = setLanding(
      definition,
      box,
      state.id,
      { ...box, x: box.x - 40, y: box.y - 10 },
      references,
    );
    const after = landingBoxes(moved, components, 'lower-third', state.id).find(
      (entry) => entry.sourceLayerId === 'news-clock',
    )!;
    expect([after.x, after.y]).toEqual([box.x - 40, box.y - 10]);
    const stored = moved.states
      .find((entry) => entry.id === state.id)!
      .sharedValues!.filter((value) => value.sourceLayerId === 'news-clock');
    expect(
      stored
        .filter((value) => value.property === 'x' || value.property === 'y')
        .map((value) => value.override),
    ).toEqual([true, true]);
    expect(transitionLogicErrors(moved, references)).toEqual([]);
  });
});

describe('layout checks', () => {
  it('reports content past the frame edge', () => {
    const { set, definition, references } = northline();
    const layouts = templateLayouts(set);
    const state = definition.states[0]!;
    const layout = layouts.get(state.templateId)!;
    layout.layers[0]!.pose = { ...layout.layers[0]!.pose, x: layout.width - 10, width: 200 };
    const checks = layoutChecks(definition, layouts, templateLookup(set), references);
    expect(checks.some((check) => check.id === `frame:${state.id}`)).toBe(true);
  });
});

describe('more checks', () => {
  it('flags small text, a lane appearing before its room is ready, and a rundown left on air', () => {
    const { set, definition, references } = northline();
    const layouts = templateLayouts(set);
    const state = definition.states[0]!;
    const layout = layouts.get(state.templateId)!;
    layout.layers.push({ ...layout.layers[0]!, layerId: 'tiny', name: 'Tiny', fontSize: 9 });
    const checks = layoutChecks(definition, layouts, templateLookup(set), references);
    expect(checks.some((check) => check.id === `small-text:${state.id}`)).toBe(true);

    const late = structuredClone(definition);
    const rule = late.layoutRules![0]!;
    const trigger = layerStates(late, rule.whenSlotId)[0]!;
    const recipe = late.transitions.find(
      (entry) =>
        entry.id ===
        cellTiming(late, { slotId: rule.whenSlotId, from: null, to: trigger.id }).recipe!.id,
    )!;
    recipe.layoutPhase = { startFrame: 0, durationFrames: 30 };
    recipe.incomingStartFrame = 0;
    recipe.durationFrames = Math.max(recipe.durationFrames, 30, recipe.incomingFrames);
    expect(
      layoutChecks(late, layouts, templateLookup(set), references).some((check) =>
        check.id.startsWith(`room-late:${rule.id}`),
      ),
    ).toBe(true);

    const steps = defaultShow(definition);
    expect(showEndsOnAir(definition, steps)).toEqual([]);
    expect(showEndsOnAir(definition, steps.slice(0, 2)).length).toBeGreaterThan(0);
  });
});
