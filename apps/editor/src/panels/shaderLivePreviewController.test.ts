import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createShaderElement } from '@ograf-editor/scene-model';
const rendererFactory = vi.hoisted(() => vi.fn());
vi.mock('@ograf-editor/ograf-runtime', () => ({ createShaderRenderer: rendererFactory }));
import { ShaderLivePreviewController } from './shaderLivePreviewController';

const paint = createShaderElement();
function fixture(hidden = false) {
  let now = 0,
    nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const canvases: Array<HTMLCanvasElement & { remove: ReturnType<typeof vi.fn> }> = [];
  const document = Object.assign(new EventTarget(), {
    hidden,
    createElement: vi.fn(() => {
      const canvas = Object.assign(new EventTarget(), {
        dataset: {},
        width: 480,
        height: 270,
        setAttribute: vi.fn(),
        remove: vi.fn(),
      }) as unknown as (typeof canvases)[number];
      canvases.push(canvas);
      return canvas;
    }),
  });
  const window = {
    performance: { now: () => now },
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      frames.delete(id);
    }),
  };
  const host = { replaceChildren: vi.fn() } as unknown as HTMLElement;
  const error = vi.fn();
  const controller = new ShaderLivePreviewController(
    host,
    { document: document as unknown as Document, window: window as unknown as Window },
    error,
  );
  return {
    controller,
    document,
    window,
    canvases,
    frames,
    host,
    error,
    tick(time: number) {
      now = time;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
    setTime(time: number) {
      now = time;
    },
    visible(visible: boolean) {
      document.hidden = !visible;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}
beforeEach(() => {
  rendererFactory.mockReset();
  rendererFactory.mockImplementation(() => ({
    render: vi.fn(),
    updateParameters: vi.fn(),
    dispose: vi.fn(),
  }));
});

describe('live draft shader preview', () => {
  it('animates on the owning window and reuses canvas/program/time for uniform and metadata-only updates', () => {
    const { controller, document, canvases, frames, tick } = fixture();
    controller.update(paint);
    const renderer = rendererFactory.mock.results[0]!.value;
    expect(document.createElement).toHaveBeenCalledWith('canvas');
    expect(rendererFactory).toHaveBeenCalledWith(
      canvases[0],
      paint,
      { width: 480, height: 270 },
      expect.any(Function),
    );
    tick(125);
    expect(renderer.render).toHaveBeenLastCalledWith(125);
    const changed = { ...paint, parameters: { waveFrequency: 4 } };
    controller.update(changed);
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(renderer.updateParameters).toHaveBeenCalledWith(changed);
    expect(renderer.render).toHaveBeenLastCalledWith(125);
    controller.update({ ...changed, parameters: { ...changed.parameters } });
    expect(renderer.updateParameters).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    tick(225);
    expect(renderer.render).toHaveBeenLastCalledWith(225);
    controller.dispose();
  });

  it('replaces only one context on source, scale or image-input changes and preserves the running phase', () => {
    const { controller, canvases, tick, frames } = fixture();
    controller.update(paint);
    tick(300);
    const first = rendererFactory.mock.results[0]!.value;
    const source = { ...paint, fragmentSource: `${paint.fragmentSource}\n// revised` };
    controller.update(source);
    const second = rendererFactory.mock.results[1]!.value;
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(canvases[0]!.remove).toHaveBeenCalledTimes(1);
    expect(second.render).toHaveBeenLastCalledWith(300);
    controller.update({ ...source, resolutionScale: 0.5 });
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(rendererFactory).toHaveBeenCalledTimes(3);
    controller.update({
      ...source,
      resolutionScale: 0.5,
      inputImage: {
        source: 'data:image/png;base64,iVBORw0KGgo=',
        wrap: 'repeat',
        filter: 'linear',
      },
    });
    expect(rendererFactory).toHaveBeenCalledTimes(4);
    expect(frames.size).toBe(1);
    controller.dispose();
  });

  it('does no GPU work while hidden and applies the latest draft when visible without advancing hidden time', () => {
    const target = fixture(true);
    target.controller.update(paint);
    expect(rendererFactory).not.toHaveBeenCalled();
    target.visible(true);
    target.tick(100);
    const renderer = rendererFactory.mock.results[0]!.value;
    target.visible(false);
    expect(target.frames.size).toBe(0);
    target.setTime(5000);
    const changed = { ...paint, parameters: { waveFrequency: 9 } };
    target.controller.update(changed);
    expect(renderer.updateParameters).not.toHaveBeenCalled();
    target.visible(true);
    expect(renderer.updateParameters).toHaveBeenCalledWith(changed);
    expect(renderer.render).toHaveBeenLastCalledWith(100);
    target.tick(5100);
    expect(renderer.render).toHaveBeenLastCalledWith(200);
    target.controller.dispose();
  });

  it('releases failed construction and recovers when a valid draft is supplied', () => {
    const target = fixture();
    rendererFactory.mockImplementationOnce(() => {
      throw new Error('Fragment compilation failed');
    });
    target.controller.update(paint);
    expect(target.error).toHaveBeenLastCalledWith('Fragment compilation failed');
    expect(target.canvases[0]!.remove).toHaveBeenCalledTimes(1);
    expect(target.frames.size).toBe(0);
    target.controller.update({ ...paint, fragmentSource: `${paint.fragmentSource}\n// fixed` });
    expect(target.error).toHaveBeenLastCalledWith(null);
    expect(target.frames.size).toBe(1);
    target.controller.dispose();
  });

  it('stops failed drawing and cancels all animation/listeners/GPU work on close', () => {
    const target = fixture();
    target.controller.update(paint);
    const renderer = rendererFactory.mock.results[0]!.value;
    renderer.render.mockImplementationOnce(() => {
      throw new Error('Context lost');
    });
    target.tick(100);
    expect(target.error).toHaveBeenLastCalledWith('Context lost');
    expect(target.frames.size).toBe(0);
    target.controller.dispose();
    target.controller.dispose();
    target.visible(false);
    target.visible(true);
    target.controller.update(paint);
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(target.frames.size).toBe(0);
  });
});
