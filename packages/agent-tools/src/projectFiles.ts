import { access, link, lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Stage the source and sidecar together; restore existing files if either commit fails. */
export async function writeTemplateFiles(
  files: Array<{ path: string; data: string | Uint8Array }>,
  overwrite: boolean,
  verify?: () => Promise<void>,
): Promise<void> {
  const transaction = randomUUID();
  const staged = files.map((file) => ({
    ...file,
    temporary: `${file.path}.${transaction}.tmp`,
    backup: `${file.path}.${transaction}.bak`,
  }));
  const committed: typeof staged = [];
  const backups: typeof staged = [];
  try {
    for (const file of staged) {
      if ((await exists(file.path)) && !(await lstat(file.path)).isFile())
        throw new Error('Template targets must be regular files.');
      if (!overwrite && (await exists(file.path)))
        throw new Error(
          'Template or thumbnail already exists. Set overwrite=true only after confirming replacement.',
        );
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.temporary, file.data);
    }
    for (const file of staged) {
      if (await exists(file.path)) {
        if (!overwrite)
          throw new Error('A target file appeared while saving. Retry without overwriting it.');
        await rename(file.path, file.backup);
        backups.push(file);
      }
      if (overwrite) await rename(file.temporary, file.path);
      else await link(file.temporary, file.path); // Atomically refuse a target created after preflight.
      committed.push(file);
      if (!overwrite) await unlink(file.temporary);
    }
    await verify?.();
  } catch (error) {
    const failures: unknown[] = [];
    for (const file of [...committed].reverse())
      await unlink(file.path).catch((cause) => failures.push(cause));
    for (const file of [...backups].reverse())
      await rename(file.backup, file.path).catch((cause) => failures.push(cause));
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        'Save failed and some backup files could not be restored. Keep the .bak files for recovery.',
      );
    throw error;
  } finally {
    await Promise.all(staged.map((file) => unlink(file.temporary).catch(() => undefined)));
  }
  await Promise.all(backups.map((file) => unlink(file.backup).catch(() => undefined)));
}
