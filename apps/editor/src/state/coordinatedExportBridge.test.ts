import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
const packageMock = vi.hoisted(() => vi.fn());
vi.mock('./coordinatedExport', () => ({ createCertifiedCoordinatedPackage: packageMock }));
import { createProjectSet, addProjectSetTemplate } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { exportCoordinatedSetForBridge, handleTemplateSetRequest } from './templateSetBridge';
import { createDefaultTransitionLogic } from './transitionLogicEditing';
import { useTransitionLogicDraftStore } from './transitionLogicDraftStore';
const revision = () => handleTemplateSetRequest({ action: 'read' }).revision as string;
beforeEach(() => {
  vi.stubGlobal('window', {
    clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  });
  const project = createProject({ name: 'Headline' });
  let set = createProjectSet('News set', project);
  set.transitionLogic = createDefaultTransitionLogic(set);
  set = addProjectSetTemplate(set, createProject({ name: 'CH01' }));
  useProjectStore.getState().loadProject(project);
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
  useTransitionLogicDraftStore.setState({ drafts: {} });
  packageMock.mockReset();
  packageMock.mockImplementation(async (snapshot) => ({
    blob: new Blob(['certified bytes']),
    artifacts: {
      manifest: { name: snapshot.name },
      transitionDescriptor: { templates: [snapshot.templates[0]] },
    },
    compatibility: { valid: true },
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe('coordinated export snapshot admission', () => {
  it('reports referenced overlays and unreferenced CH01 without mutating the source', async () => {
    const expectedRevision = revision();
    const before = useProjectSetStore.getState().projectSet;
    const result = await exportCoordinatedSetForBridge({
      action: 'export-coordinated',
      expectedRevision,
      profile: 'realtime',
    });
    expect(result).toMatchObject({
      outcome: 'certified',
      revision: expectedRevision,
      previewFileName: 'News set.html',
      unreferencedTemplates: [{ name: 'CH01' }],
    });
    expect(result.includedTemplateIds).toHaveLength(1);
    expect(useProjectSetStore.getState().projectSet).toBe(before);
    expect(revision()).toBe(expectedRevision);
  });
  it('rejects a stale revision before compilation', async () => {
    expect(
      await exportCoordinatedSetForBridge({
        action: 'export-coordinated',
        expectedRevision: 'stale',
        profile: 'dual',
      }),
    ).toMatchObject({ outcome: 'snapshot-failed', stage: 'snapshot' });
    expect(packageMock).not.toHaveBeenCalled();
  });
  it('rejects dirty applied-state drafts', async () => {
    const set = useProjectSetStore.getState().projectSet!;
    useTransitionLogicDraftStore.getState().sync(set.id, set.transitionLogic);
    useTransitionLogicDraftStore.getState().replace(set.id, null);
    expect(
      await exportCoordinatedSetForBridge({
        action: 'export-coordinated',
        expectedRevision: revision(),
        profile: 'dual',
      }),
    ).toMatchObject({ outcome: 'snapshot-failed', message: expect.stringContaining('unapplied') });
    expect(packageMock).not.toHaveBeenCalled();
  });
  it('rejects source changes while certification is pending', async () => {
    packageMock.mockImplementation(async () => {
      useProjectStore.getState().setProjectMeta({ name: 'Changed during export' });
      return { blob: new Blob(['certified bytes']) };
    });
    expect(
      await exportCoordinatedSetForBridge({
        action: 'export-coordinated',
        expectedRevision: revision(),
        profile: 'dual',
      }),
    ).toMatchObject({ message: expect.stringContaining('revision conflict') });
  });
});
