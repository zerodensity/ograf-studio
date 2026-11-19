import type { FramePictureJob, FramePictureResult } from './framePicturePool';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FramePictureJob>) => void) | null;
  postMessage(message: FramePictureResult, transfer?: Transferable[]): void;
};

async function png(picture: ImageBitmap): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(picture.width, picture.height);
  const context = canvas.getContext('bitmaprenderer');
  if (!context) throw new Error('The browser could not provide a drawing surface.');
  // The canvas takes the picture over without copying it.
  context.transferFromImageBitmap(picture);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

let surface: OffscreenCanvas | undefined;
let alphaPlanes = new Uint8Array(0);

function planes(job: Extract<FramePictureJob, { kind: 'planes' }>) {
  const { picture, width, height, timestamp, duration } = job;
  if (surface?.width !== width || surface.height !== height) {
    surface = new OffscreenCanvas(width, height);
    // A picture whose brightness is the alpha has no colour: its two colour planes stay grey.
    alphaPlanes = new Uint8Array(width * height + 2 * (width / 2) * (height / 2)).fill(128);
  }
  const context = surface.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not provide a drawing surface.');
  context.clearRect(0, 0, width, height);
  context.drawImage(picture, 0, 0);
  picture.close();
  // getImageData gives colours that are not multiplied by their alpha, as WebM stores them.
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let pixel = 0; pixel < width * height; pixel += 1)
    alphaPlanes[pixel] = pixels[pixel * 4 + 3]!;
  const frame = { codedWidth: width, codedHeight: height, timestamp, duration };
  return {
    colour: new VideoFrame(pixels, { format: 'RGBX', ...frame }),
    alpha: new VideoFrame(alphaPlanes, { format: 'I420', ...frame }),
  };
}

scope.onmessage = ({ data: job }) => {
  void (async () => {
    try {
      if (job.kind === 'png') {
        const file = await png(job.picture);
        scope.postMessage({ id: job.id, kind: 'png', png: file }, [file]);
      } else {
        const frames = planes(job);
        scope.postMessage({ id: job.id, kind: 'planes', ...frames }, [frames.colour, frames.alpha]);
      }
    } catch (cause) {
      scope.postMessage({
        id: job.id,
        kind: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  })();
};
