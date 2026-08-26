import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '@ograf-editor/scene-model';
import { AuthoringWorkspace } from './workspace';

const temporaryRoots: string[] = [];

async function createTemporaryWorkspace(): Promise<{
  root: string;
  workspace: AuthoringWorkspace;
}> {
  const root = await mkdtemp(join(tmpdir(), 'ograf-studio-workspace-'));
  temporaryRoots.push(root);
  return { root, workspace: new AuthoringWorkspace(root) };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('AuthoringWorkspace project source extensions', () => {
  it('opens canonical .ogs project source', async () => {
    const { root, workspace } = await createTemporaryWorkspace();
    const project = createProject({ name: 'Canonical source' });
    await writeFile(join(root, 'canonical.ogs'), JSON.stringify(project));

    await expect(workspace.open('canonical', 'canonical.ogs')).resolves.toBeDefined();
    expect(workspace.get('canonical').snapshot().project.name).toBe('Canonical source');
  });

  it('keeps legacy .ogeproj source readable', async () => {
    const { root, workspace } = await createTemporaryWorkspace();
    const project = createProject({ name: 'Legacy source' });
    await writeFile(join(root, 'legacy.ogeproj'), JSON.stringify(project));

    await expect(workspace.open('legacy', 'legacy.ogeproj')).resolves.toBeDefined();
    expect(workspace.get('legacy').snapshot().project.name).toBe('Legacy source');
  });

  it('rejects unrelated JSON files', async () => {
    const { root, workspace } = await createTemporaryWorkspace();
    await writeFile(join(root, 'project.json'), JSON.stringify(createProject()));

    await expect(workspace.open('invalid', 'project.json')).rejects.toThrow(
      '.ogs or a legacy .ogeproj',
    );
  });
});
