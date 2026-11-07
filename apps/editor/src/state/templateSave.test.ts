import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createProject } from '@ograf-editor/scene-model';
import { downloadProjectSource, saveProjectSourceToFile, saveProjectToFile } from './fileIO';
import { certifyProject } from './ografCompatibility';
import { createTemplateThumbnail } from './templateThumbnail';

vi.mock('./ografCompatibility', () => ({ certifyProject: vi.fn() }));
vi.mock('./templateThumbnail', () => ({ createTemplateThumbnail: vi.fn() }));

describe('saving a template with its thumbnail', () => {
  beforeEach(() => {
    vi.mocked(certifyProject).mockResolvedValue({ valid: true, errors: [], checks: [] } as never);
    vi.mocked(createTemplateThumbnail).mockResolvedValue(
      new Blob(['png-bytes'], { type: 'image/png' }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the filename selected in the native dialog for both source and editor state', async () => {
    const events: string[] = [];
    let output: Blob | undefined;
    const folderPicker = vi.fn();
    const writable = {
      write: vi.fn(async (blob: Blob) => {
        output = blob;
        events.push('write');
      }),
      close: vi.fn(async () => {
        events.push('close');
      }),
      abort: vi.fn(async () => {}),
    };
    const filePicker = vi.fn(async () => {
      events.push('picker');
      return { name: 'Morning Update.ogs', createWritable: async () => writable };
    });
    vi.stubGlobal('window', { showSaveFilePicker: filePicker, showDirectoryPicker: folderPicker });
    vi.mocked(certifyProject).mockImplementation(async () => {
      events.push('certify');
      return { valid: true, errors: [], checks: [] } as never;
    });
    const project = createProject({ name: 'News Bulletin' });

    const saving = saveProjectSourceToFile(project);
    expect(events).toEqual(['picker']);
    expect(await saving).toMatchObject({
      status: 'saved',
      fileName: 'Morning Update.ogs',
      project: { id: project.id, name: 'Morning Update' },
    });
    expect(filePicker).toHaveBeenCalledWith({
      suggestedName: 'News Bulletin.ogs',
      types: [
        {
          description: 'OGS template files',
          accept: { 'application/x-ograf-studio-project': ['.ogs'] },
        },
      ],
    });
    expect(events).toEqual(['picker', 'certify', 'write', 'close']);
    expect(folderPicker).not.toHaveBeenCalled();
    expect(JSON.parse(await output!.text())).toMatchObject({
      id: project.id,
      name: 'Morning Update',
    });
    expect(certifyProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Morning Update' }),
    );
    expect(project.name).toBe('News Bulletin');
  });

  it('leaves the project untouched when the file save dialog is cancelled', async () => {
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => {
        throw new DOMException('Cancelled', 'AbortError');
      },
    });
    const certify = vi.mocked(certifyProject);
    certify.mockClear();
    expect(await saveProjectSourceToFile(createProject())).toEqual({ status: 'cancelled' });
    expect(certify).not.toHaveBeenCalled();
  });

  it('reports a write failure and aborts without silently downloading elsewhere', async () => {
    const writeError = new Error('Disk full');
    const writable = {
      write: vi.fn(async () => {
        throw writeError;
      }),
      close: vi.fn(),
      abort: vi.fn(async () => {}),
    };
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => ({ name: 'News.ogs', createWritable: async () => writable }),
    });
    await expect(saveProjectSourceToFile(createProject())).rejects.toBe(writeError);
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
  });

  it('downloads renamed .ogs source without opening a folder or file picker', async () => {
    let output: Blob | undefined;
    const picker = vi.fn();
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('window', {
      document: { createElement: () => anchor },
      showDirectoryPicker: picker,
      showSaveFilePicker: picker,
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
    });
    vi.stubGlobal('document', { createElement: () => anchor });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      output = blob as Blob;
      return 'blob:source';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const project = createProject({ name: 'News Bulletin', thumbnailFrame: 7 });

    expect(await downloadProjectSource(project)).toBe('downloaded');
    expect(picker).not.toHaveBeenCalled();
    expect(anchor.download).toBe('News Bulletin.ogs');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(JSON.parse(await output!.text())).toMatchObject({
      id: project.id,
      name: 'News Bulletin',
      thumbnailFrame: 7,
    });
  });

  it('picks a folder during the click and saves both matching files after certification', async () => {
    const saved = new Map<string, Blob>();
    const events: string[] = [];
    const directory = {
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        let content: Blob;
        return {
          createWritable: async () => ({
            write: async (data: Blob) => {
              content = data;
              events.push('write');
            },
            close: async () => {
              saved.set(name, content);
              events.push('close');
            },
            abort: vi.fn(),
          }),
        };
      }),
    };
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        events.push('picker');
        return directory;
      },
      confirm: () => true,
    });
    vi.mocked(createTemplateThumbnail).mockImplementation(async () => {
      events.push('thumbnail');
      return new Blob(['png-bytes'], { type: 'image/png' });
    });
    const project = createProject({ name: 'News', thumbnailFrame: 7 });
    expect(await saveProjectToFile(project, { baseName: 'My Template' })).toBe('saved');
    expect([...saved.keys()]).toEqual(['My Template.ogs', `${project.id}_thumb.png`]);
    expect(JSON.parse(await saved.get('My Template.ogs')!.text()).thumbnailFrame).toBe(7);
    expect(saved.get(`${project.id}_thumb.png`)!.type).toBe('image/png');
    expect(events).toEqual(['picker', 'thumbnail', 'write', 'write', 'close', 'close']);
  });

  it('does not create target files when rendering or certification fails', async () => {
    const directory = { getFileHandle: vi.fn() };
    vi.stubGlobal('window', { showDirectoryPicker: async () => directory });
    vi.mocked(certifyProject).mockResolvedValue({
      valid: false,
      errors: ['Invalid graphic'],
      checks: [],
    } as never);
    await expect(saveProjectToFile(createProject())).rejects.toThrow('compatibility');
    expect(directory.getFileHandle).not.toHaveBeenCalled();
  });

  it('downloads one ZIP containing both files when folder access is unavailable', async () => {
    let output: Blob | undefined;
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('window', {
      document: { createElement: () => anchor },
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
    });
    vi.stubGlobal('document', { createElement: () => anchor });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      output = blob as Blob;
      return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const project = createProject({ name: 'Lower Third' });
    expect(await saveProjectToFile(project)).toBe('downloaded');
    expect(anchor.download).toBe('Lower Third.source.zip');
    const zip = await JSZip.loadAsync(await output!.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['Lower Third.ogs', `${project.id}_thumb.png`]);
    expect(await zip.file(`${project.id}_thumb.png`)!.async('string')).toBe('png-bytes');
  });
});
