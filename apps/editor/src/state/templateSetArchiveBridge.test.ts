import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
const archive = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./projectSetArchiveTask', () => ({ createProjectSetArchiveTask: archive.run }));
import { createProjectSet, createProjectSetArchive, openProjectSetArchive } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { archiveTemplateSetForBridge, handleTemplateSetRequest } from './templateSetBridge';

beforeEach(() => {
  vi.stubGlobal('window', {
    clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  });
  archive.run.mockReset();
  const project = createProject({ name: 'News' });
  const set = createProjectSet('News set', project);
  useProjectStore.getState().loadProject(project);
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const revision = () => handleTemplateSetRequest({ action: 'read' }).revision as string;
describe('native MCP template-set archive bridge', () => {
  it.each(['compact', 'compatible'] as const)(
    'builds a bounded %s source copy without revising or renaming the document',
    async (archiveMode) => {
      archive.run.mockImplementation(createProjectSetArchive);
      const before = structuredClone(useProjectSetStore.getState().projectSet),
        expectedRevision = revision();
      const result = await archiveTemplateSetForBridge({
        action: 'archive',
        expectedRevision,
        archiveMode,
      });
      expect(result).toMatchObject({
        revision: expectedRevision,
        name: 'News set',
        archiveMode,
        schemaVersion: archiveMode === 'compact' ? 6 : 5,
        templateCount: 1,
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      const bytes = Buffer.from(result.archiveBase64, 'base64');
      expect(bytes.length).toBe(result.archiveBytes);
      expect((await openProjectSetArchive(bytes)).name).toBe('News set');
      expect(useProjectSetStore.getState().projectSet).toEqual(before);
      expect(revision()).toBe(expectedRevision);
    },
  );
  it('rejects stale or expired admission before preparing any archive', async () => {
    await expect(
      archiveTemplateSetForBridge({ action: 'archive', expectedRevision: 'old' }),
    ).rejects.toThrow('revision conflict');
    await expect(
      archiveTemplateSetForBridge(
        { action: 'archive', expectedRevision: revision() },
        { expiresAt: 0 },
      ),
    ).rejects.toThrow('expired');
    expect(archive.run).not.toHaveBeenCalled();
  });
  it('rejects edits made while the archive worker was preparing the snapshot', async () => {
    let complete!: (blob: Blob) => void;
    archive.run.mockImplementation(() => new Promise<Blob>((resolve) => (complete = resolve)));
    const expectedRevision = revision(),
      saving = archiveTemplateSetForBridge({ action: 'archive', expectedRevision });
    const assertion = expect(saving).rejects.toThrow('revision conflict');
    useProjectStore.getState().setProjectMeta({ name: 'Changed while saving' });
    complete(new Blob(['archive']));
    await assertion;
    expect(useProjectStore.getState().project.name).toBe('Changed while saving');
  });
  it('rejects oversized worker output before allocating a base64 transfer', async () => {
    archive.run.mockResolvedValue({ size: 64 * 1024 * 1024 + 1, arrayBuffer: vi.fn() });
    await expect(
      archiveTemplateSetForBridge({ action: 'archive', expectedRevision: revision() }),
    ).rejects.toThrow('64 MiB');
  });
});
