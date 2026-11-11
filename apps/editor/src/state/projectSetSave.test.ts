import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { saveProjectSetToFile } from './fileIO';
import {
  addProjectSetTemplate,
  createProjectSet,
  DEFAULT_PROJECT_SET_NAME,
  createProjectSetArchive,
  migrateProjectSetDocument,
  openProjectSetArchive,
  renameProjectSet,
  saveProjectSetTemplateEdits,
} from './projectSet';

describe('template-set naming and saving', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('repairs the old untitled set placeholder without changing its child name', () => {
    const set = createProjectSet('', createProject({ name: 'Untitled Template' }));
    const old = { ...set, name: 'Untitled Template', nameOrigin: undefined };
    const migrated = migrateProjectSetDocument(old);
    expect(migrated.name).toBe(DEFAULT_PROJECT_SET_NAME);
    expect(migrated.templates[0]!.name).toBe('Untitled Template');
    expect(migrated.id).toBe(set.id);
  });

  it('preserves an explicitly chosen set name even if it resembles an old placeholder', async () => {
    const set = renameProjectSet(createProjectSet('', createProject()), 'Untitled Template');
    const archive = await createProjectSetArchive(set);
    const reopened = await openProjectSetArchive(await archive.arrayBuffer());
    expect(reopened.name).toBe('Untitled Template');
    expect(reopened.nameOrigin).toBe('custom');
  });

  it('gives an untitled set its own name and keeps parent and child renames independent', () => {
    const project = createProject({ name: 'Untitled Template' });
    const set = createProjectSet('', project);
    expect(set.name).toBe(DEFAULT_PROJECT_SET_NAME);
    expect(set.templates[0]!.name).toBe('Untitled Template');
    const renamed = renameProjectSet(set, '  Evening Show  ');
    expect(renamed.name).toBe('Evening Show');
    expect(renamed.templates).toBe(set.templates);
    expect(renamed.id).toBe(set.id);
    expect(() => renameProjectSet(set, '  ')).toThrow('Enter a template set name');
    const childSaved = saveProjectSetTemplateEdits(renamed, renamed.templates[0]!.id, {
      ...project,
      name: 'News Bulletin',
    });
    expect(childSaved.name).toBe('Evening Show');
    expect(childSaved.templates[0]!.name).toBe('News Bulletin');
  });

  it('uses the selected .ogp filename for the returned set and the reopened archive', async () => {
    const project = createProject({ name: 'News Bulletin' });
    const set = addProjectSetTemplate(
      createProjectSet('', project),
      createProject({ name: 'Sports' }),
    );
    let output: Blob | undefined;
    const writable = {
      write: vi.fn(async (blob: Blob) => {
        output = blob;
      }),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    const handle = {
      name: 'Evening Show.ogp',
      createWritable: async () => writable,
    };
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('window', { showSaveFilePicker: picker });

    const saving = saveProjectSetToFile(set);
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Untitled Template Set.ogs' }),
    );
    const result = await saving;
    expect(result).toMatchObject({
      status: 'saved',
      fileName: 'Evening Show.ogp',
      projectSet: { id: set.id, name: 'Evening Show' },
    });
    if (result.status !== 'saved') throw new Error('Expected a saved file');
    expect(result.handle).toBe(handle);
    const reopened = await openProjectSetArchive(await output!.arrayBuffer());
    expect(reopened.name).toBe('Evening Show');
    expect(reopened.templates.map((template) => template.name)).toEqual([
      'News Bulletin',
      'Sports',
    ]);
    expect(reopened.templates.map((template) => template.id)).toEqual(
      set.templates.map((template) => template.id),
    );
    expect(reopened.activeTemplateId).toBe(set.activeTemplateId);
    expect(set.name).toBe(DEFAULT_PROJECT_SET_NAME);
  });

  it('updates the existing set file and reopens every template without prompting for a filename', async () => {
    const set = addProjectSetTemplate(
      createProjectSet('Edited set title', createProject({ name: 'News' })),
      createProject({ name: 'Sports' }),
    );
    const picker = vi.fn();
    const write = vi.fn();
    const close = vi.fn();
    const requestPermission = vi.fn(async () => 'granted');
    const handle = {
      name: 'Existing set.ogs',
      requestPermission,
      createWritable: async () => ({ write, close, abort: vi.fn() }),
    } as unknown as FileSystemFileHandle;
    vi.stubGlobal('window', { showSaveFilePicker: picker });

    const saving = saveProjectSetToFile(set, { handle, archiveMode: 'compact' });
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    const result = await saving;

    expect(picker).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'saved', fileName: 'Existing set.ogs' });
    if (result.status !== 'saved') throw new Error('Expected a saved file');
    expect(result.handle).toBe(handle);
    const reopened = await openProjectSetArchive(
      await (write.mock.calls[0]![0] as Blob).arrayBuffer(),
    );
    expect(reopened).toMatchObject({
      id: set.id,
      name: 'Edited set title',
      activeTemplateId: set.activeTemplateId,
      templates: set.templates.map(({ id, name }) => ({ id, name })),
    });
  });

  it('does not rename the current set if its save dialog is cancelled', async () => {
    const set = createProjectSet('', createProject());
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => {
        throw new DOMException('Cancelled', 'AbortError');
      },
    });
    expect(await saveProjectSetToFile(set)).toEqual({ status: 'cancelled' });
    expect(set.name).toBe(DEFAULT_PROJECT_SET_NAME);
  });

  it('aborts a failed write without committing the selected filename to the current set', async () => {
    const set = createProjectSet('', createProject());
    const error = new Error('Write failed');
    const writable = {
      write: vi.fn(async () => {
        throw error;
      }),
      close: vi.fn(),
      abort: vi.fn(async () => {}),
    };
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => ({
        name: 'Failed Save.ogp',
        createWritable: async () => writable,
      }),
    });
    await expect(saveProjectSetToFile(set)).rejects.toBe(error);
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
    expect(set.name).toBe(DEFAULT_PROJECT_SET_NAME);
  });
});
