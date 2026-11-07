import { describe, expect, it } from 'vitest';
import { matchesPropertyFilter, propertyFilterTokens } from './propertiesFilterLogic';

describe('Properties filter', () => {
  it('matches case-insensitively with partial text', () => {
    expect(matchesPropertyFilter('Drop Shadow Opacity', 'sha opa')).toBe(true);
    expect(matchesPropertyFilter('Drop Shadow Opacity', 'rotation')).toBe(false);
  });

  it('normalizes repeated whitespace into required tokens', () => {
    expect(propertyFilterTokens('  media   pos  ')).toEqual(['media', 'pos']);
  });
});
