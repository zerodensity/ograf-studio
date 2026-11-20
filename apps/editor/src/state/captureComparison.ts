/** A reference picture to compare a capture with, as the agent supplied it. */
export interface CaptureReference {
  mimeType: string;
  /** Base64 of the picture file. */
  data: string;
}

export interface CaptureComparison {
  mimeType: 'image/png';
  /** Base64 PNG, the size of the capture: black where the pictures agree, brighter where they differ. */
  data: string;
  /** Average colour distance over all pixels, from 0 (the same picture) to 1. */
  meanDifference: number;
  /** Share of pixels whose colour differs by more than a tenth of the range. */
  differingFraction: number;
  referenceWidth: number;
  referenceHeight: number;
}

/** A pixel counts as different when its largest channel distance passes a tenth of the range. */
const DIFFERENT_FROM = 26;
/** Small distances are hard to see as dark grey, so the difference picture shows them brighter. */
const SHOWN_GAIN = 3;

/**
 * Compares two RGBA pictures of the same size, each seen over black so that a see-through
 * pixel counts as dark. Returns the difference picture and the two scores.
 */
export function comparePixels(
  capture: Uint8ClampedArray,
  reference: Uint8ClampedArray,
): {
  difference: Uint8ClampedArray<ArrayBuffer>;
  meanDifference: number;
  differingFraction: number;
} {
  if (capture.length !== reference.length || capture.length % 4 !== 0)
    throw new Error('The capture and the reference must be the same size to compare.');
  const pixels = capture.length / 4;
  const difference = new Uint8ClampedArray(capture.length);
  let total = 0;
  let differing = 0;
  for (let offset = 0; offset < capture.length; offset += 4) {
    const captureAlpha = capture[offset + 3]! / 255;
    const referenceAlpha = reference[offset + 3]! / 255;
    let distance = 0;
    for (let channel = 0; channel < 3; channel += 1)
      distance = Math.max(
        distance,
        Math.abs(
          capture[offset + channel]! * captureAlpha - reference[offset + channel]! * referenceAlpha,
        ),
      );
    total += distance;
    if (distance > DIFFERENT_FROM) differing += 1;
    const shown = distance * SHOWN_GAIN;
    difference[offset] = shown;
    difference[offset + 1] = shown;
    difference[offset + 2] = shown;
    difference[offset + 3] = 255;
  }
  return {
    difference,
    meanDifference: pixels ? total / (255 * pixels) : 0,
    differingFraction: pixels ? differing / pixels : 0,
  };
}

async function decoded(data: string, mimeType: string, what: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  try {
    return await createImageBitmap(new Blob([bytes], { type: mimeType }));
  } catch {
    throw new Error(`The ${what} could not be read as a picture (${mimeType}).`);
  }
}

/**
 * Compares a PNG capture with a reference picture. The reference is scaled to the capture, so a
 * reference with another aspect ratio is stretched: export it at the composition's shape.
 */
export async function compareWithReference(
  capture: { data: string; width: number; height: number },
  reference: CaptureReference,
): Promise<CaptureComparison> {
  const { width, height } = capture;
  const [captured, referenced] = await Promise.all([
    decoded(capture.data, 'image/png', 'capture'),
    decoded(reference.data, reference.mimeType, 'reference'),
  ]);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser could not prepare the comparison.');
    const pixelsOf = (picture: ImageBitmap) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(picture, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    };
    const { difference, meanDifference, differingFraction } = comparePixels(
      pixelsOf(captured),
      pixelsOf(referenced),
    );
    context.putImageData(new ImageData(difference, width, height), 0, 0);
    return {
      mimeType: 'image/png',
      data: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
      meanDifference,
      differingFraction,
      referenceWidth: referenced.width,
      referenceHeight: referenced.height,
    };
  } finally {
    captured.close();
    referenced.close();
  }
}
