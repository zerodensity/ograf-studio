/** One-shot snapshot of the live stage. It does no work until the user samples a pixel. */
export async function sampleLiveShaderStage(
  stage: HTMLElement,
  clientX: number,
  clientY: number,
): Promise<Uint8ClampedArray> {
  if (stage.querySelector('video, [data-ograf-media-canvas]')) {
    throw new Error('Live or video media cannot be sampled reliably. Use the system eyedropper.');
  }
  if (stage.querySelector('[data-ograf-shader-paused], [data-ograf-shader-error-message]')) {
    throw new Error('The shader is unavailable. Restore it before sampling.');
  }
  const rect = stage.getBoundingClientRect();
  if (
    !rect.width ||
    !rect.height ||
    clientX < rect.left ||
    clientX >= rect.right ||
    clientY < rect.top ||
    clientY >= rect.bottom
  ) {
    throw new Error('Click inside the Studio canvas to sample a color.');
  }
  const win = stage.ownerDocument.defaultView;
  if (!win) throw new Error('The Studio canvas is unavailable.');
  const assertLocalImage = (src: string) => {
    if (
      src &&
      !/^(data:|blob:|#)/i.test(src) &&
      new URL(src, win.location.href).origin !== win.location.origin
    )
      throw new Error('External images cannot be sampled safely. Use the system eyedropper.');
  };
  for (const image of stage.querySelectorAll<HTMLImageElement>('img')) {
    if (!image.complete || !image.naturalWidth) throw new Error('An image is not ready to sample.');
    assertLocalImage(image.currentSrc || image.src);
  }
  for (const image of stage.querySelectorAll<SVGImageElement>('svg image'))
    assertLocalImage(image.getAttribute('href') || image.getAttribute('xlink:href') || '');
  for (const element of [stage, ...stage.querySelectorAll<HTMLElement>('*')]) {
    const background = win.getComputedStyle(element).backgroundImage;
    for (const match of background.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
      assertLocalImage(match[1] ?? '');
  }
  for (const canvas of stage.querySelectorAll<HTMLCanvasElement>('[data-ograf-shader-canvas]')) {
    const gl = canvas.getContext('webgl2');
    if (gl && (gl.isContextLost() || !gl.getContextAttributes()?.preserveDrawingBuffer))
      throw new Error('This shader canvas cannot be sampled safely. Use the system eyedropper.');
    try {
      canvas.toDataURL();
    } catch {
      throw new Error('This shader contains restricted pixels. Use the system eyedropper.');
    }
  }
  const { stagePicture } = await import('./stagePicture');
  const canvas = await stagePicture(stage);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas sampling is unavailable.');
  const pixel = context.getImageData(
    Math.floor(((clientX - rect.left) * canvas.width) / rect.width),
    Math.floor(((clientY - rect.top) * canvas.height) / rect.height),
    1,
    1,
  ).data;
  if (!pixel[3]) throw new Error('There is no visible color at this point.');
  return pixel;
}
