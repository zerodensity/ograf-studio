import { byte } from './colorMath';

/** Validate an edited hex value, retaining existing opacity when only RGB is supplied. */
export function parseColorHexDraft(
  draft: string,
  allowAlpha: boolean,
  alphaEnabled: boolean,
  opacity: number,
): string | null {
  let next = draft.trim().toLowerCase();
  if (/^#[\da-f]{3,4}$/.test(next)) next = '#' + [...next.slice(1)].map((c) => c + c).join('');
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/.test(next) || (!allowAlpha && next.length !== 7)) return null;
  if (alphaEnabled && next.length === 7) next += byte(opacity * 255);
  return next;
}
