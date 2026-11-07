import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  createFieldDefinition,
  materializeLowerThird,
  migrateProject,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from '@ograf-editor/codegen';
import { createProjectSet, createProjectSetArchive, openProjectSetArchive } from './projectSet';
import { parseRundown, rundownRowData } from './testRundowns';
import { checkRundown } from './testRundownQa';
import { playRundown } from './rundownPlayback';

describe('authoring-only test rundowns', () => {
  it('parses quoted CSV, TSV and JSON using keys and normalized field labels', () => {
    const fields = [
      createFieldDefinition('text', { key: 'headline', label: 'Main Headline' }),
      createFieldDefinition('integer', { key: 'score', label: 'Score' }),
      createFieldDefinition('boolean', { key: 'live', label: 'Live' }),
    ];
    const csv = parseRundown('Main Headline,score,live\n"Ada, Jr",12,yes', fields);
    expect(csv[0]!.values).toEqual({
      [fields[0]!.id]: 'Ada, Jr',
      [fields[1]!.id]: 12,
      [fields[2]!.id]: true,
    });
    expect(parseRundown('headline\tscore\nResult\t5', fields)[0]!.values[fields[1]!.id]).toBe(5);
    expect(parseRundown('[{"headline":"Hello","score":3}]', fields)[0]!.values[fields[0]!.id]).toBe(
      'Hello',
    );
    expect(() => parseRundown('unknown\nvalue', fields)).toThrow('not a field');
    expect(() => parseRundown('score\nnot-a-number', fields)).toThrow('valid integer');
    expect(() => parseRundown('headline,headline\na,b', fields)).toThrow('Duplicate');
  });

  it('round-trips with standalone and set sources but does not alter exported artifacts', async () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    materializeLowerThird(composition);
    const field = composition.dataFields[0]!;
    const before = buildExportArtifactsWithRuntime(project, composition, '/* runtime */');
    composition.testRundowns = [
      {
        id: 'rundown',
        name: 'Evening',
        rows: [{ id: 'row', values: { [field.id]: 'DO NOT EXPORT THIS ROW' } }],
      },
    ];
    expect(
      migrateProject(JSON.parse(JSON.stringify(project))).compositions[0]!.testRundowns,
    ).toEqual(composition.testRundowns);
    const set = createProjectSet('Test set', project);
    const reopened = await openProjectSetArchive(
      new Uint8Array(await (await createProjectSetArchive(set)).arrayBuffer()),
    );
    expect(reopened.templates[0]!.project.compositions[0]!.testRundowns).toEqual(
      composition.testRundowns,
    );
    const after = buildExportArtifactsWithRuntime(project, composition, '/* runtime */');
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('DO NOT EXPORT THIS ROW');
    expect(
      rundownRowData(composition.dataFields, composition.testRundowns[0]!.rows[0]!)[field.key],
    ).toBe('DO NOT EXPORT THIS ROW');
  });

  it('rejects malformed saved rundown structures while accepting older projects without them', () => {
    const project = createProject();
    expect(migrateProject(project).compositions[0]!.testRundowns).toBeUndefined();
    project.compositions[0]!.testRundowns = [
      {
        id: 'a',
        name: 'Duplicate',
        rows: [
          { id: 'same', values: {} },
          { id: 'same', values: {} },
        ],
      },
    ];
    expect(() => migrateProject(project)).toThrow('duplicate row');
  });

  it('checks all 50 rows and identifies only the three long values', async () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const block = materializeLowerThird(composition);
    const field = composition.dataFields.find((item) => item.id === block.fields.headline)!;
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `row-${index}`,
      values: { [field.id]: [3, 18, 41].includes(index) ? 'X'.repeat(100) : `Name ${index}` },
    }));
    const measure = vi.fn(async ({ text }: { text?: string }) => ({
      overflowsParent: (text?.length ?? 0) > 80,
      clippedBy: null,
      degenerate: false,
      appliedFontSize: 40,
      width: 100,
      boxWidth: 100,
      height: 20,
      boxHeight: 20,
      lines: 1,
      appliedFitRatio: 1,
      appliedShrinkRatio: 1,
      clippedAt: null,
      frame: 0,
      layerId: '',
      layerName: '',
      text: text ?? '',
      resolvedFont: { requestedFamily: '', resolvedFamily: '', resolution: 'inferred' as const },
    }));
    const reports = await checkRundown(project, composition.id, rows, measure);
    expect(reports.filter((report) => report.issues.length).map((report) => report.rowId)).toEqual([
      'row-3',
      'row-18',
      'row-41',
    ]);
  });

  it('plays 50 rows through ordered prepare, Take, Updates and Out', async () => {
    const calls: string[] = [];
    const rows = Array.from({ length: 50 }, (_, index) => ({ headline: String(index) }));
    await playRundown(
      rows,
      {
        prepare: async (row) => {
          calls.push(`prepare:${row.headline}`);
        },
        take: async () => {
          calls.push('take');
        },
        update: async (row) => {
          calls.push(`update:${row.headline}`);
        },
        out: async () => {
          calls.push('out');
        },
      },
      { holdMs: 0, signal: new AbortController().signal, onRow: () => {} },
    );
    expect(calls).toHaveLength(52);
    expect(calls.slice(0, 3)).toEqual(['prepare:0', 'take', 'update:1']);
    expect(calls.slice(-2)).toEqual(['update:49', 'out']);
  });

  it('takes the preview out when playback is stopped after Take', async () => {
    const abort = new AbortController();
    const port = {
      prepare: vi.fn(async () => {}),
      take: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      out: vi.fn(async () => {}),
    };
    const result = playRundown([{ text: 'one' }, { text: 'two' }], port, {
      holdMs: 10000,
      signal: abort.signal,
      onRow: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(port.out).toHaveBeenCalledTimes(1);
    expect(port.update).not.toHaveBeenCalled();
  });
});
