import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createComposition,
  createKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
  createTransition,
} from '@ograf-editor/scene-model';
import { lifecycleRetimeBounds, planLifecycleRetime } from './lifecycleRetime';
import { useProjectStore } from './projectStore';

function lifecycleComposition() {
  const start = createKeyframe({ name: 'Start', role: 'start' });
  const first = createKeyframe({ name: 'Step 1', role: 'step' });
  const second = createKeyframe({ name: 'Step 2', role: 'step' });
  const end = createKeyframe({ name: 'End', role: 'end' });
  const composition = createComposition({
    keyframes: [start, first, second, end],
    transitions: [
      createTransition(start.id, first.id, { durationFrames: 10 }),
      createTransition(first.id, second.id, { durationFrames: 20 }),
      createTransition(second.id, end.id, { durationFrames: 10 }),
    ],
  });
  return { composition, start, first, second, end };
}

describe('lifecycle marker retiming', () => {
  it('bounds an interior Step between its adjacent lifecycle markers', () => {
    const { composition, first } = lifecycleComposition();

    expect(lifecycleRetimeBounds(composition, first.id)).toEqual({
      currentFrame: 10,
      minFrame: 1,
      maxFrame: 29,
    });
    expect(planLifecycleRetime(composition, first.id, -100)?.targetFrame).toBe(1);
    expect(planLifecycleRetime(composition, first.id, 100)?.targetFrame).toBe(29);
  });

  it('changes both adjacent durations so later lifecycle markers stay fixed', () => {
    const { composition, first } = lifecycleComposition();
    const plan = planLifecycleRetime(composition, first.id, 15)!;

    expect(plan.transitionUpdates.map((update) => update.durationFrames)).toEqual([15, 15]);

    const project = createProject({
      mainCompositionId: composition.id,
      compositions: [composition],
    });
    useProjectStore.getState().loadProject(project);
    const result = useProjectStore.getState().moveLifecycleKeyframe(first.id, 15);
    const updated = useProjectStore.getState().project.compositions[0]!;

    expect(result?.targetFrame).toBe(15);
    expect(computeKeyframeFrames(updated).map((item) => item.frame)).toEqual([0, 15, 30, 40]);
  });

  it('allows End to change the total duration while Start remains fixed', () => {
    const { composition, start, end } = lifecycleComposition();

    expect(planLifecycleRetime(composition, start.id, 5)).toBeNull();
    expect(planLifecycleRetime(composition, end.id, 55)?.transitionUpdates).toEqual([
      expect.objectContaining({ durationFrames: 25 }),
    ]);
  });

  it('reports keys left at the old Step and keys stranded beyond a shortened End', () => {
    const { composition, first, end } = lifecycleComposition();
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.x = [
      createLayerPropertyKeyframe(10, 100),
      createLayerPropertyKeyframe(38, 200),
      createLayerPropertyKeyframe(40, 300),
    ];
    composition.layers.push(layer);

    expect(planLifecycleRetime(composition, first.id, 15)?.warnings).toEqual([
      expect.stringContaining('old lifecycle frame 10'),
    ]);
    expect(planLifecycleRetime(composition, end.id, 35)?.warnings).toEqual([
      expect.stringContaining('old lifecycle frame 40'),
      expect.stringContaining('beyond the new End frame 35'),
    ]);
  });
});
