const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** Content whose picture is not in its markup and inline styles, or that a copy cannot load. */
const UNSUPPORTED_CONTENT =
  'video:not([data-ograf-media-clip]), picture, iframe, object, embed, slot, input, textarea, select, link';
/** What a Media paint draws from. Its canvas holds the picture; the source itself shows nothing. */
const MEDIA_SOURCE = '[data-ograf-media-clip], [data-ograf-media-live]';
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
/** What a shadow tree's own stylesheet may give its host, which a copy leaves behind with that tree. */
const HOST_PROPERTIES = [...BOX_PROPERTIES, 'isolation', 'opacity'];

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
   * A shadow tree's host takes its box in any case.
   */
  partOfPage?: boolean;
  /**
   * An image that cannot be read keeps its address, and the picture shows it missing, where
   * otherwise the picture fails with the reason. For a picture that stands in for the page while
   * it plays: a graphic opened from disk can read none of its files.
   */
  skipUnreadable?: boolean;
  /** The last word on the copy of an element under the root, for a look its markup does not hold. */
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
 * it gets its look from outside: no embedded document or form control, no SVG symbol defined
 * elsewhere, no animated pseudo-element.
 */
export function canCaptureSelfStyled(root: HTMLElement): boolean {
  return selfStyledCaptureObstacle(root) === null;
}

/** What in a tree its own markup cannot draw, in words for an error, or null when nothing is. */
export function selfStyledCaptureObstacle(root: HTMLElement | ShadowRoot): string | null {
  const unsupported = root.querySelector(UNSUPPORTED_CONTENT);
  if (unsupported) return `<${unsupported.localName}> content`;
  for (const use of root.querySelectorAll('use')) {
    const reference = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (
      !reference.startsWith('#') ||
      !root.querySelector(`[id="${CSS.escape(reference.slice(1))}"]`)
    )
      return 'an SVG symbol defined outside the layer';
  }
  const animations = 'host' in root ? root.getAnimations() : root.getAnimations({ subtree: true });
  if (animations.some(({ effect }) => Boolean((effect as KeyframeEffect | null)?.pseudoElement)))
    return 'an animated pseudo-element';
  // A shadow tree is copied in place of its host's children, so it is held to the same.
  for (const element of root.querySelectorAll(`*:not(${MEDIA_SOURCE})`)) {
    const obstacle = element.shadowRoot && selfStyledCaptureObstacle(element.shadowRoot);
    if (obstacle) return obstacle;
  }
  return null;
}

/** Splits a comma-separated value, leaving commas inside quotes and brackets alone. */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * One item of a comma-separated mask property replaced, for the mask image at `index` of `length`.
 * A list shorter than the images repeats, as CSS reads it; an empty one holds `initial`.
 */
export function withMaskListItem(
  list: string,
  length: number,
  index: number,
  value: string,
  initial: string,
): string {
  const items = splitList(list);
  const full = Array.from({ length }, (_, at) =>
    items.length ? items[at % items.length]! : initial,
  );
  full[index] = value;
  return full.join(', ');
}

