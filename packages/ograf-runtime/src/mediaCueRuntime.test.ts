import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaCue, type MediaCue } from '@ograf-editor/scene-model';
import { MediaCueRuntime, mediaCueAutomaticStartMs } from './mediaCueRuntime';

const originalMediaElement = globalThis.HTMLMediaElement;
const originalVideoElement = globalThis.HTMLVideoElement;

afterEach(() => {
  Object.defineProperty(globalThis, 'HTMLMediaElement', {
    configurable: true,
    value: originalMediaElement,
  });
  Object.defineProperty(globalThis, 'HTMLVideoElement', {
    configurable: true,
    value: originalVideoElement,
  });
});

function audioFixture(patch: Partial<MediaCue> = {}, foreignRealm = false) {
  const mediaClass = () =>
    class {
      src = '';
      preload = '';
      loop = false;
      muted = false;
      volume = 1;
      playbackRate = 1;
      currentTime = 0;
      duration = 32;
      readyState = 1;
      paused = true;
      playsInline = false;
      ownerDocument: unknown = null;
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      play = vi.fn(async () => {
        this.paused = false;
      });
      pause = vi.fn(() => {
        this.paused = true;
      });
      removeAttribute = vi.fn();
      load = vi.fn();
      remove = vi.fn();
    };
  const FakeMedia = mediaClass();
  const ForeignMedia = mediaClass();
  class FakeVideo extends FakeMedia {}
  Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: FakeMedia });
  Object.defineProperty(globalThis, 'HTMLVideoElement', { configurable: true, value: FakeVideo });
  const created: InstanceType<typeof FakeMedia>[] = [];
  const primaryDocument = {
    defaultView: { HTMLMediaElement: FakeMedia, HTMLVideoElement: FakeVideo },
    createElement: () => new FakeMedia(),
  };
  const secondaryDocument = {
    defaultView: { HTMLMediaElement: ForeignMedia, HTMLVideoElement: ForeignMedia },
    createElement: () => new ForeignMedia(),
  };
  const host = {
    dataset: {} as Record<string, string>,
    ownerDocument: foreignRealm ? secondaryDocument : primaryDocument,
    appendChild: (media: InstanceType<typeof FakeMedia>) => {
      media.ownerDocument = host.ownerDocument;
      created.push(media);
    },
    remove: vi.fn(),
  };
  const cue = createMediaCue({
    id: 'music',
    sources: [
      { id: 'main', name: 'Original music', kind: 'clip', mediaType: 'audio', src: 'asset:music' },
    ],
    activeSourceId: 'main',
    trigger: { type: 'manual' },
    loop: true,
    volume: 0.4,
    retrigger: 'ignore',
    ...patch,
  });
  const runtime = new MediaCueRuntime(
    host as unknown as HTMLElement,
    {
      frameRate: 25,
      keyframes: [],
      mediaCues: [cue],
    } as never,
  );
  const adopt = () => {
    host.ownerDocument =
      host.ownerDocument === primaryDocument ? secondaryDocument : primaryDocument;
    for (const media of created) media.ownerDocument = host.ownerDocument;
  };
  return { runtime, cue, created, host, adopt };
}

