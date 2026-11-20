import { describe, expect, it } from 'vitest';
import { agentVideoSize } from './agentVideoExport';

describe('agent video size', () => {
  const hd = { width: 1920, height: 1080 };

  it('renders at the composition size unless a smaller longest side is asked for', () => {
    expect(agentVideoSize(hd)).toBeUndefined();
    expect(agentVideoSize(hd, 1920)).toBeUndefined();
    expect(agentVideoSize(hd, 4096)).toBeUndefined();
  });

  it('keeps the shape when it scales down', () => {
    expect(agentVideoSize(hd, 960)).toEqual({ width: 960, height: 540 });
    expect(agentVideoSize({ width: 1080, height: 1920 }, 640)).toEqual({ width: 360, height: 640 });
  });

  it('never goes below two pixels a side', () => {
    expect(agentVideoSize({ width: 4000, height: 40 }, 64)).toEqual({ width: 64, height: 2 });
  });
});
