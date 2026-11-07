import { afterAll, describe, expect, it, vi } from 'vitest';
import { createProject, migrateProject } from '@ograf-editor/scene-model';
import { buildExportArtifacts } from './exportPackage';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { buildCoordinatedProjectSetArtifacts } from './coordinatedCompile';
import { createProjectSetArchive, openProjectSetArchive } from './projectSet';
import { useProjectStore } from './projectStore';
import {
  addReviewComment,
  changedReviewLayerIds,
  resolveReviewComment,
  reviewProjectFingerprint,
  saveReviewVersion,
  setReviewApproval,
} from './projectReview';

vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');
afterAll(() => vi.unstubAllGlobals());

describe('project review', () => {
  it('rejects invalid review metadata without changing the project', () => {
    useProjectStore.getState().loadProject(createProject());
    const project = useProjectStore.getState().project;
    expect(() =>
      addReviewComment({
        text: 'x'.repeat(2001),
        author: 'Designer',
        compositionId: project.mainCompositionId,
        layerId: null,
        frame: 0,
        x: 0,
        y: 0,
      }),
    ).toThrow();
    expect(() => saveReviewVersion('x'.repeat(129))).toThrow();
    expect(useProjectStore.getState().project).toBe(project);
  });
  it('persists comments and versions without exporting them, and flags edits after approval', () => {
    useProjectStore.getState().loadProject(createProject());
    const layerId = useProjectStore.getState().addLayer('text');
    const before = useProjectStore.getState().project;
    const composition = before.compositions[0]!;
    const baseline = buildExportArtifacts(before, composition);
    addReviewComment({
      text: 'Private review marker',
      author: 'Designer',
      compositionId: composition.id,
      layerId,
      frame: 12,
      x: 120,
      y: 80,
    });
    const commentId = useProjectStore.getState().project.review!.comments[0]!.id;
    resolveReviewComment(commentId, true);
    saveReviewVersion('First version');
    const versionSnapshot = useProjectStore.getState().project.review!.versions[0]!.snapshot;
    const sourceCompositions = useProjectStore.getState().project.compositions;
    setReviewApproval('Designer');
    const reviewed = useProjectStore.getState().project;
    expect(reviewed.compositions).toBe(sourceCompositions);
    expect(reviewed.review!.versions[0]!.snapshot).toBe(versionSnapshot);
    expect(reviewed.review!.approval!.fingerprint).toBe(reviewProjectFingerprint(reviewed));
    expect(reviewed.review!.versions[0]!.snapshot).not.toHaveProperty('review');
    const reopened = migrateProject(JSON.parse(JSON.stringify(reviewed)));
    expect(reopened.review!.comments[0]).toMatchObject({
      text: 'Private review marker',
      resolved: true,
      layerId,
    });
    const exported = buildExportArtifacts(reopened, reopened.compositions[0]!);
    expect(exported.manifest).toEqual(baseline.manifest);
    expect(exported.mainJs).toEqual(baseline.mainJs);
    expect(JSON.stringify(exported)).not.toContain('Private review marker');
    useProjectStore.getState().renameLayer(layerId, 'Changed');
    const changed = useProjectStore.getState().project;
    expect(changed.review!.approval!.fingerprint).not.toBe(reviewProjectFingerprint(changed));
    expect(changedReviewLayerIds(changed, changed.review!.versions[0]!.snapshot)).toContain(
      layerId,
    );
    history.resetHistory();
  });

  it('retains review comments in a template-set source while excluding them from coordinated output', async () => {
    const set = createTransitionLogicNewsExample(1_760_000_000_000);
    const baseline = buildCoordinatedProjectSetArtifacts(set);
    const project = set.templates[0]!.project;
    project.review = {
      comments: [
        {
          id: 'private-comment',
          text: 'CONFIDENTIAL REVIEW TEST',
          author: 'Designer',
          createdAt: '2026-11-01T00:00:00.000Z',
          resolved: false,
          compositionId: project.mainCompositionId,
          layerId: null,
          frame: 0,
          x: 10,
          y: 20,
        },
      ],
      versions: [],
    };
    const archive = await createProjectSetArchive(set);
    const reopened = await openProjectSetArchive(await archive.arrayBuffer());
    expect(reopened.templates[0]!.project.review?.comments[0]?.text).toBe(
      'CONFIDENTIAL REVIEW TEST',
    );
    const output = buildCoordinatedProjectSetArtifacts(reopened);
    expect(JSON.stringify(output)).not.toContain('CONFIDENTIAL REVIEW TEST');
    expect(output.manifest).toEqual(baseline.manifest);
    expect(output.transitionDescriptor).toEqual(baseline.transitionDescriptor);
  });
});
