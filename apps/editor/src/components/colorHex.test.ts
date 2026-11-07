import { describe, expect, it } from 'vitest';
import { parseColorHexDraft } from './colorHex';

describe('color picker hex input', () => {
  it('accepts and normalizes RGB and RGBA hex values', () => {
    expect(parseColorHexDraft('  #ABC  ', false, false, 1)).toBe('#aabbcc');
    expect(parseColorHexDraft('#AbC8', true, false, 1)).toBe('#aabbcc88');
    expect(parseColorHexDraft('#01020304', true, true, 0.5)).toBe('#01020304');
  });
  it('retains the current alpha when changing only RGB', () => {
    expect(parseColorHexDraft('#fedcba', true, true, 128 / 255)).toBe('#fedcba80');
  });
  it('rejects invalid values and disallowed alpha', () => {
    expect(parseColorHexDraft('#12', true, false, 1)).toBeNull();
    expect(parseColorHexDraft('#xyz123', true, false, 1)).toBeNull();
    expect(parseColorHexDraft('#12345678', false, false, 1)).toBeNull();
  });
});
