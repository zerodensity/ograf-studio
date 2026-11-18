/**
 * The example catalog is one generated JSON file that describes every downloadable example, so the
 * explorer can list, search and describe them from a single request. `scripts/buildExampleCatalog.ts`
 * writes it; this module is the only place Studio reads it.
 */

export const EXAMPLE_CATALOG_VERSION = 1;
export const EXAMPLE_LEVELS = ['Basic', 'Intermediate', 'Advanced'] as const;
export type ExampleLevel = (typeof EXAMPLE_LEVELS)[number];

/** Where an example's files come from: shipped with Studio, or downloaded from the examples repo. */
export type ExampleSource = 'builtin' | 'online';

export interface ExampleLicense {
  name: string;
  url?: string;
  attribution?: string;
}

export interface CatalogExample {
  id: string;
  title: string;
  summary: string;
  category: string;
  level: ExampleLevel;
  /** Studio features the example shows, such as "Shader" or "Live data". */
  tags: string[];
  author: string;
  license: ExampleLicense | null;
  credits: string | null;
  /** ISO dates (YYYY-MM-DD): first published, and last changed. */
  released: string;
  updated: string;
  /** In the repo and reachable by its link, but never shown in the explorer. */
  unlisted: boolean;
  fileUrl: string;
  bytes: number;
  sha256: string;
  thumbnailUrl: string;
  /** A short looping video shown while the pointer rests on the card. */
  previewUrl: string | null;
  canvas: { width: number; height: number; frameRate: number };
  templates: number;
  fields: number;
  /** The newest project document version inside the file; newer than Studio reads means "update". */
  documentVersion: number;
  pageUrl: string | null;
  source: ExampleSource;
}

export interface ExampleCatalog {
  /** Example IDs to show first, in this order. */
  featured: string[];
  examples: CatalogExample[];
}

export const EMPTY_EXAMPLE_CATALOG: ExampleCatalog = { featured: [], examples: [] };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(where: string, problem: string): never {
  throw new Error(`Example catalog: ${where} ${problem}.`);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'must be an object');
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(where, `must be text of 1 to ${max} characters`);
  return value;
}

function httpsUrl(value: unknown, where: string): string {
  const link = text(value, where, 512);
  if (!/^https:\/\//.test(link) || !URL.canParse(link)) fail(where, 'must be an HTTPS link');
  const url = new URL(link);
  if (url.username || url.password) fail(where, 'must not contain credentials');
  return link;
}

function parseExampleLicense(value: unknown, where: string): ExampleLicense | null {
  if (value === undefined) return null;
  const license = record(value, where);
  return {
    name: text(license.name, `${where}.name`, 120),
    ...(license.url === undefined ? {} : { url: httpsUrl(license.url, `${where}.url`) }),
    ...(license.attribution === undefined
      ? {}
      : { attribution: text(license.attribution, `${where}.attribution`, 1000) }),
  };
}

function positiveInteger(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    fail(where, 'must be a positive whole number');
  return value as number;
}

function count(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    fail(where, 'must be zero or a positive whole number');
  return value as number;
}

/** Files must sit beside the catalog, so a catalog can never point Studio at another host. */
function fileUrl(value: unknown, where: string, catalogUrl: URL): string {
  const path = text(value, where, 512);
  const folder = new URL('.', catalogUrl);
  let url: URL;
  try {
    url = new URL(path, folder);
  } catch {
    fail(where, 'must be a relative path');
  }
  if (url.origin !== folder.origin || !url.pathname.startsWith(folder.pathname) || url.search)
    fail(where, 'must be a path inside the catalog folder');
  return url.href;
}

function parseExample(
  value: unknown,
  index: number,
  catalogUrl: URL,
  source: ExampleSource,
): CatalogExample {
  const where = `examples[${index}]`;
  const entry = record(value, where);
  const id = text(entry.id, `${where}.id`, 80);
  if (!ID.test(id)) fail(`${where}.id`, 'must be lowercase words joined by hyphens');
  const level = entry.level as ExampleLevel;
  if (!EXAMPLE_LEVELS.includes(level))
    fail(`${where}.level`, `must be one of ${EXAMPLE_LEVELS.join(', ')}`);
  if (!Array.isArray(entry.tags) || entry.tags.length > 12)
    fail(`${where}.tags`, 'must be a list of at most 12 tags');
  const tags = entry.tags.map((tag, tagIndex) => text(tag, `${where}.tags[${tagIndex}]`, 40));
  for (const key of ['released', 'updated'] as const)
    if (typeof entry[key] !== 'string' || !DATE.test(entry[key]))
      fail(`${where}.${key}`, 'must be a date written as YYYY-MM-DD');
  if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256))
    fail(`${where}.sha256`, 'must be 64 lowercase hexadecimal digits');
  const canvas = record(entry.canvas, `${where}.canvas`);
  const frameRate = canvas.frameRate;
  if (typeof frameRate !== 'number' || !Number.isFinite(frameRate) || frameRate <= 0)
    fail(`${where}.canvas.frameRate`, 'must be a positive number');
  if (entry.unlisted !== undefined && typeof entry.unlisted !== 'boolean')
    fail(`${where}.unlisted`, 'must be true or false');
  const pageUrl = entry.page === undefined ? null : httpsUrl(entry.page, `${where}.page`);
  return {
    id,
    title: text(entry.title, `${where}.title`, 80),
    summary: text(entry.summary, `${where}.summary`, 300),
    category: text(entry.category, `${where}.category`, 40),
    level,
    tags,
    author: text(entry.author, `${where}.author`, 80),
    license: parseExampleLicense(entry.license, `${where}.license`),
    credits: entry.credits === undefined ? null : text(entry.credits, `${where}.credits`, 2000),
    released: entry.released as string,
    updated: entry.updated as string,
    unlisted: entry.unlisted === true,
    fileUrl: fileUrl(entry.file, `${where}.file`, catalogUrl),
    bytes: positiveInteger(entry.bytes, `${where}.bytes`),
    sha256: entry.sha256,
    thumbnailUrl: fileUrl(entry.thumbnail, `${where}.thumbnail`, catalogUrl),
    previewUrl:
      entry.preview === undefined ? null : fileUrl(entry.preview, `${where}.preview`, catalogUrl),
    canvas: {
      width: positiveInteger(canvas.width, `${where}.canvas.width`),
      height: positiveInteger(canvas.height, `${where}.canvas.height`),
      frameRate,
    },
    templates: positiveInteger(entry.templates, `${where}.templates`),
    fields: count(entry.fields, `${where}.fields`),
    documentVersion: positiveInteger(entry.documentVersion, `${where}.documentVersion`),
    pageUrl,
    source,
  };
}

