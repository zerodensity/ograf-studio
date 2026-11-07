/** Conservative installed-font detection; CSS FontFaceSet.check alone accepts missing families. */
export function isAvailableImportFont(family: string): boolean {
  if (/^(?:serif|sans-serif|monospace)$/i.test(family)) return true;
  if (!document.fonts.check(`16px "${family.replaceAll('"', '')}"`)) return false;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return false;
  const sample = 'mmmmmmmmmmlliWW@#0123456789';
  const widths = ['monospace', 'serif', 'sans-serif'].map((fallback) => {
    context.font = `32px ${fallback}`;
    const base = context.measureText(sample).width;
    context.font = `32px "${family.replaceAll('"', '')}", ${fallback}`;
    return Math.abs(context.measureText(sample).width - base);
  });
  return widths.some((difference) => difference > 0.01);
}
