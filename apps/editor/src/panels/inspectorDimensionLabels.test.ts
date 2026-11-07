import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./InspectorPanel.tsx', import.meta.url), 'utf8');

describe('Inspector dimension labels', () => {
  it('uses complete Width and Height labels throughout the Properties pane', () => {
    expect(source).toContain("{ key: 'width', label: 'Width' }");
    expect(source).toContain("{ key: 'height', label: 'Height' }");
    expect(source).toContain('<span>ViewBox Width</span>');
    expect(source).toContain('<span>ViewBox Height</span>');
    expect(source).not.toContain("label: 'W'");
    expect(source).not.toContain("label: 'H'");
    expect(source).not.toContain('ViewBox W</span>');
    expect(source).not.toContain('ViewBox H</span>');
  });
});
