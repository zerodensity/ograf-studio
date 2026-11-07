import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createLayerKeyframe,
  createProject,
  createTextLayer,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { buildExportArtifacts } from './exportPackage';
import { prepareLibraryFontAsset } from './fontLibraryImport';
import type { LibraryFont } from './fontLibraryCatalog';
class MemoryFileReader {
  result: string | null = null;
  error = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: File) {
    void file.arrayBuffer().then(
      (data) => {
        this.result = `data:${file.type};base64,${Buffer.from(data).toString('base64')}`;
        this.onload?.();
      },
      () => this.onerror?.(),
    );
  }
}
afterEach(() => vi.unstubAllGlobals());
describe('bundled font library', () => {
  it('embeds exact licensed font bytes in an OGraf export without any external font request', async () => {
    vi.stubGlobal('FileReader', MemoryFileReader);
    const bytes = await readFile(new URL('../assets/font-library/inter.ttf', import.meta.url));
    const license = await readFile(
      new URL('../assets/font-library/inter-OFL.txt', import.meta.url),
      'utf8',
    );
    const font: LibraryFont = {
      id: 'inter',
      family: 'Inter',
      category: 'Sans serif',
      weight: '100 900',
      url: 'offline://inter',
      filename: 'inter.ttf',
      licenseText: license,
      licenseUrl: 'https://example.invalid/OFL',
      pairings: ['Lora'],
    };
    const read = vi.fn(async () => new Response(bytes, { status: 200 }));
    const asset = await prepareLibraryFontAsset(font, read as typeof fetch);
    expect(read).toHaveBeenCalledOnce();
    expect(asset).toMatchObject({
      kind: 'font',
      fontFamily: 'Inter',
      fontWeight: '100 900',
      licenseName: 'SIL Open Font License 1.1',
      licenseText: license,
    });
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.assets.push(asset);
    const text = createTextLayer();
    if (text.element.type !== 'text') throw new Error('text');
    text.element.fontFamily = 'Inter';
    text.element.content = 'MARKET HEADLINE';
    text.keyframes.push(createLayerKeyframe(0, defaultTransformFor('text')));
    composition.layers.push(text);
    const exported = buildExportArtifacts(project, composition);
    expect(exported.valid).toBe(true);
    const resource = exported.resources.find((item) => item.path.endsWith('.ttf'));
    expect(resource?.base64).toBe(true);
    expect(createHash('sha256').update(Buffer.from(resource!.data, 'base64')).digest('hex')).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(
      exported.resources.some((item) => item.path.startsWith('licenses/') && item.data === license),
    ).toBe(true);
    expect(exported.mainJs).not.toContain('offline://inter');
  });
  it('fails cleanly when the local font file is unavailable', async () => {
    const font = { family: 'Inter', url: 'offline://missing' } as LibraryFont;
    await expect(
      prepareLibraryFontAsset(
        font,
        vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
      ),
    ).rejects.toThrow('Could not read bundled Inter font');
  });
});
