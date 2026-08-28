import { useEffect, useRef, useState } from 'react';
import { numericScrubValue, NUMERIC_SCRUB_DRAG_THRESHOLD_PX } from './numericScrub';
import './NumericScrubController.css';

interface NumericHint {
  left: number;
  top: number;
}

interface ScrubGesture {
  input: HTMLInputElement;
  pointerId: number;
  startClientX: number;
  startValue: number;
  step: number;
  min: number | undefined;
  max: number | undefined;
  dragged: boolean;
}

function eligibleNumericInput(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof HTMLInputElement) || target.type !== 'number') return null;
  return target.disabled || target.readOnly ? null : target;
}

function finiteAttribute(input: HTMLInputElement, name: 'min' | 'max'): number | undefined {
  const value = Number(input[name]);
  return input[name] !== '' && Number.isFinite(value) ? value : undefined;
}

function inputStep(input: HTMLInputElement): number {
  const value = Number(input.step);
  return input.step !== 'any' && Number.isFinite(value) && value > 0 ? value : 1;
}

function hintPosition(input: HTMLInputElement): NumericHint {
  const rect = input.getBoundingClientRect();
  const width = 470;
  const left = Math.max(6, Math.min(rect.left, window.innerWidth - width - 6));
  const below = rect.bottom + 6;
  return { left, top: below + 58 < window.innerHeight ? below : Math.max(6, rect.top - 58) };
}

function publishInputValue(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function NumericScrubController() {
  const [hint, setHint] = useState<NumericHint | null>(null);
  const gestureRef = useRef<ScrubGesture | null>(null);

  useEffect(() => {
    const finishGesture = (event: PointerEvent, cancelled = false) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gestureRef.current = null;
      document.body.classList.remove('is-scrubbing-number');
      gesture.input.classList.remove('is-number-scrubbing');
      if (gesture.input.hasPointerCapture?.(gesture.pointerId)) {
        gesture.input.releasePointerCapture(gesture.pointerId);
      }
      if (!cancelled && gesture.dragged) {
        gesture.input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (!cancelled) {
        requestAnimationFrame(() => {
          gesture.input.focus();
          gesture.input.select();
        });
      }
    };

    const handlePointerOver = (event: PointerEvent) => {
      const input = eligibleNumericInput(event.target);
      if (input && !gestureRef.current) setHint(hintPosition(input));
    };
    const handlePointerOut = (event: PointerEvent) => {
      const input = eligibleNumericInput(event.target);
      if (!input || gestureRef.current) return;
      if (event.relatedTarget instanceof Node && input.contains(event.relatedTarget)) return;
      setHint(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const input = eligibleNumericInput(event.target);
      if (!input) return;
      const value = Number(input.value);
      gestureRef.current = {
        input,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startValue: Number.isFinite(value) ? value : (finiteAttribute(input, 'min') ?? 0),
        step: inputStep(input),
        min: finiteAttribute(input, 'min'),
        max: finiteAttribute(input, 'max'),
        dragged: false,
      };
      input.setPointerCapture?.(event.pointerId);
      setHint(hintPosition(input));
    };
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (
        !gesture.dragged &&
        Math.abs(event.clientX - gesture.startClientX) < NUMERIC_SCRUB_DRAG_THRESHOLD_PX
      )
        return;
      event.preventDefault();
      gesture.dragged = true;
      document.body.classList.add('is-scrubbing-number');
      gesture.input.classList.add('is-number-scrubbing');
      publishInputValue(
        gesture.input,
        numericScrubValue({
          startValue: gesture.startValue,
          startClientX: gesture.startClientX,
          currentClientX: event.clientX,
          step: gesture.step,
          min: gesture.min,
          max: gesture.max,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        }),
      );
    };
    const handlePointerUp = (event: PointerEvent) => finishGesture(event);
    const handlePointerCancel = (event: PointerEvent) => finishGesture(event, true);
    const handleBlur = () => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      finishGesture(new PointerEvent('pointercancel', { pointerId: gesture.pointerId }), true);
      setHint(null);
    };

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleBlur);
      document.body.classList.remove('is-scrubbing-number');
      gestureRef.current?.input.classList.remove('is-number-scrubbing');
      gestureRef.current = null;
    };
  }, []);

  return hint ? (
    <div className="numeric-scrub-hint" role="tooltip" style={hint}>
      <span>Drag left/right to decrease/increase · Shift 10× · Alt 0.1×</span>
      <span>Click to select all and type</span>
    </div>
  ) : null;
}
