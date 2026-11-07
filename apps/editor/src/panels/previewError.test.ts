import { describe, expect, it } from 'vitest';
import { previewErrorSummary } from './previewErrorSummary';

describe('preview diagnostics', () => {
  it('keeps a short actionable error visible', () => {
    expect(previewErrorSummary('Take a graphic first.')).toEqual({
      summary: 'Take a graphic first.',
      details: [],
    });
  });
  it('summarizes many diagnostics and retains each distinct detail', () => {
    expect(previewErrorSummary('First issue\r\nSecond issue\nFirst issue\n')).toEqual({
      summary: 'Preview could not complete this command (2 issues).',
      details: ['First issue', 'Second issue'],
    });
  });
  it('bounds a long single diagnostic without losing its complete text', () => {
    const detail = 'Long diagnostic '.repeat(100);
    const result = previewErrorSummary(detail);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.details).toEqual([detail.trim()]);
  });
});