describe('bounded media cue audio transport', () => {
  it.each([false, true])(
    'plays and controls audio across detach and redock (initial foreign realm: %s)',
    async (foreignRealm) => {
      const { runtime, created, host, adopt } = audioFixture({}, foreignRealm);
      await runtime.take('music', 'main', 0);
      const first = created[0]!;
      expect(first.play).toHaveBeenCalledOnce();
      expect(first.paused).toBe(false);
      expect(first.loop).toBe(true);
      if (foreignRealm) expect(first).not.toBeInstanceOf(globalThis.HTMLMediaElement);

      // Adoption changes ownerDocument, not the node's original prototype/realm.
      adopt();
      expect(first).not.toBeInstanceOf(host.ownerDocument.defaultView.HTMLMediaElement);
      runtime.setAudio('music', { gain: 0.5, muted: true });
      expect(first.muted).toBe(true);
      expect(first.volume).toBe(0);
      runtime.setAudio('music', { muted: false });
      expect(first.volume).toBe(0.2);
      first.currentTime = 4;
      runtime.pause('music');
      expect(first.paused).toBe(true);
      runtime.renderAtTime(10000);
      runtime.resumeBlocked();
      expect(first.currentTime).toBe(4);
      expect(first.play).toHaveBeenCalledOnce();
      runtime.resume('music');
      await Promise.resolve();
      expect(first.play).toHaveBeenCalledTimes(2);
      expect(first.paused).toBe(false);
      runtime.renderAtTime(15000);
      expect(first.currentTime).toBe(5);

      await runtime.restart('music');
      const second = created[1]!;
      expect(second.play).toHaveBeenCalledOnce();
      expect(second.volume).toBe(0.2);
      expect(first.removeAttribute).toHaveBeenCalledWith('src');
      expect(first.load).toHaveBeenCalledOnce();
      expect(first.paused).toBe(true);
      adopt();
      runtime.dispose();
      expect(second.paused).toBe(true);
      expect(second.removeAttribute).toHaveBeenCalledWith('src');
      expect(second.load).toHaveBeenCalledOnce();
      expect(created.every((media) => media.remove.mock.calls.length === 1)).toBe(true);
    },
  );

  it('retries blocked foreign-window audio after adoption without resuming a paused cue', async () => {
    const { runtime, created, host, adopt } = audioFixture({}, true);
    const create = host.ownerDocument.createElement;
    host.ownerDocument.createElement = () => {
      const media = create();
      media.play.mockRejectedValueOnce(new Error('Autoplay blocked'));
      return media;
    };
    await runtime.take('music', 'main', 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(host.dataset.ografMediaCueError).toBe('Autoplay blocked');
    adopt();
    runtime.resumeBlocked();
    await Promise.resolve();
    expect(created[0]!.play).toHaveBeenCalledTimes(2);
    expect(created[0]!.paused).toBe(false);
    expect(host.dataset.ografMediaCueError).toBeUndefined();
    runtime.pause('music');
    runtime.resumeBlocked();
    expect(created[0]!.play).toHaveBeenCalledTimes(2);
    expect(created[0]!.paused).toBe(true);
  });

  it('sets inline video playback for clips created in another window', async () => {
    const { runtime, created, adopt } = audioFixture(
      {
        sources: [
          { id: 'main', name: 'Video', kind: 'clip', mediaType: 'video', src: 'asset:video' },
        ],
      },
      true,
    );
    await runtime.take('music', 'main', 0);
    expect(created[0]!.playsInline).toBe(true);
    expect(created[0]!.play).toHaveBeenCalledOnce();
    adopt();
    runtime.pause('music');
    expect(created[0]!.paused).toBe(true);
    runtime.resume('music');
    expect(created[0]!.paused).toBe(false);
    runtime.stop('music');
    expect(created[0]!.load).toHaveBeenCalledOnce();
  });

  it('does not treat a live-source adapter as a native media clip', async () => {
    const { runtime, created } = audioFixture(
      {
        sources: [{ id: 'main', name: 'Live camera', kind: 'live', tag: 'camera' }],
      },
      true,
    );
    await runtime.take('music', 'main', 0);
    runtime.setAudio('music', { gain: 0.5 });
    runtime.pause('music');
    runtime.resume('music');
    runtime.renderAtTime(100);
    runtime.dispose();
    expect(created[0]!.play).not.toHaveBeenCalled();
    expect(created[0]!.pause).not.toHaveBeenCalled();
    expect(created[0]!.load).not.toHaveBeenCalled();
    expect(created[0]!.remove).toHaveBeenCalledOnce();
  });

  it('keeps manual music dormant until explicitly started, then loops while the Step is parked', async () => {
    const { runtime, created } = audioFixture();
    runtime.renderAtTime(0);
    runtime.renderAtTime(90000, { includeAudio: false });
    runtime.resumeBlocked();
    expect(runtime.resume('music')).toBe(false);
    expect(created).toHaveLength(0);
    await runtime.take('music', 'main', 90000);
    const music = created[0]!;
    expect(music.loop).toBe(true);
    expect(music.play).toHaveBeenCalledOnce();
    music.currentTime = 7;
    runtime.renderAtTime(200000, { includeAudio: false });
    expect(music.currentTime).toBe(7);
    expect(music.play).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
  });

  it('pauses without losing the playhead and shifts sampled time on explicit resume', async () => {
    const { runtime, created } = audioFixture();
    await runtime.take('music', 'main', 0);
    const music = created[0]!;
    runtime.renderAtTime(5500, { includeAudio: false });
    music.currentTime = 5.5;
    expect(runtime.pause('music')).toBe(true);
    runtime.renderAtTime(20500);
    runtime.resumeBlocked();
    expect(music.paused).toBe(true);
    expect(music.currentTime).toBe(5.5);
    expect(music.play).toHaveBeenCalledOnce();
    expect(runtime.resume('music')).toBe(true);
    await Promise.resolve();
    runtime.renderAtTime(20500);
    expect(music.paused).toBe(false);
    expect(music.currentTime).toBe(5.5);
    expect(created).toHaveLength(1);
  });

  it('stops an automatic cue without rearming it and explicitly restarts from zero', async () => {
    const { runtime, created } = audioFixture({ trigger: { type: 'timeline', startFrame: 0 } });
    runtime.renderAtTime(0);
    await Promise.resolve();
    const old = created[0]!;
    old.currentTime = 12;
    expect(runtime.stop('music')).toBe(true);
    runtime.renderAtTime(5000);
    runtime.resumeBlocked();
    expect(runtime.resume('music')).toBe(false);
    expect(created).toHaveLength(1);
    expect(old.pause).toHaveBeenCalled();
    expect(old.removeAttribute).toHaveBeenCalledWith('src');
    expect(old.remove).toHaveBeenCalledOnce();
    expect(await runtime.restart('music', 5000)).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[1]!.currentTime).toBe(0);
    expect(created[1]!.loop).toBe(true);
    runtime.reset('music');
    expect(created[1]!.remove).toHaveBeenCalledOnce();
    expect(created).toHaveLength(2);
  });

  it.each([{ trimStartMs: 1000 }, { trimEndMs: 4000 }, { durationFrames: 80 }, { loop: false }])(
    'keeps trimmed/block-limited and one-shot playback on existing semantics: %j',
    async (patch) => {
      const { runtime, created } = audioFixture(patch);
      await runtime.take('music', 'main', 0);
      expect(created[0]!.loop).toBe(false);
    },
  );

  it('retains deterministic forward/backward seek positions for both full and trimmed loops', async () => {
    const whole = audioFixture();
    await whole.runtime.take('music', 'main', 0);
    whole.runtime.renderAtTime(33000);
    expect(whole.created[0]!.currentTime).toBe(1);
    whole.runtime.renderAtTime(2000);
    expect(whole.created[0]!.currentTime).toBe(2);
    const trimmed = audioFixture({ trimStartMs: 1000, trimEndMs: 3000 });
    await trimmed.runtime.take('music', 'main', 0);
    trimmed.runtime.renderAtTime(2500);
    expect(trimmed.created[0]!.currentTime).toBe(1.5);
    trimmed.runtime.renderAtTime(100);
    expect(trimmed.created[0]!.currentTime).toBe(1.1);
  });

  it('applies bounded gain/mute immediately without changing the authored cue', async () => {
    const { runtime, created, cue } = audioFixture();
    expect(runtime.setAudio('music', { gain: 0.5 })).toBe(true);
    await runtime.take('music', 'main', 0);
    const music = created[0]!;
    expect(music.volume).toBe(0.2);
    expect(runtime.setAudio('music', { muted: true })).toBe(true);
    expect(music.muted).toBe(true);
    expect(music.volume).toBe(0);
    runtime.setAudio('music', { muted: false });
    expect(music.volume).toBe(0.2);
    expect(music.muted).toBe(false);
    for (const gain of [-1, 2, NaN, Infinity])
      expect(runtime.setAudio('music', { gain })).toBe(false);
    expect(runtime.setAudio('missing', { muted: true })).toBe(false);
    expect(cue.volume).toBe(0.4);
    expect(cue.muted).toBe(false);
  });

  it.each([false, true])(
    'preserves crossfade mix and Stop cleanup (foreign realm: %s)',
    async (foreignRealm) => {
      const { runtime, created } = audioFixture(
        {
          retrigger: 'restart',
          transition: {
            type: 'crossfade',
            durationFrames: 25,
            audio: 'crossfade',
            onFailure: 'keep-current',
          },
        },
        foreignRealm,
      );
      await runtime.take('music', 'main', 0);
      await runtime.take('music', 'main', 1000);
      runtime.renderAtTime(1250);
      runtime.setAudio('music', { gain: 0.5 });
      expect(created[0]!.volume).toBeCloseTo(0.15);
      expect(created[1]!.volume).toBeCloseTo(0.05);
      runtime.pause('music');
      runtime.renderAtTime(6000);
      runtime.setAudio('music', { muted: true });
      expect(created.every((media) => media.muted && media.paused)).toBe(true);
      runtime.setAudio('music', { muted: false });
      expect(created[0]!.volume).toBeCloseTo(0.15);
      expect(created[1]!.volume).toBeCloseTo(0.05);
      runtime.stop('music');
      expect(created.every((media) => media.remove.mock.calls.length === 1)).toBe(true);
    },
  );

  it('restarts sound effects without seeking one-shots on later graphic transitions', async () => {
    const { runtime, created } = audioFixture({ loop: false, retrigger: 'restart' });
    await runtime.take('music', 'main', 0);
    created[0]!.currentTime = 0.3;
    runtime.renderAtTime(8000);
    expect(created[0]!.currentTime).toBe(0.3);
    expect(created[0]!.play).toHaveBeenCalledOnce();
    await runtime.take('music', 'main', 8000);
    expect(created[0]!.remove).toHaveBeenCalledOnce();
    expect(created[1]!.currentTime).toBe(0);
    runtime.dispose();
    expect(created.every((media) => media.paused)).toBe(true);
    expect(created[1]!.removeAttribute).toHaveBeenCalledWith('src');
    expect(created[1]!.remove).toHaveBeenCalledOnce();
    expect(runtime.resume('music')).toBe(false);
  });

  it('does not leak audio or report stale errors when pending play settles after Stop/replacement', async () => {
    const { runtime, created, host } = audioFixture();
    await runtime.take('music', 'main', 0);
    const old = created[0]!;
    runtime.pause('music');
    let reject!: (error: Error) => void;
    old.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    runtime.resume('music');
    runtime.stop('music');
    await runtime.restart('music');
    reject(new Error('Cancelled old playback'));
    await Promise.resolve();
    await Promise.resolve();
    expect(old.paused).toBe(true);
    expect(created[1]!.paused).toBe(false);
    expect(host.dataset.ografMediaCueError).toBeUndefined();
    runtime.dispose();
    expect(created.every((media) => media.paused)).toBe(true);
  });
});

