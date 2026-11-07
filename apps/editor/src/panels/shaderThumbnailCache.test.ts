import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShaderElement } from '@ograf-editor/scene-model';
const rendererFactory = vi.hoisted(() => vi.fn());
vi.mock('@ograf-editor/ograf-runtime', () => ({ createShaderRenderer: rendererFactory }));
import {
  ShaderThumbnailCache,
  scheduleShaderThumbnail,
  shaderThumbnailKey,
} from './shaderThumbnailCache';

const paint = createShaderElement();
function owner() {
  const canvas = {
    width: 0,
    height: 0,
    toDataURL: vi.fn(() => 'data:image/png;base64,thumbnail'),
    remove: vi.fn(),
  };
  const document = { createElement: vi.fn(() => canvas) } as unknown as Document;
  return {
    canvas,
    document,
    window: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    } as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>,
  };
}
beforeEach(() => {
  rendererFactory.mockReset();
  rendererFactory.mockImplementation(() => ({
    ready: vi.fn(async () => {}),
    render: vi.fn(),
    dispose: vi.fn(),
  }));
});
afterEach(() => vi.useRealTimers());

describe('shader resource thumbnail snapshots', () => {
  it('serializes simultaneous thumbnail renders and coalesces duplicate requests', async () => {
    const target = owner();
    const cache = new ShaderThumbnailCache();
    let release!: () => void;
    rendererFactory.mockImplementationOnce(() => ({
      ready: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      render: vi.fn(),
      dispose: vi.fn(),
    }));
    const a = cache.get(target.document, paint);
    const duplicate = cache.get(target.document, paint);
    const b = cache.get(target.document, { ...paint, speed: 2 });
    await Promise.resolve();
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    release();
    const [first, same, second] = await Promise.all([a, duplicate, b]);
    expect(first).toBe(same);
    expect(second.kind).toBe('ready');
    expect(rendererFactory).toHaveBeenCalledTimes(2);
    expect(rendererFactory.mock.results[0]!.value.dispose).toHaveBeenCalledTimes(1);
  });
  it('previews effect-only resources with a temporary image while retaining the original resource', async () => {
    const target = owner();
    const effect = createShaderElement({
      fragmentSource:
        'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy); }',
    });
    const before = JSON.stringify(effect);
    await expect(new ShaderThumbnailCache().get(target.document, effect)).resolves.toMatchObject({
      kind: 'ready',
    });
    const renderedPaint = rendererFactory.mock.calls[0]?.[1];
    expect(renderedPaint).not.toBe(effect);
    expect(renderedPaint).toMatchObject({
      fragmentSource: effect.fragmentSource,
      inputImage: { name: 'Preview checkerboard — not applied', filter: 'nearest' },
    });
    expect(JSON.stringify(effect)).toBe(before);
    expect(effect).not.toHaveProperty('inputImage');
  });
  it('renders actual shader time in the owning document and captures before disposing GPU resources', async () => {
    const target = owner();
    const events: string[] = [];
    const renderer = {
      render: vi.fn((time: number) => events.push(`render:${time}`)),
      ready: vi.fn(async () => events.push('ready')),
      dispose: vi.fn(() => events.push('dispose')),
    };
    rendererFactory.mockReturnValue(renderer);
    target.canvas.toDataURL.mockImplementation(() => {
      events.push('capture');
      return 'data:image/png;base64,thumbnail';
    });
    await expect(new ShaderThumbnailCache().get(target.document, paint)).resolves.toEqual({
      kind: 'ready',
      dataUrl: 'data:image/png;base64,thumbnail',
    });
    expect(target.document.createElement).toHaveBeenCalledWith('canvas');
    expect(rendererFactory).toHaveBeenCalledWith(target.canvas, paint, { width: 160, height: 90 });
    expect(events).toEqual(['ready', 'render:2000', 'capture', 'dispose']);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(target.canvas.remove).toHaveBeenCalledTimes(1);
    expect([target.canvas.width, target.canvas.height]).toEqual([1, 1]);
  });

  it('reuses cached PNGs across expansion/documents and keys every rendering parameter', async () => {
    const first = owner(),
      detached = owner(),
      cache = new ShaderThumbnailCache();
    const result = await cache.get(first.document, paint);
    expect(await cache.get(detached.document, { ...paint })).toBe(result);
    expect(detached.document.createElement).not.toHaveBeenCalled();
    for (const changed of [
      { ...paint, fragmentSource: `${paint.fragmentSource}\n// variant` },
      { ...paint, speed: 2 },
      { ...paint, resolutionScale: 0.5 },
      { ...paint, parameters: { waveFrequency: 4 } },
      {
        ...paint,
        inputImage: {
          source: 'data:image/png;base64,iVBORw0KGgo=',
          wrap: 'repeat' as const,
          filter: 'linear' as const,
        },
      },
    ])
      await cache.get(detached.document, changed);
    expect(rendererFactory).toHaveBeenCalledTimes(6);
    expect(shaderThumbnailKey({ ...paint, parameters: { a: 1, b: [2, 3] } })).toBe(
      shaderThumbnailKey({ ...paint, parameters: { b: [2, 3], a: 1 } }),
    );
  });

  it('evicts the least recently used thumbnail when its bounded cache fills', async () => {
    const target = owner(),
      cache = new ShaderThumbnailCache(2);
    const second = { ...paint, speed: 2 },
      third = { ...paint, speed: 3 };
    await cache.get(target.document, paint);
    await cache.get(target.document, second);
    await cache.get(target.document, paint);
    await cache.get(target.document, third);
    await cache.get(target.document, paint);
    expect(rendererFactory).toHaveBeenCalledTimes(3);
    await cache.get(target.document, second);
    expect(rendererFactory).toHaveBeenCalledTimes(4);
  });

  it.each(['render', 'capture'])(
    'disposes on %s failure and reuses the compact error result',
    async (stage) => {
      const target = owner(),
        cache = new ShaderThumbnailCache();
      const renderer = { ready: vi.fn(async () => {}), render: vi.fn(), dispose: vi.fn() };
      rendererFactory.mockReturnValue(renderer);
      const fail = () => {
        throw new Error('Shader preview failed');
      };
      if (stage === 'render') renderer.render.mockImplementation(fail);
      else target.canvas.toDataURL.mockImplementation(fail);
      const result = await cache.get(target.document, paint);
      expect(result).toEqual({ kind: 'error', message: 'Shader preview failed' });
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
      expect(target.canvas.remove).toHaveBeenCalledTimes(1);
      expect(await cache.get(target.document, paint)).toBe(result);
      expect(rendererFactory).toHaveBeenCalledTimes(1);
    },
  );

  it('releases the temporary canvas when shader construction fails', async () => {
    const target = owner();
    rendererFactory.mockImplementation(() => {
      throw new Error('Invalid fragment shader');
    });
    await expect(new ShaderThumbnailCache().get(target.document, paint)).resolves.toEqual({
      kind: 'error',
      message: 'Invalid fragment shader',
    });
    expect(target.canvas.remove).toHaveBeenCalledTimes(1);
  });

  it('cancels work for closed rows and does not deliver results after cancellation', async () => {
    vi.useFakeTimers();
    const target = owner(),
      cache = new ShaderThumbnailCache(),
      stale = vi.fn(),
      current = vi.fn();
    const cancel = scheduleShaderThumbnail(target, paint, stale, cache);
    cancel();
    scheduleShaderThumbnail(target, { ...paint, speed: 2 }, current, cache);
    await vi.runAllTimersAsync();
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);

    let cancelDuringRender = () => {};
    const dispose = vi.fn();
    rendererFactory.mockReturnValue({
      ready: vi.fn(async () => {}),
      render: () => cancelDuringRender(),
      dispose,
    });
    cancelDuringRender = scheduleShaderThumbnail(target, { ...paint, speed: 3 }, stale, cache);
    await vi.runAllTimersAsync();
    expect(stale).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
