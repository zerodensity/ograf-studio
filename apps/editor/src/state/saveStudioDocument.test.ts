import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { openStudioDocumentFromFile } from './fileIO';
import { certifyProject } from './ografCompatibility';
import { resetHistory } from './historyStore';
import { applyOpenedStudioDocument } from './openStudioDocument';
import { addProjectSetTemplate, createProjectSet, createProjectSetArchive } from './projectSet';
import { activateProjectSetTemplate } from './projectSetSession';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { saveStudioDocument } from './saveStudioDocument';
import { parseStudioDocument } from './studioDocument';

vi.mock('./ografCompatibility', () => ({ certifyProject: vi.fn() }));

function editableFile(name: string, initial = new Blob()) {
  let contents = initial;
  const createWritable = vi.fn(async () => ({
    write: async (blob: Blob) => {
      contents = blob;
    },
    close: async () => {},
    abort: async () => {},
  }));
  const handle = {
    name,
    getFile: async () => contents,
    requestPermission: vi.fn(async () => 'granted'),
    createWritable,
  } as unknown as FileSystemFileHandle;
  return { handle, createWritable, read: () => parseStudioDocument(contents) };
}

function localWindow(source: FileSystemFileHandle, copy: FileSystemFileHandle) {
  const showOpenFilePicker = vi.fn(async () => [source]);
  const showSaveFilePicker = vi.fn(async () => copy);
  return {
    window: { showOpenFilePicker, showSaveFilePicker } as unknown as Window,
    showOpenFilePicker,
    showSaveFilePicker,
  };
}

async function openFile(ownerWindow: Window) {
  const opened = await openStudioDocumentFromFile(ownerWindow);
  expect(opened).not.toBeNull();
  applyOpenedStudioDocument(opened!);
}

function editDescription(description: string) {
  useProjectStore.getState().setProjectMeta({ description });
}

