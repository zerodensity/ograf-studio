import { describe, expect, it } from 'vitest';
import { viewportScrollForPointer } from './viewportPan';

describe('middle-button viewport panning', () => {
  const origin = { clientX: 300, clientY: 200, scrollLeft: 900, scrollTop: 500 };

  it('scrolls toward the opposite direction of the pointer drag', () => {
    expect(viewportScrollForPointer(origin, 340, 225)).toEqual({ left: 860, top: 475 });
    expect(viewportScrollForPointer(origin, 270, 160)).toEqual({ left: 930, top: 540 });
  });

  it('does not accumulate rounding drift across pointer updates', () => {
    expect(viewportScrollForPointer(origin, 300.5, 199.25)).toEqual({
      left: 899.5,
      top: 500.75,
    });
  });
});
