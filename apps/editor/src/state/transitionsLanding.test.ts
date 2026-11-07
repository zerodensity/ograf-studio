import { describe, expect, it } from 'vitest';
import { transitionLogicErrors, type TransitionLogicReferences } from '@ograf-editor/scene-model';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { layerStates } from './transitionChoreography';
import { elementDriftChecks, landingBoxes, templateLookup } from './transitionsDesign';
import { moveElementInTemplate } from './transitionsLanding';

describe('moving an element where a template places it', () => {
  it('shifts the template layout and keeps playout values following it', () => {
    const set = createTransitionLogicNewsExample(0);
    const definition = set.transitionLogic!;
    const references: TransitionLogicReferences = {
      templateIds: set.templates.map((template) => template.id),
      componentLayers: Object.fromEntries(
        set.componentAssets!.map((asset) => [asset.id, asset.layers.map((layer) => layer.id)]),
      ),
    };
    const state = layerStates(definition, 'lower-third')[1]!;
    const box = landingBoxes(definition, set.componentAssets!, 'lower-third', state.id).find(
      (entry) => entry.sourceLayerId === 'news-clock',
    )!;
    const move = moveElementInTemplate(
      set,
      definition,
      box,
      state.id,
      { dx: -40, dy: 0 },
      references,
    );

    const before = set.templates.find((entry) => entry.id === move.templateId)!.project;
    const layerOf = (project: typeof before) =>
      project.compositions[0]!.layers.find(
        (layer) => layer.componentLink?.sourceLayerId === 'news-clock',
      )!;
    expect(layerOf(move.project).keyframes.map((key) => key.transform.x)).toEqual(
      layerOf(before).keyframes.map((key) => key.transform.x - 40),
    );
    const moved = move.set.transitionLogic!;
    const after = landingBoxes(moved, set.componentAssets!, 'lower-third', state.id).find(
      (entry) => entry.sourceLayerId === 'news-clock',
    )!;
    expect(after.x).toBe(box.x - 40);
    expect(
      moved.states
        .find((entry) => entry.id === state.id)!
        .sharedValues!.some((value) => value.sourceLayerId === 'news-clock' && value.override),
    ).toBe(false);
    expect(
      elementDriftChecks(moved, move.set, templateLookup(move.set), references).some(
        (check) => check.drift?.instanceId === box.instanceId,
      ),
    ).toBe(false);
    expect(transitionLogicErrors(moved, references)).toEqual([]);
  });
});
