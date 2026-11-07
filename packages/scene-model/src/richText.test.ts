import { describe, expect, it } from 'vitest';
import { applyElementDataValue } from './boundPaint';
import { createTextElement } from './factory';

describe('rich text model', () => {
  it('preserves ordered mixed-style runs and explicit language direction', () => {
    const text = createTextElement({
      content: 'Gold Medal',
      direction: 'rtl',
      language: 'ar',
      runs: [
        { text: 'Gold ', fontWeight: 800, color: '#d4af37' },
        { text: 'Medal', fontStyle: 'italic' },
      ],
    });
    expect(text.runs.map((run) => run.text).join('')).toBe(text.content);
    expect(text).toMatchObject({ direction: 'rtl', language: 'ar' });
  });

  it('returns to plain text when runtime data replaces content', () => {
    const text = createTextElement({ content: 'A', runs: [{ text: 'A', color: '#ff0000' }] });
    expect(applyElementDataValue(text, 'content', 'B')).toMatchObject({ content: 'B', runs: [] });
  });

  it('retains authored run styles when a bound default uses the same text', () => {
    const text = createTextElement({
      content: 'Gold Medal',
      runs: [
        { text: 'Gold ', color: '#d4af37' },
        { text: 'Medal', fontWeight: 800 },
      ],
    });
    expect(applyElementDataValue(text, 'content', 'Gold Medal')).toMatchObject({
      content: 'Gold Medal',
      runs: text.runs,
    });
  });
});
