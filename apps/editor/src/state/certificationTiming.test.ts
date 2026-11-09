import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import type { CompiledTransitionLogicDescriptor } from '@ograf-editor/ograf-types';
import {
  CERTIFICATION_READINESS_ALLOWANCE_MS,
  MAX_CERTIFICATION_METHOD_TIMEOUT_MS,
  certificationMethodTiming,
  certificationPromiseWithTimeout,
} from './certificationTiming';

function fixture() {
  const project = createProject(),
    composition = project.compositions[0]!;
  composition.frameRate = 25;
  composition.transitions[0]!.durationFrames = 80;
  composition.transitions[1]!.durationFrames = 160;
  composition.layers.push(createLayerOfKind('text'));
  return compileDescriptor(composition);
}

afterEach(() => vi.useRealTimers());
describe('authored certification timing', () => {
  it('allows an 80-frame In at 25 fps and the complete longer Out, with bounded readiness time', async () => {
    vi.useFakeTimers();
    const descriptor = fixture();
    for (const [method, frames] of [
      ['playAction', 80],
      ['stopAction', 160],
    ] as const) {
      const timing = certificationMethodTiming(descriptor, method, {}, 'realtime');
      expect(timing).toEqual({
        authoredDurationMs: frames * 40,
        timeoutMs: frames * 40 + CERTIFICATION_READINESS_ALLOWANCE_MS,
        capped: false,
      });
      const result = certificationPromiseWithTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve('completed'), frames * 40)),
        method,
        timing,
      );
      await vi.advanceTimersByTimeAsync(frames * 40);
      await expect(result).resolves.toBe('completed');
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('budgets the longest update transition and the selected authored custom action', () => {
    const descriptor = fixture();
    descriptor.updateTransitionFrames = 100;
    descriptor.layers[0]!.updateTransition = {
      style: 'crossfade',
      durationFrames: 150,
      distance: 10,
    };
    descriptor.customActions = [{ id: 'long-wipe', name: 'Long wipe', durationFrames: 175 }];
    expect(
      certificationMethodTiming(descriptor, 'updateAction', {}, 'realtime').authoredDurationMs,
    ).toBe(6000);
    expect(
      certificationMethodTiming(descriptor, 'customAction', { id: 'long-wipe' }, 'realtime')
        .authoredDurationMs,
    ).toBe(7000);
  });

  it('does not wait out the timeline for non-real-time seeks or skipAnimation operations', () => {
    const descriptor = fixture();
    for (const method of ['playAction', 'stopAction', 'goToTime'] as const) {
      expect(certificationMethodTiming(descriptor, method, {}, 'non-realtime')).toEqual({
        authoredDurationMs: 0,
        timeoutMs: CERTIFICATION_READINESS_ALLOWANCE_MS,
        capped: false,
      });
      expect(
        certificationMethodTiming(descriptor, method, { skipAnimation: true }, 'realtime')
          .authoredDurationMs,
      ).toBe(0);
    }
  });

  it('still rejects a stalled promise and explains its actual authored timing budget', async () => {
    vi.useFakeTimers();
    const timing = certificationMethodTiming(fixture(), 'stopAction', {}, 'realtime');
    const result = certificationPromiseWithTimeout(new Promise(() => {}), 'stopAction', timing);
    const rejected = expect(result).rejects.toThrow(/9400 ms.*authored motion 6400 ms/);
    await vi.advanceTimersByTimeAsync(timing.timeoutMs);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting for a stalled graphics operation when export is cancelled', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');
    const timing = certificationMethodTiming(fixture(), 'playAction', {}, 'realtime');
    const result = certificationPromiseWithTimeout(
      new Promise(() => {}),
      'playAction',
      timing,
      abort.signal,
    );
    abort.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps very long authored actions and promptly clears the timer on method rejection', async () => {
    vi.useFakeTimers();
    const descriptor = fixture();
    descriptor.transitions[1]!.durationFrames = 1_000_000;
    expect(certificationMethodTiming(descriptor, 'stopAction', {}, 'realtime')).toMatchObject({
      timeoutMs: MAX_CERTIFICATION_METHOD_TIMEOUT_MS,
      capped: true,
    });
    await expect(
      certificationPromiseWithTimeout(
        Promise.reject(Error('Renderer failed')),
        'load',
        certificationMethodTiming(descriptor, 'load', {}, 'realtime'),
      ),
    ).rejects.toThrow('Renderer failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('budgets sequential parent entry and outgoing cascades for coordinated Play, while skip/NRT stays bounded', () => {
    const descriptor: CompiledTransitionLogicDescriptor = {
      version: 1,
      id: 'news',
      name: 'News',
      width: 1920,
      height: 1080,
      frameRate: 25,
      definition: {
        version: 4,
        id: 'news',
        name: 'News',
        slots: [
          { id: 'headline', name: 'Headline', order: 0 },
          {
            id: 'subline',
            name: 'Subline',
            order: 1,
            admission: { requireOnSlotIds: ['headline'] },
          },
          { id: 'header', name: 'Header', order: 2, admission: { requireOnSlotIds: ['subline'] } },
        ],
        states: [],
        sharedInstances: [],
        initialSharedValues: [],
        routes: [],
        defaultTransitionId: 'entry',
        transitions: [
          {
            id: 'entry',
            name: 'Entry',
            durationFrames: 80,
            outgoingFrames: 80,
            incomingStartFrame: 0,
            incomingFrames: 80,
            sharedFrames: 80,
            easing: 'linear',
          },
        ],
      },
      templates: [],
      sharedInstances: [],
    };
    expect(
      certificationMethodTiming(descriptor, 'playAction', {}, 'realtime').authoredDurationMs,
    ).toBe(80 * 7 * 40);
    for (const mode of ['realtime', 'non-realtime'] as const)
      expect(
        certificationMethodTiming(descriptor, 'playAction', { skipAnimation: true }, mode),
      ).toEqual({
        authoredDurationMs: 0,
        timeoutMs: CERTIFICATION_READINESS_ALLOWANCE_MS,
        capped: false,
      });
    expect(
      certificationMethodTiming(descriptor, 'goToTime', {}, 'non-realtime').authoredDurationMs,
    ).toBe(0);
  });
});
