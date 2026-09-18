import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendDictatedText,
  cancelDictation,
  startDictation,
  stopDictation,
  useDictationState,
  type BrowserRecognition,
  type RecognitionResultEvent,
} from './speechDictation';

class Recognition implements BrowserRecognition {
  static instances: Recognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: BrowserRecognition['onresult'] = null;
  onerror: BrowserRecognition['onerror'] = null;
  onend: BrowserRecognition['onend'] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    Recognition.instances.push(this);
  }
}
const result = (...texts: string[]): RecognitionResultEvent => ({
  resultIndex: 0,
  results: texts.map((transcript) => ({ isFinal: true, 0: { transcript } })),
});

describe('annotation dictation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Recognition.instances = [];
  });
  afterEach(() => {
    cancelDictation();
    vi.useRealTimers();
  });
  it('appends only new finalized speech without replacing typed annotations', () => {
    let text = 'Make this smaller';
    const error = vi.fn();
    startDictation(
      'area-1',
      Recognition,
      'en-US',
      (words) => {
        text = appendDictatedText(text, words);
      },
      error,
    );
    const recognition = Recognition.instances[0]!;
    recognition.onresult?.(result('and red'));
    recognition.onresult?.(result('and red', 'with a thin border'));
    expect(text).toBe('Make this smaller and red with a thin border');
    expect(recognition.lang).toBe('en-US');
    expect(recognition.continuous).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
  it('waits for the final speech result after Stop and then releases the mic state', () => {
    const text = vi.fn();
    startDictation('area-1', Recognition, 'en-US', text, vi.fn());
    const recognition = Recognition.instances[0]!;
    stopDictation('area-1');
    expect(recognition.stop).toHaveBeenCalled();
    expect(useDictationState.getState()).toEqual({ activeId: 'area-1', stopping: true });
    recognition.onresult?.(result('larger font'));
    recognition.onend?.();
    expect(text).toHaveBeenCalledWith('larger font');
    expect(useDictationState.getState().activeId).toBeNull();
  });
  it('cancels the old field and ignores late results when switching or removing it', () => {
    const oldText = vi.fn();
    startDictation('area-1', Recognition, 'en-US', oldText, vi.fn());
    const first = Recognition.instances[0]!,
      late = first.onresult;
    startDictation('area-2', Recognition, 'en-US', vi.fn(), vi.fn());
    late?.(result('wrong field'));
    expect(first.abort).toHaveBeenCalled();
    expect(oldText).not.toHaveBeenCalled();
    cancelDictation('area-1');
    expect(useDictationState.getState().activeId).toBe('area-2');
    cancelDictation('area-2');
    expect(useDictationState.getState().activeId).toBeNull();
  });
  it('reports denied access and stops automatically after a bounded recording', () => {
    const error = vi.fn();
    startDictation('area-1', Recognition, 'en-US', vi.fn(), error);
    Recognition.instances[0]!.onerror?.({ error: 'not-allowed' });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Microphone access was denied'));
    expect(useDictationState.getState().activeId).toBeNull();
    startDictation('area-2', Recognition, 'en-US', vi.fn(), error);
    vi.advanceTimersByTime(60_000);
    expect(Recognition.instances[1]!.stop).toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(Recognition.instances[1]!.abort).toHaveBeenCalled();
    expect(useDictationState.getState().activeId).toBeNull();
  });
  it('preserves spacing and respects annotation length limits', () => {
    expect(appendDictatedText('Red', ', please')).toBe('Red, please');
    expect(appendDictatedText('Red ', 'please')).toBe('Red please');
    expect(appendDictatedText('1234', '5678', 6)).toBe('1234 5');
  });
});
