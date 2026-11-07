import { describe, expect, it } from 'vitest';
import { filterPluginTemplates } from './pluginTemplateFilter';

describe('common plugin template search', () => {
  const items = [
    { id: 'blue-flow', name: 'Gradient Flow', description: 'A calm blue background' },
    { id: 'pulse', name: 'Pulse Pop', description: 'Overshoot and settle' },
    { id: 'horizontal-bar', name: 'Horizontal' },
  ];
  it('matches names, IDs and descriptions using all entered words', () => {
    expect(filterPluginTemplates(items, ' FLOW blue ')).toEqual([items[0]]);
    expect(filterPluginTemplates(items, 'bar')).toEqual([items[2]]);
    expect(filterPluginTemplates(items, 'settle pulse')).toEqual([items[1]]);
    expect(filterPluginTemplates(items, 'flow settle')).toEqual([]);
  });
  it('returns all templates for an empty query without changing items or order', () => {
    const before = JSON.stringify(items);
    expect(filterPluginTemplates(items, '  ')).toEqual(items);
    expect(filterPluginTemplates(items, 'pop')[0]).toBe(items[1]);
    expect(JSON.stringify(items)).toBe(before);
  });
});
