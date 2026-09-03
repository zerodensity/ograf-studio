import {
  getPaintAtFrame,
  patternRows,
  patternRowOffset,
  tilingSvgContent,
  type PatternElement,
  type LayerAnimationTracks,
} from '@ograf-editor/scene-model';
const mounted = new WeakMap<
  HTMLElement,
  {
    svg: SVGSVGElement;
    element: PatternElement;
    id: string;
    paint: string;
    elapsed: number;
    rows: ReturnType<typeof patternRows>;
  }
>();
let nextPattern = 0;
function host(container: HTMLElement): HTMLElement {
  const first = container.firstElementChild as HTMLElement | null;
  return first?.classList?.contains('layer-content-host') ? first : container;
}
export function mountPattern(container: HTMLElement, element: PatternElement): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.dataset.ografPattern = 'true';
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute(
    'viewBox',
    `0 0 ${element.definition?.width ?? 1920} ${element.definition?.height ?? 1080}`,
  );
  svg.setAttribute('preserveAspectRatio', 'none');
  Object.assign(svg.style, { width: '100%', height: '100%', pointerEvents: 'none' });
  const id = `ograf-pattern-${nextPattern++}`;
  svg.innerHTML = tilingSvgContent(element, id);
  container.appendChild(svg);
  mounted.set(container, {
    svg,
    element,
    id,
    paint: JSON.stringify(element.fill),
    elapsed: 0,
    rows: element.definition ? patternRows(element.definition) : [],
  });
}
export function renderPatternAtElapsed(container: HTMLElement, frame: number): void {
  const entry = mounted.get(host(container));
  if (!entry?.element.definition) return;
  entry.elapsed = frame;
  const pattern = entry.element.definition;
  for (const row of entry.rows) {
    const node = entry.svg.querySelector(`[data-ograf-pattern-row="${row.row}"]`);
    node?.setAttribute('x', String(patternRowOffset(pattern, row, frame)));
  }
}
export function applyPatternPaint(
  container: HTMLElement,
  tracks: LayerAnimationTracks,
  frame: number,
): boolean {
  const entry = mounted.get(host(container));
  if (!entry) return false;
  const fill = getPaintAtFrame(entry.element.fill, tracks, frame),
    serialized = JSON.stringify(fill);
  if (serialized !== entry.paint) {
    entry.svg.innerHTML = tilingSvgContent({ ...entry.element, fill }, entry.id, entry.elapsed);
    entry.paint = serialized;
  }
  return true;
}
