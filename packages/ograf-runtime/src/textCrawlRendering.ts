import { hasTextAnimation } from '@ograf-editor/scene-model';
import {
  isGradientPaint,
  normalizeTextCrawl,
  paintToCss,
  sampleTextCrawl,
  type TextElement,
} from '@ograf-editor/scene-model';
import {
  mountTextAnimationContent,
  measureTextAnimationLayout,
  applyTextAnimationGradient,
  refreshTextCrawlAnimation,
} from './textAnimationRendering';

interface MountedCrawl {
  content: HTMLElement;
  track: HTMLElement;
  copies: HTMLElement[];
  element: TextElement;
  width: number;
  viewport: number;
  elapsedMs: number;
  observer?: ResizeObserver;
  fonts?: FontFaceSet;
  loaded?: () => void;
}
const crawls = new WeakMap<HTMLElement, MountedCrawl>();

export function textCrawlPaintTargets(container: HTMLElement): HTMLElement[] | undefined {
  return crawls.get(container)?.copies;
}

export function disposeTextCrawl(container: HTMLElement): void {
  const crawl = crawls.get(container);
  crawl?.observer?.disconnect();
  if (crawl?.fonts && crawl.loaded) crawl.fonts.removeEventListener('loadingdone', crawl.loaded);
  crawls.delete(container);
}

/** The original editable text supplies the measurement; clones never change source data. */
export function mountTextCrawl(
  container: HTMLElement,
  content: HTMLElement,
  element: TextElement,
): void {
  if (!element.crawl) return;
  const first = content.cloneNode(true) as HTMLElement;
  first.dataset.ografTextCrawlCopy = 'true';
  Object.assign(first.style, {
    width: 'max-content',
    minWidth: '0',
    maxWidth: 'none',
    whiteSpace: 'pre',
    flex: 'none',
    textAlign: 'left',
    overflow: 'visible',
    transform: 'none',
    display: 'flex',
    flexDirection: 'row',
    alignItems:
      element.verticalAlign === 'middle'
        ? 'center'
        : element.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start',
  });
  // Build animated copies separately so count/rolling effects retain their own mounted state.
  if (hasTextAnimation(element)) {
    first.replaceChildren();
    mountTextAnimationContent(first, element);
  }
  const paintCopy = (copy: HTMLElement) => {
    if (!isGradientPaint(element.fill)) return;
    const paint = paintToCss(element.fill);
    if (!applyTextAnimationGradient(copy, paint, element.fill)) copy.style.backgroundImage = paint;
  };
  paintCopy(first);
  const track = content.ownerDocument.createElement('div');
  track.dataset.ografTextCrawlTrack = 'true';
  Object.assign(track.style, {
    display: 'flex',
    flexDirection: 'row',
    width: 'max-content',
    height: '100%',
    transformOrigin: '0 0',
    willChange: 'transform',
  });
  track.appendChild(first);
  content.replaceChildren(track);
  Object.assign(content.style, {
    display: 'block',
    overflow: 'hidden',
    whiteSpace: 'pre',
    background: 'none',
  });
  const crawl: MountedCrawl = {
    content,
    track,
    copies: [first],
    element,
    width: 0,
    viewport: 0,
    elapsedMs: 0,
  };
  crawls.set(container, crawl);
  const refresh = () => {
    if (crawls.get(container) !== crawl) return;
    crawl.width =
      element.content.trim() || element.runs.some((run) => run.text.trim())
        ? measureTextAnimationLayout(first, () => {
            // CSS widths keep the fraction used by flex placement. offsetWidth/scrollWidth round
            // to integral pixels, which otherwise causes a visible jump at each repeat seam.
            // Computed layout width also excludes the editor's zoom/ancestor transforms.
            const width = Number.parseFloat(
              first.ownerDocument.defaultView?.getComputedStyle(first).width ?? '',
            );
            return Number.isFinite(width) && width > 0
              ? width
              : Math.max(first.offsetWidth, first.scrollWidth);
          })
        : 0;
    crawl.viewport = container.clientWidth;
    const sample = sampleTextCrawl(
      normalizeTextCrawl(element.crawl!),
      crawl.width,
      crawl.viewport,
      crawl.elapsedMs,
    );
    while (crawl.copies.length > sample.copies) crawl.copies.pop()!.remove();
    while (crawl.copies.length < sample.copies) {
      const copy = first.cloneNode(true) as HTMLElement;
      if (hasTextAnimation(element)) {
        copy.replaceChildren();
        mountTextAnimationContent(copy, element);
      }
      paintCopy(copy);
      crawl.copies.push(copy);
      track.appendChild(copy);
    }
    track.style.gap = `${element.crawl!.gap}px`;
    track.style.transform = `translateX(${sample.offset}px)`;
    content.dataset.ografTextCrawlPeriod = String(sample.period);
    refreshTextCrawlAnimation(container, element);
  };
  refresh();
  if (typeof ResizeObserver !== 'undefined') {
    crawl.observer = new ResizeObserver(refresh);
    crawl.observer.observe(container);
    crawl.observer.observe(first);
  }
  if (content.ownerDocument.fonts) {
    crawl.fonts = content.ownerDocument.fonts;
    crawl.loaded = refresh;
    crawl.fonts.addEventListener('loadingdone', refresh);
    void crawl.fonts.ready.then(refresh);
  }
}

export function renderTextCrawlAtTime(container: HTMLElement, elapsedMs: number): void {
  const crawl = crawls.get(container);
  if (!crawl?.element.crawl) return;
  crawl.elapsedMs = elapsedMs;
  const sample = sampleTextCrawl(crawl.element.crawl, crawl.width, crawl.viewport, elapsedMs);
  crawl.track.style.transform = `translateX(${sample.offset}px)`;
}
