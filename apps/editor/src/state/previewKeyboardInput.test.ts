import { describe, expect, it, vi } from 'vitest';
import {
  canTriggerPreviewKeyboardRule,
  dispatchPreviewKeyboardInput,
} from './previewKeyboardInput';

describe('preview keyboard player forwarding', () => {
  it('uses the currently attached player with the original key phase and modifier state', () => {
    const handleKeyboardInput = vi.fn(() => true);
    const container = { firstElementChild: { handleKeyboardInput } } as unknown as HTMLElement;
    const onError = vi.fn();
    const event = {
      type: 'keyup',
      key: 'Enter',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
      repeat: false,
      isComposing: false,
    } as KeyboardEvent;
    expect(dispatchPreviewKeyboardInput(container, event, onError)).toBe(true);
    expect(handleKeyboardInput).toHaveBeenCalledExactlyOnceWith(
      'key-up',
      {
        key: 'Enter',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        repeat: false,
        isComposing: false,
      },
      event,
    );
    expect(onError).not.toHaveBeenCalled();
    expect(dispatchPreviewKeyboardInput(null, event, onError)).toBe(false);
    expect(
      dispatchPreviewKeyboardInput({ firstElementChild: {} } as HTMLElement, event, onError),
    ).toBe(false);
    handleKeyboardInput.mockClear();
    const wrappedGraphic = { handleKeyboardInput } as unknown as Element;
    expect(dispatchPreviewKeyboardInput(null, event, onError, wrappedGraphic)).toBe(true);
    expect(handleKeyboardInput).toHaveBeenCalledExactlyOnceWith(
      'key-up',
      expect.objectContaining({ key: 'Enter' }),
      event,
    );
  });

  it('claims a failed player action and reports it instead of invoking navigation as a fallback', () => {
    const error = new Error('Rule action failed');
    const onError = vi.fn();
    const container = {
      firstElementChild: {
        handleKeyboardInput: () => {
          throw error;
        },
      },
    } as unknown as HTMLElement;
    expect(
      dispatchPreviewKeyboardInput(
        container,
        { key: 'k', type: 'keydown' } as KeyboardEvent,
        onError,
      ),
    ).toBe(true);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('rejects protected shadow-DOM targets and shortcut recording without stopping unrelated events', () => {
    const protectedTarget = { closest: () => ({}) };
    expect(
      canTriggerPreviewKeyboardRule({
        composedPath: () => [protectedTarget],
      } as unknown as KeyboardEvent),
    ).toBe(false);
    expect(canTriggerPreviewKeyboardRule({ isComposing: true } as KeyboardEvent)).toBe(false);
    expect(canTriggerPreviewKeyboardRule({ key: 'Dead' } as KeyboardEvent)).toBe(false);
    expect(
      canTriggerPreviewKeyboardRule({
        key: 'k',
        target: { closest: () => null },
      } as unknown as KeyboardEvent),
    ).toBe(true);
  });
});
