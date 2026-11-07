import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Timeline toolbar grouping', () => {
  it('separates compact controls into understandable visual groups', () => {
    const panel = source('./TimelinePanel.tsx');
    const css = source('./TimelinePanel.css');

    expect(panel).toContain('timeline-playback-options');
    expect(panel).toContain('>Keys</span>');
    expect(panel).toContain('>Length</span>');
    expect(panel).toContain('>View</span>');
    expect(panel).toContain('>Transition</span>');
    expect(css).toMatch(
      /\.timeline-toolbar-section\s*\{[^}]*height:\s*26px;[^}]*display:\s*inline-flex;[^}]*border:\s*1px solid var\(--border\);[^}]*background:/s,
    );
    expect(css).toMatch(
      /\.timeline-toolbar-section-label\s*\{[^}]*font-size:\s*8px;[^}]*text-transform:\s*uppercase/s,
    );
  });
});
