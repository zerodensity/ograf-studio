import { describe, expect, it } from 'vitest';
import { createProject } from './factory';
import { frameCueErrors, MAX_FRAME_CUE_PAYLOAD_BYTES, MAX_FRAME_CUES } from './frameCue';
import { getTotalFrames } from './keyframeTiming';
import { migrateProject } from './migrations';
import { assessStaticExitHold } from './exitHoldPreflight';

describe('frame cues', () => {
  const cue = { id: 'cue-1', name: 'Flash', frame: 0 };

  it('accepts frame boundaries, repeated frames and optional JSON payloads', () => {
    expect(frameCueErrors(undefined, 24)).toEqual([]);
    expect(
      frameCueErrors(
        [
          cue,
          { ...cue, id: 'cue-2', frame: 24, payload: { team: 'home', values: [1, null] } },
          { ...cue, id: 'cue-3', frame: 24, payload: false },
        ],
        24,
      ),
    ).toEqual([]);
  });

  it('rejects malformed records, unsafe payloads and duplicate identities', () => {
    expect(frameCueErrors({}, 24)).not.toEqual([]);
    expect(
      frameCueErrors(
        Array.from({ length: MAX_FRAME_CUES + 1 }, () => cue),
        24,
      ),
    ).not.toEqual([]);
    expect(frameCueErrors([cue, cue], 24).join(' ')).toMatch(/duplicate/);
    for (const frame of [NaN, Infinity, -1, 0.5, 25])
      expect(frameCueErrors([{ ...cue, frame }], 24).join(' ')).toMatch(/whole frame/);
    expect(frameCueErrors([{ ...cue, name: '  ' }], 24).join(' ')).toMatch(/needs a name/);
    for (const payload of [
      NaN,
      new Date(),
      JSON.parse('{"__proto__":{"unsafe":true}}'),
      '🚩'.repeat(MAX_FRAME_CUE_PAYLOAD_BYTES / 4 + 1),
    ])
      expect(frameCueErrors([{ ...cue, payload }], 24).join(' ')).toMatch(/plain, finite JSON/);
  });

  it('keeps cues in project JSON and supplies an empty list for older documents', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const legacy = structuredClone(project);
    delete legacy.compositions[0]!.frameCues;
    expect(migrateProject(legacy).compositions[0]!.frameCues).toEqual([]);
    const authored = { ...cue, frame: getTotalFrames(composition), payload: { kind: 'end' } };
    composition.frameCues = [authored];
    expect(migrateProject(JSON.parse(JSON.stringify(project))).compositions[0]!.frameCues).toEqual([
      authored,
    ]);
  });

  it('does not optimize away a cue inside a static Out hold', () => {
    const composition = createProject().compositions[0]!;
    expect(assessStaticExitHold(composition, 1).reason).toBeUndefined();
    const end = getTotalFrames(composition);
    composition.frameCues = [{ ...cue, frame: end - 1 }];
    expect(assessStaticExitHold(composition, 1).reason).toMatch(/Frame cues.*authored timing/);
    composition.frameCues = [{ ...cue, frame: end }];
    expect(assessStaticExitHold(composition, 1).reason).toBeUndefined();
  });
});
