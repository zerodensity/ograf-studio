import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAsset } from '@ograf-editor/scene-model';
import { useProjectStore, getActiveComposition } from './projectStore';
import { prepareImage, readImageSize, type PreparedImage } from './imageImport';

vi.mock('./imageImport', async (original) => ({
  ...(await original<typeof import('./imageImport')>()),
  prepareImage: vi.fn(),
  readImageSize: vi.fn(),
}));
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');
const prepared = (): PreparedImage => ({
  asset: createAsset({
    name: 'Logo.png',
    kind: 'image',
    mimeType: 'image/png',
    dataUri: 'data:image/png;base64,YQ==',
  }),
  width: 320,
  height: 160,
  companions: [],
});
const composition = () => {
  const s = useProjectStore.getState();
  return getActiveComposition(s.project, s.activeCompositionId);
};
const file = { name: 'Logo.png' } as File;

describe('atomic image import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.getState().newProject();
    history.resetHistory();
    vi.mocked(prepareImage).mockResolvedValue(prepared());
    vi.mocked(readImageSize).mockResolvedValue({ width: 320, height: 160 });
  });
  afterEach(() => history.resetHistory());
  it('undoes and redoes the image and its resource together', async () => {
    const before = structuredClone(composition());
    await useProjectStore.getState().placeImageSource([file]);
    const after = structuredClone(composition());
    expect(after.layers.length).toBe(before.layers.length + 1);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expect(composition()).toEqual(before);
    history.redo();
    expect(composition()).toEqual(after);
  });
  it('does not leave resources or placeholders after a bad file or empty selection', async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(prepareImage).mockRejectedValue(new Error('Unreadable image'));
    await expect(useProjectStore.getState().placeImageSource([file])).rejects.toThrow('Unreadable');
    await expect(useProjectStore.getState().placeImageSource([])).resolves.toEqual([]);
    expect(useProjectStore.getState().project).toBe(before);
  });
  it('does not change a newly opened document when decoding finishes', async () => {
    let finish!: (image: PreparedImage) => void;
    vi.mocked(prepareImage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const importing = useProjectStore.getState().placeImageSource([file]);
    useProjectStore.getState().loadProject(structuredClone(useProjectStore.getState().project));
    const current = useProjectStore.getState().project;
    finish(prepared());
    await expect(importing).rejects.toThrow('document changed');
    expect(useProjectStore.getState().project).toBe(current);
  });
  it('does not insert after the picker has been dismissed', async () => {
    const controller = new AbortController();
    const before = useProjectStore.getState().project;
    const importing = useProjectStore
      .getState()
      .placeImageSource([file], { signal: controller.signal });
    controller.abort();
    await expect(importing).resolves.toEqual([]);
    expect(useProjectStore.getState().project).toBe(before);
  });
  it('reuses a resource without creating a duplicate payload', async () => {
    await useProjectStore.getState().placeImageSource([file]);
    const assetId = composition().assets[0]!.id;
    const count = composition().layers.length;
    await useProjectStore.getState().placeImageSource({ assetId });
    expect(composition().assets).toHaveLength(1);
    expect(composition().layers).toHaveLength(count + 1);
  });
  it('refuses a replacement whose target was locked while decoding', async () => {
    const [id] = await useProjectStore.getState().placeImageSource([file]);
    const pending = useProjectStore.getState().placeImageSource([file], { replaceLayerId: id });
    useProjectStore.setState((s) => ({
      project: {
        ...s.project,
        compositions: s.project.compositions.map((c) => ({
          ...c,
          layers: c.layers.map((l) => (l.id === id ? { ...l, isLocked: true } : l)),
        })),
      },
    }));
    const before = useProjectStore.getState().project;
    await expect(pending).rejects.toThrow('unlocked');
    expect(useProjectStore.getState().project).toBe(before);
  });
  it('does not resurrect a resource removed while its thumbnail is being inserted', async () => {
    await useProjectStore.getState().placeImageSource([file]);
    const assetId = composition().assets[0]!.id;
    const pending = useProjectStore.getState().placeImageSource({ assetId });
    useProjectStore.setState((s) => ({
      project: {
        ...s.project,
        compositions: s.project.compositions.map((c) => ({ ...c, assets: [] })),
      },
    }));
    const before = useProjectStore.getState().project;
    await expect(pending).rejects.toThrow('resource changed');
    expect(useProjectStore.getState().project).toBe(before);
  });
});
