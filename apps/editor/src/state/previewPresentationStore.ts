import { isPreviewPresented } from './previewPresentation';

interface PreviewPresentation {
  enter: () => Promise<void>;
  viewport: HTMLElement;
  /** Destination portal document, which can be known before the host is adopted. */
  ownerDocument?: Document;
}

interface RegisteredPreview extends PreviewPresentation {
  clearFocusListener?: () => void;
  clearFullscreenListener?: () => void;
}

let registeredPreview: RegisteredPreview | undefined;
const fullscreenListeners = new Set<() => void>();

function publishFullscreenChange(): void {
  for (const listener of fullscreenListeners) listener();
}

/** Background editor work can yield to the actual preview document, including detached panes. */
export function subscribePreviewPresentationFullscreen(listener: () => void): () => void {
  fullscreenListeners.add(listener);
  return () => fullscreenListeners.delete(listener);
}

/** A preview command must not change dock visibility underneath its fullscreen surface. */
export function isPreviewPresentationFullscreen(): boolean {
  const viewport = registeredPreview?.viewport;
  return !!viewport?.isConnected && isPreviewPresented(viewport);
}

/** Register the mounted preview without coupling menu actions to the preview's render state. */
export function registerPreviewPresentation(presentation: PreviewPresentation): () => void {
  const registration: RegisteredPreview = { ...presentation };
  registeredPreview?.clearFocusListener?.();
  registeredPreview?.clearFullscreenListener?.();
  registeredPreview = registration;
  const owner = registration.ownerDocument ?? registration.viewport.ownerDocument;
  const onFullscreenChange = () => publishFullscreenChange();
  owner.addEventListener('fullscreenchange', onFullscreenChange);
  registration.clearFullscreenListener = () =>
    owner.removeEventListener('fullscreenchange', onFullscreenChange);
  publishFullscreenChange();
  return () => {
    registration.clearFocusListener?.();
    registration.clearFullscreenListener?.();
    if (registeredPreview === registration) {
      registeredPreview = undefined;
      publishFullscreenChange();
    }
  };
}

/** Invoke synchronously up to requestFullscreen so the menu click retains user activation. */
export async function requestPreviewPresentation(trigger?: HTMLElement): Promise<void> {
  const preview = registeredPreview;
  if (!preview?.viewport.isConnected) {
    throw new Error('Preview is not available. Open Preview & Export and try again.');
  }
  const viewport = preview.viewport;
  // Portals can adopt the same element into another document after registration.
  const ownerDocument = viewport.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow || ownerWindow.closed) {
    throw new Error('The preview window has closed. Open Preview & Export and try again.');
  }
  ownerWindow.focus();
  if (isPreviewPresented(viewport)) return;

  preview.clearFocusListener?.();
  const returnFocus = trigger ?? (ownerDocument.activeElement as HTMLElement | null);
  let entered = false;
  const cleanup = () => {
    ownerDocument.removeEventListener('fullscreenchange', onFullscreenChange);
    ownerWindow.removeEventListener('pagehide', onPageHide);
    if (preview.clearFocusListener === cleanup) preview.clearFocusListener = undefined;
  };
  const restoreFocus = () => {
    cleanup();
    if (!returnFocus?.isConnected) return;
    const returnWindow = returnFocus.ownerDocument.defaultView;
    if (returnWindow?.closed) return;
    returnWindow?.focus();
    returnFocus.focus({ preventScroll: true });
  };
  const onFullscreenChange = () => {
    if (isPreviewPresented(viewport)) entered = true;
    else if (entered) restoreFocus();
  };
  const onPageHide = () => restoreFocus();
  preview.clearFocusListener = cleanup;
  ownerDocument.addEventListener('fullscreenchange', onFullscreenChange);
  ownerWindow.addEventListener('pagehide', onPageHide);
  try {
    await preview.enter();
    entered = isPreviewPresented(viewport);
    if (!entered) cleanup();
  } catch (cause) {
    cleanup();
    throw cause;
  }
}
