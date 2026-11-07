import { describe, expect, it } from 'vitest';
import { isColorSamplingTargetCurrent } from './colorSamplingTarget';

describe('color sampling target', () => {
  it('cancels a pending sample when the document, selection or control changes', () => {
    const root = { isConnected: true } as HTMLElement;
    const target = { root, project: {}, compositionId: 'one', selection: {} };
    expect(isColorSamplingTargetCurrent(target, target)).toBe(true);
    expect(isColorSamplingTargetCurrent(target, { ...target, project: {} })).toBe(false);
    expect(isColorSamplingTargetCurrent(target, { ...target, selection: {} })).toBe(false);
    expect(isColorSamplingTargetCurrent(target, { ...target, compositionId: 'two' })).toBe(false);
    expect(isColorSamplingTargetCurrent(target, { ...target, root: null })).toBe(false);
    const detached = { ...target, root: { isConnected: false } as HTMLElement };
    expect(isColorSamplingTargetCurrent(detached, detached)).toBe(false);
  });
});