/** Check the whole catalog once, where it enters Studio; one bad entry rejects the file. */
export function parseExampleCatalog(
  value: unknown,
  catalogUrl: string,
  source: ExampleSource,
): ExampleCatalog {
  const root = record(value, 'the file');
  if (root.version !== EXAMPLE_CATALOG_VERSION)
    fail('version', `must be ${EXAMPLE_CATALOG_VERSION}`);
  if (!Array.isArray(root.examples) || root.examples.length > 2000)
    fail('examples', 'must be a list of at most 2000 examples');
  const base = new URL(catalogUrl);
  const examples = root.examples.map((entry, index) => parseExample(entry, index, base, source));
  const ids = new Set<string>();
  for (const example of examples) {
    if (ids.has(example.id)) fail(`example "${example.id}"`, 'appears more than once');
    ids.add(example.id);
  }
  const featured = root.featured ?? [];
  if (!Array.isArray(featured) || featured.some((id) => typeof id !== 'string'))
    fail('featured', 'must be a list of example IDs');
  for (const id of featured as string[])
    if (!ids.has(id)) fail(`featured "${id}"`, 'is not an example in this catalog');
  return { featured: [...new Set(featured as string[])], examples };
}

/**
 * Prefer a newer online document, and use the online details for identical documents while keeping
 * the bundled files available offline. The online listing choice applies to either copy.
 */
export function mergeExampleCatalogs(
  builtin: ExampleCatalog,
  online: ExampleCatalog,
): ExampleCatalog {
  const byId = new Map(builtin.examples.map((example) => [example.id, example]));
  for (const example of online.examples) {
    const shipped = byId.get(example.id);
    if (!shipped || (example.sha256 !== shipped.sha256 && example.updated > shipped.updated)) {
      byId.set(example.id, example);
    } else if (example.sha256 === shipped.sha256) {
      byId.set(example.id, {
        ...example,
        fileUrl: shipped.fileUrl,
        thumbnailUrl: shipped.thumbnailUrl,
        previewUrl: shipped.previewUrl,
        source: 'builtin',
      });
    } else {
      byId.set(example.id, { ...shipped, unlisted: example.unlisted });
    }
  }
  return {
    featured: [...new Set([...online.featured, ...builtin.featured])],
    examples: [...byId.values()],
  };
}
