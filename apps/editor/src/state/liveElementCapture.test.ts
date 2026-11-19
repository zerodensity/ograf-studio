import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveElementCapture, liveElementCaptureSupported } from './liveElementCapture';

/** A page whose canvas paints only when the test says so. */
function standInPage(visibility: DocumentVisibilityState = 'visible') {
  const drawn: unknown[] = [];
  const context = {
    clearRect: vi.fn(),
    drawElementImage: vi.fn((element: unknown) => void drawn.push(element)),
  };
  const canvas = Object.assign(new EventTarget(), {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as unknown[],
    setAttribute(name: string, value: string) {
      canvas.attributes[name] = value;
    },
    getContext: () => context,
    appendChild: (child: unknown) => void canvas.children.push(child),
    remove: vi.fn(),
    requestPaint: vi.fn(),
    ownerDocument: undefined as unknown,
  });
  class Canvas {
    requestPaint() {}
  }
  class Context {
    drawElementImage() {}
  }
  const page = Object.assign(new EventTarget(), {
    visibilityState: visibility,
    body: { appendChild: vi.fn() },
    createElement: () => canvas,
    defaultView: {
      HTMLCanvasElement: Canvas,
      CanvasRenderingContext2D: Context,
      createImageBitmap: () => undefined,
    },
  });
  canvas.ownerDocument = page;
  const element = { setAttribute: vi.fn() } as unknown as HTMLElement;
  return {
    page: page as unknown as Document,
    canvas,
    context,
    drawn,
    element,
    paint: () => canvas.dispatchEvent(new Event('paint')),
    setVisibility(next: DocumentVisibilityState) {
      page.visibilityState = next;
      page.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

const layout = { width: 1920, height: 1080 };
const output = { width: 960, height: 540 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.unstubAllGlobals());

describe('liveElementCaptureSupported', () => {
  it('needs the browser to draw a canvas’s children and to say when it painted them', () => {
    const { page } = standInPage();
    const view = page.defaultView as unknown as Record<string, unknown>;
    expect(liveElementCaptureSupported(view as unknown as typeof globalThis)).toBe(true);
    expect(liveElementCaptureSupported({} as typeof globalThis)).toBe(false);
    expect(
      liveElementCaptureSupported({
        ...view,
        CanvasRenderingContext2D: class {},
      } as unknown as typeof globalThis),
    ).toBe(false);
    expect(createLiveElementCapture(layout, output, { defaultView: {} } as Document)).toBeNull();
  });
});

describe('createLiveElementCapture', () => {
  it('lays the host out at the page size and gives it the output size in pixels', () => {
    const { page, canvas, element } = standInPage();
    const capture = createLiveElementCapture(layout, output, page)!;
    expect([canvas.width, canvas.height]).toEqual([960, 540]);
    expect(canvas.style).toMatchObject({ width: '1920px', height: '1080px', position: 'fixed' });
    expect(canvas.attributes).toMatchObject({ layoutsubtree: '', content: 'drawable' });
    capture.adopt(element);
    expect(element.setAttribute).toHaveBeenCalledWith('drawable', '');
    expect(canvas.children).toEqual([element]);
    capture.dispose();
    expect(canvas.remove).toHaveBeenCalledOnce();
  });

  it('draws the element only after the next paint, which shows the latest changes', async () => {
    const { page, canvas, context, drawn, element, paint } = standInPage();
    const bitmap = { width: 960, height: 540 };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const capture = createLiveElementCapture(layout, output, page)!;
    const picture = capture.pictureOf(element);
    await settle();
    expect(canvas.requestPaint).toHaveBeenCalledOnce();
    expect(drawn).toEqual([]);
    paint();
    expect(await picture).toBe(bitmap);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 960, 540);
    expect(context.drawElementImage).toHaveBeenCalledWith(element, 0, 0);
    expect(createImageBitmap).toHaveBeenCalledWith(canvas);
  });

  it('has no picture of a hidden page, without waiting for a paint that will not come', async () => {
    const { page, canvas, element } = standInPage('hidden');
    const capture = createLiveElementCapture(layout, output, page)!;
    expect(await capture.pictureOf(element)).toBeNull();
    expect(canvas.requestPaint).not.toHaveBeenCalled();
  });

  it('gives up the wait when the page is hidden before it paints', async () => {
    const { page, drawn, element, paint, setVisibility } = standInPage();
    const capture = createLiveElementCapture(layout, output, page)!;
    const picture = capture.pictureOf(element);
    await settle();
    setVisibility('hidden');
    expect(await picture).toBeNull();
    // A paint after the wait ended draws nothing.
    paint();
    expect(drawn).toEqual([]);
  });

  it('stops waiting when the export is cancelled', async () => {
    const { page, drawn, element, paint } = standInPage();
    const capture = createLiveElementCapture(layout, output, page)!;
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');
    const picture = capture.pictureOf(element, controller.signal);
    await settle();
    controller.abort(reason);
    await expect(picture).rejects.toBe(reason);
    paint();
    expect(drawn).toEqual([]);
    await expect(capture.pictureOf(element, controller.signal)).rejects.toBe(reason);
  });
});
