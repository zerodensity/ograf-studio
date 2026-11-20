import { describe, expect, it } from 'vitest';
import { parseOutputLayerInput } from './outputLayerInputValue';

describe('output layer integer input', () => {
  it.each(['', '-', '0.5', '9007199254740991.1', '9007199254740992', 'Infinity', '1e100'])(
    'rejects incomplete, fractional or unsafe text %s',
    (value) => {
      expect(parseOutputLayerInput(value)).toBeNull();
    },
  );
  it.each([
    ['-9007199254740991', Number.MIN_SAFE_INTEGER],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['-12', -12],
    ['-0', 0],
    ['0', 0],
  ] as const)('accepts %s without rounding', (text, value) => {
    expect(parseOutputLayerInput(text)).toBe(value);
  });
});
