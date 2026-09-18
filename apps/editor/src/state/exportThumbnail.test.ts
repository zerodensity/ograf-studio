import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createProject } from '@ograf-editor/scene-model';
import { validateManifest } from '@ograf-editor/validation';
import { exportProjectAsZip } from './exportPackage';
import { certifyExportArtifacts } from './ografCompatibility';
import { saveBlobToFile } from './fileIO';
import { createTemplateThumbnail } from './templateThumbnail';

vi.mock('./ografCompatibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ografCompatibility')>()),
  certifyExportArtifacts: vi.fn(),
}));
vi.mock('./fileIO', () => ({ saveBlobToFile: vi.fn() }));
vi.mock('./templateThumbnail', () => ({ createTemplateThumbnail: vi.fn() }));

describe('OGraf ZIP thumbnails', () => {
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(certifyExportArtifacts).mockResolvedValue({ valid: true, errors: [], checks: [] });
    vi.mocked(saveBlobToFile).mockResolvedValue('saved');
    vi.mocked(createTemplateThumbnail).mockResolvedValue(new Blob([png], { type: 'image/png' }));
  });

  it('certifies and saves the PNG alongside its manifest reference using the selected frame', async () => {
    const project = createProject({ thumbnailFrame: 7 });
    const source = structuredClone(project);
    await exportProjectAsZip(project, project.compositions[0]!);

    const blob = vi.mocked(saveBlobToFile).mock.calls[0]![0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const name = `${project.id}_thumb.png`;
    const manifest = JSON.parse(await zip.file(`${project.id}.ograf.json`)!.async('string'));
    expect(manifest.thumbnails).toEqual([{ file: name }]);
    expect(validateManifest(manifest).valid).toBe(true);
    expect(await zip.file(name)!.async('uint8array')).toEqual(png);
    expect(zip.file('main.js')).not.toBeNull();
    expect(vi.mocked(certifyExportArtifacts).mock.calls[0]![0].resources).toContainEqual({
      path: name,
      data: Buffer.from(png).toString('base64'),
      base64: true,
    });
    expect(createTemplateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailFrame: 7, mainCompositionId: project.mainCompositionId }),
    );
    expect(project).toEqual(source);
  });

  it('does not save an incomplete ZIP when thumbnail rendering fails', async () => {
    vi.mocked(createTemplateThumbnail).mockRejectedValue(new Error('Image could not be decoded'));
    const project = createProject();
    await expect(exportProjectAsZip(project, project.compositions[0]!)).rejects.toThrow(
      'Image could not be decoded',
    );
    expect(saveBlobToFile).not.toHaveBeenCalled();
    expect(certifyExportArtifacts).not.toHaveBeenCalled();
  });
});
