import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Express, Request, Response } from 'express';
import { parseWorkspaceState } from '@ograf-editor/ui-kit/workspace-model';

const MAX_BYTES = 2 * 1024 * 1024;

/** UI workspaces belong to the operating-system user, independently of template folders. */
export function studioWorkspacePreferencesPath(): string {
  const root =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(root, 'OGrafStudio', 'workspaces.json');
}

function sameOrigin(request: Request): boolean {
  // Custom header prevents cross-origin HTML forms; this route has no CORS grant.
  if (request.get('X-OGraf-Workspace-Profile') !== '1') return false;
  const origin = request.get('Origin');
  return (
    (!origin || origin === `${request.protocol}://${request.get('host')}`) &&
    request.get('Sec-Fetch-Site') !== 'cross-site'
  );
}

async function acquireProfileLock(path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, String(process.pid), { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await readFile(path, 'utf8').catch(() => '');
      const pid = Number(owner);
      let abandoned = false;
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          abandoned = (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
      } else {
        const file = await stat(path).catch(() => null);
        abandoned = !!file && Date.now() - file.mtimeMs > 60_000;
      }
      if (!abandoned || (await readFile(path, 'utf8').catch(() => '')) !== owner) return false;
      await unlink(path).catch(() => {});
    }
  }
  return false;
}

export function installStudioWorkspacePreferences(app: Express): void {
  const path = studioWorkspacePreferencesPath();
  let writes: Promise<unknown> = Promise.resolve();
  const read = async () => {
    let bytes: Buffer;
    try {
      if ((await stat(path)).size > MAX_BYTES)
        throw new Error('The workspace profile exceeds the size limit.');
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { revision: 'empty', data: null };
      throw error;
    }
    if (bytes.byteLength > MAX_BYTES)
      throw new Error('The workspace profile exceeds the size limit.');
    const data: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parseWorkspaceState(data))
      throw new Error('The workspace profile has an unsupported format.');
    return { revision: createHash('sha256').update(bytes).digest('hex'), data };
  };
  const fail = (response: Response, error: unknown) =>
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Could not access the workspace profile.',
    });
  app.get('/api/studio/workspaces', async (request, response) => {
    if (!sameOrigin(request))
      return response.status(403).json({ error: 'Same-origin Studio request required.' });
    response.setHeader('Cache-Control', 'no-store');
    try {
      return response.json(await read());
    } catch (error) {
      return fail(response, error);
    }
  });
  app.put('/api/studio/workspaces', async (request, response) => {
    if (!sameOrigin(request))
      return response.status(403).json({ error: 'Same-origin Studio request required.' });
    const { expectedRevision, data } = request.body ?? {};
    const normalized = parseWorkspaceState(data);
    if (typeof expectedRevision !== 'string' || !normalized)
      return response
        .status(400)
        .json({ error: 'A valid workspace profile and revision are required.' });
    const bytes = Buffer.from(JSON.stringify(normalized));
    if (bytes.byteLength > MAX_BYTES)
      return response.status(413).json({ error: 'The workspace profile exceeds the size limit.' });
    const performWrite = async () => {
      await mkdir(dirname(path), { recursive: true });
      const lock = `${path}.lock`;
      const temporary = `${path}.${randomUUID()}.tmp`;
      if (!(await acquireProfileLock(lock)))
        return response
          .status(423)
          .json({ error: 'Another Studio window is saving this workspace profile. Try again.' });
      try {
        const current = await read();
        if (current.revision !== expectedRevision)
          return response.status(409).json({
            error:
              'Workspace settings changed in another Studio window. Reload before saving again.',
          });
        await writeFile(temporary, bytes, { flag: 'wx' });
        await rename(temporary, path);
        return response.json({ revision: createHash('sha256').update(bytes).digest('hex') });
      } finally {
        await unlink(temporary).catch(() => {});
        await unlink(lock).catch(() => {});
      }
    };
    const operation = writes.then(performWrite);
    writes = operation.catch(() => {});
    try {
      return await operation;
    } catch (error) {
      return fail(response, error);
    }
  });
}
