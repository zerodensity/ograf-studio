import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createOGrafAuthoringHost } from './index';
import { assertStaticEditorRoot } from './staticEditor';

describe('standalone static editor hosting', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('serves the editor, immutable assets, SPA fallback, and existing health endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ograf-static-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Packaged Studio</title>');
    await writeFile(join(root, 'transition-logic-news.html'), '<!doctype html><title>News</title>');
    await writeFile(join(root, 'assets', 'app.js'), 'globalThis.packagedStudio = true;');
    await assertStaticEditorRoot(root);

    const host = createOGrafAuthoringHost({ editorRoot: root, workspaceRoot: root });
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    try {
      const editor = await fetch(`http://127.0.0.1:${port}/`);
      expect(await editor.text()).toContain('Packaged Studio');
      expect(editor.headers.get('cache-control')).toBe('no-store');

      const news = await fetch(`http://127.0.0.1:${port}/transition-logic-news.html`);
      expect(await news.text()).toContain('<title>News</title>');
      expect(news.headers.get('cache-control')).toBe('no-store');

      const asset = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
      expect(await asset.text()).toContain('packagedStudio');
      expect(asset.headers.get('cache-control')).toContain('immutable');

      const fallback = await fetch(`http://127.0.0.1:${port}/workspace/project`, {
        headers: { Accept: 'text/html' },
      });
      expect(await fallback.text()).toContain('Packaged Studio');

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(await health.json()).toMatchObject({ ok: true, editorConnected: false });
    } finally {
      await new Promise<void>((resolve, reject) =>
        host.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('reports a missing production editor before starting the server', async () => {
    await expect(assertStaticEditorRoot('C:\\missing-ograf-editor')).rejects.toThrow(
      /compiled OGraf Studio editor was not found/,
    );
  });

  it('keeps SPA fallback working when the editor is installed below a hidden profile folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ograf-hidden-static-'));
    roots.push(root);
    const editorRoot = join(root, '.studio-profile', 'editor');
    await mkdir(editorRoot, { recursive: true });
    await writeFile(join(editorRoot, 'index.html'), '<!doctype html><title>Profile Studio</title>');
    const host = createOGrafAuthoringHost({ editorRoot, workspaceRoot: root });
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    try {
      const fallback = await fetch(`http://127.0.0.1:${port}/workspace/project`, {
        headers: { Accept: 'text/html' },
      });
      expect(fallback.status).toBe(200);
      expect(await fallback.text()).toContain('Profile Studio');
      expect(fallback.headers.get('cache-control')).toBe('no-store');
    } finally {
      await new Promise<void>((resolve, reject) =>
        host.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('serves a generated embedded-asset map without a filesystem directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ograf-embedded-'));
    roots.push(root);
    const indexPath = join(root, 'embedded-index');
    const scriptPath = join(root, 'embedded-script');
    const newsPath = join(root, 'embedded-news');
    await writeFile(indexPath, '<!doctype html><title>Embedded Studio</title>');
    await writeFile(scriptPath, 'globalThis.embeddedStudio = true;');
    await writeFile(newsPath, '<!doctype html><title>Embedded News</title>');

    const host = createOGrafAuthoringHost({
      embeddedEditorAssets: {
        '/index.html': indexPath,
        '/assets/editor.js': scriptPath,
        '/transition-logic-news.html': newsPath,
      },
      workspaceRoot: root,
    });
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    try {
      const editor = await fetch(`http://127.0.0.1:${port}/`);
      expect(editor.headers.get('content-type')).toContain('text/html');
      expect(await editor.text()).toContain('Embedded Studio');
      expect(editor.headers.get('cache-control')).toBe('no-store');

      const news = await fetch(`http://127.0.0.1:${port}/transition-logic-news.html`);
      expect(await news.text()).toContain('Embedded News');
      expect(news.headers.get('content-type')).toContain('text/html');
      expect(news.headers.get('cache-control')).toBe('no-store');

      const script = await fetch(`http://127.0.0.1:${port}/assets/editor.js`);
      expect(script.headers.get('content-type')).toContain('text/javascript');
      expect(await script.text()).toContain('embeddedStudio');
      expect(script.headers.get('cache-control')).toContain('immutable');
    } finally {
      await new Promise<void>((resolve, reject) =>
        host.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
