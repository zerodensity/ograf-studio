import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { getExportProfile, projectForExportProfile } from './exportProfiles';

describe('export profiles', () => {
  it.each([
    ['realtime', true, false, '-rt'],
    ['non-realtime', false, true, '-nrt'],
    ['dual', true, true, ''],
  ] as const)('derives %s output without mutating source', (id, realtime, nonRealtime, suffix) => {
    const source = createProject({
      id: 'news',
      supportsRealTime: false,
      supportsNonRealTime: true,
    });
    const output = projectForExportProfile(source, getExportProfile(id));
    expect(output).not.toBe(source);
    expect(output.id).toBe(`news${suffix}`);
    expect(output.supportsRealTime).toBe(realtime);
    expect(output.supportsNonRealTime).toBe(nonRealtime);
    expect(source).toMatchObject({
      id: 'news',
      supportsRealTime: false,
      supportsNonRealTime: true,
    });
  });
});
