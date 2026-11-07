import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PluginLoadWarning } from '../state/pluginLoadWarnings';

vi.mock('./useMovableDialog', () => ({
  useMovableDialog: () => ({ dialogProps: {}, handleProps: {} }),
}));

import { PluginLoadWarningDialog } from './PluginLoadWarningDialog';

const warning: PluginLoadWarning = {
  key: 'template-a:chart',
  templateId: 'template-a',
  templateName: 'A20 — Win Probability',
  projectId: 'project-a',
  reference: { id: 'chart.test', version: '1.3.1', sha256: 'a'.repeat(64) },
  replacement: { id: 'chart.test', version: '1.3.1', sha256: 'b'.repeat(64) },
  pluginName: 'Chart.js renderer',
  reason: 'not-installed',
  objects: 1,
  componentObjects: 0,
  replacementErrors: [],
};

function render(row = warning, active = true) {
  const actions = {
    onClose: vi.fn(),
    onReview: vi.fn(),
    onUseInstalled: vi.fn(),
    onEnableSaved: vi.fn(),
    onOpenTemplate: vi.fn(),
  };
  return {
    actions,
    html: renderToStaticMarkup(
      createElement(PluginLoadWarningDialog, {
        warnings: [row],
        documentName: 'NFL Review Set',
        isActive: () => active,
        error: '',
        owner: {} as Window,
        ...actions,
      }),
    ),
  };
}

describe('plugin load warning dialog', () => {
  it('makes the blocked template and exact same-version build difference explicit without applying it', () => {
    const { html, actions } = render();
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Plugin mismatch — charts unavailable');
    expect(html).toContain('NFL Review Set');
    expect(html).toContain('A20 — Win Probability');
    expect(html).toContain('The version numbers match, but these are different renderer builds.');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('b'.repeat(64));
    expect(html).toContain('Installed, enabled and trusted');
    expect(html).toContain('Use installed renderer');
    expect(actions.onUseInstalled).not.toHaveBeenCalled();
    expect(actions.onEnableSaved).not.toHaveBeenCalled();
  });

  it('requires opening an inactive affected template before offering its source migration', () => {
    const { html } = render(warning, false);
    expect(html).toContain('Open affected template');
    expect(html).not.toContain('>Use installed renderer<');
    expect(html).toContain('Review plugin settings…');
  });

  it('routes unfamiliar code to review without offering trust or automatic enablement', () => {
    const { html, actions } = render({ ...warning, reason: 'untrusted', replacement: null });
    expect(html).toContain('has not been trusted in Studio');
    expect(html).toContain('Review plugin settings…');
    expect(html).not.toContain('>Use installed renderer<');
    expect(html).not.toContain('>Enable saved renderer<');
    expect(html).not.toContain('>Trust &amp; Install<');
    expect(actions.onReview).not.toHaveBeenCalled();
  });

  it('offers enablement separately from a renderer migration for a trusted disabled build', () => {
    const { html } = render({ ...warning, reason: 'disabled', replacement: null });
    expect(html).toContain('The saved renderer is disabled in Studio.');
    expect(html).toContain('>Enable saved renderer<');
  });
});
