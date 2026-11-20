import { describe, expect, it } from 'vitest';
import { mergeExampleCatalogs, parseExampleCatalog, type ExampleCatalog } from './exampleCatalog';
import {
  explorerCategories,
  isNewExample,
  listExplorerItems,
  RECIPES,
  type ExplorerFilter,
} from './explorerItems';

const URL_ = 'https://examples.test/v1/catalog.json';

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    summary: `Summary of ${id}.`,
    category: 'Weather',
    level: 'Basic',
    tags: ['Shader'],
    author: 'Zero Density',
    released: '2026-10-01',
    updated: '2026-10-02',
    file: `${id}/${id}.ogs`,
    bytes: 1234,
    sha256: 'a'.repeat(64),
    thumbnail: `${id}/thumbnail.webp`,
    preview: `${id}/preview.mp4`,
    canvas: { width: 1920, height: 1080, frameRate: 50 },
    templates: 1,
    fields: 3,
    documentVersion: 37,
    ...overrides,
  };
}

function catalog(examples: unknown[], featured: string[] = []): ExampleCatalog {
  return parseExampleCatalog({ version: 1, featured, examples }, URL_, 'online');
}

const everything: ExplorerFilter = { browse: 'all', category: null, level: null, query: '' };

describe('parseExampleCatalog', () => {
  it('resolves files beside the catalog and keeps the source', () => {
    const [example] = catalog([entry('rain')]).examples;
    expect(example).toMatchObject({
      id: 'rain',
      fileUrl: 'https://examples.test/v1/rain/rain.ogs',
      thumbnailUrl: 'https://examples.test/v1/rain/thumbnail.webp',
      previewUrl: 'https://examples.test/v1/rain/preview.mp4',
      unlisted: false,
      pageUrl: null,
      license: null,
      credits: null,
      source: 'online',
    });
  });

  it('accepts an example without a preview video', () => {
    const { preview: _preview, ...withoutPreview } = entry('rain');
    expect(catalog([withoutPreview]).examples[0]!.previewUrl).toBeNull();
  });

  it('reads an example license separately from third-party credits', () => {
    const license = {
      name: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'Graphics by the example author.',
    };
    const [example] = catalog([
      entry('rain', { license, credits: 'Weather icons by the design team.' }),
    ]).examples;
    expect(example).toMatchObject({ license, credits: 'Weather icons by the design team.' });
  });

  it.each([
    ['another host', { file: 'https://elsewhere.test/rain.ogs' }, 'inside the catalog folder'],
    ['a parent folder', { thumbnail: '../secret.webp' }, 'inside the catalog folder'],
    ['an unknown level', { level: 'Expert' }, 'level'],
    ['a malformed date', { updated: '2 October' }, 'YYYY-MM-DD'],
    ['a short hash', { sha256: 'abc' }, 'sha256'],
    ['an insecure page link', { page: 'http://ografstudio.org/x' }, 'HTTPS'],
    ['a license without a name', { license: { attribution: 'Author' } }, 'license.name'],
    ['a script license link', { license: { name: 'Custom', url: 'javascript:void(0)' } }, 'HTTPS'],
  ])('rejects %s with a reason', (_name, overrides, reason) => {
    expect(() => catalog([entry('rain', overrides)])).toThrow(reason);
  });

  it('rejects a duplicate ID, an unknown featured ID and another catalog version', () => {
    expect(() => catalog([entry('rain'), entry('rain')])).toThrow('more than once');
    expect(() => catalog([entry('rain')], ['snow'])).toThrow('featured "snow"');
    expect(() => parseExampleCatalog({ version: 2, examples: [] }, URL_, 'online')).toThrow(
      'version',
    );
  });
});

