import { captureAgentPng } from './agentCapture';
import { downloadBlob } from './fileIO';
import {
  alphaToKeyPixels,
  snapshotFileName,
  snapshotMatte,
  type SnapshotKind,
} from './frameSnapshot';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';

function base64PngToBlob(data: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

async function keyBlobFromAlphaPng(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable, so the key image cannot be built.');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  context.putImageData(new ImageData(alphaToKeyPixels(image.data), canvas.width), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The key image could not be encoded.'))),
      'image/png',
    ),
  );
}

async function captureCurrentFrame(matte: string) {
  const { project, activeCompositionId } = useProjectStore.getState();
  const composition = project.compositions.find((item) => item.id === activeCompositionId);
  if (!composition) throw new Error('There is no active composition to snapshot.');
  const frame = useTimelineStore.getState().currentFrame;
  const capture = await captureAgentPng({
    target: 'composition',
    project,
    compositionId: composition.id,
    frame,
    maxDimension: Math.max(composition.width, composition.height),
    matte,
  });
  return { png: base64PngToBlob(capture.data), name: project.name, frame };
}

/** Downloads the current frame at full resolution with the chosen background. */
export async function downloadFrameSnapshot(kind: SnapshotKind): Promise<void> {
  const { png, name, frame } = await captureCurrentFrame(snapshotMatte(kind));
  downloadBlob(png, snapshotFileName(name, frame));
}

/** Downloads a fill (over black) and key (alpha as greyscale) pair for the current frame. */
export async function downloadFillKeyPair(): Promise<void> {
  const fill = await captureCurrentFrame(snapshotMatte('black'));
  const alpha = await captureCurrentFrame(snapshotMatte('alpha'));
  downloadBlob(fill.png, snapshotFileName(fill.name, fill.frame, 'fill'));
  downloadBlob(
    await keyBlobFromAlphaPng(alpha.png),
    snapshotFileName(alpha.name, alpha.frame, 'key'),
  );
}
