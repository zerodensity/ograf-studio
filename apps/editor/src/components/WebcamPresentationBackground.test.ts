import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWebcamPresentationStream,
  getWebcamPreviewState,
  type WebcamPreviewState,
} from '../state/webcamPreview';
import { WebcamPresentationBackground } from './WebcamPresentationBackground';
import { attachWebcamPresentationVideo } from './webcamPresentationVideo';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('../state/webcamPreview', () => ({
  getWebcamPresentationStream: vi.fn(),
  getWebcamPreviewState: vi.fn(),
  subscribeWebcamPreview: vi.fn(),
}));

function fixture() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const player = {
    srcObject: null as MediaStream | null,
    muted: false,
    defaultMuted: false,
    autoplay: false,
    playsInline: false,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    ownerDocument: { title: 'Detached preview window' },
  };
  return { stream, track, player, video: player as unknown as HTMLVideoElement };
}

const active = { status: 'running', presentation: true } as WebcamPreviewState;
const getUserMedia = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.mocked(getWebcamPreviewState).mockReturnValue(active);
});
afterEach(() => vi.unstubAllGlobals());

describe('passive webcam presentation video', () => {
  it('shares the existing stream across two consumers and releases only the local video', () => {
    const first = fixture(),
      second = fixture();
    const detachFirst = attachWebcamPresentationVideo(first.video, first.stream);
    const detachSecond = attachWebcamPresentationVideo(second.video, first.stream);
    expect(first.player.srcObject).toBe(first.stream);
    expect(second.player.srcObject).toBe(first.stream);
    expect(first.player).toMatchObject({
      muted: true,
      defaultMuted: true,
      autoplay: true,
      playsInline: true,
    });
    expect(first.player.play).toHaveBeenCalledOnce();
    expect(second.player.play).toHaveBeenCalledOnce();
    detachFirst();
    expect(first.player.pause).toHaveBeenCalledOnce();
    expect(first.player.srcObject).toBeNull();
    expect(second.player.srcObject).toBe(first.stream);
    expect(second.player.pause).not.toHaveBeenCalled();
    expect(first.track.stop).not.toHaveBeenCalled();
    detachFirst();
    expect(first.player.pause).toHaveBeenCalledOnce();
    detachSecond();
    expect(first.track.stop).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('does not let stale cleanup detach a replacement stream or a newer attachment of the same stream', () => {
    const first = fixture(),
      next = fixture();
    const oldCleanup = attachWebcamPresentationVideo(first.video, first.stream);
    const replacementCleanup = attachWebcamPresentationVideo(first.video, next.stream);
    oldCleanup();
    expect(first.player.srcObject).toBe(next.stream);
    expect(first.player.pause).not.toHaveBeenCalled();
    const newestCleanup = attachWebcamPresentationVideo(first.video, next.stream);
    replacementCleanup();
    expect(first.player.srcObject).toBe(next.stream);
    newestCleanup();
    expect(first.player.srcObject).toBeNull();
    expect(first.track.stop).not.toHaveBeenCalled();
    expect(next.track.stop).not.toHaveBeenCalled();
  });

  it('uses the supplied detached-document video without querying the global document or camera', () => {
    const { stream, player, video } = fixture();
    const createElement = vi.fn(() => {
      throw new Error('Unexpected main-document access');
    });
    vi.stubGlobal('document', { createElement });
    const cleanup = attachWebcamPresentationVideo(video, stream);
    expect(player.srcObject).toBe(stream);
    expect(createElement).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    cleanup();
  });

  it('contains autoplay rejection without taking ownership of the camera', async () => {
    const { stream, player, video, track } = fixture();
    player.play.mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'));
    const cleanup = attachWebcamPresentationVideo(video, stream);
    await Promise.resolve();
    expect(player.srcObject).toBe(stream);
    cleanup();
    expect(track.stop).not.toHaveBeenCalled();
  });
});

describe('shared webcam presentation backdrop markup', () => {
  it('renders a passive cover video for an existing running presentation stream', () => {
    const { stream } = fixture();
    vi.mocked(getWebcamPresentationStream).mockReturnValue(stream);
    const html = renderToStaticMarkup(
      createElement(WebcamPresentationBackground, { className: 'preview-background' }),
    );
    expect(html).toContain('class="webcam-presentation-background preview-background"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<video');
    for (const attribute of ['autoPlay=""', 'muted=""', 'playsInline=""', 'tabindex="-1"'])
      expect(html).toContain(attribute);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'idle', presentation: false },
    { status: 'starting', presentation: true },
    { status: 'running', presentation: false },
    { status: 'error', presentation: true },
  ] as const)('stays absent for %s without requesting capture', (state) => {
    vi.mocked(getWebcamPreviewState).mockReturnValue(state as WebcamPreviewState);
    vi.mocked(getWebcamPresentationStream).mockReturnValue(fixture().stream);
    expect(renderToStaticMarkup(createElement(WebcamPresentationBackground))).toBe('');
    expect(getWebcamPresentationStream).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('stays absent when the running state has no presentation stream', () => {
    vi.mocked(getWebcamPresentationStream).mockReturnValue(null);
    expect(renderToStaticMarkup(createElement(WebcamPresentationBackground))).toBe('');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
