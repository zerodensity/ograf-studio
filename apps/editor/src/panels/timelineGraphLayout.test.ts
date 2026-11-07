import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Timeline graph layout', () => {
  it('gives the graph the editor area and keeps channel and parameter scrolling independent', () => {
    const panel = source('./TimelinePanel.tsx');
    const timelineCss = source('./TimelinePanel.css');
    const graphCss = source('./AnimationGraphEditor.css');

    expect(panel).toContain("showAnimationGraph ? ' has-animation-graph' : ''");
    expect(panel).not.toContain('TimelineGraphDivider');
    expect(timelineCss).toMatch(
      /\.timeline-panel\.has-animation-graph \.timeline-content\s*\{[^}]*grid-template-rows:\s*42px minmax\(0, 1fr\);[^}]*height:\s*100%/s,
    );
    expect(timelineCss).toMatch(/\.timeline-key-editor\s*\{[^}]*grid-row:\s*1 \/ 3/s);
    expect(timelineCss).toMatch(
      /\.timeline-graph-view\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0/s,
    );
    expect(timelineCss).toMatch(
      /\.timeline-panel\.has-animation-graph \.timeline-gutter\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(timelineCss).toMatch(
      /\.timeline-key-editor\s*\{[^}]*position:\s*relative;[^}]*display:\s*block;[^}]*max-height:\s*100%/s,
    );
    expect(timelineCss).toMatch(
      /\.timeline-key-editor\[open\] > \.collapsible-section-content\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*var\(--ui-header-height\) 0 0;[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable/s,
    );
    expect(graphCss).toMatch(
      /\.animation-graph-editor\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0, 1fr\)/s,
    );
  });
});