describe('mergeExampleCatalogs', () => {
  it('prefers the online copy only once it is newer than the shipped one', () => {
    const shipped = parseExampleCatalog(
      { version: 1, examples: [entry('rain'), entry('snow')] },
      'http://localhost/explorer/catalog.json',
      'builtin',
    );
    const online = catalog(
      [
        entry('rain', { updated: '2026-11-01', sha256: 'b'.repeat(64) }),
        entry('snow'),
        entry('wind'),
      ],
      ['wind'],
    );
    const merged = mergeExampleCatalogs(shipped, online);
    const sources = Object.fromEntries(merged.examples.map((item) => [item.id, item.source]));
    expect(sources).toEqual({ rain: 'online', snow: 'builtin', wind: 'online' });
    expect(merged.featured).toEqual(['wind']);
  });

  it('updates details and visibility for identical bundled files without requiring a new date', () => {
    const url = 'http://localhost/explorer/catalog.json';
    const shipped = parseExampleCatalog({ version: 1, examples: [entry('rain')] }, url, 'builtin');
    const license = { name: 'Example license' };
    const online = catalog([entry('rain', { title: 'Rain', unlisted: true, license })]);
    const merged = mergeExampleCatalogs(shipped, online);
    expect(merged.examples[0]).toMatchObject({
      title: 'Rain',
      source: 'builtin',
      fileUrl: 'http://localhost/explorer/rain/rain.ogs',
      license,
      unlisted: true,
    });
    expect(listExplorerItems(merged, everything, 'featured').examples).toEqual([]);
  });
});

describe('listExplorerItems', () => {
  const examples = catalog(
    [
      entry('rain', { title: 'Rain', updated: '2026-10-05' }),
      entry('snow', { title: 'Snow', updated: '2026-11-01', level: 'Advanced' }),
      entry('wind', { title: 'Wind', updated: '2026-09-01', category: 'Finance' }),
      entry('hail', { title: 'Hail', unlisted: true }),
    ],
    ['wind'],
  );
  const ids = (sort: 'featured' | 'updated' | 'name', filter = everything) =>
    listExplorerItems(examples, filter, sort).examples.map((item) => item.id);

  it('never lists an unlisted example, even when the search names it', () => {
    expect(ids('name')).toEqual(['rain', 'snow', 'wind']);
    expect(ids('name', { ...everything, query: 'hail' })).toEqual([]);
  });

  it('puts featured examples first, then the latest updated', () => {
    expect(ids('featured')).toEqual(['wind', 'snow', 'rain']);
    expect(ids('updated')).toEqual(['snow', 'rain', 'wind']);
  });

  it('filters by section, category, level and every search word', () => {
    expect(
      listExplorerItems(examples, { ...everything, browse: 'examples' }, 'name').recipes,
    ).toEqual([]);
    expect(ids('name', { ...everything, browse: 'recipes' })).toEqual([]);
    expect(ids('name', { ...everything, category: 'Finance' })).toEqual(['wind']);
    expect(ids('name', { ...everything, level: 'Advanced' })).toEqual(['snow']);
    expect(ids('name', { ...everything, query: 'SHADER sno' })).toEqual(['snow']);
    const recipes = listExplorerItems(examples, { ...everything, query: 'ticker' }, 'featured');
    expect(recipes.recipes.map((item) => item.id)).toEqual(['recipe-ticker']);
  });

  it('counts listed examples and recipes per category', () => {
    const counts = Object.fromEntries(
      explorerCategories(examples).map(({ name, count }) => [name, count]),
    );
    expect(counts.Weather).toBe(2);
    expect(counts.Finance).toBe(1);
    expect(counts['Clocks & timers']).toBe(2);
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(RECIPES.length + 3);
  });
});

describe('isNewExample', () => {
  it('marks an example as new for thirty days after its release', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    expect(isNewExample({ released: '2026-11-13' }, now)).toBe(true);
    expect(isNewExample({ released: '2026-10-15' }, now)).toBe(true);
    expect(isNewExample({ released: '2026-10-13' }, now)).toBe(false);
    expect(isNewExample({ released: '2026-11-20' }, now)).toBe(false);
  });
});
