import { describe, expect, it } from 'vitest';
import { createFieldDefinition } from '@ograf-editor/scene-model';
import { mapConnectionPayload, parseConnectionPayload } from './dataConnections';

const connection = {
  id: 'feed',
  name: 'Feed',
  format: 'json' as const,
  source: 'embedded' as const,
  url: '',
  embeddedText: '',
  refreshMs: 0,
  missing: 'default' as const,
  enabled: true,
  mappings: [] as Array<{ fieldId: string; sourcePath: string }>,
};

describe('data connections', () => {
  it('parses JSON and quoted CSV rows', () => {
    expect(parseConnectionPayload('json', '{"score":2}')).toEqual({ score: 2 });
    expect(parseConnectionPayload('csv', 'name,score\n"Ada, Jr",4')).toEqual({
      name: 'Ada, Jr',
      score: '4',
    });
  });

  it('maps nested values and applies missing-data policy', () => {
    const name = createFieldDefinition('text', {
      id: 'name',
      key: 'name',
      defaultValue: 'Unknown',
    });
    const score = createFieldDefinition('integer', { id: 'score', key: 'score', defaultValue: 0 });
    const mapped = mapConnectionPayload(
      {
        ...connection,
        mappings: [
          { fieldId: 'name', sourcePath: 'athlete.name' },
          { fieldId: 'score', sourcePath: 'score' },
        ],
      },
      [name, score],
      { athlete: { name: 'Ada' }, score: '3' },
    );
    expect(mapped).toEqual({ name: 'Ada', score: 3 });
    expect(
      mapConnectionPayload(
        {
          ...connection,
          missing: 'keep-last',
          mappings: [{ fieldId: 'score', sourcePath: 'missing' }],
        },
        [score],
        {},
        { score: 7 },
      ),
    ).toEqual({ score: 7 });
  });
});
