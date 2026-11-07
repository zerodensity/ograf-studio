import { describe, expect, it, vi } from 'vitest';
import { newsVisibilityGate } from './transitionLogicNewsVisibility';

describe('news demonstration mount visibility', () => {
  it('keeps a mount hidden until prepared and a sampled frame is rendered', async () => {
    let finish!: () => void;
    const mount = {
      ready: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      host: { style: { visibility: 'hidden' } },
    };
    const refresh = vi.fn();
    const revealAfterRender = newsVisibilityGate(mount, () => true, refresh);
    revealAfterRender();
    expect(mount.host.style.visibility).toBe('hidden');
    finish();
    await mount.ready;
    expect(refresh).toHaveBeenCalledOnce();
    expect(mount.host.style.visibility).toBe('hidden');
    revealAfterRender();
    expect(mount.host.style.visibility).toBe('');
  });

  it('does not reveal a failed or released preparation', async () => {
    const failed = {
      ready: Promise.reject(new Error('failed')),
      host: { style: { visibility: 'hidden' } },
    };
    const refresh = vi.fn();
    const revealFailed = newsVisibilityGate(failed, () => true, refresh);
    await failed.ready.catch(() => undefined);
    revealFailed();
    expect(failed.host.style.visibility).toBe('hidden');

    let finish!: () => void;
    let current = true;
    const released = {
      ready: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      host: { style: { visibility: 'hidden' } },
    };
    const revealReleased = newsVisibilityGate(released, () => current, refresh);
    current = false;
    finish();
    await released.ready;
    revealReleased();
    expect(released.host.style.visibility).toBe('hidden');
    expect(refresh).not.toHaveBeenCalled();
  });
});
