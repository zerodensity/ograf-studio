import { describe, expect, it, vi } from 'vitest';
import {
  choosePresentationBackground,
  presentationBackgroundChoice,
} from './presentationBackgroundSelection';
import { useCanvasBackdropStore } from './canvasBackdropStore';

describe('shared presentation background selection', () => {
  it('selects document and program sources using the same ownership and camera rules', () => {
    const webcam = { mode: 'webcam' as const, imageSource: '', imageName: '' };
    const update = vi.fn(() => true);
    const setProgram = vi.fn();
    const stop = vi.fn();
    expect(
      choosePresentationBackground('program:video', 'project:1', webcam, update, setProgram, stop),
    ).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(setProgram).toHaveBeenCalledWith('video');
    expect(
      choosePresentationBackground('still-image', 'project:1', webcam, update, setProgram, stop),
    ).toBe(true);
    expect(update).toHaveBeenCalledWith({ mode: 'still-image' }, 'project:1');
    expect(setProgram).toHaveBeenLastCalledWith('document');
    expect(presentationBackgroundChoice('still-image', 'document')).toBe('still-image');
    expect(presentationBackgroundChoice('still-image', 'sample-news')).toBe('program:sample-news');
  });

  it('rejects stale owners, unknown choices and failed document updates', () => {
    const settings = { mode: 'none' as const, imageSource: '', imageName: '' };
    const update = vi.fn(() => false);
    const setProgram = vi.fn();
    const stop = vi.fn();
    expect(choosePresentationBackground('webcam', null, settings, update, setProgram, stop)).toBe(
      false,
    );
    expect(
      choosePresentationBackground(
        'program:unknown',
        'project:1',
        settings,
        update,
        setProgram,
        stop,
      ),
    ).toBe(false);
    expect(
      choosePresentationBackground('webcam', 'project:1', settings, update, setProgram, stop),
    ).toBe(false);
    expect(setProgram).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('lets the editor hide its shared presentation bed without changing the source', () => {
    const previous = useCanvasBackdropStore.getState();
    try {
      useCanvasBackdropStore.getState().setBackdrop({ mode: 'solid', showPresentation: false });
      expect(useCanvasBackdropStore.getState()).toMatchObject({
        mode: 'solid',
        showPresentation: false,
      });
      useCanvasBackdropStore.getState().setBackdrop({ showPresentation: true });
      expect(useCanvasBackdropStore.getState()).toMatchObject({
        mode: 'solid',
        showPresentation: true,
      });
    } finally {
      useCanvasBackdropStore.setState({
        mode: previous.mode,
        color: previous.color,
        showPresentation: previous.showPresentation,
      });
    }
  });
});
