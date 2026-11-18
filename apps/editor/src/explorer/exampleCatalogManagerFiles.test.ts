import { describe, expect, it } from 'vitest';
import {
  loadExampleCatalogManager,
  saveExampleCatalogManager,
  type ExampleCatalogManagerSnapshot,
} from './exampleCatalogManagerFiles';
import { listExplorerItems } from './explorerItems';
import { parseExampleCatalog } from './exampleCatalog';

function fixture(featured: string[] | null = ['beta']) {
  const assets = {
    'alpha/alpha.ogs': 'opaque document bytes',
    'alpha/thumbnail.webp': 'opaque image bytes',
    'alpha/preview.mp4': 'opaque video bytes',
  };
  const metadata = {
    title: 'Alpha',
    summary: 'A starting point.',
    category: 'News',
    level: 'Basic',
    tags: ['Ticker'],
    author: 'Test Studio',
  };
  const dates = { released: '2026-01-01', updated: '2026-10-01' };
  const preview = { seconds: 3.5, actions: [{ at: 0.4, do: 'play' }] };
  const sources = {
    alpha: { ...metadata, ...dates, preview },
    beta: { ...metadata, title: 'Beta' },
    gamma: { ...metadata, title: 'Gamma', unlisted: true },
  };
  const examples = Object.entries(sources).map(([id, { ...details }]) => ({
    ...details,
    id,
    ...dates,
    file: `${id}/${id}.ogs`,
    bytes: 123,
    sha256: 'f'.repeat(64),
    thumbnail: `${id}/thumbnail.webp`,
    preview: `${id}/preview.mp4`,
    canvas: { width: 1280, height: 720, frameRate: 25 },
    templates: 2,
    fields: 4,
    documentVersion: 30,
  }));
  const initialCatalog = { version: 1, featured: featured ?? [], examples };
  const files = new Map<string, string>(Object.entries(assets));
  for (const [id, value] of Object.entries(sources))
    files.set(`${id}/example.json`, JSON.stringify(value));
  files.set('catalog.json', JSON.stringify(initialCatalog));
  if (featured) files.set('featured.json', JSON.stringify(featured));
  const writes: string[] = [];
  const fail = new Set<string>();
  const afterWrite: Array<(path: string) => void> = [];

  function folder(name: string, parent = ''): FileSystemDirectoryHandle {
    const prefix = parent + (parent || name !== 'examples' ? `${name}/` : '');
    return {
      name,
      async getDirectoryHandle(child: string) {
        return folder(child, prefix);
      },
      async getFileHandle(file: string, { create = false } = {}) {
        const path = prefix + file;
        if (!files.has(path)) {
          if (!create) throw new DOMException('Missing file', 'NotFoundError');
          files.set(path, '');
        }
        return {
          name: file,
          async getFile() {
            const text = files.get(path);
            if (text === undefined) throw new DOMException('Missing file', 'NotFoundError');
            return new File([text], file);
          },
          async createWritable() {
            let buffered = '';
            return {
              async write(contents: string) {
                buffered = contents;
              },
              async close() {
                if (fail.has(path)) throw new Error('Disk full');
                files.set(path, buffered);
                writes.push(path);
                for (const notify of afterWrite) notify(path);
              },
              async abort() {},
            };
          },
        };
      },
      async removeEntry(file: string) {
        files.delete(prefix + file);
      },
    } as FileSystemDirectoryHandle;
  }

  return {
    directory: folder('examples'),
    files,
    writes,
    fail,
    afterWrite,
    assets,
    initialCatalog,
    preview,
    read(path: string) {
      return JSON.parse(files.get(path)!);
    },
  };
}

function licensedDraft(snapshot: ExampleCatalogManagerSnapshot) {
  return snapshot.entries.map((entry) =>
    entry.id === 'alpha'
      ? {
          ...entry,
          details: {
            ...entry.details,
            title: 'Alpha Revised',
            license: {
              name: 'Example license',
              url: 'https://example.com/license',
              attribution: 'Example author',
            },
            credits: 'Typeface by the type designer.',
          },
        }
      : entry,
  );
}

