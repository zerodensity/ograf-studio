import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Studio UI typography contract', () => {
  it('defines exactly two UI sizes and applies them to the full editor chrome', () => {
    const css = source('./index.css');
    const sizes = [...css.matchAll(/--ui-font-size(?:-compact)?:\s*([^;]+);/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(sizes).toEqual(['13px', '12px']);
    expect(css).toContain('#root * {');
    expect(css).toContain('font-family: var(--sans);');
    expect(css).toContain('font-size: var(--ui-font-size);');
    expect(css).toContain('font-size: var(--ui-font-size-compact);');
  });

  it('keeps editable controls on the UI family and size', () => {
    const css = source('./index.css');

    expect(css).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{/);
    expect(css).toMatch(
      /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-family: var\(--sans\);[^}]*font-size: var\(--ui-font-size\);/s,
    );
  });

  it('bundles the RealityHub Nunito UI face locally', () => {
    const main = source('./main.tsx');
    const css = source('./index.css');

    expect(main).toContain("import '@fontsource/nunito/latin-400.css';");
    expect(main).toContain("import '@fontsource/nunito/latin-ext-400.css';");
    expect(main).toContain("import '@fontsource/nunito/vietnamese-400.css';");
    expect(css).toMatch(/--sans:\s*\n?\s*'Nunito'/);
  });

  it('keeps the shared Zero Density surface and accent tokens centralized', () => {
    const css = source('./index.css');

    expect(css).toContain('--bg-header: #232323;');
    expect(css).toContain('--bg-panel: #2e2e2e;');
    expect(css).toContain('--text: #dadada;');
    expect(css).toContain('--text-dim: #aaa;');
    expect(css).toContain('--accent: #399ed4;');
    expect(css).toContain('--accent-focus: #60d0ff;');
    expect(css).toContain('--action: #26a69a;');
  });

  it('does not restyle editor font controls with template fonts', () => {
    const uiSources = source('./panels/InspectorPanel.tsx') + source('./panels/ResourcesPanel.tsx');

    expect(uiSources).not.toMatch(/style=\{\{[^}]*fontFamily/s);
    expect(uiSources).not.toMatch(/fontFamily:\s*(?:asset|layer\.element|option|selected)/);
  });
});
