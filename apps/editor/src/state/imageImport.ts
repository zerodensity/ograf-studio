import {
  buildSvgBundle,
  createAsset,
  createLayerOfKind,
  createLayerKeyframe,
  createDefaultTransform,
  computeKeyframeFrames,
  type Asset,
  type Composition,
} from '@ograf-editor/scene-model';

export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.svg';
export interface ImageSize {
  width: number;
  height: number;
}
export interface PreparedImage extends ImageSize {
  asset: Asset;
  companions: Asset[];
}
export interface ImagePlacement {
  position?: { x: number; y: number };
  replaceLayerId?: string;
  signal?: AbortSignal;
}

/** SVGs without explicit dimensions otherwise inherit the browser's 300 × 150 image box. */
function intrinsicSvgSize(src: string, fallback: ImageSize): ImageSize {
  if (!/^data:image\/svg\+xml[;,]/i.test(src)) return fallback;
  try {
    const comma = src.indexOf(',');
    const header = src.slice(0, comma),
      payload = src.slice(comma + 1);
    const xml = /;base64/i.test(header)
      ? new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))
      : decodeURIComponent(payload);
    const svg = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
    if (svg.localName !== 'svg') return fallback;
    const viewBox = svg
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      !viewBox ||
      viewBox.length !== 4 ||
      !viewBox.every(Number.isFinite) ||
      viewBox[2]! <= 0 ||
      viewBox[3]! <= 0
    )
      return fallback;
    const length = (name: string) => {
      const value = svg.getAttribute(name)?.trim() ?? '';
      return /^(?:\d*\.)?\d+(?:px)?$/i.test(value) ? parseFloat(value) : undefined;
    };
    const width = length('width'),
      height = length('height');
    if (width && height) return { width, height };
    if (width) return { width, height: (width * viewBox[3]!) / viewBox[2]! };
    if (height) return { width: (height * viewBox[2]!) / viewBox[3]!, height };
    if (
      ['width', 'height'].every(
        (name) => !svg.hasAttribute(name) || /%$/.test(svg.getAttribute(name)!),
      )
    ) {
      return { width: viewBox[2]!, height: viewBox[3]! };
    }
  } catch {
    /* The successful browser decode remains authoritative for other SVG forms. */
  }
  return fallback;
}

export function readImageSize(src: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => finish(new Error('The image took too long to load.')), 15000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (error) reject(error);
      else
        resolve(intrinsicSvgSize(src, { width: image.naturalWidth, height: image.naturalHeight }));
    };
    image.onload = () =>
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? undefined
          : new Error('This image has no usable dimensions.'),
      );
    image.onerror = () =>
      finish(new Error('This image could not be opened. Try PNG, JPEG, WebP, GIF, AVIF or SVG.'));
    image.src = src;
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  let asset: Asset;
  let companions: Asset[] = [];
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
    const result = await buildSvgBundle([
      {
        name: /\.svg$/i.test(file.name) ? file.name : `${file.name}.svg`,
        type: file.type,
        size: file.size,
        text: () => file.text(),
        arrayBuffer: () => file.arrayBuffer(),
      },
    ]);
    if (result.warnings.length) {
      throw new Error(
        `${file.name}: Import this SVG with its companion files in Resources first. ${result.warnings.join(' ')}`,
      );
    }
    asset = result.svgAsset;
    companions = result.fontAssets;
  } else {
    const mimeType =
      file.type ||
      (
        {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          gif: 'image/gif',
          avif: 'image/avif',
        } as Record<string, string>
      )[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
    if (!mimeType?.startsWith('image/')) throw new Error(`${file.name} is not a supported image.`);
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result).replace(/^data:[^;]*;/, `data:${mimeType};`));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
      reader.readAsDataURL(file);
    });
    asset = createAsset({
      name: file.name,
      kind: 'image',
      dataUri,
      mimeType,
      originalFileName: file.name,
      byteSize: file.size,
    });
  }
  try {
    return { asset, companions, ...(await readImageSize(asset.dataUri)) };
  } catch (error) {
    throw new Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Commit only fully decoded images, together with their resources, in one store change. */
export function placeImages(
  composition: Composition,
  images: PreparedImage[],
  options: ImagePlacement = {},
): string[] {
  if (!images.length) return [];
  const target = options.replaceLayerId
    ? composition.layers.find((l) => l.id === options.replaceLayerId)
    : undefined;
  if (options.replaceLayerId && (!target || target.isLocked || target.element.type !== 'image')) {
    throw new Error('Select an unlocked image layer to replace.');
  }
  if (target && images.length !== 1) throw new Error('Choose one image to replace this layer.');
  for (const image of images) {
    if (![image.width, image.height].every((n) => Number.isFinite(n) && n > 0))
      throw new Error('Invalid image dimensions.');
  }
  return images.map((image, index) => {
    const existing = composition.assets.find(
      (a) => a.kind === 'image' && a.dataUri === image.asset.dataUri,
    );
    const asset = existing ?? image.asset;
    if (!existing) {
      composition.assets.push(asset);
      for (const companion of image.companions) {
        if (!composition.assets.some((a) => a.id === companion.id))
          composition.assets.push(companion);
      }
    }
    if (target && target.element.type === 'image') {
      target.element.src = `asset:${asset.id}`;
      return target.id;
    }
    const scale = Math.min(
      1,
      (composition.width * 0.8) / image.width,
      (composition.height * 0.8) / image.height,
    );
    const width = image.width * scale,
      height = image.height * scale;
    const center = options.position ?? { x: composition.width / 2, y: composition.height / 2 };
    const layer = createLayerOfKind('image');
    layer.name = asset.name.replace(/\.[^.]+$/, '') || 'Image';
    layer.element = { type: 'image', src: `asset:${asset.id}` };
    const frames = computeKeyframeFrames(composition);
    layer.keyframes = composition.keyframes.map((keyframe, i) =>
      createLayerKeyframe(
        frames[i]?.frame ?? 0,
        createDefaultTransform({
          x: center.x - width / 2 + index * 24,
          y: center.y - height / 2 + index * 24,
          width,
          height,
        }),
        {
          easing:
            composition.transitions.find((t) => t.toKeyframeId === keyframe.id)?.easing ?? 'linear',
        },
      ),
    );
    composition.layers.push(layer);
    return layer.id;
  });
}
