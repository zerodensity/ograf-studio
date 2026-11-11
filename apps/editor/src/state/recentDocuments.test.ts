import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import {
  createRecentDocumentsHistory,
  readRecentDocument,
  sortedRecentDocuments,
  updatedRecentDocuments,
  type RecentDocument,
  type RecentDocumentsStorage,
} from './recentDocuments';
import { createProjectSet, createProjectSetArchive } from './projectSet';

afterEach(() => vi.unstubAllGlobals());

function backend(seed: RecentDocument[] = []) {
  let records = [...seed];
  const storage: RecentDocumentsStorage = {
    read: vi.fn(async () => [...records]),
    commit: vi.fn(async (record) => {
      records = updatedRecentDocuments(records, record);
    }),
  };
  let nextId = 0;
  const options = { now: () => 100, id: () => `record-${++nextId}` };
  return {
    storage,
    options,
    rows: () => records,
    history: createRecentDocumentsHistory(storage, options),
  };
}

function handle(
  key: string,
  name = `${key}.ogs`,
  file = new Blob([JSON.stringify(createProject())]),
) {
  return {
    name,
    kind: 'file',
    key,
    getFile: vi.fn(async () => file),
    isSameEntry: vi.fn(async (other: { key: string }) => key === other.key),
  } as unknown as FileSystemFileHandle;
}

describe('recent Studio document history', () => {
  it('keeps only ten newest entries across reopening the history store', async () => {
    const { history, storage, options, rows } = backend();
    for (let index = 1; index <= 12; index++) await history.rememberHandle(handle(`file-${index}`));
    expect(rows()).toHaveLength(10);
    const reopened = createRecentDocumentsHistory(storage, options);
    expect((await reopened.list()).map((item) => item.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `file-${12 - index}.ogs`),
    );
    expect(rows().every((item) => !('bytes' in item) && !('project' in item))).toBe(true);
  });

  it('deduplicates the same physical file while retaining distinct files with identical names', async () => {
    const { history } = backend();
    await history.rememberHandle(handle('first-path', 'News.ogs'));
    const originalId = (await history.list())[0]!.id;
    await history.rememberHandle(handle('second-path', 'News.ogs'));
    await history.rememberHandle(handle('first-path', 'Renamed.ogs'));
    const records = await history.list();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ id: originalId, name: 'Renamed.ogs' });
    expect(records[1]!.name).toBe('News.ogs');
  });

  it('prunes hidden old rows left by earlier history limits and can reopen one by its exact handle', async () => {
    const seed = Array.from({ length: 30 }, (_, index) => ({
      id: `old-${index}`,
      name: `${index}.ogs`,
      openedAt: index,
      handle: handle(String(index)),
    }));
    const { history, rows } = backend(seed);
    await history.rememberHandle(handle('0'));
    expect(rows()).toHaveLength(10);
    expect((await history.list())[0]!.id).toBe('old-0');
    expect(rows().map((item) => item.id)).not.toContain('old-1');
  });

  it('serializes rapid opens and treats URL fragments as the same document while preserving query identity', async () => {
    const { history } = backend();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        history.rememberUrl(`https://example.test/${index}.ogs`, `${index}`),
      ),
    );
    expect((await history.list())[0]!.name).toBe('11');
    const id = (await history.list())[0]!.id;
    await history.rememberUrl('https://example.test/11.ogs#section', 'New label');
    expect((await history.list())[0]).toMatchObject({
      id,
      name: 'New label',
      url: 'https://example.test/11.ogs',
    });
    await history.rememberUrl('https://example.test/11.ogs?edition=2', 'Other edition');
    expect((await history.list()).filter((item) => item.url?.includes('/11.ogs'))).toHaveLength(2);
    expect(await history.list()).toHaveLength(10);
  });

  it('does not let an inaccessible old handle or one failed write poison later history', async () => {
    const oldHandle = handle('old');
    vi.mocked(oldHandle.isSameEntry).mockRejectedValue(
      new DOMException('Unavailable', 'NotFoundError'),
    );
    const { history, storage } = backend([
      { id: 'old', name: 'old.ogs', openedAt: 1, handle: oldHandle },
    ]);
    vi.mocked(storage.commit).mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(history.rememberHandle(handle('new'))).rejects.toThrow('Database unavailable');
    await history.rememberHandle(handle('next'));
    expect((await history.list())[0]!.name).toBe('next.ogs');
  });

  it('does not retain unsupported sources or embedded URL credentials', async () => {
    const { history } = backend();
    await expect(history.rememberUrl('file:///C:/News.ogs', 'News')).rejects.toThrow('HTTP(S)');
    await expect(
      history.rememberUrl('https://user:secret@example.test/news.ogs', 'News'),
    ).rejects.toThrow('credentials');
    expect(sortedRecentDocuments([{ id: 'invalid', name: 'invalid', openedAt: 2 }])).toEqual([]);
    expect(await history.list()).toEqual([]);
  });
});

describe('reading a recent document', () => {
  it('requests file permission in the initiating gesture and reads the current file bytes', async () => {
    const project = createProject({ name: 'Latest file contents' });
    const retained = handle('News', 'News.ogs', new Blob([JSON.stringify(project)]));
    retained.requestPermission = vi.fn(async (): Promise<PermissionState> => 'granted');
    const pending = readRecentDocument({
      id: 'file',
      name: 'Old file label',
      openedAt: 1,
      handle: retained,
    });
    expect(retained.requestPermission).toHaveBeenCalledExactlyOnceWith({ mode: 'read' });
    expect(retained.getFile).not.toHaveBeenCalled();
    await expect(pending).resolves.toEqual({ kind: 'template', project });
  });

  it('rejects revoked permissions or missing handles without reading document data', async () => {
    const retained = handle('News');
    retained.requestPermission = vi.fn(async (): Promise<PermissionState> => 'denied');
    await expect(
      readRecentDocument({ id: 'file', name: 'News', openedAt: 1, handle: retained }),
    ).rejects.toThrow('File access was not granted');
    expect(retained.getFile).not.toHaveBeenCalled();
    await expect(readRecentDocument({ id: 'file', name: 'News', openedAt: 1 })).rejects.toThrow(
      'select it again',
    );
  });

  it('sniffs a complete template set rather than treating it as a standalone template', async () => {
    const archive = await createProjectSetArchive(
      createProjectSet('News set', createProject({ name: 'Headline' })),
    );
    const document = await readRecentDocument({
      id: 'set',
      name: 'News.ogs',
      openedAt: 1,
      handle: handle('set', 'News.ogs', archive),
    });
    expect(document.kind).toBe('template-set');
    if (document.kind !== 'template-set') throw new Error('Expected a set');
    expect(document.projectSet.name).toBe('News set');
    expect(document.projectSet.templates).toHaveLength(1);
  });

  it('re-fetches URL documents without credentials and rejects corrupt source before opening', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createProject({ name: 'Current URL contents' }))),
      )
      .mockResolvedValueOnce(new Response('broken json'));
    vi.stubGlobal('fetch', fetch);
    const item = { id: 'url', name: 'News', openedAt: 1, url: 'https://example.test/news.ogs' };
    const first = await readRecentDocument(item);
    expect(first.kind === 'template' && first.project.name).toBe('Current URL contents');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    await expect(readRecentDocument(item)).rejects.toThrow('not valid JSON');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
