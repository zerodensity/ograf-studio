import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { writeTemplateFiles } from './projectFiles';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (
      dirname(resolve(folder)) !== resolve(tmpdir()) ||
      !basename(folder).startsWith('ograf-save-test-')
    )
      throw new Error('Invalid test cleanup path');
    await rm(folder, { recursive: true, force: true });
  }
});

describe('paired template files', () => {
  it('writes and replaces both files without leaving staging files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ograf-save-test-'));
    folders.push(folder);
    const files = [
      { path: join(folder, 'News.ogs'), data: 'source' },
      { path: join(folder, 'News_ thumb.png'), data: Buffer.from('png') },
    ];
    await writeTemplateFiles(files, false);
    expect(await readFile(files[0]!.path, 'utf8')).toBe('source');
    expect(await readFile(files[1]!.path, 'utf8')).toBe('png');
    await writeTemplateFiles(
      files.map((file) => ({ ...file, data: 'updated' })),
      true,
    );
    expect(await readFile(files[0]!.path, 'utf8')).toBe('updated');
    expect(await readFile(files[1]!.path, 'utf8')).toBe('updated');
    expect((await readdir(folder)).sort()).toEqual(['News.ogs', 'News_ thumb.png']);
  });
  it('does not create the source when an existing sidecar blocks the save', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ograf-save-test-'));
    folders.push(folder);
    const png = join(folder, 'News_ thumb.png');
    await writeFile(png, 'keep');
    await expect(
      writeTemplateFiles(
        [
          { path: join(folder, 'News.ogs'), data: 'new' },
          { path: png, data: 'replace' },
        ],
        false,
      ),
    ).rejects.toThrow('already exists');
    expect(await readdir(folder)).toEqual(['News_ thumb.png']);
    expect(await readFile(png, 'utf8')).toBe('keep');
  });
});
