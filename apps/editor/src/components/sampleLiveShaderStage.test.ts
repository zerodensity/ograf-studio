import { describe, expect, it, vi } from 'vitest';
import { sampleLiveShaderStage } from './sampleLiveShaderStage';

function stage(overrides: Record<string, unknown> = {}) {
  return {
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      width: 200,
      height: 100,
    }),
    ownerDocument: {
      defaultView: {
        location: { href: 'http://localhost/', origin: 'http://localhost' },
        getComputedStyle: () => ({ backgroundImage: 'none' }),
      },
    },
    offsetWidth: 200,
    offsetHeight: 100,
    ...overrides,
  } as unknown as HTMLElement;
}

describe('live shader eyedropper capture safety', () => {
  it('rejects video instead of silently sampling a missing poster or webcam frame', async () => {
    const root = stage({
      querySelector: (selector: string) => (selector.startsWith('video') ? {} : null),
    });
    await expect(sampleLiveShaderStage(root, 40, 40, [])).rejects.toThrow(
      /video media cannot be sampled/,
    );
  });
  it('rejects a shader whose framebuffer is not preserved', async () => {
    const shader = {
      getContext: () => ({
        isContextLost: () => false,
        getContextAttributes: () => ({ preserveDrawingBuffer: false }),
      }),
    };
    const root = stage({
      querySelectorAll: (selector: string) => (selector.includes('shader-canvas') ? [shader] : []),
    });
    await expect(sampleLiveShaderStage(root, 40, 40, [])).rejects.toThrow(
      /cannot be sampled safely/,
    );
  });
  it('rejects restricted shader pixels rather than returning a blank color', async () => {
    const shader = {
      getContext: () => null,
      toDataURL: () => {
        throw new Error('SecurityError');
      },
    };
    const root = stage({
      querySelectorAll: (selector: string) => (selector.includes('shader-canvas') ? [shader] : []),
    });
    await expect(sampleLiveShaderStage(root, 40, 40, [])).rejects.toThrow(/restricted pixels/);
  });
  it('rejects cross-origin images before a snapshot can silently omit them', async () => {
    const image = {
      complete: true,
      naturalWidth: 10,
      currentSrc: 'https://external.example/image.png',
    };
    const root = stage({
      querySelectorAll: (selector: string) => (selector === 'img' ? [image] : []),
    });
    await expect(sampleLiveShaderStage(root, 40, 40, [])).rejects.toThrow(/External images/);
  });
});
