import { describe, expect, it } from 'vitest';
import { timelineViewAfterSelectionChange, type TimelineViewSelection } from './timelineViewMode';

const selected: TimelineViewSelection = {
  contextId: 'project:composition',
  channelId: 'rectangle:x',
  animated: true,
};

describe('Timeline view retention', () => {
  it('keeps Graph when deleting keys, including the last key or clearing key selection', () => {
    expect(timelineViewAfterSelectionChange('graph', selected, selected)).toBe('graph');
    const empty = { ...selected, animated: false };
    expect(timelineViewAfterSelectionChange('graph', selected, empty)).toBe('graph');
    expect(timelineViewAfterSelectionChange('graph', selected, { ...empty, channelId: null })).toBe(
      'graph',
    );
    expect(timelineViewAfterSelectionChange('graph', empty, selected)).toBe('graph');
  });

  it('respects explicit Keys while editing or restoring the same channel', () => {
    expect(timelineViewAfterSelectionChange('keys', selected, selected)).toBe('keys');
    const empty = { ...selected, animated: false };
    expect(timelineViewAfterSelectionChange('keys', selected, empty)).toBe('keys');
    expect(timelineViewAfterSelectionChange('keys', empty, selected)).toBe('keys');
  });

  it('opens a different animated channel without forcing Keys for a static channel', () => {
    const other = { ...selected, channelId: 'rectangle:opacity' };
    expect(timelineViewAfterSelectionChange('keys', selected, other)).toBe('graph');
    expect(timelineViewAfterSelectionChange('graph', selected, { ...other, animated: false })).toBe(
      'graph',
    );
  });

  it('uses the new document selection when changing projects or compositions', () => {
    const other = { ...selected, contextId: 'another-project:composition' };
    expect(timelineViewAfterSelectionChange('keys', selected, other)).toBe('graph');
    expect(timelineViewAfterSelectionChange('graph', selected, { ...other, animated: false })).toBe(
      'keys',
    );
  });
});
