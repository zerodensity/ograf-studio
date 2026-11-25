const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** Content whose picture is not in its markup and inline styles, or that a copy cannot load. */
const UNSUPPORTED_CONTENT =
  'video, picture, iframe, object, embed, slot, input, textarea, select, link';
const KEYFRAME_FIELDS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
const LAYER_MASK_CONTENT = '[data-ograf-layer-mask-id]';
/**
 * What an element takes from the elements around it when it sets nothing itself. A tree drawn on
 * its own loses these unless its root carries them.
 */
const INHERITED_PROPERTIES = [
  'color',
  'direction',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'font-size',
  'font-stretch',
  'font-style',
  'font-synthesis',
  'font-variant',
  'font-variation-settings',
  'font-weight',
  'hyphens',
  'letter-spacing',
  'line-height',
  'overflow-wrap',
  'paint-order',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-indent',
  'text-rendering',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'text-wrap',
  'visibility',
  'white-space',
  'word-break',
  'word-spacing',
  'writing-mode',
  '-webkit-font-smoothing',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
  '-webkit-text-stroke-width',
];

const CURRENT_COLOR_PROPERTIES = new Set(['-webkit-text-fill-color', '-webkit-text-stroke-color']);
/** The box a stylesheet of the page may give an element through its class. */
const BOX_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'box-sizing',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'overflow-x',
  'overflow-y',
];

type TreeElement = HTMLElement | SVGElement;

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
  /**
   * The tree is a part of a page, not a whole picture. Its copy then also takes what the page
   * gives it and its markup does not hold: what its root inherits from the elements around it,
   * such as a font or a text colour set further up, and the box of each element that has a class.
   */
  partOfPage?: boolean;
  /**
   * An image that cannot be read keeps its address, and the picture shows it missing, where
   * otherwise the picture fails with the reason. For a picture that stands in for the page while
   * it plays: a graphic opened from disk can read none of its files.
   */
  skipUnreadable?: boolean;
  /** The last word on one element's copy, for a look that is in neither its markup nor its animations. */
  adjust?: (original: TreeElement, copy: TreeElement) => void;
  /**
   * The resources already read for this tree, by address. Give the same map to every capture of
   * one tree so each is read once. It follows the tree: an entry the latest picture did not use
   * is dropped from it, so a tree that lives for hours does not keep every image it ever showed.
   */
  embedded?: Map<string, Promise<string>>;
}

/**
 * Whether a tree draws the same from its own markup as it does in the page. It does when nothing in
 * it gets its look from outside: no shadow tree, embedded document or form control, no SVG symbol
 * defined elsewhere, no animated pseudo-element.
 */
export function canCaptureSelfStyled(root: HTMLElement): boolean {
  return selfStyledCaptureObstacle(root) === null;
}

