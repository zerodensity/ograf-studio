import { cloneNode } from 'html-to-image/es/clone-node';
import { embedImages } from 'html-to-image/es/embed-images';
import { embedWebFonts } from 'html-to-image/es/embed-webfonts';
import { applyStyle } from 'html-to-image/es/apply-style';
import { nodeToDataURL } from 'html-to-image/es/util';
import type { Options } from 'html-to-image/es/types';
import { bakeLayerCaptureMasks } from '@ograf-editor/ograf-runtime/src/selfStyledCapture';

/** Computed styles expand fragment URLs; only definitions actually present in the clone localize. */
export function localizeSvgReferences(value: string, ids: ReadonlySet<string>): string {
  return value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote, url: string) => {
    const hash = url.lastIndexOf('#');
    if (hash < 0) return match;
    const id = url.slice(hash + 1);
    return ids.has(id) ? `url("#${id}")` : match;
  });
}

/** html-to-image tries to fetch SVG fragment masks as images. Keep them local while embedding,
 * then put self-contained SVG alpha images on the clone. The live editor DOM is never modified. */
export async function captureMaskedCanvas(
  root: HTMLElement,
  options: Options,
): Promise<HTMLCanvasElement> {
  const cloned = (await cloneNode(root, options, true)) as HTMLElement;
  await embedWebFonts(cloned, options);
  const nodes = [cloned, ...cloned.querySelectorAll<HTMLElement | SVGElement>('*')];
  const ids = new Set(nodes.map((node) => node.id).filter(Boolean));
  const masks: Array<{ node: HTMLElement | SVGElement; value: string }> = [];
  for (const node of nodes) {
    if (!node.style) continue;
    const value = localizeSvgReferences(node.style.maskImage, ids);
    if (/url\(["']?#/.test(value)) {
      masks.push({ node, value });
      node.style.maskImage = 'none';
    }
  }
  await embedImages(cloned, options);
  for (const { node, value } of masks) node.style.maskImage = value;
  for (const node of nodes) {
    if (node.style) {
      for (const property of ['filter', 'clip-path', 'fill', 'stroke', 'mask-image']) {
        const value = node.style.getPropertyValue(property);
        if (value.includes('url('))
          node.style.setProperty(property, localizeSvgReferences(value, ids));
      }
    }
  }
  bakeLayerCaptureMasks(cloned);
  applyStyle(cloned, options);
  const source = await nodeToDataURL(cloned, options.width!, options.height!);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Masked capture SVG could not render.'));
    image.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = options.canvasWidth ?? options.width!;
  canvas.height = options.canvasHeight ?? options.height!;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Masked capture canvas is unavailable.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
