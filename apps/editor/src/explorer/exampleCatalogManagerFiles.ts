import {
  parseExampleCatalog,
  type CatalogExample,
  type ExampleLevel,
  type ExampleLicense,
} from './exampleCatalog';
import { sortExamples } from './explorerItems';

export interface EditableExampleDetails {
  title: string;
  summary: string;
  category: string;
  level: ExampleLevel;
  tags: string[];
  author: string;
  page?: string;
  unlisted: boolean;
  license?: ExampleLicense;
  credits?: string;
}

export interface EditableExampleEntry {
  id: string;
  details: EditableExampleDetails;
}

export interface ExampleCatalogManagerSnapshot {
  name: string;
  entries: EditableExampleEntry[];
  order: string[];
}

type JsonObject = Record<string, unknown>;

interface CatalogFile {
  directory: FileSystemDirectoryHandle;
  name: string;
  label: string;
  original: string | null;
}

interface DraftCatalog {
  directory: FileSystemDirectoryHandle;
  generated: JsonObject;
  generatedFile: CatalogFile;
  featured: string[];
  featuredFile: CatalogFile;
  order: string[];
  sources: Map<string, { file: CatalogFile; value: JsonObject; details: EditableExampleDetails }>;
  saving: boolean;
}

interface FileChange {
  file: CatalogFile;
  contents: string;
}

const EDITABLE_FIELDS = [
  'title',
  'summary',
  'category',
  'level',
  'tags',
  'author',
  'page',
  'unlisted',
  'license',
  'credits',
] as const satisfies readonly (keyof EditableExampleDetails)[];

const VALIDATION_URL = 'https://catalog.invalid/examples/catalog.json';
const drafts = new WeakMap<ExampleCatalogManagerSnapshot, DraftCatalog>();

