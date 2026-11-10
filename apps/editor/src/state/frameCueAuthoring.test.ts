import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, getTotalFrames } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';

describe('frame cue authoring', () => {
  const composition = () => useProjectStore.getState().project.compositions[0]!;
  beforeEach(() => useProjectStore.getState().loadProject(createProject()));

  it('adds at the rounded playhead and changes or clears payload without affecting media or layers', () => {
    const state = useProjectStore.getState();
    const id = state.addFrameCue(4.7);
    expect(composition().frameCues).toEqual([{ id, name: 'Cue 1', frame: 5 }]);
    const payload = { score: 3 };
    state.updateFrameCue(id, { name: ' Goal ', frame: 6, payload });
    payload.score = 9;
    expect(composition().frameCues).toEqual([
      { id, name: 'Goal', frame: 6, payload: { score: 3 } },
    ]);
    expect(composition().layers).toEqual([]);
    expect(composition().mediaCues).toEqual([]);
    state.updateFrameCue(id, { name: 'Goal', frame: 6 });
    expect(composition().frameCues).toEqual([{ id, name: 'Goal', frame: 6 }]);
    state.removeFrameCue(id);
    expect(composition().frameCues).toEqual([]);
  });

  it('validates frame and payload before mutating the authored project', () => {
    const state = useProjectStore.getState();
    const end = getTotalFrames(composition());
    const id = state.addFrameCue(end + 20);
    expect(composition().frameCues?.[0]?.frame).toBe(end);
    const before = useProjectStore.getState().project;
    expect(() => state.updateFrameCue(id, { name: 'Goal', frame: end + 1 })).toThrow(/whole frame/);
    expect(() => state.updateFrameCue(id, { name: 'Goal', frame: 5, payload: NaN })).toThrow(
      /JSON/,
    );
    expect(() => state.updateFrameCue(id, { name: ' ', frame: 5 })).toThrow(/name/);
    expect(useProjectStore.getState().project).toBe(before);
  });
});
