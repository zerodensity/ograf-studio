import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('RealityHub-style configuration panes', () => {
  it('uses one section-bar and two-column row contract in Properties', () => {
    const css = source('./panels/InspectorPanel.css');

    expect(css).toMatch(/\.inspector-section\s*\{[^}]*background: #252525;/s);
    expect(css).toMatch(
      /\.inspector-row,\s*\.inspector-row-stacked\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(118px, 42%\) minmax\(0, 1fr\);/s,
    );
    expect(css).toMatch(/\.inspector-grid,[^{]+\{\s*display: contents;/s);
  });

  it('uses the same label/value columns for Data and Preview overrides', () => {
    const dataCss = source('./panels/DataPanel.css');
    const previewCss = source('./panels/PreviewExportPanel.css');
    const columns = /grid-template-columns: minmax\(118px, 42%\) minmax\(0, 1fr\);/;

    expect(dataCss).toMatch(columns);
    expect(previewCss).toMatch(columns);
  });
});
