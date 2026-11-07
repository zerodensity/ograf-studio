import { describe, expect, it } from 'vitest';
import {
  transitionLogicErrors,
  TRANSITION_LOGIC_VERSION,
  type TransitionLogicDefinition,
  type TransitionLogicReferences,
} from '@ograf-editor/scene-model';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { resolveTransition } from './transitionChoreography';
import { cellTiming } from './transitionsDesign';
import { resizeTiming, setResizeTiming } from './transitionResizeTiming';

function northline() {
  const set = createTransitionLogicNewsExample(0);
  const definition = set.transitionLogic!;
  const references: TransitionLogicReferences = {
    templateIds: set.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      set.componentAssets!.map((asset) => [asset.id, asset.layers.map((layer) => layer.id)]),
    ),
  };
  return { definition, references };
}

const tickerRecipe = (definition: TransitionLogicDefinition, phase: 'enter' | 'exit') =>
  resolveTransition(
    definition,
    'ticker',
    phase === 'exit' ? 'ticker' : null,
    phase === 'enter' ? 'ticker' : null,
  ).recipe!;

describe('explicit resize timing', () => {
  it('reads the news example resize and restore timing, including ordering', () => {
    const { definition } = northline();
    expect(resizeTiming(definition, 'ticker', 'ticker', 'enter', 50)).toEqual({
      startFrame: 0,
      durationFrames: 30,
      waitForResize: true,
    });
    expect(resizeTiming(definition, 'ticker', 'ticker', 'exit', 50)).toEqual({
      startFrame: 39,
      durationFrames: 30,
      waitForResize: true,
    });
  });

  it('follows the actual incoming and outgoing opacity phases when no layout timing exists', () => {
    const { definition } = northline();
    const enter = tickerRecipe(definition, 'enter');
    const exit = tickerRecipe(definition, 'exit');
    delete enter.layoutPhase;
    delete exit.layoutPhase;
    enter.sharedFrames = 12;
    expect(resizeTiming(definition, 'ticker', 'ticker', 'enter', 50)).toEqual({
      startFrame: 34,
      durationFrames: 50,
      waitForResize: false,
    });
    expect(resizeTiming(definition, 'ticker', 'ticker', 'exit', 50)).toEqual({
      startFrame: 0,
      durationFrames: 35,
      waitForResize: false,
    });
  });

  it('represents an instantaneous implicit phase with the editable one-frame minimum', () => {
    const { definition } = northline();
    const enter = tickerRecipe(definition, 'enter');
    delete enter.layoutPhase;
    enter.incomingFrames = 0;
    expect(resizeTiming(definition, 'ticker', 'ticker', 'enter', 50).durationFrames).toBe(1);
    expect(enter.incomingFrames).toBe(0);
  });

  it('uses a positive frame-rate based fallback only for an invalid implicit duration', () => {
    const { definition } = northline();
    const exit = tickerRecipe(definition, 'exit');
    delete exit.layoutPhase;
    exit.outgoingFrames = Number.NaN;
    expect(resizeTiming(definition, 'ticker', 'ticker', 'exit', 50).durationFrames).toBe(30);
    expect(resizeTiming(definition, 'ticker', 'ticker', 'exit', 1).durationFrames).toBe(1);
  });

  it('extends the recipe and preserves room-first ordering when start or duration grows', () => {
    const { definition, references } = northline();
    const source = structuredClone(definition);
    const next = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'enter',
      { startFrame: 20, durationFrames: 40 },
      references,
    );
    const before = tickerRecipe(definition, 'enter');
    const after = tickerRecipe(next, 'enter');
    expect(after).toMatchObject({
      layoutPhase: { startFrame: 20, durationFrames: 40 },
      incomingStartFrame: 60,
      incomingFrames: before.incomingFrames,
      outgoingFrames: before.outgoingFrames,
      sharedFrames: before.sharedFrames,
      easing: before.easing,
      durationFrames: 110,
    });
    expect(resizeTiming(next, 'ticker', 'ticker', 'enter', 50).waitForResize).toBe(true);
    expect(transitionLogicErrors(next, references)).toEqual([]);
    expect(definition).toEqual(source);
  });

  it('keeps an existing incoming delay when resize becomes shorter', () => {
    const { definition, references } = northline();
    const next = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'enter',
      { startFrame: 0, durationFrames: 12 },
      references,
    );
    expect(tickerRecipe(next, 'enter').incomingStartFrame).toBe(34);
  });

  it('preserves deliberately overlapping incoming motion', () => {
    const { definition, references } = northline();
    tickerRecipe(definition, 'enter').incomingStartFrame = 10;
    const next = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'enter',
      { startFrame: 15, durationFrames: 35 },
      references,
    );
    expect(tickerRecipe(next, 'enter').incomingStartFrame).toBe(10);
    expect(resizeTiming(next, 'ticker', 'ticker', 'enter', 50).waitForResize).toBe(false);
  });

  it('scopes changes to the selected template and preserves other phases and advanced state', () => {
    const { definition, references } = northline();
    definition.states.push({
      ...definition.states.find((state) => state.id === 'ticker')!,
      id: 'second-ticker',
    });
    const otherEnter = resolveTransition(definition, 'ticker', null, 'second-ticker').recipe;
    const ownExit = tickerRecipe(definition, 'exit');
    const update = resolveTransition(definition, 'ticker', 'ticker', 'ticker').recipe;
    const lowerSwitch = resolveTransition(definition, 'lower-third', 'name', 'headline').recipe;
    const next = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'enter',
      { startFrame: 9, durationFrames: 48 },
      references,
    );
    expect(cellTiming(next, { slotId: 'ticker', from: null, to: 'ticker' }).custom).toBe(true);
    expect(resolveTransition(next, 'ticker', null, 'second-ticker').recipe).toEqual(otherEnter);
    expect(tickerRecipe(next, 'exit')).toEqual(ownExit);
    expect(resolveTransition(next, 'ticker', 'ticker', 'ticker').recipe).toEqual(update);
    expect(resolveTransition(next, 'lower-third', 'name', 'headline').recipe).toEqual(lowerSwitch);
    expect(next.layoutRules).toEqual(definition.layoutRules);
    expect(next.sharedInstances).toEqual(definition.sharedInstances);
    expect(next.initialSharedValues).toEqual(definition.initialSharedValues);
    expect(next.states).toEqual(definition.states);
    expect(
      next.routes.filter((route) => definition.routes.some((old) => old.id === route.id)),
    ).toEqual(definition.routes);
  });

  it('updates an existing exact exception without creating duplicate routes', () => {
    const { definition, references } = northline();
    const first = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'enter',
      {
        startFrame: 0,
        durationFrames: 20,
      },
      references,
    );
    const second = setResizeTiming(
      first,
      'ticker',
      'ticker',
      'enter',
      {
        startFrame: 8,
        durationFrames: 40,
      },
      references,
    );
    expect(second.routes).toEqual(first.routes);
    expect(second.transitions).toHaveLength(first.transitions.length);
    expect(tickerRecipe(second, 'enter').layoutPhase).toEqual({
      startFrame: 8,
      durationFrames: 40,
    });
  });

  it('supports both restore-after-out and explicitly overlapping restore timing', () => {
    const { definition, references } = northline();
    const later = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'exit',
      {
        startFrame: 50,
        durationFrames: 40,
      },
      references,
    );
    expect(tickerRecipe(later, 'exit')).toMatchObject({
      outgoingFrames: 35,
      layoutPhase: { startFrame: 50, durationFrames: 40 },
      durationFrames: 90,
    });
    expect(resizeTiming(later, 'ticker', 'ticker', 'exit', 50).waitForResize).toBe(true);
    const overlapping = setResizeTiming(
      later,
      'ticker',
      'ticker',
      'exit',
      {
        startFrame: 10,
        durationFrames: 12,
      },
      references,
    );
    expect(tickerRecipe(overlapping, 'exit').layoutPhase).toEqual({
      startFrame: 10,
      durationFrames: 12,
    });
    expect(resizeTiming(overlapping, 'ticker', 'ticker', 'exit', 50).waitForResize).toBe(false);
  });

  it('preserves an advanced hold after the last phase', () => {
    const { definition, references } = northline();
    tickerRecipe(definition, 'exit').durationFrames += 11;
    const next = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'exit',
      {
        startFrame: 50,
        durationFrames: 40,
      },
      references,
    );
    expect(tickerRecipe(next, 'exit').durationFrames).toBe(101);
  });

  it.each([1, 2] as const)('upgrades version %s only when saving explicit timing', (version) => {
    const { definition, references } = northline();
    definition.version = version;
    for (const recipe of definition.transitions) delete recipe.layoutPhase;
    if (version === 1) delete definition.layoutRules;
    expect(transitionLogicErrors(definition, references)).toEqual([]);
    resizeTiming(definition, 'ticker', 'ticker', 'enter', 50);
    expect(definition.version).toBe(version);
    const next = setResizeTiming(
      definition,
      'ticker',
      'ticker',
      'enter',
      {
        startFrame: 3,
        durationFrames: 20,
      },
      references,
    );
    expect(next.version).toBe(TRANSITION_LOGIC_VERSION);
    expect(definition.version).toBe(version);
    const saved = JSON.parse(JSON.stringify(next));
    expect(transitionLogicErrors(saved, references)).toEqual([]);
    expect(resizeTiming(saved, 'ticker', 'ticker', 'enter', 50)).toMatchObject({
      startFrame: 3,
      durationFrames: 20,
    });
  });

  it.each([
    { startFrame: -1, durationFrames: 10 },
    { startFrame: 0.5, durationFrames: 10 },
    { startFrame: 1_000_001, durationFrames: 10 },
    { startFrame: 0, durationFrames: 0 },
    { startFrame: 0, durationFrames: Number.NaN },
    { startFrame: 0, durationFrames: 1_000_001 },
  ])('rejects invalid resize frames: %j', (timing) => {
    const { definition, references } = northline();
    expect(() =>
      setResizeTiming(definition, 'ticker', 'ticker', 'enter', timing, references),
    ).toThrow(/whole number/);
  });

  it.each([
    ['ticker', null],
    ['ticker', 'missing-state'],
    ['ticker', 'name'],
    ['missing-slot', 'ticker'],
  ] as const)('rejects a missing or wrong-lane selection: %s / %s', (slotId, stateId) => {
    const { definition, references } = northline();
    expect(() => resizeTiming(definition, slotId, stateId, 'enter', 50)).toThrow();
    expect(() =>
      setResizeTiming(
        definition,
        slotId,
        stateId,
        'enter',
        {
          startFrame: 0,
          durationFrames: 30,
        },
        references,
      ),
    ).toThrow();
  });
});
