/** A second view of the editor's existing output, with no second playback runtime. */
import { mirrorTickerTransport } from '@ograf-editor/ograf-runtime';
let nextMirrorId = 0;

const EXCLUDED =
  '.canvas-layout-overlay, .canvas-output-crop, .layer-crop-selection-target, ' +
  '.layer-inline-text-badge, .layer-content-placeholder';
const EDITOR_CLASSES = new Set(['selected', 'guide', 'inline-text-editing']);
const RENDER_EVENT = 'ograf-editor-preview-render';
const VIDEO_STYLES = [
  'position',
  'display',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'top',
  'right',
  'bottom',
  'left',
  'object-fit',
  'object-position',
  'transform',
  'transform-origin',
  'opacity',
  'visibility',
  'filter',
  'clip-path',
  'mix-blend-mode',
  'border',
  'border-radius',
  'padding',
  'margin',
  'vertical-align',
  'background-color',
  'aspect-ratio',
] as const;

type PixelSource = HTMLCanvasElement | HTMLVideoElement;

/**
 * Mirror the rendered Stage subtree. DOM changes retain their corresponding nodes; native
 * canvas/video frames are copied directly, without PNG encoding, pixel reads or new players.
 * The source can dispatch `ograf-editor-preview-render` after an imperative draw for an
 * immediate copy. The destination window supplies the fallback frame clock for detached panes.
 */
