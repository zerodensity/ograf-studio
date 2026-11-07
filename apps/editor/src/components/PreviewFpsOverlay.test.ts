import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewFpsControls, PreviewFpsOverlayView } from './PreviewFpsOverlay';

const render = (fps: number | null) =>
  renderToStaticMarkup(createElement(PreviewFpsOverlayView, { fps }));

describe('preview FPS overlay', () => {
  it('shows a compact measured value without live-region announcements', () => {
    const html = render(59.94);
    expect(html).toContain('class="preview-fps-overlay"');
    expect(html).toContain('data-preview-diagnostic="fps"');
    expect(html).toContain('aria-label="Preview FPS: 59.9"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('<span>Preview FPS</span>');
    expect(html).toContain('<strong>59.9</strong>');
    expect(html).toContain('not the authored frame rate or GPU render throughput');
  });

  it.each([null, NaN, Infinity, -1])('does not invent a value for %s', (fps) => {
    expect(render(fps)).toContain('<strong>—</strong>');
  });

  it('keeps a measured idle zero distinct from a missing sample', () => {
    expect(render(0)).toContain('<strong>0.0</strong>');
    expect(render(50)).toContain('<strong>50.0</strong>');
  });

  it('removes diagnostic chrome when disabled', () => {
    expect(
      renderToStaticMarkup(createElement(PreviewFpsOverlayView, { fps: 60, visible: false })),
    ).toBe('');
  });

  it('offers an enabled presentation-only toggle in preview controls', () => {
    const html = renderToStaticMarkup(createElement(PreviewFpsControls));
    expect(html).toContain('aria-label="Show FPS overlay"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});
