import { describe, expect, it } from 'vitest';
import { isPreviewPresentationSuspended } from './usePreviewPresentationSuspended';

describe('preview presentation suspension', () => {
  it.each([
    { paneVisible: true, onScreen: true, fullscreen: false, suspended: false },
    { paneVisible: false, onScreen: true, fullscreen: false, suspended: true },
    { paneVisible: true, onScreen: false, fullscreen: false, suspended: true },
    { paneVisible: false, onScreen: false, fullscreen: false, suspended: true },
    { paneVisible: false, onScreen: false, fullscreen: true, suspended: false },
    { paneVisible: true, onScreen: true, fullscreen: true, suspended: false },
  ])('%o', ({ suspended, ...state }) => {
    expect(isPreviewPresentationSuspended(state)).toBe(suspended);
  });
});
