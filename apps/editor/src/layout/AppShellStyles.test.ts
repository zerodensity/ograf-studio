import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function layer(path: string, selector: string): number {
  const css = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = css.indexOf(`${selector} {`);
  const rule = css.slice(start, css.indexOf('}', start));
  const value = /z-index:\s*(\d+)\s*;/.exec(rule);
  if (start < 0 || !value) throw new Error(`Missing stacking layer for ${selector}.`);
  return Number(value[1]);
}

describe('application menu stacking', () => {
  it('keeps the menubar ancestor above workspace controls but below higher overlays', () => {
    const menu = layer('./AppShell.css', '.app-shell > .menubar');
    expect(menu).toBeGreaterThan(layer('./ResizeHandle.css', '.resize-handle'));
    expect(menu).toBeGreaterThan(layer('./DockWorkspace.css', '.dock-floating-pane'));
    expect(menu).toBeGreaterThan(layer('./DockWorkspace.css', '.dock-hints'));
    expect(menu).toBeLessThan(
      layer('../panels/AnimationPresetGallery.css', '.animation-preset-picker'),
    );
    expect(menu).toBeLessThan(
      layer('../components/ConfigurationDialog.css', '.configuration-backdrop'),
    );
    expect(menu).toBeLessThan(
      layer('../components/ConfigurationDialog.css', '.configuration-subdialog-backdrop'),
    );
    expect(menu).toBeLessThan(
      layer('../components/TemplateSaveDialog.css', '.template-save-backdrop'),
    );
  });
});
