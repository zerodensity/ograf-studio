import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ unit: 'seconds' as 'seconds' | 'frames' | 'timecode' }));
vi.mock('../state/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      editorPreferences: { durationUnit: fixture.unit },
      updateEditorPreferences: vi.fn(),
    }),
}));

import { TimelineDisplayUnits } from './TimelineDisplayUnits';
import { nextTimelineDurationUnit } from './timelineDurationUnits';

describe('timeline duration display controls', () => {
  it.each([
    ['seconds', 's', 'Seconds', 'Frames'],
    ['frames', 'f', 'Frames', 'Timecode'],
    ['timecode', 'TC', 'Timecode', 'Seconds'],
  ] as const)(
    'renders a single button for the saved %s selection',
    (unit, short, current, next) => {
      fixture.unit = unit;
      const markup = renderToStaticMarkup(createElement(TimelineDisplayUnits));
      expect(markup.match(/<button\b/g)).toHaveLength(1);
      expect(markup).toContain('data-duration-unit-cycle');
      expect(markup).toContain('throughout Studio');
      expect(markup).toContain(`aria-label="Duration display: ${current}. Switch to ${next}."`);
      expect(markup).toContain(`>${short}</button>`);
    },
  );

  it('cycles seconds, frames and timecode in order', () => {
    expect(nextTimelineDurationUnit('seconds')).toBe('frames');
    expect(nextTimelineDurationUnit('frames')).toBe('timecode');
    expect(nextTimelineDurationUnit('timecode')).toBe('seconds');
  });
});
