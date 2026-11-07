import {
  canTriggerPreviewKeyboardRule,
  isPreviewKeyboardRecording,
  isPreviewKeyboardTyping,
} from './previewKeyboardInput';
import { usePlayoutControlsStore } from './playoutControlsStore';

export type PreviewArrowNavigation =
  { type: 'step'; step: number } | { type: 'template'; delta: -1 | 1 };

/** True for the browser fullscreen surface or its in-window fallback. */
export function isPreviewPresented(viewport: HTMLElement | null): boolean {
  return Boolean(
    viewport &&
    (viewport.ownerDocument?.fullscreenElement === viewport ||
      viewport.hasAttribute?.('data-preview-overlay')),
  );
}

export async function exitPreviewFullscreen(viewport: HTMLElement): Promise<void> {
  if (viewport.hasAttribute?.('data-preview-overlay')) {
    viewport.removeAttribute('data-preview-overlay');
    const EventConstructor = viewport.ownerDocument.defaultView?.Event ?? Event;
    viewport.ownerDocument.dispatchEvent(new EventConstructor('fullscreenchange'));
  } else if (viewport.ownerDocument.fullscreenElement === viewport) {
    await viewport.ownerDocument.exitFullscreen();
  }
}

/** Arrow keys visit every template step before crossing a template boundary. */
export function resolvePreviewArrowNavigation(
  delta: -1 | 1,
  currentStep: number | undefined,
  stepCount: number,
): PreviewArrowNavigation {
  const count = Number.isFinite(stepCount) ? Math.max(0, Math.floor(stepCount)) : 0;
  const current =
    currentStep !== undefined &&
    Number.isInteger(currentStep) &&
    currentStep >= 0 &&
    currentStep < count
      ? currentStep
      : -1;
  const next = current + delta;
  return next >= 0 && next < count ? { type: 'step', step: next } : { type: 'template', delta };
}

/** Describe the same steps-first route used by the popup, docked controls and keyboard. */
export function previewArrowNavigationLabel(
  delta: -1 | 1,
  currentStep: number | undefined,
  stepCount: number,
  hasAdjacentTemplate: boolean,
): string {
  const target = resolvePreviewArrowNavigation(delta, currentStep, stepCount);
  if (target.type === 'step')
    return currentStep === undefined ? 'Take In' : delta < 0 ? 'Previous step' : 'Next step';
  if (hasAdjacentTemplate) return delta < 0 ? 'Previous template' : 'Next template';
  return delta > 0 ? (currentStep === undefined ? 'Take In' : 'Take Out') : 'Back to Start';
}

/** Preview navigation takes priority over editor Timeline shortcuts only in its own surface. */
export function installPreviewShortcuts(
  owner: Document,
  panel: HTMLElement,
  viewport: HTMLElement,
  onStep: (delta: -1 | 1) => void,
  isReady: () => boolean,
  options: {
    toggleControls?: () => void;
    onArrow?: (delta: -1 | 1) => void;
    onKeyboard?: (event: KeyboardEvent) => boolean;
  } = {},
): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isPreviewKeyboardRecording(event)) return;
    const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    const target = event.target as HTMLElement | null;
    const fullscreen = owner.fullscreenElement === viewport || isPreviewPresented(viewport);
    const insideViewport = target === viewport || Boolean(target && viewport.contains?.(target));
    if (event.key === 'Escape' && (fullscreen || insideViewport)) {
      event.preventDefault();
      event.stopPropagation();
      if (fullscreen && !modified) {
        if (viewport.ownerDocument) void exitPreviewFullscreen(viewport).catch(() => undefined);
        else if (owner.fullscreenElement === viewport)
          void owner.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    if (!fullscreen && (!target || !('nodeType' in target) || !panel.contains(target))) return;
    if (isPreviewKeyboardTyping(event)) return;
    if (
      (fullscreen || insideViewport) &&
      canTriggerPreviewKeyboardRule(event) &&
      options.onKeyboard?.(event)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (modified) return;
    const action = event.key.toLowerCase();
    const session = usePlayoutControlsStore.getState().session;
    if (!event.repeat && session?.ready && !session.editorSynchronized && isReady()) {
      if (action === 't') session.play({ goto: 0 });
      else if (action === 'u' && session.updateDataBatch) session.updateDataBatch(session.values);
      else if (action === 'o') session.out();
      else {
        // No program action was assigned to this key.
      }
      if (action === 't' || action === 'o' || (action === 'u' && session.updateDataBatch)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (fullscreen && event.key.toLowerCase() === 'd' && options.toggleControls) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) options.toggleControls();
      return;
    }
    // Space keeps native button activation; arrows can navigate while a preview button has focus.
    const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    if (arrow && target?.closest?.('[data-preview-controls-drag]')) return;
    if (
      target?.closest?.('[data-preview-controls], button, [role="button"]') &&
      !(arrow && options.onArrow)
    )
      return;
    const space = event.code === 'Space' || event.key === ' ';
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' || space ? 1 : null;
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && isReady()) {
      const navigate = !space && options.onArrow ? options.onArrow : onStep;
      navigate(delta);
    }
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isPreviewKeyboardRecording(event)) return;
    const target = event.target as HTMLElement | null;
    const fullscreen = owner.fullscreenElement === viewport || isPreviewPresented(viewport);
    if (!fullscreen && target !== viewport && !(target && viewport.contains?.(target))) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (canTriggerPreviewKeyboardRule(event) && options.onKeyboard?.(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  owner.addEventListener('keydown', keydown, true);
  owner.addEventListener('keyup', keyup, true);
  return () => {
    owner.removeEventListener('keydown', keydown, true);
    owner.removeEventListener('keyup', keyup, true);
  };
}

export async function enterPreviewFullscreen(viewport: HTMLElement): Promise<void> {
  if (isPreviewPresented(viewport)) return;
  try {
    if (!viewport.requestFullscreen || viewport.ownerDocument.fullscreenEnabled === false)
      throw new Error('Fullscreen unavailable');
    await viewport.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Embedded browsers may deny fullscreen; keep the same preview and controls
    // in a browser-window-sized overlay instead of leaving a small thumbnail.
    viewport.setAttribute('data-preview-overlay', '');
    const EventConstructor = viewport.ownerDocument.defaultView?.Event ?? Event;
    viewport.ownerDocument.dispatchEvent(new EventConstructor('fullscreenchange'));
  }
  viewport.focus({ preventScroll: true });
}
