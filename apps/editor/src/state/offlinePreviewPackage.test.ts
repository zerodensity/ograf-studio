import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import { addOfflinePreviewFile } from './offlinePreviewPackage';

describe('offline preview packaging', () => {
  const artifacts = {
    manifest: { name: 'Signal Blue' },
    mainJs: '',
    resources: [],
  } as unknown as ExportArtifacts;

  it('uses the template name and leaves an unrelated index.html resource intact', async () => {
    const zip = new JSZip();
    zip.file('index.html', 'existing resource');
    expect(addOfflinePreviewFile(zip, artifacts)).toBe('Signal Blue.html');
    expect(await zip.file('Signal Blue.html')!.async('string')).toContain('<!doctype html>');
    expect(await zip.file('index.html')!.async('string')).toBe('existing resource');
  });

  it.each(['SIGNAL BLUE.HTML', 'Signal Blue.html/asset.png'])(
    'rejects the Windows extraction collision %s',
    (path) => {
      const zip = new JSZip();
      zip.file(path, 'existing resource');
      expect(() => addOfflinePreviewFile(zip, artifacts)).toThrow(
        'package already contains Signal Blue.html',
      );
    },
  );
});
