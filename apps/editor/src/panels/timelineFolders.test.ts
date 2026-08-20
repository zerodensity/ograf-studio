import { describe, expect, it } from 'vitest';
import { createLayerOfKind, type TimelineFolder } from '@ograf-editor/scene-model';
import { buildTimelineEntries } from './timelineFolders';

describe('timeline group row ordering', () => {
  it('groups rows without mutating layer paint order and collapses only the UI rows', () => {
    const back = { ...createLayerOfKind('rectangle'), id: 'back', name: 'Back' };
    const label = { ...createLayerOfKind('text'), id: 'label', name: 'Label' };
    const icon = { ...createLayerOfKind('ellipse'), id: 'icon', name: 'Icon' };
    const topToBottom = [icon, label, back];
    const folders: TimelineFolder[] = [
      { id: 'day', name: 'Day', color: '#7c6cff', layerIds: ['back', 'icon'] },
    ];

    const expanded = buildTimelineEntries(topToBottom, folders, new Set());
    expect(expanded.map((entry) => (entry.kind === 'folder' ? 'folder' : entry.layer.id))).toEqual([
      'folder',
      'icon',
      'back',
      'label',
    ]);
    expect(topToBottom.map((layer) => layer.id)).toEqual(['icon', 'label', 'back']);

    const collapsed = buildTimelineEntries(topToBottom, folders, new Set(['day']));
    expect(collapsed.map((entry) => (entry.kind === 'folder' ? 'folder' : entry.layer.id))).toEqual(
      ['folder', 'label'],
    );
  });
});
