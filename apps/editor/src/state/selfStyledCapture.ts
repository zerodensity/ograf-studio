import { awaitExportOperation } from './exportAbort';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** Content whose picture is not in its markup and inline styles, or that a copy cannot load. */
const UNSUPPORTED_CONTENT =
  'video, picture, iframe, object, embed, slot, input, textarea, select, link';
const KEYFRAME_FIELDS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

export interface SelfStyledCaptureOptions {
  /** The size the tree is laid out at. */
  width: number;
  height: number;
  /** The size of the canvas it is drawn on. */
  canvasWidth: number;
  canvasHeight: number;
  /** Styles for the copy's root on top of its own. */
  style: Partial<CSSStyleDeclaration>;
  /** The `@font-face` rules the tree's text needs, with their fonts embedded. */
  fontEmbedCSS: string;
  /** False for an element to leave out, with everything in it. */
  filter?: (element: HTMLElement) => boolean;
}

/**
 * Whether a tree draws the same from its own markup as it does in the page. It does when nothing in
 * it gets its look from outside: no shadow tree, embedded document or form control, no SVG symbol
 * defined elsewhere, no animated pseudo-element.
 */
export function canCaptureSelfStyled(root: HTMLElement): boolean {
  if (root.querySelector(UNSUPPORTED_CONTENT)) return false;
  for (const element of root.querySelectorAll('*')) if (element.shadowRoot) return false;
  for (const use of root.querySelectorAll('use')) {
    const reference = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (
      !reference.startsWith('#') ||
      !root.querySelector(`[id="${CSS.escape(reference.slice(1))}"]`)
    )
      return false;
  }
  return root
    .getAnimations({ subtree: true })
    .every(({ effect }) => !(effect instanceof KeyframeEffect) || !effect.pseudoElement);
}

