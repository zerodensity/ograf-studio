import { describe, expect, it } from 'vitest';
import { resolvePlayTarget } from './lifecycle';

const resolve = (currentStep: number | undefined, params: { delta?: number; goto?: number } = {}) =>
  resolvePlayTarget(['step-0', 'step-1'], 'start', 'end', currentStep, params);

describe('resolvePlayTarget', () => {
  it('takes the first default play from start to step zero', () => {
    expect(resolve(undefined)).toEqual({ keyframeId: 'step-0', currentStep: 0 });
  });

  it('moves between numbered steps without skipping step zero', () => {
    expect(resolve(0)).toEqual({ keyframeId: 'step-1', currentStep: 1 });
  });

  it('crosses past the last step into end instead of clamping', () => {
    expect(resolve(1)).toEqual({ keyframeId: 'end', currentStep: undefined });
  });

  it('crosses backward before step zero into start', () => {
    expect(resolve(0, { delta: -1 })).toEqual({ keyframeId: 'start', currentStep: undefined });
  });

  it('honors goto and supports a graphic with no steps', () => {
    expect(resolve(undefined, { goto: 1 })).toEqual({ keyframeId: 'step-1', currentStep: 1 });
    expect(resolvePlayTarget([], 'start', 'end', undefined, {})).toEqual({
      keyframeId: 'end',
      currentStep: undefined,
    });
  });
});