export function installEditorPreviewMirror(source: HTMLElement, target: HTMLElement): () => void {
  const prefix = `ograf-editor-mirror-${++nextMirrorId}-`;
  const nodes = new Map<Node, Node>();
  const pixels = new Map<PixelSource, HTMLCanvasElement>();
  const tickerTransports = new Map<Node, () => void>();
  let disposed = false;
  let frame: number | undefined;
  let frameOwner: Window | null = null;

  const fragmentReferences = (value: string) =>
    value.replace(
      /url\(\s*(['"]?)#([^\s)'"\]]+)\1\s*\)/g,
      (_match, quote, id) => `url(${quote}#${prefix}${id}${quote})`,
    );

  const attributeValue = (attribute: Attr): string => {
    const name = attribute.localName;
    const value = attribute.value;
    if (name === 'id') return `${prefix}${value}`;
    if (name === 'href' && value.startsWith('#')) return `#${prefix}${value.slice(1)}`;
    if (name === 'aria-labelledby' || name === 'aria-describedby' || name === 'headers')
      return value
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => `${prefix}${id}`)
        .join(' ');
    if (name === 'for') return `${prefix}${value}`;
    if (name === 'class')
      return value
        .split(/\s+/)
        .filter((token) => token && !EDITOR_CLASSES.has(token))
        .join(' ');
    // SVG filters, clip paths, masks and paints all use local fragment URLs.
    return fragmentReferences(value);
  };

  const excluded = (node: Node) =>
    node.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).matches(EXCLUDED) || (node as Element).localName === 'script');

  const syncVideoStyle = (from: HTMLVideoElement, to: HTMLCanvasElement) => {
    // Video-specific stylesheet selectors do not match its passive canvas replacement. Computed
    // CSS dimensions retain authored layout units; bounding rectangles would include Stage zoom.
    const computed = from.ownerDocument.defaultView?.getComputedStyle(from);
    if (!computed) return;
    for (const property of VIDEO_STYLES)
      to.style.setProperty(property, fragmentReferences(computed.getPropertyValue(property)));
  };

  const syncAttributes = (from: Element, to: Element) => {
    const media = from.localName === 'video';
    const allowed = (attribute: Attr) =>
      !attribute.name.toLowerCase().startsWith('on') &&
      (!media ||
        !['src', 'srcset', 'autoplay', 'controls', 'loop', 'muted', 'preload', 'poster'].includes(
          attribute.localName,
        ));
    for (const attribute of [...to.attributes]) {
      const present = attribute.namespaceURI
        ? from.hasAttributeNS(attribute.namespaceURI, attribute.localName)
        : from.hasAttribute(attribute.name);
      if (!present) {
        if (attribute.namespaceURI)
          to.removeAttributeNS(attribute.namespaceURI, attribute.localName);
        else to.removeAttribute(attribute.name);
      }
    }
    for (const attribute of [...from.attributes]) {
      if (!allowed(attribute)) {
        if (attribute.namespaceURI)
          to.removeAttributeNS(attribute.namespaceURI, attribute.localName);
        else to.removeAttribute(attribute.name);
        continue;
      }
      const value = attributeValue(attribute);
      if (attribute.namespaceURI) {
        if (to.getAttributeNS(attribute.namespaceURI, attribute.localName) !== value)
          to.setAttributeNS(attribute.namespaceURI, attribute.name, value);
      } else if (to.getAttribute(attribute.name) !== value) {
        // Runtime SVG markup can contain literal xmlns/xlink:href attributes created without a
        // namespace. Preserve that DOM contract instead of passing a null namespace with a prefix.
        to.setAttribute(attribute.name, value);
      }
    }
    if (from === source) {
      (to as HTMLElement).style.pointerEvents = 'none';
      (to as HTMLElement).style.userSelect = 'none';
      to.setAttribute('inert', '');
      to.setAttribute('aria-hidden', 'true');
    }
    if (from.hasAttribute('contenteditable')) to.setAttribute('contenteditable', 'false');
    if (from.hasAttribute('data-inline-text-editor')) {
      (to as HTMLElement).style.outline = 'none';
      (to as HTMLElement).style.caretColor = 'transparent';
    }
    if (media) syncVideoStyle(from as HTMLVideoElement, to as HTMLCanvasElement);
  };

  const clone = (from: Node): Node | null => {
    if (excluded(from)) return null;
    const owner = target.ownerDocument;
    if (from.nodeType === Node.TEXT_NODE) {
      const value =
        from.parentElement?.localName === 'style'
          ? fragmentReferences(from.nodeValue ?? '')
          : (from.nodeValue ?? '');
      const to = owner.createTextNode(value);
      nodes.set(from, to);
      return to;
    }
    if (from.nodeType === Node.COMMENT_NODE) {
      const to = owner.createComment(from.nodeValue ?? '');
      nodes.set(from, to);
      return to;
    }
    if (from.nodeType !== Node.ELEMENT_NODE) return null;
    const element = from as Element;
    if (
      element.localName === 'audio' ||
      element.localName === 'source' ||
      element.localName === 'track'
    ) {
      const to = owner.createComment('Editor preview media source');
      nodes.set(from, to);
      return to;
    }
    // A video uses the source's decoded frame. Never attach another player or audio source.
    // Custom-element wrappers are passive containers, so cloning cannot run another runtime.
    const localName =
      element.localName === 'video'
        ? 'canvas'
        : element.localName.includes('-')
          ? 'div'
          : element.localName;
    const to = owner.createElementNS(element.namespaceURI, localName);
    nodes.set(from, to);
    syncAttributes(element, to);
    if (element.getAttribute('data-ograf-ticker-track') === 'true') {
      tickerTransports.set(from, mirrorTickerTransport(element as HTMLElement, to as HTMLElement));
    }
    if (element.localName === 'canvas' || element.localName === 'video') {
      pixels.set(element as PixelSource, to as HTMLCanvasElement);
    } else {
      for (const child of [...from.childNodes]) {
        const copy = nodes.get(child) ?? clone(child);
        if (copy) to.appendChild(copy);
      }
    }
    return to;
  };

  const forget = (node: Node) => {
    for (const child of [...node.childNodes]) forget(child);
    pixels.delete(node as PixelSource);
    tickerTransports.get(node)?.();
    tickerTransports.delete(node);
    nodes.delete(node);
  };

  const copyPixels = () => {
    if (disposed) return;
    for (const [from, to] of pixels) {
      const video = from.localName === 'video' ? (from as HTMLVideoElement) : null;
      const width = video ? video.videoWidth : (from as HTMLCanvasElement).width;
      const height = video ? video.videoHeight : (from as HTMLCanvasElement).height;
      if (width <= 0 || height <= 0 || (video && video.readyState < 2)) continue;
      if (to.width !== width) to.width = width;
      if (to.height !== height) to.height = height;
      const context = to.getContext('2d', { alpha: true });
      if (!context) continue;
      try {
        context.clearRect(0, 0, width, height);
        context.drawImage(from, 0, 0, width, height);
      } catch {
        // A source may be between frames or losing its GPU context. Its next draw can recover.
      }
    }
  };

  const cancelFrame = () => {
    if (frame !== undefined) frameOwner?.cancelAnimationFrame(frame);
    frame = undefined;
    frameOwner = null;
  };
  const scheduleFrames = () => {
    if (disposed || frame !== undefined || pixels.size === 0) return;
    const owner = target.ownerDocument.defaultView;
    if (!owner || owner.closed) return;
    frameOwner = owner;
    frame = owner.requestAnimationFrame(() => {
      frame = undefined;
      frameOwner = null;
      if (target.isConnected && !target.ownerDocument.hidden) copyPixels();
      scheduleFrames();
    });
  };

  const initial = clone(source);
  target.replaceChildren(...(initial ? [initial] : []));
  copyPixels();
  scheduleFrames();

  const Observer = source.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer((mutations) => {
    if (disposed) return;
    const changedParents = new Set<Node>();
    const removedNodes = new Set<Node>();
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        changedParents.add(mutation.target);
        for (const removed of [...mutation.removedNodes]) removedNodes.add(removed);
      } else if (!nodes.has(mutation.target) && mutation.target.parentNode) {
        // A previously excluded node may have acquired an ordinary content class.
        changedParents.add(mutation.target.parentNode);
      }
    }
    const depth = (node: Node) => {
      let value = 0;
      for (let parent: Node | null = node; parent && parent !== source; parent = parent.parentNode)
        value += 1;
      return value;
    };
    // Reconcile the final source order once per parent, from ancestors to descendants. An added
    // parent is cloned with its current children, so later records for those children must reuse
    // those copies rather than duplicating an entire chart, mask or native pixel surface.
    for (const parent of [...changedParents].sort((left, right) => depth(left) - depth(right))) {
      if (parent !== source && !source.contains(parent)) continue;
      const to = nodes.get(parent);
      if (!to || to.nodeType !== Node.ELEMENT_NODE || pixels.has(parent as PixelSource)) continue;
      let before: Node | null = null;
      for (const child of [...parent.childNodes].reverse()) {
        if (excluded(child)) continue;
        const copy = nodes.get(child) ?? clone(child);
        if (!copy) continue;
        if (copy.parentNode !== to || copy.nextSibling !== before) to.insertBefore(copy, before);
        before = copy;
      }
    }
    for (const removed of removedNodes) {
      // Reparented nodes still belong to the output and retain their canvas/DOM identity.
      if (removed === source || source.contains(removed)) continue;
      const copy = nodes.get(removed);
      copy?.parentNode?.removeChild(copy);
      forget(removed);
    }
    for (const mutation of mutations) {
      const to = nodes.get(mutation.target);
      if (!to) continue;
      if (mutation.type === 'attributes' && to.nodeType === Node.ELEMENT_NODE) {
        if (excluded(mutation.target)) {
          to.parentNode?.removeChild(to);
          forget(mutation.target);
        } else syncAttributes(mutation.target as Element, to as Element);
      } else if (mutation.type === 'characterData') {
        to.nodeValue =
          mutation.target.parentElement?.localName === 'style'
            ? fragmentReferences(mutation.target.nodeValue ?? '')
            : mutation.target.nodeValue;
      }
    }
    copyPixels();
    if (pixels.size === 0) cancelFrame();
    else scheduleFrames();
  });
  observer.observe(source, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  source.addEventListener(RENDER_EVENT, copyPixels);
  const sourceWindow = source.ownerDocument.defaultView;
  const resize = () => {
    for (const [from, to] of pixels)
      if (from.localName === 'video') syncVideoStyle(from as HTMLVideoElement, to);
    copyPixels();
  };
  sourceWindow?.addEventListener('resize', resize);

  return () => {
    disposed = true;
    observer.disconnect();
    source.removeEventListener(RENDER_EVENT, copyPixels);
    sourceWindow?.removeEventListener('resize', resize);
    cancelFrame();
    nodes.clear();
    pixels.clear();
    for (const dispose of tickerTransports.values()) dispose();
    tickerTransports.clear();
    if (initial?.parentNode === target) target.removeChild(initial);
  };
}
