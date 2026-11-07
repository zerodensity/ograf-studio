import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createChartElement } from '@ograf-editor/scene-model';
import { ChartEditor } from './ChartEditor';
import { PaintEditor } from './PaintEditor';

vi.mock('../layout/EditorWindow', () => ({
  useEditorWindow: () => ({ document: { body: {} } }),
  isSelectElement: () => false,
}));

describe('chart plugin editor', () => {
  it('offers the standard paint selector with a dataset-color reset and a provider capability gate', () => {
    const fillEditor = createElement(PaintEditor, {
      value: undefined,
      originalLabel: 'Dataset colors',
      onChange: () => {},
    });
    const markup = renderToStaticMarkup(
      createElement(ChartEditor, { element: createChartElement(), onChange: () => {}, fillEditor }),
    );
    expect(markup).toContain('Dataset colors');
    expect(markup).toContain('Linear gradient');
    expect(markup).toContain('Shader');
    expect(markup).toContain('Media');
    expect(markup).toContain('Choose a renderer supporting chart fills');
    expect(markup).toContain('class="chart-fill-editor" disabled=""');
    expect(markup).not.toContain('Chart bar gradient');
    expect(markup).not.toContain('Fragment source');
  });
  it('shows all nine selectable previews and direct data controls', () => {
    const markup = renderToStaticMarkup(
      createElement(ChartEditor, { element: createChartElement(), onChange: () => {} }),
    );
    expect(markup.match(/aria-pressed=/g)).toHaveLength(9);
    expect(markup).toContain('Chart type gallery');
    expect(markup).toContain('Horizontal');
    expect(markup).toContain('Doughnut');
    expect(markup).toContain('Polar area');
    expect(markup).toContain('Chart rows');
    expect(markup).toContain('Advanced · edit JSON');
    expect(markup).toContain('Choose chart renderer');
    expect(markup).toContain('Select an installed chart renderer');
    expect(markup).not.toContain('Built-in Chart.js');
  });
});
