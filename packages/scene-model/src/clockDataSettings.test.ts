import { describe, expect, it } from 'vitest';
import { applyElementDataValue, readElementDataValue } from './boundPaint';
import { CLOCK_DATA_SETTINGS, normalizeClockTimerSettings } from './clockTimer';
import { createTextElement } from './factory';
import type { TextElement } from './types';

function clock(settings: Record<string, unknown> = {}): TextElement {
  return { ...createTextElement(), clock: normalizeClockTimerSettings(settings) };
}

const apply = (element: TextElement, setting: string, value: unknown) =>
  (applyElementDataValue(element, `clock.${setting}`, value) as TextElement).clock!;

describe('clock settings from data', () => {
  it('applies each setting and reads it back', () => {
    const element = clock({ mode: 'count-down' });
    const cases: Record<(typeof CLOCK_DATA_SETTINGS)[number], [unknown, unknown]> = {
      timeZone: ['Asia/Tokyo', 'Asia/Tokyo'],
      hourCycle: ['12', '12'],
      showAmPm: [true, true],
      format: ['mm:ss', 'mm:ss'],
      initialValueMs: [300000, 300000],
      endBehavior: ['continue', 'continue'],
    };
    for (const setting of CLOCK_DATA_SETTINGS) {
      const [value, expected] = cases[setting];
      const next = applyElementDataValue(element, `clock.${setting}`, value);
      expect(readElementDataValue(next, `clock.${setting}`)).toBe(expected);
    }
  });

  it('accepts the forms a select or toggle field sends', () => {
    expect(apply(clock(), 'hourCycle', 12).hourCycle).toBe('12');
    expect(apply(clock(), 'showAmPm', 'true').showAmPm).toBe(true);
    expect(apply(clock(), 'showAmPm', 'false').showAmPm).toBe(false);
    expect(apply(clock(), 'initialValueMs', '60000').initialValueMs).toBe(60000);
    expect(apply(clock(), 'initialValueMs', '05:00').initialValueMs).toBe(300000);
  });

  it('keeps the authored setting when a feed sends a value it cannot take', () => {
    const element = clock({ timeZone: 'UTC', format: 'hh:mm', mode: 'count-down' });
    expect(apply(element, 'timeZone', 'Mars/Olympus').timeZone).toBe('UTC');
    expect(apply(element, 'hourCycle', '13').hourCycle).toBe('24');
    expect(apply(element, 'format', 'no tokens [').format).toBe('hh:mm');
    expect(apply(element, 'initialValueMs', -5).initialValueMs).toBe(element.clock!.initialValueMs);
    expect(apply(element, 'initialValueMs', 'soon').initialValueMs).toBe(
      element.clock!.initialValueMs,
    );
    expect(apply(element, 'endBehavior', 'explode').endBehavior).toBe('stop');
  });

  it('leaves text that is not a clock alone', () => {
    const element = createTextElement();
    expect(applyElementDataValue(element, 'clock.timeZone', 'UTC')).toBe(element);
    expect(readElementDataValue(element, 'clock.timeZone')).toBeUndefined();
  });
});
