import { createProject, createRectangleLayer } from '@ograf-editor/scene-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { installSharedPlayoutAutoFollow, useSharedPlayoutEditor } from './sharedPlayoutEditor';
import type { SharedPlayoutSource } from './sharedPlayoutPublish';

const mocks = vi.hoisted(() => ({
  build:
    vi.fn<(source: SharedPlayoutSource, signal: AbortSignal) => Promise<SharedPlayoutSource>>(),
  links: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('./sharedPlayoutPublish', () => ({
  buildSharedPlayoutPreview: mocks.build,
  getSharedPlayoutLinks: mocks.links,
  publishSharedPlayout: mocks.publish,
}));

const links = {
  viewerUrl: 'http://127.0.0.1:4320/preview/',
  operatorUrl: 'http://127.0.0.1:4320/control/test/',
};

// The controller schedules work through queueMicrotask and settled mock promises.
const flushPublication = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function savedProject(name: string) {
  const project = createProject({ name });
  project.compositions[0]!.layers.push({ ...createRectangleLayer(), name: `${name} artwork` });
  return project;
}

describe('Shared Live opening behavior', () => {
  let stopFollowing: (() => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal('window', { clearTimeout });
    useProjectSetStore.getState().clearProjectSet();
    // MCP Reset uses the scene-model starter, rather than the editor-created timeline defaults.
    useProjectStore.getState().loadProject(createProject());
    mocks.build.mockReset().mockImplementation(async (source) => source);
    mocks.links.mockReset().mockResolvedValue(links);
    let publicationNumber = 0;
    mocks.publish.mockReset().mockImplementation(async () => ({
      ...links,
      publicationId: `publication-${++publicationNumber}`,
    }));
    stopFollowing = installSharedPlayoutAutoFollow();
  });

  afterEach(() => {
    stopFollowing?.();
    vi.unstubAllGlobals();
  });

  it('keeps an empty MCP starter unpublished until its first object is added', async () => {
    await flushPublication();
    expect(useSharedPlayoutEditor.getState()).toMatchObject({
      checking: false,
      publicationId: null,
    });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();

    const starter = useProjectStore.getState();
    const fieldId = starter.addDataField('text');
    await flushPublication();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();

    const layerId = starter.addLayer('rectangle');
    await flushPublication();

    expect(useProjectStore.getState().documentLoadRevision).toBe(starter.documentLoadRevision);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(useSharedPlayoutEditor.getState()).toMatchObject({
      publicationId: 'publication-1',
      publishedSource: {
        project: { id: starter.project.id },
        composition: {
          id: starter.activeCompositionId,
          layers: [{ id: layerId }],
          dataFields: [{ id: fieldId }],
        },
      },
    });
  });

  it('publishes a saved replacement and publishes a same-ID reopen as a new document', async () => {
    const first = savedProject('First headline');
    useProjectStore.getState().loadProject(first);
    await flushPublication();
    expect(useSharedPlayoutEditor.getState().publicationId).toBe('publication-1');

    const replacement = savedProject('Replacement headline');
    useProjectStore.getState().loadProject(replacement);
    await flushPublication();
    expect(useSharedPlayoutEditor.getState()).toMatchObject({
      publicationId: 'publication-2',
      publicationName: replacement.name,
      publishedSource: { project: { id: replacement.id } },
    });

    const reopened = structuredClone(replacement);
    reopened.compositions[0]!.layers[0]!.name = 'Reopened headline artwork';
    useProjectStore.getState().loadProject(reopened);
    await flushPublication();

    expect(mocks.publish).toHaveBeenCalledTimes(3);
    expect(useSharedPlayoutEditor.getState()).toMatchObject({
      publicationId: 'publication-3',
      publishedSource: {
        project: { id: replacement.id },
        composition: {
          id: replacement.mainCompositionId,
          layers: [{ name: 'Reopened headline artwork' }],
        },
      },
    });
  });

  it('keeps the published artwork while editing its document or opening an empty draft', async () => {
    const saved = savedProject('On air');
    useProjectStore.getState().loadProject(saved);
    await flushPublication();
    const before = useSharedPlayoutEditor.getState();
    expect(before.publicationId).toBe('publication-1');

    const layerId = saved.compositions[0]!.layers[0]!.id;
    useProjectStore.getState().renameLayer(layerId, 'Edited off air');
    await flushPublication();
    expect(useProjectStore.getState().project.compositions[0]!.layers[0]!.name).toBe(
      'Edited off air',
    );
    expect(useSharedPlayoutEditor.getState().publishedSource).toBe(before.publishedSource);

    useProjectStore.getState().loadProject(createProject());
    await flushPublication();
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(useSharedPlayoutEditor.getState()).toMatchObject({
      links,
      publicationId: before.publicationId,
      publicationName: saved.name,
      publishedSource: { composition: { layers: [{ name: 'On air artwork' }] } },
    });
  });

  it('does not replace the viewer with a guide-only draft', async () => {
    const guideProject = savedProject('Guide only');
    guideProject.compositions[0]!.layers[0]!.isGuide = true;
    useProjectStore.getState().loadProject(guideProject);
    await flushPublication();

    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(useSharedPlayoutEditor.getState().publicationId).toBeNull();
  });

  it('publishes a background-only graphic', async () => {
    const background = createProject({ name: 'Solid output' });
    background.compositions[0]!.backgroundColor = '#142532';
    useProjectStore.getState().loadProject(background);
    await flushPublication();

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(useSharedPlayoutEditor.getState()).toMatchObject({
      publicationName: background.name,
      publishedSource: { composition: { backgroundColor: '#142532', layers: [] } },
    });
  });
});
