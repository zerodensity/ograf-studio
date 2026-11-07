import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildFigmaPluginPackage } from './figmaPluginPackage';

describe('Figma plugin distribution', () => {
  it('packages the manifest, local exporter, UI and setup guide', async () => {
    const zip = await JSZip.loadAsync(await (await buildFigmaPluginPackage()).arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      'LICENSE.txt',
      'README.md',
      'code.js',
      'manifest.json',
      'ui.html',
    ]);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.networkAccess.allowedDomains).toEqual(['none']);
    expect(await zip.file('code.js')!.async('string')).toContain('figma.base64Encode');
    expect(await zip.file('LICENSE.txt')!.async('string')).toContain(
      'GNU AFFERO GENERAL PUBLIC LICENSE',
    );
    expect(await zip.file('README.md')!.async('string')).toContain('Import plugin from manifest');
  });
});
