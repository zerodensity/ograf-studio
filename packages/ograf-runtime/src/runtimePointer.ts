import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';

export interface RuntimePointerPosition {
  x: number;
  y: number;
}

/** Resolve a related target within this snapshot, including descendants of a rendered layer. */
export function runtimeRelatedLayerId(
  event: Pick<MouseEvent, 'relatedTarget'>,
  layers: ReadonlyMap<string, HTMLElement>,
): string | undefined {
  const related = event.relatedTarget;
  if (!related || typeof related !== 'object' || !('nodeType' in related)) return undefined;
  for (const [id, element] of layers) if (element.contains(related as Node)) return id;
  return undefined;
}

/** Convert the visible viewport back to authored composition pixels, including a canvas crop. */
export function runtimePointerPosition(
  viewport: HTMLElement,
  descriptor: Pick<CompiledGraphicDescriptor, 'width' | 'height' | 'crop'>,
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
): RuntimePointerPosition | null {
  const bounds = viewport.getBoundingClientRect();
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY) ||
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    return null;
  return {
    x:
      (descriptor.crop?.x ?? 0) +
      ((event.clientX - bounds.left) / bounds.width) * (descriptor.crop?.width ?? descriptor.width),
    y:
      (descriptor.crop?.y ?? 0) +
      ((event.clientY - bounds.top) / bounds.height) *
        (descriptor.crop?.height ?? descriptor.height),
  };
}

/** Listen only within the preview surface; toolbar and unrelated document movement stay out. */
export function bindRuntimePointerPosition(options: {
  target: HTMLElement;
  viewport: HTMLElement;
  descriptor: Pick<CompiledGraphicDescriptor, 'width' | 'height' | 'crop'>;
  enabled(): boolean;
  changed(position: RuntimePointerPosition | null): void;
}): () => void {
  const update = (event: Event) => {
    if (!options.enabled()) return;
    const pointer = event as PointerEvent;
    if (pointer.pointerType === 'touch') return;
    // Keyboard activation has no pointer location; keep the last genuine position instead.
    if ((event.type === 'click' || event.type === 'dblclick') && pointer.detail === 0) return;
    options.changed(runtimePointerPosition(options.viewport, options.descriptor, pointer));
  };
  const leave = () => options.changed(null);
  // Capture updates the condition context before an object's click/down/up rule is evaluated.
  const events = ['pointerenter', 'pointermove', 'pointerdown', 'pointerup', 'click', 'dblclick'];
  for (const name of events) options.target.addEventListener(name, update, true);
  options.target.addEventListener('pointerleave', leave);
  options.target.addEventListener('pointercancel', leave);
  return () => {
    for (const name of events) options.target.removeEventListener(name, update, true);
    options.target.removeEventListener('pointerleave', leave);
    options.target.removeEventListener('pointercancel', leave);
  };
}