function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must contain a JSON object.`);
  return value as JsonObject;
}

function parseJson(contents: string, label: string): unknown {
  try {
    return JSON.parse(contents) as unknown;
  } catch (cause) {
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function readText({ directory, name }: CatalogFile): Promise<string | null> {
  let handle: FileSystemFileHandle;
  try {
    handle = await directory.getFileHandle(name);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'NotFoundError') return null;
    throw cause;
  }
  return (await handle.getFile()).text();
}

async function readFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  label = name,
): Promise<CatalogFile> {
  const file: CatalogFile = { directory, name, label, original: null };
  try {
    file.original = await readText(file);
    return file;
  } catch (cause) {
    throw new Error(`Could not read ${label}: ${errorMessage(cause)}`, { cause });
  }
}

function requireContents(file: CatalogFile): string {
  if (file.original === null) throw new Error(`Missing ${file.label} in the selected folder.`);
  return file.original;
}

function editableDetails(example: CatalogExample): EditableExampleDetails {
  return {
    title: example.title,
    summary: example.summary,
    category: example.category,
    level: example.level,
    tags: example.tags,
    author: example.author,
    page: example.pageUrl ?? undefined,
    unlisted: example.unlisted,
    license: example.license ?? undefined,
    credits: example.credits ?? undefined,
  };
}

function projectMetadata(generated: JsonObject, source: JsonObject): JsonObject {
  const result = { ...generated };
  for (const field of EDITABLE_FIELDS) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
    else delete result[field];
  }
  // The generator uses the document history only when a source file omits its dates.
  for (const field of ['released', 'updated']) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

function withEditedDetails(
  original: JsonObject,
  previous: EditableExampleDetails,
  edited: EditableExampleDetails,
): JsonObject {
  const next = { ...original };
  for (const field of EDITABLE_FIELDS) {
    if (sameValue(edited[field], previous[field])) continue;
    const value = edited[field];
    if (value === undefined || (field === 'unlisted' && value === false)) delete next[field];
    else next[field] = value;
  }
  return next;
}

/** Open generated examples and their editable source files from one local checkout. */
export async function loadExampleCatalogManager(
  directory: FileSystemDirectoryHandle,
): Promise<ExampleCatalogManagerSnapshot> {
  const [generatedFile, featuredFile] = await Promise.all([
    readFile(directory, 'catalog.json'),
    readFile(directory, 'featured.json'),
  ]);
  const generated = jsonObject(
    parseJson(requireContents(generatedFile), generatedFile.label),
    generatedFile.label,
  );
  const catalog = parseExampleCatalog(generated, VALIDATION_URL, 'online');
  const rawEntries = generated.examples as JsonObject[];
  const featured =
    featuredFile.original === null ? [] : parseJson(featuredFile.original, featuredFile.label);
  if (!Array.isArray(featured))
    throw new Error('featured.json must contain a list of example IDs.');

  const sourceFiles = await Promise.all(
    catalog.examples.map(async ({ id }) => {
      let exampleDirectory: FileSystemDirectoryHandle;
      try {
        exampleDirectory = await directory.getDirectoryHandle(id);
      } catch (cause) {
        throw new Error(`Could not open the example folder "${id}": ${errorMessage(cause)}`, {
          cause,
        });
      }
      const file = await readFile(exampleDirectory, 'example.json', `${id}/example.json`);
      const value = jsonObject(parseJson(requireContents(file), file.label), file.label);
      return { file, value };
    }),
  );
  const localCatalog = parseExampleCatalog(
    {
      ...generated,
      featured,
      examples: rawEntries.map((entry, index) => projectMetadata(entry, sourceFiles[index]!.value)),
    },
    VALIDATION_URL,
    'online',
  );
  const entries = localCatalog.examples.map((example) => ({
    id: example.id,
    details: editableDetails(example),
  }));
  const order = sortExamples(localCatalog.examples, localCatalog.featured, 'featured').map(
    ({ id }) => id,
  );
  const snapshot = { name: directory.name, entries: structuredClone(entries), order: [...order] };
  drafts.set(snapshot, {
    directory,
    generated,
    generatedFile,
    featured: localCatalog.featured,
    featuredFile,
    order,
    sources: new Map(
      entries.map(({ id, details }, index) => [id, { ...sourceFiles[index]!, details }]),
    ),
    saving: false,
  });
  return snapshot;
}

function verifyIds(ids: string[], draft: DraftCatalog, label: string): void {
  if (
    ids.length !== draft.sources.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !draft.sources.has(id))
  )
    throw new Error(
      `${label} must contain every example once. Reopen the local catalog and retry.`,
    );
}

function buildChanges(
  draft: DraftCatalog,
  entries: EditableExampleEntry[],
  order: string[],
): FileChange[] {
  verifyIds(
    entries.map(({ id }) => id),
    draft,
    'The details list',
  );
  verifyIds(order, draft, 'The example order');
  const changes: FileChange[] = [];
  const nextSources = new Map<string, JsonObject>();
  for (const { id, details } of entries) {
    const { details: previous, file, value } = draft.sources.get(id)!;
    const next = withEditedDetails(value, previous, details);
    nextSources.set(id, next);
    if (!sameValue(next, value)) changes.push({ file, contents: serialize(next) });
  }
  const reorder = !sameValue(order, draft.order);
  if (reorder) changes.push({ file: draft.featuredFile, contents: serialize(order) });

  const nextCatalog = {
    ...draft.generated,
    featured: reorder ? order : draft.featured,
    examples: (draft.generated.examples as Array<JsonObject & { id: string }>).map((example) =>
      projectMetadata(example, nextSources.get(example.id)!),
    ),
  };
  parseExampleCatalog(nextCatalog, VALIDATION_URL, 'online');
  if (!sameValue(nextCatalog, draft.generated))
    changes.push({ file: draft.generatedFile, contents: serialize(nextCatalog) });
  return changes;
}

async function ensureContents(file: CatalogFile, expected: string | null): Promise<void> {
  if ((await readText(file)) !== expected)
    throw new Error(`${file.label} changed on disk. Reopen the local catalog before saving.`);
}

async function writeText(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writer = await handle.createWritable();
  try {
    await writer.write(contents);
    await writer.close();
  } catch (cause) {
    await writer.abort().catch(() => undefined);
    throw cause;
  }
}

async function rollback(
  attempted: Array<FileChange & { handle: FileSystemFileHandle }>,
): Promise<string[]> {
  const unresolved: string[] = [];
  for (const { file, handle, contents } of attempted.reverse()) {
    try {
      const current = await readText(file);
      if (current === file.original) continue;
      // Never undo a separate edit made while the save was in progress.
      if (current !== contents && !(file.original === null && current === '')) {
        unresolved.push(file.label);
      } else if (file.original === null) {
        await file.directory.removeEntry(file.name);
      } else {
        await writeText(handle, file.original);
      }
    } catch {
      unresolved.push(file.label);
    }
  }
  return unresolved;
}

/** Save source edits first and publish the regenerated local catalog only after they succeed. */
export async function saveExampleCatalogManager(
  snapshot: ExampleCatalogManagerSnapshot,
  entries: EditableExampleEntry[],
  order: string[],
): Promise<ExampleCatalogManagerSnapshot> {
  const draft = drafts.get(snapshot);
  if (!draft) throw new Error('Reopen the local catalog before saving.');
  if (draft.saving) throw new Error('A catalog save is already in progress.');
  const changes = buildChanges(draft, entries, order);
  if (!changes.length) return snapshot;

  draft.saving = true;
  const attempted: Array<FileChange & { handle: FileSystemFileHandle }> = [];
  const written = new Map<CatalogFile, string>();
  const sourceFiles = [
    draft.featuredFile,
    ...Array.from(draft.sources.values(), ({ file }) => file),
  ];
  try {
    await Promise.all(
      [draft.generatedFile, ...sourceFiles].map((file) => ensureContents(file, file.original)),
    );
    try {
      for (const change of changes) {
        const { file, contents } = change;
        if (file === draft.generatedFile) {
          await Promise.all(
            sourceFiles.map((source) =>
              ensureContents(source, written.get(source) ?? source.original),
            ),
          );
        }
        await ensureContents(file, file.original);
        try {
          const handle = await file.directory.getFileHandle(file.name, {
            create: file.original === null,
          });
          attempted.push({ ...change, handle });
          await writeText(handle, contents);
          written.set(file, contents);
          await ensureContents(file, contents);
        } catch (cause) {
          throw new Error(`${file.label}: ${errorMessage(cause)}`, { cause });
        }
      }
    } catch (cause) {
      const unresolved = await rollback(attempted);
      if (unresolved.length) {
        drafts.delete(snapshot);
        throw new Error(
          `Could not save the catalog: ${errorMessage(cause)}. Inspect ${unresolved.join(', ')} before reopening the catalog.`,
          { cause },
        );
      }
      throw new Error(
        `Could not save the catalog: ${errorMessage(cause)}. Changes were restored.`,
        {
          cause,
        },
      );
    }
    drafts.delete(snapshot);
    try {
      return await loadExampleCatalogManager(draft.directory);
    } catch (cause) {
      throw new Error(
        `Changes were saved, but the catalog could not be reopened: ${errorMessage(cause)}`,
        {
          cause,
        },
      );
    }
  } finally {
    draft.saving = false;
  }
}