/** What in a tree its own markup cannot draw, in words for an error, or null when nothing is. */
export function selfStyledCaptureObstacle(root: HTMLElement): string | null {
  const unsupported = root.querySelector(UNSUPPORTED_CONTENT);
  if (unsupported) return `<${unsupported.localName}> content`;
  for (const target of root.querySelectorAll<HTMLElement>(LAYER_MASK_CONTENT)) {
    // A backdrop crop can combine its own image with the layer mask.
    if (target.style.maskImage !== `url("#${target.dataset.ografLayerMaskId}")`)
      return 'a mask combined with another image';
  }
  for (const element of root.querySelectorAll('*'))
    if (element.shadowRoot) return 'an element with its own shadow tree';
  for (const use of root.querySelectorAll('use')) {
    const reference = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (
      !reference.startsWith('#') ||
      !root.querySelector(`[id="${CSS.escape(reference.slice(1))}"]`)
    )
      return 'an SVG symbol defined outside the layer';
  }
  const pseudo = root
    .getAnimations({ subtree: true })
    .some(({ effect }) => Boolean((effect as KeyframeEffect | null)?.pseudoElement));
  return pseudo ? 'an animated pseudo-element' : null;
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
    const keyframes = effect as KeyframeEffect | null;
    if (!keyframes?.target || typeof keyframes.getKeyframes !== 'function') continue;
    let names = properties.get(keyframes.target);
    if (!names) properties.set(keyframes.target, (names = new Set()));
    for (const keyframe of keyframes.getKeyframes())
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

/** Reads a resource as a `data:` address, so a picture drawn from markup can hold it. */
export async function readAsDataUrl(owner: Window, url: string): Promise<string> {
  const response = await owner.fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new (owner as Window & typeof globalThis).FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Converts layer mask fragments to standalone alpha images, which a copy drawn on its own needs. */
export function bakeLayerCaptureMasks(cloned: HTMLElement): void {
  for (const target of cloned.querySelectorAll<HTMLElement>(LAYER_MASK_CONTENT)) {
    const id = target.dataset.ografLayerMaskId!;
    const mask = [...target.querySelectorAll('mask')].find((node) => node.id === id);
    const definitions = mask?.closest('svg');
    if (!mask || !definitions) throw new Error(`Capture mask definition is missing: ${id}`);
    const width = Number(mask.getAttribute('width')),
      height = Number(mask.getAttribute('height'));
    const svg = definitions.cloneNode(true) as SVGSVGElement;
    svg.removeAttribute('style');
    svg.setAttribute('xmlns', SVG_NAMESPACE);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const rect = cloned.ownerDocument.createElementNS(SVG_NAMESPACE, 'rect');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', 'white');
    rect.setAttribute('mask', `url(#${id})`);
    svg.appendChild(rect);
    target.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}")`;
    target.style.maskMode = 'alpha';
    target.style.maskSize = '100% 100%';
    target.style.maskRepeat = 'no-repeat';
  }
}

/** Abandons an operation whose API takes no signal, and observes its late result. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const cleanUp = () => signal.removeEventListener('abort', abort);
    promise.then(
      (result) => {
        cleanUp();
        resolve(result);
      },
      (error: unknown) => {
        cleanUp();
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Draws a tree from its own markup, time after time. The runtime styles what it builds inline, as
 * it does in an exported graphic, so a copy of the tree draws the same without every element's
 * computed style being written onto it. Writing those styles, and the browser reading them back,
 * is most of what such a picture otherwise costs.
 *
 * The copy takes nothing from the page around the tree except what `partOfPage` asks for. Check
 * `selfStyledCaptureObstacle` before each call.
 */
export function selfStyledCapture(
  root: HTMLElement,
  options: SelfStyledCaptureOptions,
): (signal?: AbortSignal) => Promise<HTMLCanvasElement> {
  const owner = root.ownerDocument;
  const view = owner.defaultView;
  if (!view) throw new Error('A tree outside a window cannot be drawn.');
  // A copy cannot load anything, so what the tree loads from elsewhere is read once and embedded.
  const embedded = options.embedded ?? new Map<string, Promise<string>>();

  return async (signal) => {
    signal?.throwIfAborted();
    const used = new Set<string>();
    const embed = (reference: string): Promise<string> => {
      const url = new URL(reference, owner.baseURI).href;
      used.add(url);
      let data = embedded.get(url);
      if (!data) {
        data = readAsDataUrl(view, url).catch((cause: unknown) => {
          // A resource that could not be read is asked for again by the next picture.
          embedded.delete(url);
          if (options.skipUnreadable) return url;
          const reason = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`An image of the graphic could not be read (${reason}): ${url}`);
        });
        embedded.set(url, data);
      }
      return data;
    };

    /** A class may place and size an element from a stylesheet, which the copy does not have. */
    const takeClassBox = (original: TreeElement, copy: TreeElement) => {
      if (!original.hasAttribute('class')) return;
      const current = view.getComputedStyle(original);
      for (const name of BOX_PROPERTIES)
        if (!copy.style.getPropertyValue(name))
          copy.style.setProperty(name, current.getPropertyValue(name));
    };

    // A document nothing is shown in: its images do not load and nothing in it runs.
    const inert = owner.implementation.createHTMLDocument('');
    const copyRoot = inert.importNode(root, true);
    const originals = root.querySelectorAll<TreeElement>('*');
    const copies = copyRoot.querySelectorAll<TreeElement>('*');
    const animated = animatedProperties(root);
    const embedding: Promise<void>[] = [];
    let omitted: Element | null = null;
    const embedInlineStyle = (styled: TreeElement) => {
      const style = styled.getAttribute('style');
      if (!style?.includes('url(')) return;
      embedding.push(
        embedStyleUrls(style, embed).then((next) => {
          if (next !== style) styled.setAttribute('style', next);
        }),
      );
    };
    for (const [index, original] of originals.entries()) {
      if (omitted?.contains(original)) continue;
      let copy = copies[index]!;
      if (options.filter && 'dataset' in original && !options.filter(original as HTMLElement)) {
        copy.remove();
        omitted = original;
        continue;
      }
      const names = animated.get(original);
      if (names) {
        const current = view.getComputedStyle(original);
        for (const name of names) copy.style.setProperty(name, current.getPropertyValue(name));
      }
      if (options.partOfPage) takeClassBox(original, copy);
      options.adjust?.(original, copy);
      if (original.localName === 'canvas' && original.namespaceURI !== SVG_NAMESPACE) {
        const drawn = (original as HTMLCanvasElement).toDataURL();
        // A canvas with no area has no picture; its empty copy stands for it.
        if (drawn !== 'data:,') {
          const picture = inert.createElement('img');
          for (const { name, value } of copy.attributes) picture.setAttribute(name, value);
          picture.setAttribute('src', drawn);
          copy.replaceWith(picture);
          copy = picture;
        }
      } else if (original.localName === 'img' && original.namespaceURI !== SVG_NAMESPACE) {
        const image = original as HTMLImageElement;
        const source = image.currentSrc || image.src;
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
      } else if (original.localName === 'image' && original.namespaceURI === SVG_NAMESPACE) {
        const source = (original as SVGImageElement).href.baseVal;
        const picture = copy;
        if (source && !source.startsWith('data:'))
          embedding.push(
            embed(source).then((data) => {
              picture.removeAttribute('xlink:href');
              picture.setAttribute('href', data);
            }),
          );
      }
      embedInlineStyle(copy);
    }

    if (options.partOfPage) {
      takeClassBox(root, copyRoot);
      const inherited = view.getComputedStyle(root);
      for (const name of INHERITED_PROPERTIES) {
        if (copyRoot.style.getPropertyValue(name)) continue;
        const value = inherited.getPropertyValue(name);
        // These follow each element's own text colour until something sets them. Their computed
        // value is that colour spelled out, which would then hold for every element below.
        if (CURRENT_COLOR_PROPERTIES.has(name) && value === inherited.color) continue;
        if (value) copyRoot.style.setProperty(name, value);
      }
    }
    embedInlineStyle(copyRoot);
    await abortable(Promise.all(embedding), signal);
    if (copyRoot.querySelector(LAYER_MASK_CONTENT)) bakeLayerCaptureMasks(copyRoot);

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

    const image = new (view as Window & typeof globalThis).Image();
    await abortable(
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("The browser could not draw the picture from the graphic's markup."));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      }),
      signal,
    );
    const canvas = owner.createElement('canvas');
    canvas.width = options.canvasWidth;
    canvas.height = options.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not provide a drawing surface.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (options.embedded)
      for (const url of embedded.keys()) if (!used.has(url)) embedded.delete(url);
    return canvas;
  };
}