/** A keyframe names a property as script does: `backgroundColor`, `cssFloat`, `--custom`. */
export function keyframePropertyName(field: string): string {
  if (field.startsWith('--')) return field;
  if (field === 'cssFloat') return 'float';
  if (field === 'cssOffset') return 'offset';
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The properties a running animation holds on each element: their value is not in the markup. */
function animatedProperties(root: HTMLElement): Map<Element, Set<string>> {
  const properties = new Map<Element, Set<string>>();
  for (const { effect } of root.getAnimations({ subtree: true })) {
    if (!(effect instanceof KeyframeEffect) || !effect.target) continue;
    let names = properties.get(effect.target);
    if (!names) properties.set(effect.target, (names = new Set()));
    for (const keyframe of effect.getKeyframes())
      for (const field of Object.keys(keyframe))
        if (!KEYFRAME_FIELDS.has(field)) names.add(keyframePropertyName(field));
  }
  return properties;
}

/**
 * Replaces the resources a declaration block loads from elsewhere with embedded copies. References
 * into the same document and resources that are already embedded stay as they are.
 */
export async function embedStyleUrls(
  style: string,
  embed: (url: string) => Promise<string>,
): Promise<string> {
  const outside = new Set<string>();
  for (const [, , url] of style.matchAll(CSS_URL))
    if (url && !url.startsWith('data:') && !url.startsWith('#')) outside.add(url);
  if (!outside.size) return style;
  const embedded = new Map(
    await Promise.all([...outside].map(async (url) => [url, await embed(url)] as const)),
  );
  return style.replace(CSS_URL, (match, _quote, url: string) =>
    embedded.has(url) ? `url("${embedded.get(url)}")` : match,
  );
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Draws a capture tree from its own markup, time after time. The runtime styles what it builds
 * inline, as it does in an exported graphic, so a copy of the tree draws the same without every
 * element's computed style being written onto it. Writing those styles, and the browser reading
 * them back, is most of what a capture through html-to-image costs.
 *
 * The copy takes nothing from the page around the tree, which an exported graphic does not have
 * either. Check `canCaptureSelfStyled` before each call.
 */
export function selfStyledCapture(
  root: HTMLElement,
  options: SelfStyledCaptureOptions,
): (signal?: AbortSignal) => Promise<HTMLCanvasElement> {
  // A copy cannot load anything, so what the tree loads from elsewhere is read once and embedded.
  const embedded = new Map<string, Promise<string>>();
  const embed = (reference: string): Promise<string> => {
    const url = new URL(reference, document.baseURI).href;
    let data = embedded.get(url);
    if (!data) {
      data = fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.blob();
        })
        .then(readAsDataUrl)
        .catch((cause: unknown) => {
          const reason = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`An image of the graphic could not be read (${reason}): ${url}`);
        });
      embedded.set(url, data);
    }
    return data;
  };

  return async (signal) => {
    signal?.throwIfAborted();
    // A document nothing is shown in: its images do not load and nothing in it runs.
    const inert = document.implementation.createHTMLDocument('');
    const copyRoot = inert.importNode(root, true);
    const originals = root.querySelectorAll<HTMLElement | SVGElement>('*');
    const copies = copyRoot.querySelectorAll<HTMLElement | SVGElement>('*');
    const animated = animatedProperties(root);
    const embedding: Promise<void>[] = [];
    let omitted: Element | null = null;
    for (const [index, original] of originals.entries()) {
      if (omitted?.contains(original)) continue;
      let copy = copies[index]!;
      if (options.filter && original instanceof HTMLElement && !options.filter(original)) {
        copy.remove();
        omitted = original;
        continue;
      }
      const names = animated.get(original);
      if (names) {
        const current = getComputedStyle(original);
        for (const name of names) copy.style.setProperty(name, current.getPropertyValue(name));
      }
      if (original instanceof HTMLCanvasElement) {
        const drawn = original.toDataURL();
        // A canvas with no area has no picture; its empty copy stands for it.
        if (drawn !== 'data:,') {
          const picture = inert.createElement('img');
          for (const { name, value } of copy.attributes) picture.setAttribute(name, value);
          picture.setAttribute('src', drawn);
          copy.replaceWith(picture);
          copy = picture;
        }
      } else if (original instanceof HTMLImageElement) {
        const source = original.currentSrc || original.src;
        const picture = copy;
        // The copy is drawn once, straight after it loads: a picture may not wait to be scrolled to.
        picture.removeAttribute('loading');
        if (source && !source.startsWith('data:'))
          embedding.push(
            embed(source).then((data) => {
              picture.removeAttribute('srcset');
              picture.setAttribute('src', data);
            }),
          );
      } else if (original instanceof SVGImageElement) {
        const source = original.href.baseVal;
        const picture = copy;
        if (source && !source.startsWith('data:'))
          embedding.push(
            embed(source).then((data) => {
              picture.removeAttribute('xlink:href');
              picture.setAttribute('href', data);
            }),
          );
      }
      const style = copy.getAttribute('style');
      if (style?.includes('url(')) {
        const styled = copy;
        embedding.push(
          embedStyleUrls(style, embed).then((next) => {
            if (next !== style) styled.setAttribute('style', next);
          }),
        );
      }
    }
    await awaitExportOperation(Promise.all(embedding), signal);

    Object.assign(copyRoot.style, options.style);
    if (options.fontEmbedCSS) {
      const fonts = inert.createElement('style');
      fonts.textContent = options.fontEmbedCSS;
      copyRoot.prepend(fonts);
    }
    const svg = inert.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('width', String(options.width));
    svg.setAttribute('height', String(options.height));
    svg.setAttribute('viewBox', `0 0 ${options.width} ${options.height}`);
    const foreignObject = inert.createElementNS(SVG_NAMESPACE, 'foreignObject');
    foreignObject.setAttribute('width', '100%');
    foreignObject.setAttribute('height', '100%');
    foreignObject.appendChild(copyRoot);
    svg.appendChild(foreignObject);
    const markup = new XMLSerializer().serializeToString(svg);

    const image = new Image();
    await awaitExportOperation(
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("The browser could not draw the frame from the template's markup."));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      }),
      signal,
    );
    const canvas = document.createElement('canvas');
    canvas.width = options.canvasWidth;
    canvas.height = options.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not provide a drawing surface.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
}
