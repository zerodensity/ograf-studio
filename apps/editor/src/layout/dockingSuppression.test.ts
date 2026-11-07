import { describe, expect, it } from 'vitest';
import { createDockingSuppression } from './dockingSuppression';

function keyDown(owner: EventTarget, key: string) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
  owner.dispatchEvent(event);
  return event;
}

describe('docking suppression during a pane drag', () => {
  it('ignores Escape until a drag arms it', () => {
    const owner = new EventTarget();
    const changes: boolean[] = [];
    const suppression = createDockingSuppression(owner, (value) => changes.push(value));
    const event = keyDown(owner, 'Escape');
    expect(suppression.suppressed).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(changes).toEqual([]);
  });

  it('turns docking off on Escape and keeps it off for the rest of the drag', () => {
    const owner = new EventTarget();
    const changes: boolean[] = [];
    const suppression = createDockingSuppression(owner, (value) => changes.push(value));
    suppression.arm();
    keyDown(owner, 'Shift');
    expect(suppression.suppressed).toBe(false);
    keyDown(owner, 'Escape');
    keyDown(owner, 'Escape');
    expect(suppression.suppressed).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('keeps the drag Escape away from other Escape handlers', () => {
    const owner = new EventTarget();
    const suppression = createDockingSuppression(owner, () => {});
    suppression.arm();
    let reachedLaterListener = false;
    owner.addEventListener('keydown', () => (reachedLaterListener = true), true);
    const event = keyDown(owner, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(reachedLaterListener).toBe(false);
  });

  it('starts the next drag with docking enabled and stops listening between drags', () => {
    const owner = new EventTarget();
    const changes: boolean[] = [];
    const suppression = createDockingSuppression(owner, (value) => changes.push(value));
    suppression.arm();
    keyDown(owner, 'Escape');
    suppression.disarm();
    expect(suppression.suppressed).toBe(false);
    expect(keyDown(owner, 'Escape').defaultPrevented).toBe(false);
    suppression.arm();
    expect(suppression.suppressed).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});
