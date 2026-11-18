import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createTextLayer, type DesignToken } from '@ograf-editor/scene-model';
import {
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  resolveProjectSetTemplate,
  type ProjectSetDocument,
} from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { copyTemplate, useTemplateClipboardStore } from './templateCommands';
import { currentTemplateSetRevision } from './templateSetBridge';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('./agentCapture', () => ({ captureAgentPng: capture, measureAgentText: vi.fn() }));
import {
  beginClipboardTransferReview,
  beginFileTransferReview,
  handleTemplateTransferRequest,
} from './templateTransferReview';
import { resetHistory, undo } from './historyStore';

function brandedSet(name: string, width: number, fill: string) {
  const project = createProject({ name: `${name} template` });
  const composition = project.compositions[0]!;
  composition.width = width;
  const token: DesignToken = {
    id: `${name}-primary`,
    key: 'brand.primary',
    name: 'Primary',
    description: '',
    type: 'color',
    value: fill,
  };
  composition.designSystem.tokens = [token];
  const layer = createTextLayer();
  layer.designTokenBindings = [{ tokenId: token.id, targetProperty: 'fill' }];
  if (layer.element.type === 'text') layer.element.fill = fill;
  composition.layers = [layer];
  return {
    ...createProjectSet(name, project),
    brandKit: { name: `${name} kit`, tokens: [token] },
  };
}

function openSet(set: ProjectSetDocument) {
  const id = set.templates[0]!.id;
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: id });
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, id));
  resetHistory();
}

describe('shared template transfer review', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { clearTimeout });
    useTemplateClipboardStore.setState({ copied: null, removed: null });
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    resetHistory();
    capture.mockResolvedValue({
      mimeType: 'image/png',
      data: 'cG5n',
      width: 320,
      height: 180,
      originalWidth: 1280,
      originalHeight: 720,
      resolvedFonts: [],
    });
  });
  afterEach(() => {
    resetHistory();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('stages source-set adoption and independently reviews destination canvas settings', () => {
    const source = brandedSet('Source', 1280, '#00ccee');
    const destination = brandedSet('Destination', 1920, '#bb2211');
    openSet(destination);
    const revision = currentTemplateSetRevision();
    const session = beginFileTransferReview({ kind: 'template-set', projectSet: source });
    const plan = session.plan({ policy: 'adopt-destination', inheritSettings: true });
    expect(session.source).toMatchObject({
      kind: 'template-set-file',
      brandKitName: 'Source kit',
    });
    expect(session.availablePolicies).toContainEqual({
      policy: 'bring-source-branding',
      enabled: true,
      reason: undefined,
    });
    expect(plan.beforeProject.compositions[0]).toMatchObject({
      width: 1280,
      layers: [expect.objectContaining({ element: expect.objectContaining({ fill: '#00ccee' }) })],
    });
    expect(plan.afterProject.compositions[0]).toMatchObject({
      width: 1920,
      layers: [expect.objectContaining({ element: expect.objectContaining({ fill: '#bb2211' }) })],
    });
    expect(plan.report.settingsDifferences).toContainEqual({
      key: 'width',
      source: 1280,
      destination: 1920,
    });
    expect(useProjectSetStore.getState().projectSet).toBe(destination);
    expect(currentTemplateSetRevision()).toBe(revision);
    const applied = plan.commit();
    expect(applied.transfer.templateId).toBe(plan.report.templateId);
    expect(() => plan.commit()).toThrow('already been applied');
    undo();
    expect(useProjectSetStore.getState().projectSet).toBe(destination);
  });

  it('explains unavailable exact source branding for standalone files and rejects a stale review', () => {
    const source = brandedSet('Source', 1280, '#00ccee');
    openSet(brandedSet('Destination', 1920, '#bb2211'));
    const session = beginFileTransferReview({
      kind: 'template',
      project: source.templates[0]!.project,
    });
    expect(session.availablePolicies).toContainEqual({
      policy: 'bring-source-branding',
      enabled: false,
      reason: expect.stringContaining('shared Brand Kit'),
    });
    expect(() => session.plan({ policy: 'bring-source-branding' })).toThrow('Brand Kit');
    const prepared = session.plan({ policy: 'keep-appearance' });
    useProjectStore.getState().setProjectMeta({ description: 'An edit during review' });
    const unchanged = useProjectStore.getState().project;
    expect(() => prepared.commit()).toThrow('destination document changed');
    expect(useProjectStore.getState().project).toBe(unchanged);
  });

  it('uses a single revision-bound candidate for paged review, preview, and commit', async () => {
    const source = brandedSet('Source', 1280, '#00ccee');
    openSet(source);
    copyTemplate(source.templates[0]!.id);
    expect(beginClipboardTransferReview()).toBeNull();
    const destination = brandedSet('Destination', 1920, '#bb2211');
    openSet(destination);

    const expectedRevision = currentTemplateSetRevision();
    const request = {
      action: 'transfer-review',
      source: { kind: 'clipboard' },
      expectedRevision,
      options: { policy: 'adopt-destination' },
    } as const;
    const { result: first } = await handleTemplateTransferRequest({ ...request, limit: 1 });
    const { result: second } = await handleTemplateTransferRequest({
      ...request,
      offset: 1,
      limit: 1,
    });
    expect(second.planId).toBe(first.planId);
    expect(second.sourceRevision).toBe(first.sourceRevision);
    expect(second).toMatchObject({
      pagination: { offset: 1, limit: 1, total: 1, nextOffset: null },
    });
    expect(first).not.toHaveProperty('afterProject');
    const ref = {
      planId: String(first.planId),
      sourceRevision: String(first.sourceRevision),
      expectedRevision,
    };
    await expect(
      handleTemplateTransferRequest({ action: 'transfer-preview', ...ref }),
    ).resolves.toMatchObject({
      result: { planId: first.planId },
      captures: { before: { data: 'cG5n' }, after: { data: 'cG5n' } },
    });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(useProjectSetStore.getState().projectSet).toBe(destination);
    const { result } = await handleTemplateTransferRequest({ action: 'transfer-commit', ...ref });
    expect(result.transfer).toMatchObject({
      policy: 'adopt-destination',
      templateId: expect.any(String),
    });
    expect(useProjectSetStore.getState().projectSet!.templates).toHaveLength(2);
    await expect(
      handleTemplateTransferRequest({ action: 'transfer-commit', ...ref }),
    ).rejects.toThrow('revision conflict');
  });

  it('lists members of a workspace archive before preparing a selected transfer', async () => {
    const source = brandedSet('Source', 1280, '#00ccee');
    const deck = addProjectSetTemplate(source, createProject({ name: 'Second member' }));
    const archive = await createProjectSetArchive(deck);
    openSet(brandedSet('Destination', 1920, '#bb2211'));
    const expectedRevision = currentTemplateSetRevision();
    const { result } = await handleTemplateTransferRequest({
      action: 'transfer-review',
      expectedRevision,
      source: {
        kind: 'workspace-file',
        filename: 'source.ogs',
        sourceRevision: 'workspace-file:test',
        bytesBase64: Buffer.from(await archive.arrayBuffer()).toString('base64'),
      },
      options: { policy: 'keep-appearance' },
      limit: 1,
    });
    expect(result).toMatchObject({
      status: 'select-source-template',
      expectedRevision,
      sourceTemplates: [{ id: deck.templates[0]!.id, name: deck.templates[0]!.name }],
      pagination: { total: 2, nextOffset: 1 },
    });
    expect(result).not.toHaveProperty('planId');
    expect(currentTemplateSetRevision()).toBe(expectedRevision);
  });
});
