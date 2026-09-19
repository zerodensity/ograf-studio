import { describe, expect, it, vi } from 'vitest';
import { ShaderPreviewClock } from './shaderPreviewClock';

describe('shader content preview clock', () => {
  it('continues through a held Step and resumes its timeline without rewinding shader time', () => {
    const clock = new ShaderPreviewClock();
    clock.play(1000);
    expect(clock.sample(1480)).toBe(480);
    // The master timeline parks at frame 12 / 25 fps. Its held content clock keeps advancing.
    expect(clock.sample(6480)).toBe(5480);
    clock.play(6480);
    expect(clock.sample(6480)).toBe(5480);
    expect(clock.sample(6600)).toBe(5600);
    expect(clock.running).toBe(true);
  });

  it('explicitly seeking even to the same held Step resets and freezes exact timestamp sampling', () => {
    const clock = new ShaderPreviewClock();
    clock.play(1000);
    expect(clock.sample(6000)).toBe(5000);
    clock.seek(480);
    expect(clock.running).toBe(false);
    expect(clock.sample(6000)).toBe(480);
    expect(clock.sample(16000)).toBe(480);
    clock.seek(200);
    expect(clock.sample(18000)).toBe(200);
  });

  it('freezes on manual pause and continues from that exact content time on Play', () => {
    const clock = new ShaderPreviewClock(200);
    clock.play(1000);
    clock.pause(1250);
    expect(clock.running).toBe(false);
    expect(clock.sample(9000)).toBe(450);
    clock.play(9000);
    expect(clock.sample(9250)).toBe(700);
  });

  it('Stop resets held motion to zero and Play from the end starts a fresh content clock', () => {
    const clock = new ShaderPreviewClock();
    clock.play(1000);
    clock.seek(0);
    expect(clock.sample(10000)).toBe(0);
    clock.play(10000);
    expect(clock.sample(10480)).toBe(480);
    clock.pause(11000);
    clock.seek(0);
    clock.play(12000);
    expect(clock.sample(12100)).toBe(100);
  });

  it('keeps time when a shader renderer subscribes again after source or size edits', () => {
    const clock = new ShaderPreviewClock();
    const oldRenderer = vi.fn();
    const removeOld = clock.subscribe(oldRenderer);
    clock.play(1000);
    expect(oldRenderer).toHaveBeenCalledTimes(1);
    removeOld();
    const replacementRenderer = vi.fn();
    const removeReplacement = clock.subscribe(replacementRenderer);
    expect(clock.sample(5000)).toBe(4000);
    clock.pause(6000);
    expect(clock.sample(7000)).toBe(5000);
    expect(oldRenderer).toHaveBeenCalledTimes(1);
    expect(replacementRenderer).toHaveBeenCalledTimes(1);
    removeReplacement();
    clock.seek(0);
    expect(replacementRenderer).toHaveBeenCalledTimes(1);
  });
});
