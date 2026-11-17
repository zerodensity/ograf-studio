import type { VisualRuleKeyboardInput } from '@ograf-editor/scene-model';

const PROTECTED_TARGETS =
  'input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="separator"],[role="button"],dialog,[role="dialog"],[aria-modal="true"],[data-preview-controls],[data-rule-key-recording="true"]';

function targets(event: KeyboardEvent): Array<EventTarget | null> {
  const path = event.composedPath?.() ?? [];
  return path.length ? path : [event.target];
}

export function isPreviewKeyboardTyping(event: KeyboardEvent): boolean {
  return targets(event).some((node) => {
    const element = node as HTMLElement | null;
    return Boolean(
      element?.isContentEditable ||
      element?.closest?.(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="separator"]',
      ),
    );
  });
}

export function isPreviewKeyboardRecording(event: KeyboardEvent): boolean {
  return targets(event).some((node) =>
    Boolean((node as HTMLElement | null)?.closest?.('[data-rule-key-recording="true"]')),
  );
}

/** Playback keys belong to the graphic, never an editor field, popup, or shortcut recorder. */
export function canTriggerPreviewKeyboardRule(event: KeyboardEvent): boolean {
  if (event.isComposing || event.key === 'Process' || event.key === 'Dead') return false;
  for (const node of targets(event)) {
    const element = node as HTMLElement | null;
    if (element?.isContentEditable || element?.closest?.(PROTECTED_TARGETS)) return false;
  }
  return true;
}

/** Route through the attached player so single and coordinated previews share one input path. */
export function dispatchPreviewKeyboardInput(
  container: HTMLElement | null,
  event: KeyboardEvent,
  onError: (error: unknown) => void,
  mountedGraphic?: Element | null,
): boolean {
  const graphic = (mountedGraphic ?? container?.firstElementChild) as
    | (Element & {
        handleKeyboardInput?: (
          trigger: 'key-down' | 'key-up',
          input: VisualRuleKeyboardInput,
          sourceEvent?: KeyboardEvent,
        ) => boolean;
      })
    | null
    | undefined;
  if (!graphic?.handleKeyboardInput) return false;
  try {
    return graphic.handleKeyboardInput(
      event.type === 'keyup' ? 'key-up' : 'key-down',
      {
        key: event.key,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
      },
      event,
    );
  } catch (error) {
    onError(error);
    return true;
  }
}
