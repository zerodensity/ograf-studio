import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAsset, getLayerTransformAtFrame } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import {
  canvasDropKind,
  canvasDropPlacement,
  placeCanvasNonImage,
  applyCanvasBrandColor,
} from './canvasFileDrop';
import { resetHistory, undo, getHistorySnapshot, runDiscreteHistoryStep } from './historyStore';

vi.mock('./assetImport', () => ({
  prepareAssetImport: async (file: File) => ({
    asset: createAsset({
      name: file.name,
      kind: file.name.endsWith('.woff2') ? 'font' : 'media',
      dataUri: `data:${file.name}`,
      mimeType: file.type,
      ...(file.name.endsWith('.woff2') ? { fontFamily: 'TestFont' } : {}),
    }),
    width: 3840,
    height: 2160,
  }),
}));
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
});

const fake = (name: string, type: string, text = '') =>
  ({ name, type, size: 100, text: async () => text }) as File;
const animation = JSON.stringify({
  v: '5.13.0',
  fr: 30,
  ip: 0,
  op: 60,
  w: 320,
  h: 180,
  layers: [],
});

describe('canvas file drops', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
    resetHistory();
  });

  it('recognizes supported formats and centers oversized content within the canvas', () => {
    expect(
      ['x.svg', 'x.PNG', 'x.webm', 'x.woff2', 'x.json', 'x.pdf'].map((name) =>
        canvasDropKind(fake(name, '')),
      ),
    ).toEqual(['image', 'image', 'video', 'font', 'lottie', 'unsupported']);
    expect(
      canvasDropPlacement(4000, 2000, { width: 1000, height: 500 }, { x: 500, y: 250 }),
    ).toEqual({ x: 100, y: 50, width: 800, height: 400 });
  });

  it('imports video with a fitted media paint and undoes resource and layer together', async () => {
    const id = await placeCanvasNonImage(fake('clip.mp4', 'video/mp4'), { x: 960, y: 540 });
    const project = useProjectStore.getState().project;
    const layer = project.compositions[0]!.layers.find((item) => item.id === id)!;
    expect(layer.element).toMatchObject({
      type: 'rectangle',
      fill: { type: 'media', source: { kind: 'clip' } },
    });
    expect(getLayerTransformAtFrame(layer, 0)).toMatchObject({
      x: 192,
      y: 108,
      width: 1536,
      height: 864,
    });
    expect(project.compositions[0]!.assets).toHaveLength(1);
    expect(getHistorySnapshot().past.at(-1)?.label).toBe('Import video');
    undo();
    expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(0);
    expect(useProjectStore.getState().project.compositions[0]!.assets).toHaveLength(0);
  });

  it('imports editable Lottie and atomically rejects invalid JSON', async () => {
    const id = await placeCanvasNonImage(fake('animation.json', 'application/json', animation), {
      x: 400,
      y: 250,
    });
    expect(
      useProjectStore.getState().project.compositions[0]!.layers.find((layer) => layer.id === id)
        ?.element,
    ).toMatchObject({ type: 'lottie', animationData: { w: 320, h: 180 } });
    const before = useProjectStore.getState().project;
    await expect(
      placeCanvasNonImage(fake('bad.json', 'application/json', '{}'), { x: 0, y: 0 }),
    ).rejects.toThrow();
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('replaces only the video source on Alt-drop and restores it in one undo', async () => {
    const id = (await placeCanvasNonImage(fake('first.mp4', 'video/mp4'), { x: 960, y: 540 }))!;
    const before = useProjectStore.getState().project;
    resetHistory();
    await placeCanvasNonImage(fake('second.webm', 'video/webm'), { x: 0, y: 0 }, id, true);
    const after = useProjectStore.getState().project;
    expect(after.compositions[0]!.layers[0]!.element).not.toEqual(
      before.compositions[0]!.layers[0]!.element,
    );
    expect(after.compositions[0]!.layers[0]!.keyframes).toEqual(
      before.compositions[0]!.layers[0]!.keyframes,
    );
    expect(getHistorySnapshot().past).toHaveLength(1);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('does not place a decoded file into a different document', async () => {
    let resolve!: (value: string) => void;
    const delayed = {
      ...fake('animation.json', 'application/json'),
      text: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    } as File;
    const pending = placeCanvasNonImage(delayed, { x: 0, y: 0 });
    useProjectStore.getState().newProject();
    resetHistory();
    const current = useProjectStore.getState().project;
    resolve(animation);
    await expect(pending).rejects.toThrow('document changed');
    expect(useProjectStore.getState().project).toBe(current);
    expect(getHistorySnapshot().past).toHaveLength(0);
  });

  it('commits image placement as one named history step after asynchronous decoding', async () => {
    class FakeImage {
      naturalWidth = 800;
      naturalHeight = 400;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    try {
      const asset = createAsset({
        name: 'Mark.png',
        kind: 'image',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,YQ==',
      });
      useProjectStore.getState().addPreparedAsset(asset);
      resetHistory();
      const ids = await useProjectStore.getState().placeImageSource(
        { assetId: asset.id },
        {
          position: { x: 500, y: 300 },
          commit: (mutation) => runDiscreteHistoryStep(mutation, 'Import image'),
        },
      );
      expect(ids).toHaveLength(1);
      expect(getHistorySnapshot().past.map((item) => item.label)).toEqual(['Import image']);
      undo();
      expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(0);
      expect(useProjectStore.getState().project.compositions[0]!.assets).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', {
        clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
      });
    }
  });

  it('installs a font on a text target and preserves both in one undo', async () => {
    const id = useProjectStore.getState().addLayer('text');
    resetHistory();
    await placeCanvasNonImage(fake('TestFont.woff2', 'font/woff2'), { x: 0, y: 0 }, id);
    expect(useProjectStore.getState().project.compositions[0]!.layers[0]!.element).toMatchObject({
      fontFamily: 'TestFont',
    });
    undo();
    expect(useProjectStore.getState().project.compositions[0]!.assets).toHaveLength(0);
  });

  it('binds a Brand Kit color and rejects a stale token without altering history', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const token = store.addDesignToken('color');
    const context = {
      tokenId: token,
      projectId: store.project.id,
      compositionId: store.activeCompositionId,
    };
    resetHistory();
    applyCanvasBrandColor(context, id);
    expect(
      useProjectStore.getState().project.compositions[0]!.layers.find((layer) => layer.id === id)
        ?.designTokenBindings,
    ).toContainEqual({ tokenId: token, targetProperty: 'fill' });
    expect(() => applyCanvasBrandColor({ ...context, tokenId: 'missing' }, id)).toThrow();
    expect(getHistorySnapshot().past).toHaveLength(1);
  });
});
