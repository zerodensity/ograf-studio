import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createProject,
  migrateProject,
  normalizeDataConnection,
} from '@ograf-editor/scene-model';
import {
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
} from './projectSet';
import { parseProjectSource } from './studioDocument';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const field = createFieldDefinition('text', { key: 'btcPrice' });
  composition.dataFields = [field];
  composition.dataConnections = [
    normalizeDataConnection({
      id: 'legacy-csv',
      name: 'Imported CSV',
      source: 'embedded',
      format: 'csv',
      embeddedText: 'btcPrice\n65000',
      mappings: [{ fieldId: field.id, sourcePath: 'btcPrice' }],
    }),
    normalizeDataConnection({
      id: 'legacy',
      name: 'Legacy JSON',
      source: 'url',
      url: 'https://example.com/quotes.json',
      refreshMs: 10000,
      mappings: [{ fieldId: field.id, sourcePath: 'quotes.btc' }],
    }),
    normalizeDataConnection({
      id: 'public',
      name: 'Public markets',
      source: 'public-markets',
      target: 'both',
      publicMarkets: { symbols: ['BTC-USD', 'ETH-USD'] },
      mappings: [{ fieldId: field.id, sourcePath: 'btcPrice' }],
    }),
  ];
  return project;
}

describe('persisted Studio data connections', () => {
  it('keeps legacy routing absent and native provider settings in standalone source', () => {
    const project = fixture();
    const restored = migrateProject(parseProjectSource(JSON.stringify(project)));
    expect(restored.compositions[0]!.dataConnections).toEqual(
      project.compositions[0]!.dataConnections,
    );
    expect(restored.compositions[0]!.dataConnections[0]!.target).toBeUndefined();
  });
  it.each(['compact', 'compatible'] as const)(
    'hydrates field mappings unchanged from %s .ogs',
    async (archiveMode) => {
      const project = fixture();
      const set = createProjectSet('Market set', project);
      const archive = await createProjectSetArchive(set, { archiveMode });
      const restored = await openProjectSetArchive(await archive.arrayBuffer());
      const child = resolveProjectSetTemplate(restored, restored.templates[0]!.id);
      expect(child.compositions[0]!.dataConnections).toEqual(
        project.compositions[0]!.dataConnections,
      );
      expect(child.compositions[0]!.dataFields[0]!.id).toBe(
        project.compositions[0]!.dataFields[0]!.id,
      );
    },
  );
});
