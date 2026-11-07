import { describe, expect, it } from 'vitest';
import { applyRevealToComposite } from './revealPresentation';
import { applyRevealClip } from './loopRendering';

describe('reveal clip ownership and padded compositing', () => {
  it('keeps the parent matte intact even before content is mounted', () => {
    const host = {
      style: { clipPath: 'polygon(0 0, 1px 0, 1px 1px)' },
      dataset: {},
    } as unknown as HTMLElement;
    applyRevealClip(host, { clipRight: [{ id: 'wipe', frame: 0, value: 1, easing: 'linear' }] });
    expect(host.style.clipPath).toBe('polygon(0 0, 1px 0, 1px 1px)');
    expect(host.dataset.ografRevealInsets).toBe('[0,1,0,0]');
  });

  it('offsets wipe planes for effect padding and restores only its own output clip', () => {
    const host = {
      style: { width: '100px', height: '60px' },
      dataset: { ografRevealInsets: '[0,0.5,0,0]' },
    } as unknown as HTMLElement;
    const output = {
      style: { left: '-12px', top: '-12px', clipPath: '' },
      dataset: {},
    } as unknown as HTMLCanvasElement;
    applyRevealToComposite(host, output);
    expect(output.style.clipPath).toBe('inset(0px 62px 0px 0px)');
    host.dataset.ografRevealInsets = '[0,1,0,0]';
    applyRevealToComposite(host, output);
    expect(output.style.clipPath).toBe('inset(0% 100% 0% 0%)');
    delete host.dataset.ografRevealInsets;
    applyRevealToComposite(host, output);
    expect(output.style.clipPath).toBe('');
    output.style.clipPath = 'circle(50%)';
    applyRevealToComposite(host, output);
    expect(output.style.clipPath).toBe('circle(50%)');
  });
});
