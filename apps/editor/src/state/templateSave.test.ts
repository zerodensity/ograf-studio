import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createProject } from '@ograf-editor/scene-model';
import { saveProjectToFile } from './fileIO';
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
