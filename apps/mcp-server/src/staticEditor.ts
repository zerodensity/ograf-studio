import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import express, { type Express } from 'express';

export async function assertStaticEditorRoot(editorRoot: string): Promise<void> {
  try {
    await access(join(editorRoot, 'index.html'), constants.R_OK);
  } catch {
    throw new Error(
      `The compiled OGraf Studio editor was not found at ${editorRoot}. Build the standalone editor first.`,
    );
  }
}

export function installStaticEditor(app: Express, editorRoot: string): void {
  const indexPath = join(editorRoot, 'index.html');
  app.use(
    express.static(editorRoot, {
      index: 'index.html',
      setHeaders(response, filePath) {
        response.setHeader(
          'Cache-Control',
          filePath === indexPath ? 'no-store' : 'public, max-age=31536000, immutable',
        );
      },
    }),
  );
  app.use((request, response, next) => {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !request.accepts('html')) {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  });
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function installEmbeddedEditor(
  app: Express,
  assets: Readonly<Record<string, string>>,
): void {
  const indexPath = assets['/index.html'];
  if (!indexPath) throw new Error('The standalone editor asset map is missing /index.html.');

  app.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    const requestedPath = request.path === '/' ? '/index.html' : request.path;
    const assetPath = assets[requestedPath];
    const fallbackToIndex = !assetPath && Boolean(request.accepts('html'));
    const resolvedPath = assetPath ?? (fallbackToIndex ? indexPath : undefined);
    if (!resolvedPath) {
      next();
      return;
    }

    void readFile(resolvedPath)
      .then((data) => {
        const logicalPath = fallbackToIndex ? '/index.html' : requestedPath;
        response.setHeader(
          'Cache-Control',
          logicalPath === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
        );
        response.setHeader(
          'Content-Type',
          CONTENT_TYPES[extname(logicalPath).toLowerCase()] ?? 'application/octet-stream',
        );
        response.send(data);
      })
      .catch(next);
  });
}