describe('File Save and Save As', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { clearTimeout, setTimeout });
    vi.mocked(certifyProject).mockResolvedValue({ valid: true, errors: [], checks: [] } as never);
  });

  afterEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    resetHistory();
    vi.unstubAllGlobals();
  });

  it('saves an opened template in place and adopts the file selected in Save As', async () => {
    const project = createProject({ name: 'Headline' });
    const source = editableFile('opened.ogs', new Blob([JSON.stringify(project)]));
    const copy = editableFile('Copy.ogs');
    const browser = localWindow(source.handle, copy.handle);
    await openFile(browser.window);

    editDescription('Saved to the opened file');
    expect(await saveStudioDocument('save', browser.window)).toEqual({
      status: 'saved',
      fileName: 'opened.ogs',
    });
    expect(browser.showSaveFilePicker).not.toHaveBeenCalled();
    expect(await source.read()).toMatchObject({
      kind: 'template',
      project: { id: project.id, name: 'Headline', description: 'Saved to the opened file' },
    });

    expect(await saveStudioDocument('save-as', browser.window)).toEqual({
      status: 'saved',
      fileName: 'Copy.ogs',
    });
    expect(browser.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Headline.ogs' }),
    );
    expect(useProjectStore.getState().project.name).toBe('Copy');
    editDescription('Saved to the new destination');
    await saveStudioDocument('save', browser.window);
    expect(browser.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(source.createWritable).toHaveBeenCalledOnce();
    expect(copy.createWritable).toHaveBeenCalledTimes(2);
    expect(await copy.read()).toMatchObject({
      kind: 'template',
      project: { id: project.id, name: 'Copy', description: 'Saved to the new destination' },
    });
  });

  it('keeps the set destination while switching templates and reopens the complete Save As archive', async () => {
    const set = addProjectSetTemplate(
      createProjectSet('News Show', createProject({ name: 'Headline' })),
      createProject({ name: 'Ticker' }),
    );
    const source = editableFile('show.ogs', await createProjectSetArchive(set));
    const copy = editableFile('Evening Show.ogs');
    const browser = localWindow(source.handle, copy.handle);
    await openFile(browser.window);
    const [first, second] = set.templates;
    expect(activateProjectSetTemplate(first!.id)).toBe(true);
    editDescription('Updated headline');
    expect(activateProjectSetTemplate(second!.id)).toBe(true);
    editDescription('Updated ticker');
    await saveStudioDocument('save', browser.window);
    expect(browser.showSaveFilePicker).not.toHaveBeenCalled();
    expect(await source.read()).toMatchObject({
      kind: 'template-set',
      projectSet: {
        id: set.id,
        name: 'News Show',
        activeTemplateId: second!.id,
        templates: [
          { id: first!.id, project: { description: 'Updated headline' } },
          { id: second!.id, project: { description: 'Updated ticker' } },
        ],
      },
    });

    await saveStudioDocument('save-as', browser.window);
    expect(useProjectSetStore.getState().projectSet?.name).toBe('Evening Show');
    editDescription('Updated evening ticker');
    await saveStudioDocument('save', browser.window);
    expect(browser.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(source.createWritable).toHaveBeenCalledOnce();
    expect(copy.createWritable).toHaveBeenCalledTimes(2);
    expect(await copy.read()).toMatchObject({
      kind: 'template-set',
      projectSet: {
        id: set.id,
        name: 'Evening Show',
        templates: [
          { id: first!.id, project: { description: 'Updated headline' } },
          { id: second!.id, project: { description: 'Updated evening ticker' } },
        ],
      },
    });
  });

  it('keeps the old destination and title when Save As is cancelled or the write fails', async () => {
    const project = createProject({ name: 'Current template' });
    const source = editableFile('opened.ogs', new Blob([JSON.stringify(project)]));
    const copy = editableFile('Failed copy.ogs');
    const browser = localWindow(source.handle, copy.handle);
    await openFile(browser.window);
    browser.showSaveFilePicker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
    expect(await saveStudioDocument('save-as', browser.window)).toEqual({ status: 'cancelled' });
    copy.createWritable.mockRejectedValueOnce(new Error('Disk full'));
    await expect(saveStudioDocument('save-as', browser.window)).rejects.toThrow('Disk full');
    expect(useProjectStore.getState().project.name).toBe('Current template');
    expect(await saveStudioDocument('save', browser.window)).toEqual({
      status: 'saved',
      fileName: 'opened.ogs',
    });
    expect(source.createWritable).toHaveBeenCalledOnce();
  });

  it('does not change the destination of a newly opened copy with the same project ID', async () => {
    const project = createProject({ name: 'Shared identity' });
    const original = new Blob([JSON.stringify(project)]);
    const source = editableFile('opened.ogs', original);
    const copy = editableFile('Pending copy.ogs');
    const other = editableFile('another.ogs', original);
    const browser = localWindow(source.handle, copy.handle);
    await openFile(browser.window);
    let choose: (handle: FileSystemFileHandle) => void = () => {};
    browser.showSaveFilePicker.mockImplementationOnce(
      () =>
        new Promise<FileSystemFileHandle>((resolve) => {
          choose = resolve;
        }),
    );
    const pending = saveStudioDocument('save-as', browser.window);
    browser.showOpenFilePicker.mockResolvedValueOnce([other.handle]);
    await openFile(browser.window);
    choose(copy.handle);
    await pending;
    expect(useProjectStore.getState().project.name).toBe('Shared identity');
    expect(await saveStudioDocument('save', browser.window)).toEqual({
      status: 'saved',
      fileName: 'another.ogs',
    });
    expect(other.createWritable).toHaveBeenCalledOnce();
  });

  it('downloads an editable source when the browser has no file save picker', async () => {
    const project = createProject({ name: 'Offline template' });
    applyOpenedStudioDocument({ kind: 'template', project });
    const anchor = { download: '', href: '', click: vi.fn() };
    const browser = {
      document: { createElement: () => anchor },
      setTimeout: (callback: () => void) => callback(),
    } as unknown as Window;
    for (const mode of ['save', 'save-as'] as const) {
      expect(await saveStudioDocument(mode, browser)).toEqual({
        status: 'downloaded',
        fileName: 'Offline template.ogs',
      });
    }
    expect(anchor.download).toBe('Offline template.ogs');
    expect(anchor.click).toHaveBeenCalledTimes(2);
  });
});
