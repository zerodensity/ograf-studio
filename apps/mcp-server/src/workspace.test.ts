import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { AuthoringWorkspace } from './workspace';

it('opens a saved project into the existing editor as an undoable replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ograf-open-'));
  try {
    const workspace = new AuthoringWorkspace(root),
      before = workspace.get('editor').snapshot().project;
    await writeFile(join(root, 'graphic.ogs'), JSON.stringify(createProject({ name: 'Masks' })));
    const opened = await workspace.open('editor', 'graphic.ogs');
    expect(opened.snapshot().project.name).toBe('Masks');
    expect(opened.undo(opened.revision).project).toEqual(before);
    await expect(workspace.open('other', '../outside.ogs')).rejects.toThrow('configured workspace');
  } finally {
    await rm(join(root, 'graphic.ogs'), { force: true });
    await rmdir(root);
  }
});
