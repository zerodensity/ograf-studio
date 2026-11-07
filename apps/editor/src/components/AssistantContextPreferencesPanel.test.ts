import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeAssistantContextPreferences } from '../state/workspaceModel';
import { AssistantContextPreferencesForm } from './AssistantContextPreferencesPanel';

describe('Studio assistant preferences form', () => {
  it('shows automatic planning and explicit scope for an older/default profile', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantContextPreferencesForm, {
        value: normalizeAssistantContextPreferences(null),
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain('AI assistant context preferences');
    expect(html.match(/Automatic/g)).toHaveLength(4);
    expect(html).not.toContain('type="number"');
    expect(html).toContain('estimated fallback');
    expect(html).toContain('External MCP clients');
    expect(html).toContain('not included in templates or exports');
  });

  it('renders custom token limits as checked options with accessible numeric controls', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantContextPreferencesForm, {
        value: { contextWindowTokens: 131_072, maxHistoryTokens: null, maxToolResultTokens: 2048 },
        onChange: vi.fn(),
      }),
    );
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Override model context window tokens"');
    expect(html).toContain('value="131072"');
    expect(html).toContain('aria-label="Limit tool result page tokens"');
    expect(html).toContain('value="2048"');
    expect(html).not.toContain('aria-label="Limit conversation context tokens"');
  });
});
