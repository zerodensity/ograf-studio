import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasZoomControls } from './CanvasZoomControls';

describe('canvas zoom controls', () => {
  it('offers zoom adjustment, actual size, fit and preset magnifications', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasZoomControls, {
        zoom: 0.75,
        onZoomIn: () => {},
        onZoomOut: () => {},
        onZoomChange: () => {},
        onFit: () => {},
      }),
    );
    expect(html).toContain('aria-label="Canvas zoom"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Canvas zoom percentage"');
    expect(html).toContain('value="75"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('>Fit</button>');
    expect(html).toContain('>1:1</button>');
    expect(html).toContain('aria-label="Canvas zoom presets"');
    for (const percent of [25, 50, 100, 150, 200, 400])
      expect(html).toContain(`>${percent}%</option>`);
  });
});
