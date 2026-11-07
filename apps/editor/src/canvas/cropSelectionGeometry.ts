import { layerCropPolygon, type CropRect, type Layer } from '@ograf-editor/scene-model';

/** The retained region in the layer's local box, independent of source fitting and animation. */
export function layerSelectionCrop(layer: Layer): CropRect | null {
  if (!layer.crop) return null;
  const points = layerCropPolygon(layer.crop);
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}

function matrix(element: HTMLElement) {
  return new DOMMatrix(element.style.transform || undefined);
}

function matrixText(value: DOMMatrix) {
  return `matrix(${value.a}, ${value.b}, ${value.c}, ${value.d}, ${value.e}, ${value.f})`;
}

export function translateSelectionTarget(target: HTMLElement, x: number, y: number) {
  const transform = matrix(target);
  transform.e = x;
  transform.f = y;
  target.style.transform = matrixText(transform);
}

function origin(value: string | undefined, size: number) {
  if (!value) return size / 2;
  return value.endsWith('%') ? (Number.parseFloat(value) * size) / 100 : Number.parseFloat(value);
}

/** Mirrors the crop using an editor-only target; the renderer retains the complete layer box. */
export function syncCropSelectionTarget(root: HTMLElement, target: HTMLElement, crop: CropRect) {
  const width = Number.parseFloat(root.style.width) || root.clientWidth;
  const height = Number.parseFloat(root.style.height) || root.clientHeight;
  const offsetX = crop.x * width,
    offsetY = crop.y * height;
  const transform = matrix(root);
  transform.e += offsetX;
  transform.f += offsetY;
  const [originX, originY] = root.style.transformOrigin.split(' ');
  Object.assign(target.style, {
    width: `${width * crop.width}px`,
    height: `${height * crop.height}px`,
    transform: matrixText(transform),
    transformOrigin: `${origin(originX, width) - offsetX}px ${origin(originY, height) - offsetY}px`,
  });
}

/** Converts controls on the cropped box back into the authored full layer's coordinate system. */
export function cropSelectionTransform(target: HTMLElement, crop: CropRect) {
  const width = Number.parseFloat(target.style.width) / crop.width;
  const height = Number.parseFloat(target.style.height) / crop.height;
  const transform = matrix(target);
  transform.e -= crop.x * width;
  transform.f -= crop.y * height;
  return {
    x: transform.e,
    y: transform.f,
    rotation: (Math.atan2(transform.b, transform.a) * 180) / Math.PI,
    width,
    height,
    transform: matrixText(transform),
  };
}
