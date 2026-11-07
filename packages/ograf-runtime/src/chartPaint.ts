import { gradientStopColor, isGradientPaint, type Paint } from '@ograf-editor/scene-model';

/** Native solid/gradient paints use the same CSS angle, stop ordering and stop alpha contract. */
export function drawChartPaint(
  canvas: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  paint: Paint,
): void {
  if (canvas.width !== mask.width) canvas.width = mask.width;
  if (canvas.height !== mask.height) canvas.height = mask.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Chart paint requires Canvas 2D rendering.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  // A provider can still be mounting, or temporarily have a zero-size responsive canvas.
  // Clear stale pixels now; the provider's next valid coverage frame repaints normally.
  if (mask.width <= 0 || mask.height <= 0) return;
  context.save();
  try {
    if (typeof paint === 'string') context.fillStyle = paint;
    else if (isGradientPaint(paint)) {
      const { width, height } = canvas;
      const radians = (paint.angle * Math.PI) / 180;
      const dx = Math.sin(radians),
        dy = -Math.cos(radians);
      const length = Math.abs(width * dx) + Math.abs(height * dy);
      const gradient =
        paint.type === 'linear'
          ? context.createLinearGradient(
              width / 2 - (dx * length) / 2,
              height / 2 - (dy * length) / 2,
              width / 2 + (dx * length) / 2,
              height / 2 + (dy * length) / 2,
            )
          : paint.type === 'radial'
            ? context.createRadialGradient(
                width / 2,
                height / 2,
                0,
                width / 2,
                height / 2,
                Math.hypot(width, height) / 2,
              )
            : context.createConicGradient(radians - Math.PI / 2, width / 2, height / 2);
      for (const stop of [...paint.stops].sort((a, b) => a.offset - b.offset))
        gradient.addColorStop(stop.offset, gradientStopColor(stop));
      context.fillStyle = gradient;
    } else return; // Shader and media paints are drawn by their shared native compositor.
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = 'source-over';
  } finally {
    context.restore();
  }
}