/** A keyframe names a property as script does: `backgroundColor`, `cssFloat`, `--custom`. */
export function keyframePropertyName(field: string): string {
  if (field.startsWith('--')) return field;
  if (field === 'cssFloat') return 'float';
  if (field === 'cssOffset') return 'offset';
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Adds the properties running animations hold on their elements: such a value is not in the markup. */
function noteAnimatedProperties(
  animations: readonly Animation[],
  properties: Map<Element, Set<string>>,
): void {
  for (const { effect } of animations) {
    const keyframes = effect as KeyframeEffect | null;
    if (!keyframes?.target || typeof keyframes.getKeyframes !== 'function') continue;
    let names = properties.get(keyframes.target);
    if (!names) properties.set(keyframes.target, (names = new Set()));
    for (const keyframe of keyframes.getKeyframes())
      for (const field of Object.keys(keyframe))
        if (!KEYFRAME_FIELDS.has(field)) names.add(keyframePropertyName(field));
  }
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

/**
 * Converts layer mask fragments to standalone alpha images, which a copy drawn on its own needs. A
 * backdrop crop may hold its own image beside the layer's mask; that one stays as it is.
 */
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
    const baked = `url("data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}")`;
    const images = splitList(target.style.maskImage);
    const at = images.indexOf(`url("#${id}")`);
    if (at < 0) {
      target.style.maskImage = baked;
      target.style.maskMode = 'alpha';
      target.style.maskSize = '100% 100%';
      target.style.maskRepeat = 'no-repeat';
      continue;
    }
    const count = images.length;
    target.style.maskImage = withMaskListItem(target.style.maskImage, count, at, baked, 'none');
    target.style.maskMode = withMaskListItem(
      target.style.maskMode,
      count,
      at,
      'alpha',
      'match-source',
    );
    target.style.maskSize = withMaskListItem(target.style.maskSize, count, at, '100% 100%', 'auto');
    target.style.maskRepeat = withMaskListItem(
      target.style.maskRepeat,
      count,
      at,
      'no-repeat',
      'repeat',
    );
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

    /** What a stylesheet gives an element and its markup does not hold goes onto its copy. */
    const take = (original: TreeElement, copy: TreeElement, properties: readonly string[]) => {
      const current = view.getComputedStyle(original);
      for (const name of properties)
        if (!copy.style.getPropertyValue(name))
          copy.style.setProperty(name, current.getPropertyValue(name));
    };

    // A document nothing is shown in: its images do not load and nothing in it runs.
    const inert = owner.implementation.createHTMLDocument('');
    const animated = new Map<Element, Set<string>>();
    noteAnimatedProperties(root.getAnimations({ subtree: true }), animated);
    const embedding: Promise<void>[] = [];
    const embedInlineStyle = (styled: TreeElement) => {
      const style = styled.getAttribute('style');
      if (!style?.includes('url(')) return;
      embedding.push(
        embedStyleUrls(style, embed).then((next) => {
          if (next !== style) styled.setAttribute('style', next);
        }),
      );
    };
    /** The copy of one element with everything in it, or null for one the filter leaves out. */
    const copyOf = (original: TreeElement, isRoot: boolean): TreeElement | null => {
      if (!isRoot && original.matches(MEDIA_SOURCE)) return null;
      if (
        !isRoot &&
        options.filter &&
        'dataset' in original &&
        !options.filter(original as HTMLElement)
      )
        return null;
      const copy = inert.importNode(original, false);
      const names = animated.get(original);
      if (names) {
        const current = view.getComputedStyle(original);
        for (const name of names) copy.style.setProperty(name, current.getPropertyValue(name));
      }
      const shadow = original.shadowRoot;
      if (shadow) take(original, copy, HOST_PROPERTIES);
      // A class may place and size an element from a stylesheet, which the copy does not have.
      else if (options.partOfPage && original.hasAttribute('class'))
        take(original, copy, BOX_PROPERTIES);
      if (!isRoot) options.adjust?.(original, copy);
      if (original.localName === 'canvas' && original.namespaceURI !== SVG_NAMESPACE) {
        const drawn = (original as HTMLCanvasElement).toDataURL();
        // A canvas with no area has no picture; its empty copy stands for it.
        if (drawn === 'data:,') return copy;
        const picture = inert.createElement('img');
        for (const { name, value } of copy.attributes) picture.setAttribute(name, value);
        picture.setAttribute('src', drawn);
        embedInlineStyle(picture);
        return picture;
      }
      if (original.localName === 'img' && original.namespaceURI !== SVG_NAMESPACE) {
        const image = original as HTMLImageElement;
        const source = image.currentSrc || image.src;
        // The copy is drawn once, straight after it loads: a picture may not wait to be scrolled to.
        copy.removeAttribute('loading');
        if (source && !source.startsWith('data:'))
          embedding.push(
            embed(source).then((data) => {
              copy.removeAttribute('srcset');
              copy.setAttribute('src', data);
            }),
          );
      } else if (original.localName === 'image' && original.namespaceURI === SVG_NAMESPACE) {
        const source = (original as SVGImageElement).href.baseVal;
        if (source && !source.startsWith('data:'))
          embedding.push(
            embed(source).then((data) => {
              copy.removeAttribute('xlink:href');
              copy.setAttribute('href', data);
            }),
          );
      }
      embedInlineStyle(copy);
      // A shadow tree is what its host shows, so it is copied in place of the host's own children.
      if (shadow) noteAnimatedProperties(shadow.getAnimations(), animated);
      for (const child of (shadow ?? original).childNodes) {
        if (child.nodeType === 1) {
          const element = child as TreeElement;
          // A shadow tree's stylesheet reaches no further than that tree; a copy has no such border.
          if (shadow && element.localName === 'style') continue;
          const childCopy = copyOf(element, false);
          if (childCopy) copy.appendChild(childCopy);
        } else if (child.nodeType === 3 || child.nodeType === 4)
          copy.appendChild(inert.importNode(child, false));
      }
      return copy;
    };
    const copyRoot = copyOf(root, true) as HTMLElement;

    if (options.partOfPage) {
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