describe('local example catalog manager', () => {
  it('saves details and drag order for the next browser session without rewriting media or preview instructions', async () => {
    const repository = fixture();
    const snapshot = await loadExampleCatalogManager(repository.directory);
    expect(snapshot.name).toBe('examples');
    expect(snapshot.order).toEqual(['beta', 'alpha', 'gamma']);
    expect(snapshot.entries.find(({ id }) => id === 'gamma')?.details.unlisted).toBe(true);

    const edits = licensedDraft(snapshot);
    const order = ['gamma', 'alpha', 'beta'];
    const saved = await saveExampleCatalogManager(snapshot, edits, order);
    expect(repository.writes).toEqual(['alpha/example.json', 'featured.json', 'catalog.json']);
    expect(repository.read('featured.json')).toEqual(order);
    expect(saved.order).toEqual(order);
    expect(saved.entries).toEqual(edits);
    expect(await loadExampleCatalogManager(repository.directory)).toEqual(saved);
    expect(repository.read('alpha/example.json')).toEqual({
      ...edits[0]!.details,
      unlisted: undefined,
      released: '2026-01-01',
      updated: '2026-10-01',
      preview: repository.preview,
    });
    const generated = repository.read('catalog.json');
    expect(generated.examples[0]).toEqual({
      ...repository.initialCatalog.examples[0],
      title: 'Alpha Revised',
      license: edits[0]!.details.license,
      credits: edits[0]!.details.credits,
    });
    expect(generated.examples.slice(1)).toEqual(repository.initialCatalog.examples.slice(1));
    for (const [path, value] of Object.entries(repository.assets))
      expect(repository.files.get(path)).toBe(value);
    const listing = listExplorerItems(
      parseExampleCatalog(generated, 'https://example.com/catalog.json', 'online'),
      { browse: 'examples', category: null, level: null, query: '' },
      'featured',
    );
    expect(listing.examples.map(({ id }) => id)).toEqual(['alpha', 'beta']);
    expect(listing.examples[0]?.license).toEqual(edits[0]!.details.license);
  });

  it('leaves the featured subset intact for a details-only save and clears removed optional details', async () => {
    const repository = fixture();
    const originalFeatured = repository.files.get('featured.json');
    const snapshot = await loadExampleCatalogManager(repository.directory);
    const saved = await saveExampleCatalogManager(
      snapshot,
      licensedDraft(snapshot),
      snapshot.order,
    );
    expect(repository.files.get('featured.json')).toBe(originalFeatured);

    const edits = structuredClone(saved.entries);
    delete edits[0]!.details.license;
    delete edits[0]!.details.credits;
    await saveExampleCatalogManager(saved, edits, saved.order);
    expect(repository.read('catalog.json').examples[0]).not.toHaveProperty('license');
    expect(repository.read('alpha/example.json')).not.toHaveProperty('credits');
    expect(repository.writes).not.toContain('featured.json');
  });

  it('rejects an unsafe license URL or incomplete ordering before generating any files', async () => {
    const repository = fixture();
    const snapshot = await loadExampleCatalogManager(repository.directory);
    const edits = licensedDraft(snapshot);
    edits[0]!.details.license!.url = 'javascript:alert(1)';
    await expect(saveExampleCatalogManager(snapshot, edits, snapshot.order)).rejects.toThrow(
      /license.*HTTPS/,
    );
    await expect(saveExampleCatalogManager(snapshot, snapshot.entries, ['beta'])).rejects.toThrow(
      'The example order must contain every example once.',
    );
    expect(repository.writes).toEqual([]);
  });

  it('detects changes to source files after opening the manager and writes nothing', async () => {
    const repository = fixture();
    const snapshot = await loadExampleCatalogManager(repository.directory);
    repository.files.set('beta/example.json', JSON.stringify({ title: 'External edit' }));
    await expect(
      saveExampleCatalogManager(snapshot, licensedDraft(snapshot), snapshot.order),
    ).rejects.toThrow('beta/example.json changed on disk.');
    expect(repository.writes).toEqual([]);
  });

  it('rolls back local source writes and removes a newly created order file if catalog save fails', async () => {
    const repository = fixture(null);
    const before = new Map(repository.files);
    const snapshot = await loadExampleCatalogManager(repository.directory);
    repository.fail.add('catalog.json');
    await expect(
      saveExampleCatalogManager(snapshot, licensedDraft(snapshot), [...snapshot.order].reverse()),
    ).rejects.toThrow('catalog.json: Disk full. Changes were restored.');
    expect(repository.files).toEqual(before);
    expect(repository.files.has('featured.json')).toBe(false);
  });

  it('keeps an external edit made during save and does not publish a stale catalog', async () => {
    const repository = fixture();
    const snapshot = await loadExampleCatalogManager(repository.directory);
    const originalAlpha = repository.files.get('alpha/example.json');
    const originalCatalog = repository.files.get('catalog.json');
    const externalEdit = JSON.stringify({
      ...repository.read('beta/example.json'),
      title: 'External edit',
    });
    repository.afterWrite.push((path) => {
      if (path === 'alpha/example.json') repository.files.set('beta/example.json', externalEdit);
    });
    await expect(
      saveExampleCatalogManager(snapshot, licensedDraft(snapshot), snapshot.order),
    ).rejects.toThrow('beta/example.json changed on disk.');
    expect(repository.files.get('alpha/example.json')).toBe(originalAlpha);
    expect(repository.files.get('beta/example.json')).toBe(externalEdit);
    expect(repository.files.get('catalog.json')).toBe(originalCatalog);
  });
});
