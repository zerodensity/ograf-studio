import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import type {
  AuthoringWorkspacePort,
  BrowserVideoRequest,
  BrowserVideoResult,
  EditorBridgePort,
} from './ports';
import { MAX_VIDEO_EXPORT_BYTES, videoExportFile } from './videoExportFile';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

function movie(payload = 'picture and sound'): BrowserVideoResult {
  const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(payload)]);
  return {
    mimeType: 'video/webm',
    data: bytes.toString('base64'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: 1920,
    height: 1080,
    frameRate: 50,
    frames: 150,
    durationSeconds: 3,
  };
}

async function fixture(exportVideo: (request: BrowserVideoRequest) => Promise<BrowserVideoResult>) {
  const root = await mkdtemp(join(tmpdir(), 'ograf-video-export-'));
  folders.push(root);
  const rendered = vi.fn(exportVideo);
  const workspace = {
    resolveAllowedPath: (input: string) => resolve(root, input),
  } as unknown as AuthoringWorkspacePort;
  const save = videoExportFile(workspace, { exportVideo: rendered } as unknown as EditorBridgePort);
  const input = (overrides: Record<string, unknown> = {}) => ({
    path: 'movie.webm',
    operationId: 'export-1',
    overwrite: false,
    revision: 4,
    request: { project: createProject(), transparent: true, holdSeconds: 3 },
    ...overrides,
  });
  return { root, rendered, save, input };
}

describe('video export file', () => {
  it('saves the movie the editor rendered and reports what it is', async () => {
    const rendered = movie();
    const { root, save, input } = await fixture(async () => rendered);
    const result = await save(input());
    expect(result).toMatchObject({
      path: join(root, 'movie.webm'),
      operationId: 'export-1',
      bytes: rendered.bytes,
      sha256: rendered.sha256,
      width: 1920,
      height: 1080,
      frames: 150,
      durationSeconds: 3,
      replayed: false,
    });
    expect(result).not.toHaveProperty('data');
    expect((await readFile(join(root, 'movie.webm'))).toString('base64')).toBe(rendered.data);
  });

  it('answers again for a saved export without rendering it twice', async () => {
    const { rendered, save, input } = await fixture(async () => movie());
    await save(input());
    expect(await save(input())).toMatchObject({ replayed: true, operationId: 'export-1' });
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  it('lets a caller that lost its answer wait for the running export', async () => {
    let finish!: (result: BrowserVideoResult) => void;
    const { rendered, save, input } = await fixture(
      () => new Promise<BrowserVideoResult>((done) => (finish = done)),
    );
    const first = save(input());
    const second = save(input());
    await vi.waitFor(() => expect(rendered).toHaveBeenCalledTimes(1));
    finish(movie());
    expect(await first).toEqual(await second);
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  it('refuses an operation ID that belongs to another export', async () => {
    const { save, input } = await fixture(async () => movie());
    await save(input());
    await expect(save(input({ path: 'other.webm' }))).rejects.toThrow('different video export');
    await expect(save(input({ revision: 5 }))).rejects.toThrow('different video export');
  });

  it('keeps an existing file unless told to replace it, before the editor renders anything', async () => {
    const { root, rendered, save, input } = await fixture(async () => movie('new movie'));
    await writeFile(join(root, 'movie.webm'), 'old movie');
    await expect(save(input())).rejects.toThrow('already exists');
    expect(rendered).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'movie.webm'), 'utf8')).toBe('old movie');

    await save(input({ operationId: 'export-2', overwrite: true }));
    expect((await readFile(join(root, 'movie.webm'))).subarray(4).toString()).toBe('new movie');
  });

  it.each([
    ['a changed checksum', (result: BrowserVideoResult) => ({ ...result, sha256: 'f'.repeat(64) })],
    ['a wrong size', (result: BrowserVideoResult) => ({ ...result, bytes: result.bytes + 1 })],
    [
      'a file that is not WebM',
      () => {
        const bytes = Buffer.from('not a movie');
        return {
          ...movie(),
          data: bytes.toString('base64'),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      },
    ],
    [
      'a movie over the limit',
      (result: BrowserVideoResult) => ({ ...result, bytes: MAX_VIDEO_EXPORT_BYTES + 1 }),
    ],
  ] as const)('saves nothing for %s, and the same ID may try again', async (_label, broken) => {
    let attempt = 0;
    const { root, save, input } = await fixture(async () =>
      (attempt += 1) === 1 ? (broken(movie()) as BrowserVideoResult) : movie(),
    );
    await expect(save(input())).rejects.toThrow();
    await expect(readFile(join(root, 'movie.webm'))).rejects.toThrow();
    expect(await save(input())).toMatchObject({ replayed: false });
  });

  it('accepts only a .webm path and needs a connected editor that can render video', async () => {
    const { save, input } = await fixture(async () => movie());
    await expect(save(input({ path: 'movie.mp4' }))).rejects.toThrow('must end in .webm');
    const root = await mkdtemp(join(tmpdir(), 'ograf-video-export-'));
    folders.push(root);
    const withoutVideo = videoExportFile(
      {
        resolveAllowedPath: (path: string) => resolve(root, path),
      } as unknown as AuthoringWorkspacePort,
      {} as EditorBridgePort,
    );
    await expect(withoutVideo(input())).rejects.toThrow('updated, connected Studio editor');
  });

  it('notices a saved movie that was changed since', async () => {
    const { root, save, input } = await fixture(async () => movie());
    await save(input());
    await writeFile(join(root, 'movie.webm'), 'edited elsewhere');
    await expect(save(input())).rejects.toThrow('removed or changed');
  });
});
