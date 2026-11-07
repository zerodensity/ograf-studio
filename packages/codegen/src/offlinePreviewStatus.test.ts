import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const runtime = readFileSync(new URL('./offlinePreviewRuntime.js', import.meta.url), 'utf8');
const classification = runtime.slice(
  runtime.indexOf('  const coordinatedSet ='),
  runtime.indexOf("  const stage = document.getElementById('stage');"),
);
const controls = runtime.slice(
  runtime.indexOf('  function refreshStepStatus()'),
  runtime.indexOf('  function call('),
);
const initialize = runtime.slice(
  runtime.indexOf('    playButton.disabled = outButton.disabled = false;'),
  runtime.indexOf("    playButton.addEventListener('click'"),
);

function statusHarness(manifest: object, scheduler?: object) {
  const context = {
    manifest,
    scheduler,
    currentStep: undefined as number | undefined,
    stepStatus: { textContent: '' },
    playButton: { textContent: '', disabled: true },
    outButton: { disabled: true },
    backButton: { disabled: true },
    say: vi.fn(),
    check: (value: unknown) => value,
    refreshFpsVisibility: vi.fn(),
  };
  const api = runInNewContext(
    `${classification}\n${controls}\n${initialize}\n({ run, refreshStepStatus })`,
    context,
  ) as {
    run: (label: string, callback: () => unknown, lifecycle?: string) => void;
    refreshStepStatus: () => void;
  };
  return { ...api, context };
}

describe('offline preview header status', () => {
  it('identifies a coordinated set initially and after successful lane Take and Out calls', async () => {
    const { context, run } = statusHarness({
      schema: { properties: { slots: { properties: { headline: {} } } } },
      customActions: [{ id: 'transition.take' }],
    });
    expect(context.stepStatus.textContent).toBe('Coordinated set');
    for (const [label, lifecycle] of [['Take Headline'], ['Take Out', 'out']]) {
      context.say.mockClear();
      run(label!, () => ({ statusCode: 200 }), lifecycle);
      await vi.waitFor(() => expect(context.say).toHaveBeenCalled());
      expect(context.stepStatus.textContent).toBe('Coordinated set');
      expect(context.currentStep).toBeUndefined();
    }
  });

  it('keeps ordinary real-time steps and rendered-preview labels', () => {
    for (const manifest of [
      { stepCount: 3 },
      { schema: { properties: { slots: { properties: {} } } } },
      { customActions: [{ id: 'transition.take' }] },
    ]) {
      const { context, refreshStepStatus } = statusHarness(manifest);
      expect(context.stepStatus.textContent).toBe('Off air');
      context.currentStep = 0;
      refreshStepStatus();
      expect(context.stepStatus.textContent).toBe(`Step 1 of ${'stepCount' in manifest ? 3 : 1}`);
      expect(statusHarness(manifest, {}).context.stepStatus.textContent).toBe('Rendered preview');
    }
  });
});