describe('Media Cue runtime timing', () => {
  it('maps timeline and lifecycle triggers to the absolute OGraf clock', () => {
    const descriptor = {
      frameRate: 25,
      keyframes: [{ id: 'step', frame: 12, role: 'step' as const }],
    };
    expect(
      mediaCueAutomaticStartMs(
        createMediaCue({ trigger: { type: 'timeline', startFrame: 50 } }),
        descriptor,
      ),
    ).toBe(2_000);
    expect(
      mediaCueAutomaticStartMs(
        createMediaCue({
          trigger: { type: 'lifecycle', keyframeId: 'step' },
        }),
        descriptor,
      ),
    ).toBe(480);
  });

  it('keeps custom-action and manual cues dormant until explicitly triggered', () => {
    const descriptor = { frameRate: 25, keyframes: [] };
    expect(
      mediaCueAutomaticStartMs(
        createMediaCue({ trigger: { type: 'customAction', actionId: 'take' } }),
        descriptor,
      ),
    ).toBeNull();
    expect(
      mediaCueAutomaticStartMs(createMediaCue({ trigger: { type: 'manual' } }), descriptor),
    ).toBeNull();
  });

  it('defers audio on non-audio render ticks and retries an autoplay-blocked sound', async () => {
    class FakeMediaElement {
      src = '';
      preload = '';
      loop = false;
      muted = false;
      volume = 1;
      playbackRate = 1;
      currentTime = 0;
      duration = 1;
      readyState = 1;
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      play = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('Autoplay blocked'))
        .mockResolvedValue(undefined);
      pause = vi.fn();
      removeAttribute = vi.fn();
      load = vi.fn();
      remove = vi.fn();
    }
    class FakeVideoElement extends FakeMediaElement {
      playsInline = false;
    }
    Object.defineProperty(globalThis, 'HTMLMediaElement', {
      configurable: true,
      value: FakeMediaElement,
    });
    Object.defineProperty(globalThis, 'HTMLVideoElement', {
      configurable: true,
      value: FakeVideoElement,
    });

    const created: FakeMediaElement[] = [];
    const host = {
      dataset: {} as Record<string, string>,
      ownerDocument: {
        createElement: () => new FakeMediaElement(),
      },
      appendChild: (media: FakeMediaElement) => created.push(media),
      remove: vi.fn(),
    };
    const sourceId = 'sound-source';
    const runtime = new MediaCueRuntime(
      host as unknown as HTMLElement,
      {
        frameRate: 25,
        keyframes: [],
        mediaCues: [
          createMediaCue({
            id: 'sound',
            sources: [
              {
                id: sourceId,
                name: 'Sting',
                kind: 'clip',
                mediaType: 'audio',
                src: 'data:audio/wav;base64,AA==',
              },
            ],
            activeSourceId: sourceId,
            trigger: { type: 'timeline', startFrame: 0 },
          }),
        ],
      } as never,
    );

    runtime.renderAtTime(0, { includeAudio: false });
    expect(created).toHaveLength(0);

    runtime.renderAtTime(0);
    await Promise.resolve();
    runtime.renderAtTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]!.play).toHaveBeenCalledTimes(1);
    expect(host.dataset.ografMediaCueError).toBe('Autoplay blocked');

    runtime.resumeBlocked();
    await Promise.resolve();
    expect(created[0]!.play).toHaveBeenCalledTimes(2);
    expect(host.dataset.ografMediaCueError).toBeUndefined();

    runtime.renderAtTime(1_000);
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]!.play).toHaveBeenCalledTimes(2);
  });
});
