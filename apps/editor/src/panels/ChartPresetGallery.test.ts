import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChartPresetGallery } from './ChartPresetGallery';

describe('chart presets in the shared plugin gallery', () => {
  it('renders all nine named cards with their original chart icons and semantic group', () => {
    const onSelect = vi.fn();
    const markup = renderToStaticMarkup(createElement(ChartPresetGallery, { onSelect }));
    expect(markup).toContain('plugin-template-gallery');
    expect(markup).toContain('chart-preset-gallery');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Chart type gallery"');
    expect(markup.match(/<button\b/g)).toHaveLength(9);
    expect(markup.match(/<svg\b/g)).toHaveLength(9);
    for (const label of [
      'Bar',
      'Horizontal',
      'Stacked',
      'Line',
      'Area',
      'Pie',
      'Doughnut',
      'Radar',
      'Polar area',
    ])
      expect(markup).toContain(label);
    for (const icon of ['chart-icon-line', 'chart-icon-area', 'chart-icon-cut', 'chart-icon-hole'])
      expect(markup).toContain(icon);
    expect(markup).toContain('M7 27h10M25 23h10M43 18h10');
    expect(markup).not.toContain('<canvas');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks only the currently selected chart card as pressed', () => {
    const markup = renderToStaticMarkup(
      createElement(ChartPresetGallery, { selected: 'doughnut', onSelect: () => {} }),
    );
    const selected = markup.match(/<button\b[^>]*aria-pressed="true"[^>]*>[\s\S]*?<\/button>/g);
    expect(selected).toHaveLength(1);
    expect(selected![0]).toContain('Doughnut');
    expect(selected![0]).toContain('chart-icon-hole');
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(8);
  });

  it('filters to the selected provider’s supported presets while preserving normal gallery order', () => {
    const supported = ['doughnut', 'line'] as const;
    const before = [...supported];
    const markup = renderToStaticMarkup(
      createElement(ChartPresetGallery, {
        presets: supported,
        selected: 'pie',
        onSelect: () => {},
      }),
    );
    expect(markup.match(/<button\b/g)).toHaveLength(2);
    expect(markup.match(/<svg\b/g)).toHaveLength(2);
    expect(markup.indexOf('Line')).toBeLessThan(markup.indexOf('Doughnut'));
    expect(markup).not.toContain('aria-pressed="true"');
    expect(markup).not.toContain('Horizontal');
    expect(markup).not.toContain('Polar area');
    expect(supported).toEqual(before);
    const empty = renderToStaticMarkup(
      createElement(ChartPresetGallery, { presets: [], onSelect: () => {} }),
    );
    expect(empty).not.toContain('<button');
  });

  it('finds templates by name or ID while retaining their icons and selected state', () => {
    const polar = renderToStaticMarkup(
      createElement(ChartPresetGallery, {
        searchQuery: '  POLAR  ',
        onSelect: () => {},
      }),
    );
    expect(polar.match(/<button\b/g)).toHaveLength(1);
    expect(polar).toContain('Polar area');
    expect(polar).toContain('chart-icon-cut');
    const horizontal = renderToStaticMarkup(
      createElement(ChartPresetGallery, {
        searchQuery: 'horizontal-bar',
        selected: 'horizontal-bar',
        onSelect: () => {},
      }),
    );
    expect(horizontal.match(/<button\b/g)).toHaveLength(1);
    expect(horizontal).toContain('Horizontal');
    expect(horizontal).toContain('aria-pressed="true"');
  });

  it('searches only the selected provider’s capabilities and announces an empty match without side effects', () => {
    const onSelect = vi.fn();
    const presets = ['bar', 'horizontal-bar'] as const;
    const before = [...presets];
    const bar = renderToStaticMarkup(
      createElement(ChartPresetGallery, {
        presets,
        searchQuery: 'bar',
        onSelect,
      }),
    );
    expect(bar.match(/<button\b/g)).toHaveLength(2);
    expect(bar).toContain('Horizontal');
    expect(bar).not.toContain('Stacked');
    const empty = renderToStaticMarkup(
      createElement(ChartPresetGallery, {
        presets: ['line', 'doughnut'],
        searchQuery: 'bar',
        selected: 'bar',
        onSelect,
      }),
    );
    expect(empty).not.toContain('<button');
    expect(empty).toContain('role="group"');
    expect(empty).toContain('aria-label="Chart type gallery"');
    expect(empty).toContain('role="status"');
    expect(empty).toContain('No matching templates.');
    expect(presets).toEqual(before);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
