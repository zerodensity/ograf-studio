import { MAX_TEXT_CLIP_MARGIN, type Element } from '@ograf-editor/scene-model';

interface TextClipMargins {
  x: number;
  y: number;
}

function clipMargin(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.min(MAX_TEXT_CLIP_MARGIN, Math.max(0, value))
    : 0;
}

export function getTextClipMargins(element: Element): TextClipMargins | null {
  if (element.type !== 'text' || element.overflowPolicy !== 'clip' || element.crawl) return null;
  const x = clipMargin(element.clipMarginX);
  const y = clipMargin(element.clipMarginY);
  return x || y ? { x, y } : null;
}

/** Backing surfaces use symmetric padding and clip to the exact two-axis margins. */
export function textClipPadding(element: Element): number {
  const margins = getTextClipMargins(element);
  return margins ? Math.ceil(Math.max(margins.x, margins.y)) : 0;
}

/** Convert composition pixels to pre-transform pixels for Squeeze text. */
export function localTextClipMargins(margins: TextClipMargins, scaleX = 1, scaleY = 1) {
  return { x: margins.x / (scaleX || 1), y: margins.y / (scaleY || 1) };
}

export function applyTextClipMargins(
  style: CSSStyleDeclaration,
  margins: TextClipMargins,
  scaleX = 1,
  scaleY = 1,
): void {
  const { x, y } = localTextClipMargins(margins, scaleX, scaleY);
  // Clip painting without moving the glyphs, changing line wrapping, or reducing the fit box.
  style.overflow = 'visible';
  style.clipPath = `inset(${-y}px ${-x}px)`;
}
