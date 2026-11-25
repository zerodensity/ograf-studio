import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TemplateNavigatorPanel } from './TemplateNavigatorPanel';

vi.hoisted(() => {
  vi.stubGlobal('HTMLElement', class {});
});
vi.mock('../layout/EditorWindow', () => ({ useEditorWindow: () => ({ window: {} }) }));
afterAll(() => vi.unstubAllGlobals());

describe('Templates pane', () => {
  it('shows the standalone template card and keeps both ways to add another template', () => {
    const html = renderToStaticMarkup(createElement(TemplateNavigatorPanel));

    expect(html).toContain('class="template-card is-active"');
    expect(html).toContain('class="template-card-preview"');
    expect(html).toContain('conic-gradient');
    expect(html).toContain('class="template-card-caption" title="Untitled Template"');
    expect(html).toContain('aria-label="Refresh thumbnail for Untitled Template"');
    expect(html).toContain('New template…');
    expect(html).toContain('Add existing template…');
    expect(html).not.toContain('Remove template');
  });
});
