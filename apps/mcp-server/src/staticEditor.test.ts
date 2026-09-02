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
    await writeFile(join(root, 'assets', 'app.js'), 'globalThis.packagedStudio = true;');
    await assertStaticEditorRoot(root);

    const host = createOGrafAuthoringHost({ editorRoot: root, workspaceRoot: root });
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    try {
      const editor = await fetch(`http://127.0.0.1:${port}/`);
      expect(await editor.text()).toContain('Packaged Studio');
      expect(editor.headers.get('cache-control')).toBe('no-store');

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

  it('serves a generated embedded-asset map without a filesystem directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ograf-embedded-'));
    roots.push(root);
    const indexPath = join(root, 'embedded-index');
    const scriptPath = join(root, 'embedded-script');
    await writeFile(indexPath, '<!doctype html><title>Embedded Studio</title>');
    await writeFile(scriptPath, 'globalThis.embeddedStudio = true;');

    const host = createOGrafAuthoringHost({
      embeddedEditorAssets: {
        '/index.html': indexPath,
        '/assets/editor.js': scriptPath,
      },
      workspaceRoot: root,
    });
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    try {
      const editor = await fetch(`http://127.0.0.1:${port}/`);
      expect(editor.headers.get('content-type')).toContain('text/html');
      expect(await editor.text()).toContain('Embedded Studio');

      const script = await fetch(`http://127.0.0.1:${port}/assets/editor.js`);
      expect(script.headers.get('content-type')).toContain('text/javascript');
      expect(await script.text()).toContain('embeddedStudio');
    } finally {
      await new Promise<void>((resolve, reject) =>
        host.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
