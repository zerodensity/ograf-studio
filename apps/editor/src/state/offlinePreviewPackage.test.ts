import { describe, expect, it } from 'vitest';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import { createStandaloneHtmlFile } from './offlinePreviewPackage';

describe('standalone HTML export', () => {
  const artifacts = {
    manifest: { name: 'Signal Blue' },
    mainJs: '',
    resources: [],
  } as unknown as ExportArtifacts;

  it('keeps a package resource with the same name inside the independent HTML payload', async () => {
    const file = createStandaloneHtmlFile({
      ...artifacts,
      resources: [{ path: 'Signal Blue.html', data: 'existing resource', base64: false }],
    });
    expect(file).toMatchObject({ format: 'html', fileName: 'Signal Blue.html' });
    expect(file.blob.type).toBe('text/html;charset=utf-8');
    const html = await file.blob.text();
    expect(html).toContain('<!doctype html>');
    const payload = html.match(/id="ograf-package">([\s\S]*?)<\/script>/);
    expect(JSON.parse(payload![1]!).resources).toContainEqual({
      path: 'Signal Blue.html',
      data: 'existing resource',
      base64: false,
    });
  });
});
