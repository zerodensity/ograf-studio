import { describe, expect, it } from 'vitest';
import { createProject, getTotalFrames } from '@ograf-editor/scene-model';
import { setNewTemplateTiming } from './newTemplateTiming';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useTimelineStore } from './timelineStore';
import { compileDescriptor } from '@ograf-editor/codegen';
import { parseProjectSource } from './studioDocument';
import { createLayerOfKind, createLayerPropertyKeyframe } from '@ograf-editor/scene-model';

describe('UI template timing', () => {
  it('retains a single Step and opts safe blank templates into the half-second tail', () => {
    const project = setNewTemplateTiming(createProject());
    const descriptor = compileDescriptor(project.compositions[0]!);
    expect(descriptor.stepCount).toBe(1);
    const exit = descriptor.transitions.find(
      (transition) => transition.toKeyframeId === descriptor.endKeyframeId,
    )!;
    expect(exit.durationFrames).toBe(112);
    expect(descriptor.exitTailStartFrame).toBe(112);
    expect((125 - descriptor.exitTailStartFrame!) / descriptor.frameRate).toBeCloseTo(0.52);
  });
  it('persists the opt-in and safely falls back for animation in the hold', () => {
    const project = setNewTemplateTiming(createProject());
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.opacity = [
      createLayerPropertyKeyframe(13, 1),
      createLayerPropertyKeyframe(125, 0),
    ];
    composition.layers.push(layer);
    const loaded = parseProjectSource(JSON.stringify(project));
    expect(loaded.compositions[0]!.shortOutFrames).toBe(13);
    expect(compileDescriptor(loaded.compositions[0]!).exitTailStartFrame).toBeUndefined();
    delete loaded.compositions[0]!.shortOutFrames;
    expect(compileDescriptor(loaded.compositions[0]!).exitTailStartFrame).toBeUndefined();
  });
  it.each([25, 50, 59.94])('starts at least five seconds long at %s fps', (fps) => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.frameRate = fps;
    setNewTemplateTiming(project);
    expect(getTotalFrames(composition) / fps).toBeGreaterThanOrEqual(5);
    expect(composition.transitions[0]!.durationFrames).toBe(Math.round(fps * 0.5));
    expect(composition.keyframes.filter((keyframe) => keyframe.role === 'step')).toHaveLength(1);
  });

  it.each([24_000 / 1_001, 30_000 / 1_001, 60_000 / 1_001, 47.952])(
    'retimes an untouched new blank at %s fps',
    (fps) => {
      useProjectSetStore.getState().clearProjectSet();
      useProjectStore.getState().newProject();
      useProjectStore
        .getState()
        .updateCompositionSettings({ width: 1080, height: 1920, frameRate: fps });
      const composition = useProjectStore.getState().project.compositions[0]!;
      expect(composition).toMatchObject({ width: 1080, height: 1920, frameRate: fps });
      expect(getTotalFrames(composition) / composition.frameRate).toBeGreaterThanOrEqual(5);
      expect(useTimelineStore.getState().currentFrame).toBe(0);
    },
  );

  it('does not retime an opened project when its frame rate changes', () => {
    useProjectSetStore.getState().clearProjectSet();
    const project = createProject();
    setNewTemplateTiming(project);
    useProjectStore.getState().loadProject(project);
    const before = getTotalFrames(useProjectStore.getState().project.compositions[0]!);
    useProjectStore.getState().updateCompositionSettings({ frameRate: 50 });
    expect(getTotalFrames(useProjectStore.getState().project.compositions[0]!)).toBe(before);
  });
  it('allows an existing project to opt in or out without retiming its timeline', () => {
    useProjectSetStore.getState().clearProjectSet();
    const project = createProject();
    const before = getTotalFrames(project.compositions[0]!);
    useProjectStore.getState().loadProject(project);
    useProjectStore.getState().updateCompositionSettings({ shortOutFrames: 6 });
    expect(useProjectStore.getState().project.compositions[0]!.shortOutFrames).toBe(6);
    useProjectStore.getState().updateCompositionSettings({ shortOutFrames: undefined });
    const composition = useProjectStore.getState().project.compositions[0]!;
    expect(composition.shortOutFrames).toBeUndefined();
    expect(getTotalFrames(composition)).toBe(before);
  });
});
