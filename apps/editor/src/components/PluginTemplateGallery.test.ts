import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PluginTemplateGallery, PluginTemplateWorkspace } from './PluginTemplateGallery';

describe('shared plugin template interface', () => {
  it('gives named templates the same card contract with exactly one selection', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginTemplateGallery, {
        label: 'Shader preset gallery',
        items: [
          { id: 'waves', name: 'Waves', description: 'Moving waves' },
          { id: 'grid', name: 'Data Grid' },
        ],
        selected: 'grid',
        onSelect: () => {},
      }),
    );
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup.match(/class="plugin-template-card/g)).toHaveLength(2);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toContain('title="Moving waves"');
    expect(markup).toContain('is-text-only');
    expect(markup).not.toMatch(/<canvas|<svg|<img/);
  });
  it('retains icons, disabled explanations and the chart styling hook without another grid wrapper', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginTemplateGallery, {
        label: 'Chart type gallery',
        className: 'chart-preset-gallery',
        items: [
          {
            id: 'bar',
            name: 'Bar',
            icon: createElement('svg'),
            disabled: true,
            disabledReason: 'Unavailable for this selection.',
          },
        ],
        onSelect: () => {},
      }),
    );
    expect(markup.match(/role="group"/g)).toHaveLength(1);
    expect(markup).toContain('plugin-template-gallery chart-preset-gallery');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('title="Unavailable for this selection."');
    expect(markup).toContain('class="plugin-template-icon" aria-hidden="true"');
  });
  it('enables dragging only when a drag source is supplied and the template is available', () => {
    const items = [
      { id: 'waves', name: 'Waves' },
      { id: 'disabled', name: 'Disabled', disabled: true },
    ];
    const inert = renderToStaticMarkup(
      createElement(PluginTemplateGallery, {
        label: 'Animation preset gallery',
        items,
        onSelect: () => {},
      }),
    );
    expect(inert).not.toContain('draggable="true"');
    const draggable = renderToStaticMarkup(
      createElement(PluginTemplateGallery, {
        label: 'Shader preset gallery',
        items,
        onSelect: () => {},
        onDragStart: () => {},
      }),
    );
    expect(draggable.match(/draggable="true"/g)).toHaveLength(1);
    expect(draggable.match(/draggable="false"/g)).toHaveLength(1);
    expect(draggable).toContain('disabled=""');
  });
  it('places kind-specific controls in the labelled right detail area', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginTemplateWorkspace, {
        gallery: createElement('button', null, 'Pulse Pop'),
        details: createElement('input', { 'aria-label': 'Duration' }),
        detailsLabel: 'Animation Settings',
      }),
    );
    const browser = markup.match(/<section[^>]*>([\s\S]*?)<\/section>/)![1]!;
    const detail = markup.match(/<aside[^>]*>([\s\S]*?)<\/aside>/)![1]!;
    expect(browser).toContain('Pulse Pop');
    expect(browser).not.toContain('Duration');
    expect(detail).toContain('<h3>Animation Settings</h3>');
    expect(detail).toContain('aria-label="Duration"');
    expect(markup).toContain('class="plugin-template-splitter"');
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-label="Resize templates and Animation Settings"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-valuemin="180"');
    expect(markup).toContain('aria-valuemax="640"');
    expect(markup).toContain('aria-valuenow="320"');
    expect(markup).toContain('Arrow keys adjust width');
  });
  it('uses the available width for charts without reserving an empty inspector', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginTemplateWorkspace, { gallery: 'Charts' }),
    );
    expect(markup).toContain('is-gallery-only');
    expect(markup).not.toContain('<aside');
    expect(markup).not.toContain('role="separator"');
  });
  it('keeps plugin selection and search above the left gallery, outside the full-height detail column', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginTemplateWorkspace, {
        browserHeader: createElement(
          'header',
          null,
          createElement('button', null, 'ZD News Shaders'),
          createElement('input', { 'aria-label': 'Find plugin template' }),
        ),
        gallery: createElement('button', null, 'Gradient Flow'),
        details: createElement('canvas', { 'aria-label': 'Selected shader' }),
        detailsLabel: 'Shader Preview',
      }),
    );
    const browser = markup.match(/<section[^>]*>([\s\S]*?)<\/section>/)![1]!;
    const detail = markup.match(/<aside[^>]*>([\s\S]*?)<\/aside>/)![1]!;
    expect(browser).toContain('class="plugin-template-browser-header"');
    expect(browser).toContain('ZD News Shaders');
    expect(browser).toContain('aria-label="Find plugin template"');
    expect(browser).toContain('class="plugin-template-browser-content"');
    expect(browser.indexOf('ZD News Shaders')).toBeLessThan(browser.indexOf('Gradient Flow'));
    expect(detail).toContain('<h3>Shader Preview</h3>');
    expect(detail).toContain('aria-label="Selected shader"');
    expect(detail).not.toContain('ZD News Shaders');
    expect(detail).not.toContain('Find plugin template');
    expect(detail).not.toContain('Gradient Flow');
    expect(markup.match(/class="plugin-template-splitter"/g)).toHaveLength(1);
  });
  it('retains the browser header for gallery-only plugins without an empty right column', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginTemplateWorkspace, {
        browserHeader: createElement('button', null, 'Chart.js'),
        gallery: createElement('button', null, 'Bar chart'),
      }),
    );
    expect(markup).toContain('is-gallery-only');
    expect(markup).toContain('class="plugin-template-browser-header"');
    expect(markup).toContain('class="plugin-template-browser-content"');
    expect(markup.indexOf('Chart.js')).toBeLessThan(markup.indexOf('Bar chart'));
    expect(markup).not.toContain('<aside');
    expect(markup).not.toContain('role="separator"');
  });
});
