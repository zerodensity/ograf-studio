/**
 * Draws an element the way the page itself paints it, through the browser's own drawing of a
 * canvas's children (HTML-in-Canvas). Nothing is copied or re-read: the browser hands over the
 * picture it already made, so patterns, masks, effect filters and embedded fonts cost nothing
 * extra and the result is what the Stage shows.
 */

interface ElementDrawingContext extends CanvasRenderingContext2D {
  drawElementImage(element: Element, x: number, y: number): void;
}

interface PaintingCanvas extends HTMLCanvasElement {
  /** Asks for a `paint` event at the next screen refresh, also when nothing changed. */
  requestPaint(): void;
}

export interface LiveElementCapture {
  /** The element to capture is mounted in here, where it is laid out but not shown. */
  readonly host: HTMLElement;
  /** Marks an element mounted in the host as one the browser keeps a picture of. */
  adopt(element: HTMLElement): void;
  /**
   * The element as the page paints it now, at the output size. `null` when the page is hidden: a
   * hidden page paints nothing, so there is no picture to take until it is shown again.
   */
  pictureOf(element: HTMLElement, signal?: AbortSignal): Promise<ImageBitmap | null>;
  dispose(): void;
}

export function liveElementCaptureSupported(ownerWindow: typeof globalThis = globalThis): boolean {
  return (
    typeof ownerWindow.CanvasRenderingContext2D === 'function' &&
    'drawElementImage' in ownerWindow.CanvasRenderingContext2D.prototype &&
    typeof ownerWindow.HTMLCanvasElement === 'function' &&
    'requestPaint' in ownerWindow.HTMLCanvasElement.prototype &&
    typeof ownerWindow.createImageBitmap === 'function'
  );
}

/**
 * Resolves `true` at the next paint of the canvas's children, which shows everything done to them
 * so far, or `false` as soon as the page is hidden.
 */
function nextPaint(canvas: PaintingCanvas, signal?: AbortSignal): Promise<boolean> {
  const ownerDocument = canvas.ownerDocument;
  return new Promise<boolean>((resolve, reject) => {
    const settle = (act: () => void) => {
      canvas.removeEventListener('paint', painted);
      ownerDocument.removeEventListener('visibilitychange', visibilityChanged);
      signal?.removeEventListener('abort', aborted);
      act();
    };
    const painted = () => settle(() => resolve(true));
    const visibilityChanged = () => {
      if (ownerDocument.visibilityState !== 'visible') settle(() => resolve(false));
    };
    const aborted = () => settle(() => reject(signal!.reason));
    canvas.addEventListener('paint', painted);
    ownerDocument.addEventListener('visibilitychange', visibilityChanged);
    signal?.addEventListener('abort', aborted);
    canvas.requestPaint();
  });
}

/**
 * A place to mount an element and take its picture from, or `null` where the browser cannot draw
 * a canvas's children. `layout` is the element's size on the page, `output` the picture's.
 */
export function createLiveElementCapture(
  layout: { width: number; height: number },
  output: { width: number; height: number },
  ownerDocument: Document = document,
): LiveElementCapture | null {
  if (!liveElementCaptureSupported(ownerDocument.defaultView ?? globalThis)) return null;
  const canvas = ownerDocument.createElement('canvas') as PaintingCanvas;
  // The browser scales its picture of a child from the canvas's size on the page to its pixels,
  // whatever the display scaling, so these two sizes are all a differently sized export needs.
  canvas.width = output.width;
  canvas.height = output.height;
  canvas.setAttribute('layoutsubtree', '');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    zIndex: '-2147483647',
    pointerEvents: 'none',
  });
  const context = canvas.getContext('2d') as ElementDrawingContext | null;
  if (!context) return null;
  ownerDocument.body.appendChild(canvas);
  return {
    host: canvas,
    adopt(element) {
      element.setAttribute('drawable', '');
      canvas.appendChild(element);
    },
    async pictureOf(element, signal) {
      signal?.throwIfAborted();
      if (ownerDocument.visibilityState !== 'visible') return null;
      // The browser draws the picture from its last paint, so a change shows only after the next.
      if (!(await nextPaint(canvas, signal))) return null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawElementImage(element, 0, 0);
      return createImageBitmap(canvas);
    },
    dispose() {
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
