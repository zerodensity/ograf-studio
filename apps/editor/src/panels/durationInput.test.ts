import { describe, expect, it } from 'vitest';
import {
  formatDurationInput,
  parseDurationInput,
  formatMillisecondDuration,
  parseMillisecondDuration,
  resolveMillisecondDraft,
  resolveFrameDurationDraft,
} from './durationInput';

describe('duration input', () => {
  it('never reparses an untouched rounded frame display when switching units', () => {
    const rounded = formatDurationInput(3, 120, 'seconds');
    expect(parseDurationInput(rounded, 120, 'seconds')?.frames).not.toBe(3);
    expect(resolveFrameDurationDraft(rounded, rounded, 120, 'seconds')).toBeUndefined();
    for (const fps of [25, 30_000 / 1_001, 60_000 / 1_001, 120]) {
      const display = formatDurationInput(3, fps, 'seconds');
      expect(resolveFrameDurationDraft(display, display, fps, 'seconds')).toBeUndefined();
      expect(resolveFrameDurationDraft('12f', display, fps, 'seconds')?.frames).toBe(12);
      expect(resolveFrameDurationDraft('0.5s', display, fps, 'frames')?.frames).toBe(
        Math.round(fps * 0.5),
      );
      expect(resolveFrameDurationDraft('00:00:01:00', display, fps, 'frames')?.frames).toBe(
        Math.round(fps),
      );
    }
  });
  it('never changes an untouched rounded millisecond display and handles nullable values deliberately', () => {
    const displayed = formatMillisecondDuration(123.456, 25, 'timecode');
    expect(resolveMillisecondDraft(displayed, displayed, 25, 'timecode', true, 0, 60000)).toEqual({
      kind: 'unchanged',
    });
    expect(resolveMillisecondDraft('', displayed, 25, 'seconds', true, 0, 60000)).toEqual({
      kind: 'value',
      value: null,
    });
    expect(resolveMillisecondDraft('', displayed, 25, 'seconds', false, 0, 60000)).toEqual({
      kind: 'invalid',
    });
    expect(resolveMillisecondDraft('61s', displayed, 25, 'seconds', false, 0, 60000)).toEqual({
      kind: 'value',
      value: 60000,
    });
  });
  it.each([25, 50, 59.94])(
    'parses millisecond-backed values without frame quantization at %s fps',
    (fps) => {
      expect(parseMillisecondDuration('123.456ms', fps, 'seconds')).toBe(123.456);
      expect(parseMillisecondDuration('0.123456s', fps, 'seconds')).toBe(123.456);
      expect(parseMillisecondDuration('0.5s', fps, 'frames')).toBeCloseTo(500, 10);
      expect(parseMillisecondDuration('12f', fps, 'seconds')).toBeCloseTo(12000 / fps, 10);
      expect(
        parseMillisecondDuration(
          formatMillisecondDuration(123.456, fps, 'seconds'),
          fps,
          'seconds',
        ),
      ).toBeCloseTo(123.456, 10);
      expect(parseMillisecondDuration('nonsense', fps, 'seconds')).toBeNull();
    },
  );
  it('accepts seconds, milliseconds, frames and non-drop timecode', () => {
    expect(parseDurationInput('0.5s', 25, 'seconds')).toEqual({
      frames: 13,
      exactFrames: 12.5,
      rounded: true,
    });
    expect(parseDurationInput('500ms', 50, 'seconds')?.frames).toBe(25);
    expect(parseDurationInput('12f', 25, 'seconds')?.frames).toBe(12);
    expect(parseDurationInput('00:00:01:05', 25, 'seconds')?.frames).toBe(30);
  });
  it('interprets bare numbers according to the display unit and rejects malformed values', () => {
    expect(parseDurationInput('12', 25, 'frames')?.frames).toBe(12);
    expect(parseDurationInput('0.5', 25, 'seconds')?.frames).toBe(13);
    for (const input of ['-1s', 'abc', '00:60:01:00', '00:00:01:25'])
      expect(parseDurationInput(input, 25, 'seconds')).toBeNull();
  });
  it('shows consistent frames and non-drop timecode across frame rates', () => {
    expect(formatDurationInput(25, 25, 'seconds')).toBe('1.00s');
    expect(formatDurationInput(25, 25, 'frames')).toBe('25f');
    expect(formatDurationInput(30, 25, 'timecode')).toBe('00:00:01:05');
    expect(
      parseDurationInput(formatDurationInput(65, 59.94, 'timecode'), 59.94, 'timecode')?.frames,
    ).toBe(65);
  });
});
