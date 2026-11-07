import {
  croppedSourcePlacement,
  type MediaPaintFit,
  type SourceCrop,
} from '@ograf-editor/scene-model';

interface CropLayout {
  update: () => void;
  dispose: () => void;
}
const layouts = new WeakMap<HTMLElement, CropLayout>();

export function mountCroppedImage(
  container: HTMLElement,
  image: HTMLImageElement,
  crop: SourceCrop,
  fit: MediaPaintFit,
) {
  const overflow = container.style.overflow;
  container.style.overflow = 'hidden';
  container.dataset.ografSourceCropHost = 'true';
  const update = () => {
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      !container.clientWidth ||
      !container.clientHeight
    )
      return;
    const rect = croppedSourcePlacement(
      { width: image.naturalWidth, height: image.naturalHeight },
      { width: container.clientWidth, height: container.clientHeight },
      crop,
      fit,
    );
    Object.assign(image.style, {
      position: 'absolute',
      objectFit: 'fill',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      clipPath: `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)`,
    });
  };
  image.addEventListener('load', update);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
  observer?.observe(container);
  layouts.set(container, {
    update,
    dispose: () => {
      image.removeEventListener('load', update);
      observer?.disconnect();
      container.style.overflow = overflow;
      delete container.dataset.ografSourceCropHost;
    },
  });
  update();
}

export function refreshCroppedImages(root: ParentNode) {
  layouts.get(root as HTMLElement)?.update();
  for (const container of root.querySelectorAll<HTMLElement>('[data-ograf-source-crop-host]'))
    layouts.get(container)?.update();
}

export function disposeCroppedImage(container: HTMLElement) {
  layouts.get(container)?.dispose();
  layouts.delete(container);
}
