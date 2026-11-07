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
    const picker = vi.fn(async () => ({
      name: 'Evening Show.ogp',
      createWritable: async () => writable,
    }));
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
