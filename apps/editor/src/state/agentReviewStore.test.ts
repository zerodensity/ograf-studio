import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { useAgentReviewStore, type AgentAuthoringProposal } from './agentReviewStore';

describe('main-canvas proposal review', () => {
  beforeEach(() => useAgentReviewStore.setState({ proposals: [], lastResolution: null }));
  const fixture = () => {
    const original = createProject({ name: 'Original' });
    const draft = structuredClone(original);
    draft.name = 'Proposed';
    const proposal: AgentAuthoringProposal = {
      id: 'proposal',
      title: 'Review change',
      description: '',
      sessionId: 'editor',
      baseRevision: 4,
      operationTypes: ['set_project_metadata'],
      operationCount: 1,
      previewUrl: '/preview.png',
      previewExpiresAt: new Date(Date.now() + 60000).toISOString(),
      render: 'strip',
      frames: [0, 12, 24],
      valid: true,
      warnings: [],
      project: draft,
      compositionId: draft.mainCompositionId,
    };
    return { original, draft, proposal };
  };
  it('previews and compares the draft without changing the source, including after rejection', () => {
    const { original, draft, proposal } = fixture();
    const before = structuredClone(original);
    const store = useAgentReviewStore.getState();
    store.present(proposal, original);
    expect(useAgentReviewStore.getState().proposals[0]?.previewFrame).toBe(12);
    store.compare(proposal.id);
    store.setFrame(proposal.id, 7);
    expect(useAgentReviewStore.getState().proposals[0]).toMatchObject({
      showOriginal: true,
      previewFrame: 7,
    });
    expect(original).toEqual(before);
    expect(draft.name).toBe('Proposed');
    store.resolve(proposal.id, { status: 'rejected', message: 'Rejected' });
    expect(useAgentReviewStore.getState().proposals).toEqual([]);
    expect(original).toEqual(before);
  });
  it('invalidates changed revisions and resets readiness when choosing another frame', () => {
    const { original, proposal } = fixture();
    const store = useAgentReviewStore.getState();
    store.present(proposal, original);
    store.update(proposal.id, { previewReady: true });
    store.setFrame(proposal.id, 12);
    expect(useAgentReviewStore.getState().proposals[0]?.previewReady).toBe(true);
    store.setFrame(proposal.id, 1000);
    expect(useAgentReviewStore.getState().proposals[0]).toMatchObject({
      previewFrame: 24,
      previewReady: false,
    });
    store.invalidate('Changed', 4);
    expect(useAgentReviewStore.getState().proposals[0]?.staleReason).toBeNull();
    store.invalidate('Changed', 5);
    expect(useAgentReviewStore.getState().proposals[0]).toMatchObject({
      staleReason: 'Changed',
      previewReady: false,
    });
  });
  it('keeps the queue and original snapshots separate across decisions', () => {
    const { original, proposal } = fixture();
    const store = useAgentReviewStore.getState();
    store.present(proposal, original);
    store.present({ ...proposal, id: 'second' }, original);
    store.update(proposal.id, { deciding: 'accept' });
    store.resolve(proposal.id, { status: 'accepted', message: 'Accepted' });
    expect(useAgentReviewStore.getState().proposals.map((item) => item.id)).toEqual(['second']);
    expect(original.name).toBe('Original');
  });
});
