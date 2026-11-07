import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DockPaneVisibilityProvider, useDockPaneVisible } from './PaneVisibilityContext';

function PreviewGate() {
  return createElement('span', null, useDockPaneVisible() ? 'preview-mounted' : 'preview-disposed');
}

describe('dock pane preview visibility', () => {
  it('preserves normal visibility outside a dock pane', () => {
    expect(renderToStaticMarkup(createElement(PreviewGate))).toContain('preview-mounted');
  });
  it.each([
    [false, false, 'preview-disposed'],
    [true, false, 'preview-mounted'],
    [false, true, 'preview-mounted'],
    [true, true, 'preview-mounted'],
  ] as const)('gates inactive/active/detached panes (%s, %s)', (active, detached, expected) => {
    const markup = renderToStaticMarkup(
      createElement(
        DockPaneVisibilityProvider,
        { visible: active || detached },
        createElement(PreviewGate),
      ),
    );
    expect(markup).toContain(expected);
  });
});
