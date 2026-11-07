import { describe, expect, it, vi } from 'vitest';
import { bindRuntimePointerPosition, runtimePointerPosition } from './runtimePointer';

class Surface extends EventTarget {
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    // Node's EventTarget ignores boolean capture on removal; browsers support both spellings.
    super.removeEventListener(
      type,
      listener,
      typeof options === 'boolean' ? { capture: options } : options,
    );
  }
  getBoundingClientRect() {
    return { left: 100, top: 50, right: 740, bottom: 410, width: 640, height: 360 };
  }
}
const descriptor = { width: 1920, height: 1080 };
function event(type: string, patch: Record<string, unknown> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: 420,
    clientY: 230,
    pointerType: 'mouse',
    detail: 1,
    ...patch,
  });
}

describe('graphic-local composition pointer coordinates', () => {
  it('converts scaled viewports and crops back into authored composition pixels', () => {
    const viewport = new Surface() as unknown as HTMLElement;
    expect(runtimePointerPosition(viewport, descriptor, { clientX: 420, clientY: 230 })).toEqual({
      x: 960,
      y: 540,
    });
    expect(
      runtimePointerPosition(
        viewport,
        { ...descriptor, crop: { x: 200, y: 100, width: 1280, height: 720 } },
        { clientX: 420, clientY: 230 },
      ),
    ).toEqual({ x: 840, y: 460 });
    expect(runtimePointerPosition(viewport, descriptor, { clientX: 99, clientY: 230 })).toBeNull();
    expect(runtimePointerPosition(viewport, descriptor, { clientX: NaN, clientY: 230 })).toBeNull();
    expect(
      runtimePointerPosition(
        { getBoundingClientRect: () => ({ width: 0, height: 0 }) } as HTMLElement,
        descriptor,
        { clientX: 0, clientY: 0 },
      ),
    ).toBeNull();
  });

  it('captures the latest mouse position before click Rules and clears only on its own surface leave', () => {
    const surface = new Surface(),
      outside = new Surface();
    const listen = vi.spyOn(surface, 'addEventListener');
    let pointer: unknown = null;
    const changed = vi.fn((next) => {
      pointer = next;
    });
    const stop = bindRuntimePointerPosition({
      target: surface as unknown as HTMLElement,
      viewport: surface as unknown as HTMLElement,
      descriptor,
      enabled: () => true,
      changed,
    });
    expect(listen).toHaveBeenCalledWith('click', expect.any(Function), true);
    const clickRule = vi.fn(() => pointer);
    surface.addEventListener('click', clickRule);
    surface.dispatchEvent(event('click'));
    expect(clickRule.mock.results[0]!.value).toEqual({ x: 960, y: 540 });
    changed.mockClear();
    outside.dispatchEvent(event('pointermove'));
    surface.dispatchEvent(event('click', { detail: 0, clientX: 0, clientY: 0 }));
    surface.dispatchEvent(event('pointermove', { pointerType: 'touch' }));
    expect(changed).not.toHaveBeenCalled();
    surface.dispatchEvent(event('pointerleave'));
    expect(changed).toHaveBeenLastCalledWith(null);
    stop();
    changed.mockClear();
    surface.dispatchEvent(event('pointermove'));
    expect(changed).not.toHaveBeenCalled();
  });
});
