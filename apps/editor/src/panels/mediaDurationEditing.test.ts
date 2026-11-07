import { describe, expect, it } from 'vitest';
import {
  createProject,
  createMediaCue,
  createLayerOfKind,
  createMediaPaint,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { parseProjectSource } from '../state/studioDocument';
import { formatMillisecondDuration, resolveMillisecondDraft } from './durationInput';

describe('media timing precision through authoring and export', () => {
  it.each([25, 50, 59.94])('keeps exact milliseconds and automatic trim at %s fps', (frameRate) => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.frameRate = frameRate;
    const value = 123.456;
    const display = formatMillisecondDuration(value, frameRate, 'timecode');
    expect(
      resolveMillisecondDraft(display, display, frameRate, 'timecode', false, 0, 60000),
    ).toEqual({ kind: 'unchanged' });
    const parsed = resolveMillisecondDraft(
      '123.456ms',
      display,
      frameRate,
      'timecode',
      false,
      0,
      60000,
    );
    expect(parsed).toEqual({ kind: 'value', value });
    const audio = createLayerOfKind('audio');
    if (audio.element.type !== 'audio') throw Error('Expected audio');
    audio.element.trimStartMs = value;
    audio.element.trimEndMs = null;
    audio.element.timelineStartMs = value;
    const rectangle = createLayerOfKind('rectangle');
    if (rectangle.element.type !== 'rectangle') throw Error('Expected rectangle');
    rectangle.element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'data:video/mp4;base64,AA==' },
      offsetMs: value,
      trimEndMs: null,
      timelineStartMs: value,
    });
    composition.layers = [audio, rectangle];
    composition.mediaCues = [createMediaCue({ trimStartMs: value, trimEndMs: null })];
    const restored = parseProjectSource(JSON.stringify(project)).compositions[0]!;
    expect(restored.mediaCues[0]).toMatchObject({ trimStartMs: value, trimEndMs: null });
    expect(restored.layers[0]!.element).toMatchObject({
      trimStartMs: value,
      trimEndMs: null,
      timelineStartMs: value,
    });
    expect(restored.layers[1]!.element).toMatchObject({
      fill: { offsetMs: value, trimEndMs: null, timelineStartMs: value },
    });
    const compiled = compileDescriptor(restored);
    expect(compiled.mediaCues).toHaveLength(1);
    expect(compiled.mediaCues![0]).toMatchObject({ trimStartMs: value, trimEndMs: null });
    expect(compiled.layers[0]!.element).toMatchObject({
      trimStartMs: value,
      trimEndMs: null,
      timelineStartMs: value,
    });
    expect(compiled.layers[1]!.element).toMatchObject({
      fill: { offsetMs: value, trimEndMs: null, timelineStartMs: value },
    });
  });
});
