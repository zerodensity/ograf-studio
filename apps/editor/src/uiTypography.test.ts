import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Studio UI typography contract', () => {
  it('defines exactly two UI sizes and applies them to the full editor chrome', () => {
    const css = source('./index.css');
    const sizes = [...css.matchAll(/--ui-font-size(?:-compact)?:\s*([^;]+);/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(sizes).toEqual(['12px', '10px']);
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

  it('does not restyle editor font controls with template fonts', () => {
    const uiSources = source('./panels/InspectorPanel.tsx') + source('./panels/ResourcesPanel.tsx');

    expect(uiSources).not.toMatch(/style=\{\{[^}]*fontFamily/s);
    expect(uiSources).not.toMatch(/fontFamily:\s*(?:asset|layer\.element|option|selected)/);
  });
});
