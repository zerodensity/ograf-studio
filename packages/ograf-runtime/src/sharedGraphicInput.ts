import type {
  SharedGraphicInput,
  SharedGraphicPointerEdge,
  SharedGraphicPointerPosition,
} from '@ograf-editor/ograf-types';
import type { VisualRuleKeyboardInput } from '@ograf-editor/scene-model';
import type { RuntimeKeyboardTrigger } from './runtimeKeyboard';
import { normalizedRuntimePointerPosition } from './runtimePointer';

export type SharedInputHandler = (input: SharedGraphicInput) => void;

export function validSharedPointerPosition(position: SharedGraphicPointerPosition): boolean {
  return (
    Number.isFinite(position.x) &&
    position.x >= 0 &&
    position.x <= 1 &&
    Number.isFinite(position.y) &&
    position.y >= 0 &&
    position.y <= 1
  );
}

const positionEvents = [
  'pointerenter',
  'pointermove',
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
];

function hasPointerPosition(event: MouseEvent): boolean {
  return (
    (!('pointerType' in event) || event.pointerType !== 'touch') &&
    ((event.type !== 'click' && event.type !== 'dblclick') || event.detail !== 0)
  );
}

/** Observe trusted local input without changing its native handling or emitting virtual replay. */
export function createSharedInputCapture(host: HTMLElement, enabled: () => boolean) {
  let handler: SharedInputHandler | null = null;
  let latestPosition: SharedGraphicPointerPosition | null = null;
  const emit = (input: SharedGraphicInput, event?: Event) => {
    if (!handler || !event?.isTrusted || !enabled()) return;
    try {
      handler(input);
    } catch {
      // Transport observers must never interrupt the local graphic's input.
    }
  };
  const move = (event: Event) => {
    const mouse = event as MouseEvent;
    if (!handler || !event.isTrusted || !enabled() || !hasPointerPosition(mouse)) return;
    const position = normalizedRuntimePointerPosition(host, mouse);
    if (!position) {
      if (latestPosition) leave(event);
      return;
    }
    if (latestPosition?.x === position.x && latestPosition.y === position.y) return;
    latestPosition = position;
    emit({ type: 'pointer-move', position }, event);
  };
  const leave = (event: Event) => {
    latestPosition = null;
    emit({ type: 'pointer-leave' }, event);
  };
  return {
    set(next: SharedInputHandler | null) {
      if (Boolean(next) !== Boolean(handler)) {
        if (next) {
          for (const name of positionEvents) host.addEventListener(name, move, true);
          host.addEventListener('pointerleave', leave);
          host.addEventListener('pointercancel', leave);
        } else {
          for (const name of positionEvents) host.removeEventListener(name, move, true);
          host.removeEventListener('pointerleave', leave);
          host.removeEventListener('pointercancel', leave);
        }
      }
      if (next !== handler) latestPosition = null;
      handler = next;
    },
    pointer(input: SharedGraphicPointerEdge, event: MouseEvent, includePosition = true) {
      if (!handler || !event.isTrusted || !enabled()) return;
      const position =
        includePosition && hasPointerPosition(event)
          ? normalizedRuntimePointerPosition(host, event)
          : null;
      emit(position ? { ...input, position } : input, event);
    },
    keyboard(
      trigger: RuntimeKeyboardTrigger,
      input: VisualRuleKeyboardInput,
      event?: KeyboardEvent,
    ) {
      const { isComposing, ...key } = input;
      if (!isComposing) emit({ type: trigger, ...key }, event);
    },
  };
}
