import { readColor } from '@ograf-editor/scene-model';

export interface TextTintStep {
  color: string;
  weight: number;
}
export interface ComposedTextTint {
  rgb: [number, number, number];
  weight: number;
}

/** Collapse an ordered sequence of per-property color animations into one premultiplied tint. */
export function composeTextTint(steps: readonly TextTintStep[]): ComposedTextTint {
  let weight = 0;
  const contribution = [0, 0, 0];
  for (const step of steps) {
    const color = readColor(step.color);
    if (!color) throw new Error('Text tint color cannot be parsed.');
    const amount = Math.max(0, Math.min(1, step.weight)) * color.alpha;
    for (let channel = 0; channel < 3; channel++)
      contribution[channel] = contribution[channel]! * (1 - amount) + color.rgb[channel]! * amount;
    weight = weight * (1 - amount) + amount;
  }
  return {
    rgb:
      weight > 0
        ? [contribution[0]! / weight, contribution[1]! / weight, contribution[2]! / weight]
        : [0, 0, 0],
    weight,
  };
}

/**
 * Composite a glyph's tint onto a separate transparent weight map. Erase existing tint by
 * full glyph coverage before additively drawing the new tint, so an untinted foreground glyph
 * occludes previously tinted glyphs. The ordinary coverage mask is maintained separately.
 */
export function paintTextTintGlyph(
  context: CanvasRenderingContext2D,
  drawGlyph: () => void,
  coverageOpacity: number,
  tint: ComposedTextTint,
): void {
  context.save();
  try {
    context.globalAlpha = Math.max(0, Math.min(1, coverageOpacity));
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#ffffff';
    drawGlyph();
    if (tint.weight > 0) {
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = `rgba(${tint.rgb.map((v) => Math.round(v)).join(', ')}, ${tint.weight})`;
      drawGlyph();
    }
  } finally {
    context.restore();
  }
}
