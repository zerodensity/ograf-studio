import { describe, expect, it } from 'vitest';
import { createChartElement, createProject } from './factory';
import { migrateProject } from './migrations';
import {
  createRendererPluginSnapshot,
  rendererPluginDigest,
  rendererPluginKey,
  validateRendererPluginSnapshot,
  MAX_RENDERER_PLUGIN_SOURCE_BYTES,
  MAX_RENDERER_PLUGIN_LICENSE_BYTES,
  MAX_RENDERER_PLUGIN_ICON_BYTES,
} from './rendererPlugins';
import type { RendererPluginManifest } from './types';

const manifest: RendererPluginManifest = {
  schemaVersion: 1,
  apiVersion: 1,
  kind: 'chart',
  id: 'test.chart',
  version: '1.0.0',
  name: 'Test Chart',
  presets: ['bar', 'line'],
  license: 'MIT',
};
const source = 'export default { create() {} };\n';
const licenseText = 'Copyright Test. MIT permission.\n';
const input = () => ({ manifest: structuredClone(manifest), source, licenseText });
const pngIcon =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X2cAAAAASUVORK5CYII=';
const webpIcon =
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==';

describe('pinned renderer plugin snapshots', () => {
  it('keeps adapter declarations distinct from pinned underlying-library attribution', () => {
    const candidate = input();
    candidate.manifest.license = 'AGPL-3.0-only';
    candidate.manifest.author = 'Adapter publisher';
    candidate.manifest.library = {
      name: 'Chart.js',
      version: '4.5.1',
      license: 'MIT',
      author: 'Chart.js contributors',
      homepage: 'https://www.chartjs.org',
    };
    const snapshot = createRendererPluginSnapshot(candidate);
    expect(snapshot.manifest.license).toBe('AGPL-3.0-only');
    expect(snapshot.manifest.author).toBe('Adapter publisher');
    expect(snapshot.manifest.library).toEqual(candidate.manifest.library);
    expect(validateRendererPluginSnapshot(snapshot)).toEqual([]);
    snapshot.manifest.library!.license = 'Apache-2.0';
    expect(validateRendererPluginSnapshot(snapshot).join(' ')).toContain('integrity');
  });

  it('keeps older library metadata with no separate license/author/homepage valid', () => {
    const candidate = input();
    candidate.manifest.library = { name: 'Chart.js', version: '4.5.1' };
    const snapshot = createRendererPluginSnapshot(candidate);
    expect(validateRendererPluginSnapshot(snapshot)).toEqual([]);
    expect(snapshot.manifest.library).toEqual({ name: 'Chart.js', version: '4.5.1' });
  });

  it.each([
    ['license', ''],
    ['license', ' '.repeat(10)],
    ['license', 'L'.repeat(129)],
    ['license', 1],
    ['author', ''],
    ['author', 'A'.repeat(201)],
    ['author', false],
    ['homepage', 'http://example.com'],
    ['homepage', 'https://user:password@example.com'],
    ['homepage', 'javascript:alert(1)'],
    ['homepage', 'https://example.com/' + 'x'.repeat(2048)],
    ['homepage', ' https://example.com'],
    ['homepage', 'https://exa\tmple.com'],
    ['homepage', null],
  ])('rejects unsafe or invalid library %s=%j declarations', (key, value) => {
    const candidate = input();
    candidate.manifest.library = { name: 'Chart.js', version: '4.5.1', [key]: value };
    expect(() => createRendererPluginSnapshot(candidate)).toThrow(`Renderer plugin library ${key}`);
  });

  it.each([pngIcon, webpIcon])(
    'accepts an embedded PNG/WebP toolbar icon and pins its bytes',
    (icon) => {
      const candidate = input();
      candidate.manifest.icon = icon;
      const snapshot = createRendererPluginSnapshot(candidate);
      expect(validateRendererPluginSnapshot(snapshot)).toEqual([]);
      expect(snapshot.manifest.icon).toBe(icon);
      expect(snapshot.sha256).not.toBe(createRendererPluginSnapshot(input()).sha256);
      snapshot.manifest.icon = icon === pngIcon ? webpIcon : pngIcon;
      expect(validateRendererPluginSnapshot(snapshot).join(' ')).toContain('integrity');
    },
  );

  it.each([
    'https://example.com/icon.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/gif;base64,R0lGODlh',
    'data:image/png;base64,',
    'data:image/png;base64,%%%%',
    'data:image/png;base64,iVBORw0KGgo',
    'data:image/png;base64,iVBORw0KGgp=',
    'data:image/png;base64,aGVsbG8=',
    'data:image/webp;base64,aGVsbG8=',
    webpIcon.replace('image/webp', 'image/png'),
    pngIcon.replace('image/png', 'image/webp'),
  ])('rejects external, executable, malformed or mismatched toolbar icon %s', (icon) => {
    const candidate = input();
    candidate.manifest.icon = icon;
    expect(() => createRendererPluginSnapshot(candidate)).toThrow('Renderer plugin icon');
  });

  it('enforces the decoded 32 KiB toolbar icon budget before allocating image bytes', () => {
    const bytes = new Uint8Array(MAX_RENDERER_PLUGIN_ICON_BYTES + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const candidate = input();
    candidate.manifest.icon = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    expect(() => createRendererPluginSnapshot(candidate)).toThrow('32 KiB');
    candidate.manifest.icon = `data:image/png;base64,${btoa(String.fromCharCode(...bytes.slice(0, MAX_RENDERER_PLUGIN_ICON_BYTES)))}`;
    expect(validateRendererPluginSnapshot(createRendererPluginSnapshot(candidate))).toEqual([]);
  });

  it('keeps older manifests with no icon valid and unchanged', () => {
    const snapshot = createRendererPluginSnapshot(input());
    expect(snapshot.manifest).not.toHaveProperty('icon');
    expect(validateRendererPluginSnapshot(snapshot)).toEqual([]);
  });

  it('hashes sorted metadata and exact UTF-8 source/license bytes with portable SHA-256', async () => {
    const snapshot = createRendererPluginSnapshot(input());
    const canonical = JSON.stringify({
      licenseText,
      manifest: {
        apiVersion: 1,
        id: 'test.chart',
        kind: 'chart',
        license: 'MIT',
        name: 'Test Chart',
        presets: ['bar', 'line'],
        schemaVersion: 1,
        version: '1.0.0',
      },
      source,
    });
    const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    expect(snapshot.sha256).toBe(
      [...new Uint8Array(expected)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
    const reversed = Object.fromEntries(
      Object.entries(manifest).reverse(),
    ) as unknown as RendererPluginManifest;
    expect(rendererPluginDigest({ manifest: reversed, source, licenseText })).toBe(snapshot.sha256);
    expect(rendererPluginKey({ ...snapshot.manifest, sha256: snapshot.sha256 })).toBe(
      `test.chart@1.0.0#${snapshot.sha256}`,
    );
  });

  it.each(['source', 'licenseText', 'manifest'] as const)(
    'detects changed %s bytes or metadata',
    (field) => {
      const snapshot = createRendererPluginSnapshot(input());
      if (field === 'manifest') snapshot.manifest.name = 'Altered Chart';
      else snapshot[field] += 'Changed';
      expect(validateRendererPluginSnapshot(snapshot).join(' ')).toContain('integrity');
    },
  );

  it('copies install metadata so later catalog edits cannot mutate a pinned snapshot', () => {
    const authored = input();
    const snapshot = createRendererPluginSnapshot(authored);
    authored.manifest.name = 'Changed';
    authored.manifest.presets.push('pie');
    expect(snapshot.manifest.name).toBe('Test Chart');
    expect(snapshot.manifest.presets).toEqual(['bar', 'line']);
  });

  it.each([
    ['id', '../escape'],
    ['version', 'latest'],
    ['apiVersion', 2],
    ['schemaVersion', 2],
    ['kind', 'effect'],
    ['presets', ['scatter']],
    ['presets', ['bar', 'bar']],
  ])('rejects unsupported or unsafe manifest %s=%j', (key, value) => {
    const candidate = input();
    Object.assign(candidate.manifest, { [key]: value });
    expect(() => createRendererPluginSnapshot(candidate)).toThrow('Renderer plugin');
  });

  it('enforces source/license byte limits and rejects malformed snapshots without throwing', () => {
    expect(validateRendererPluginSnapshot(null)).toEqual([
      'Renderer plugin snapshot must be an object.',
    ]);
    const candidate = input();
    expect(() =>
      createRendererPluginSnapshot({
        ...candidate,
        source: 'é'.repeat(MAX_RENDERER_PLUGIN_SOURCE_BYTES / 2 + 1),
      }),
    ).toThrow('2 MiB');
    expect(() =>
      createRendererPluginSnapshot({
        ...candidate,
        licenseText: 'L'.repeat(MAX_RENDERER_PLUGIN_LICENSE_BYTES + 1),
      }),
    ).toThrow('128 KiB');
  });

  it('defaults legacy catalogs and unassigned chart references without a document version bump', () => {
    const project = createProject();
    expect(project.compositions[0]!.rendererPlugins).toEqual([]);
    expect(createChartElement().provider).toBeNull();
    delete project.compositions[0]!.rendererPlugins;
    expect(migrateProject(project).compositions[0]!.rendererPlugins).toEqual([]);
    expect(migrateProject(project).documentVersion).toBe(project.documentVersion);
  });
});
