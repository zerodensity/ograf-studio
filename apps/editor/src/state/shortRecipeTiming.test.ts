import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeKeyframeFrames,
  getLayerTransformAtFrame,
  getTotalFrames,
  STYLE_TOKEN_KEYS,
} from '@ograf-editor/scene-model';
import { assembleManifest, compileDescriptor } from '@ograf-editor/codegen';
import { FramePlayer, tickFramePlayers } from '../../../../packages/ograf-runtime/src/framePlayer';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { createProjectSet, resolveProjectSetTemplate } from './projectSet';
import { activateProjectSetTemplate } from './projectSetSession';
import { insertTemplateProject } from './templateCommands';
import { commitStartupCreation, requestStartupCreation } from './startupCreation';
import { useStartupScreenStore } from './startupScreenStore';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  setTimeout: (callback: () => void, timeout?: number) => setTimeout(callback, timeout),
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');

const recipes = [
  { method: 'addLowerThird', name: 'lower third', outFrames: 8 },
  { method: 'addBug', name: 'bug', outFrames: 8 },
  { method: 'addTicker', name: 'ticker', outFrames: 8 },
  { method: 'addScoreboard', name: 'scoreboard', outFrames: 6 },
  { method: 'addClock', name: 'clock', outFrames: 8 },
  { method: 'addCountdown', name: 'countdown', outFrames: 6 },
] as const;

function active() {
  const state = useProjectStore.getState();
  return state.project.compositions.find(
    (composition) => composition.id === state.activeCompositionId,
  )!;
}

function lifecycle() {
  const composition = active();
  const frames = computeKeyframeFrames(composition);
  const step = composition.keyframes.find((key) => key.role === 'step')!;
  const end = composition.keyframes.find((key) => key.role === 'end')!;
  return {
    step: frames.find((entry) => entry.keyframeId === step.id)!.frame,
    end: frames.find((entry) => entry.keyframeId === end.id)!.frame,
    out: composition.transitions.find((transition) => transition.toKeyframeId === end.id)!
      .durationFrames,
  };
}

describe('short recipe lifecycle', () => {
  beforeEach(() => {
    useStartupScreenStore.getState().close();
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.getState().deselectAll();
    history.resetHistory();
  });

  afterAll(() => {
    history.resetHistory();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(recipes.flatMap((recipe) => [25, 50, 60_000 / 1_001].map((fps) => ({ ...recipe, fps }))))(
    '$name has a short, immediately moving Out at $fps fps',
    ({ method, outFrames, fps }) => {
      useProjectStore.getState().updateCompositionSettings({ frameRate: fps });
      const result = useProjectStore.getState()[method]();
      const recipeLayers = result.layers as Record<string, string>;
      const composition = active();
      const { step, end, out } = lifecycle();
      for (const id of Object.values(recipeLayers)) {
        const layer = composition.layers.find((item) => item.id === id)!;
        expect(getLayerTransformAtFrame(layer, 0).opacity, layer.name).toBe(0);
      }
      expect(composition.keyframes.filter((key) => key.role === 'step')).toHaveLength(1);
      expect(out).toBe(outFrames);
      expect(end - step).toBe(outFrames);
      expect(getTotalFrames(composition) / fps).toBeLessThan(1.1);
      const panelId = recipeLayers.panel ?? recipeLayers.window;
      const panel = composition.layers.find((layer) => layer.id === panelId)!;
      const held = getLayerTransformAtFrame(panel, step);
      const firstOut = getLayerTransformAtFrame(panel, step + 1);
      expect(
        (['x', 'y', 'width', 'height', 'opacity'] as const).some(
          (property) => Math.abs(firstOut[property] - held[property]) > 1e-6,
        ),
      ).toBe(true);
      expect(composition.shortOutFrames).toBeUndefined();

      const descriptor = compileDescriptor(composition);
      const manifest = assembleManifest(
        useProjectStore.getState().project,
        composition,
        descriptor,
      );
      expect(descriptor.stepCount).toBe(1);
      expect(descriptor.exitTailStartFrame).toBeUndefined();
      expect(
        manifest.actionDurations?.find((action) => action.type === 'stopAction')?.duration,
      ).toBe(Math.round((outFrames / fps) * 1000));

      // Reusable source and materialized layers must share the same shortened key times.
      const component = composition.components.find((item) => item.id === result.componentId)!;
      expect(component).toBeDefined();
      for (const layer of composition.layers.filter(
        (item) => item.componentLink?.componentId === component.id,
      )) {
        const source = component.layers.find(
          (item) => item.id === layer.componentLink!.sourceLayerId,
        )!;
        expect(source).toBeDefined();
        expect(getLayerTransformAtFrame(source, 0).opacity, source.name).toBe(0);
        for (const [property, keys] of Object.entries(source.animationTracks)) {
          if (!keys) continue;
          expect(
            layer.animationTracks[property as keyof typeof layer.animationTracks]?.map(
              (key) => key.frame,
            ),
          ).toEqual(keys.map((key) => key.frame));
        }
      }

      if (method === 'addTicker') {
        const ticker = composition.layers.find((layer) => layer.id === recipeLayers.crawl)!;
        expect(ticker.element).toMatchObject({ type: 'ticker', updatePolicy: 'next-appearance' });
        expect(
          ticker.element.type === 'ticker' && ticker.element.speedPixelsPerSecond,
        ).toBeGreaterThan(0);
      }
      if (method === 'addCountdown') {
        const timer = composition.layers.find((layer) => layer.id === recipeLayers.value)!;
        expect(timer.element).toMatchObject({
          type: 'text',
          clock: { mode: 'count-down', initialValueMs: 30_000, autoStart: true },
        });
        expect(
          timer.visualRules
            .filter((rule) => rule.trigger === 'timer-alarm')
            .map((rule) => rule.timerAlarm?.thresholdMs)
            .sort((a, b) => (a ?? 0) - (b ?? 0)),
        ).toEqual([0, 5000]);
      }
    },
  );

  it.each(['news', 'sports', 'entertainment', 'documentary'] as const)(
    '%s recipe layers start transparent without hiding the on-air design',
    (pack) => {
      useProjectStore.getState().applyStylePack(pack);
      for (const { method } of recipes) {
        const result = useProjectStore.getState()[method]();
        const layers = Object.values(result.layers).map((id) =>
          active().layers.find((layer) => layer.id === id)!,
        );
        expect(layers.every((layer) => getLayerTransformAtFrame(layer, 0).opacity === 0)).toBe(
          true,
        );
        expect(
          layers.some((layer) => getLayerTransformAtFrame(layer, lifecycle().step).opacity > 0),
        ).toBe(true);
      }
    },
  );

  it('preserves a custom brand kit’s longer entrance and exit without clipping', () => {
    const store = useProjectStore.getState();
    store.applyStylePack('entertainment');
    const token = (key: string) => active().designSystem.tokens.find((entry) => entry.key === key)!;
    store.updateDesignToken(token(STYLE_TOKEN_KEYS.entranceFrames).id, { value: 20 });
    store.updateDesignToken(token(STYLE_TOKEN_KEYS.exitFrames).id, { value: 17 });
    const result = store.addLowerThird();
    const { step, end, out } = lifecycle();
    expect(step).toBeGreaterThanOrEqual(20);
    expect(out).toBe(17);
    expect(end - step).toBe(17);
    const panel = active().layers.find((layer) => layer.id === result.layers.panel)!;
    expect(getLayerTransformAtFrame(panel, step + 1)).not.toEqual(
      getLayerTransformAtFrame(panel, step),
    );
  });

  it('does not retime existing artwork or a deliberately customized blank timeline', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const before = structuredClone(active());
    store.addLowerThird();
    expect(active().keyframes).toEqual(before.keyframes);
    expect(active().transitions).toEqual(before.transitions);
    expect(active().layers.find((layer) => layer.id === id)!.animationTracks).toEqual(
      before.layers[0]!.animationTracks,
    );

    store.newProject();
    const step = active().keyframes.find((key) => key.role === 'step')!;
    store.renameKeyframe(step.id, 'Intentional hold');
    const custom = structuredClone(active());
    store.addLowerThird();
    expect(active().keyframes).toEqual(custom.keyframes);
    expect(active().transitions).toEqual(custom.transitions);
    expect(active().shortOutFrames).toBe(custom.shortOutFrames);
  });

  it('creates a short recipe in a new set template without changing the existing template or set defaults', () => {
    const project = useProjectStore.getState().project;
    const set = createProjectSet('News', project);
    const id = set.templates[0]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(id);
    const oldTemplate = structuredClone(resolveProjectSetTemplate(set, id));
    const oldDefaults = structuredClone(set.settings);
    requestStartupCreation('set-template', id, 'after');
    expect(commitStartupCreation({ width: 1280, height: 720, frameRate: 50 }, () => true)).toBe(
      true,
    );
    useStartupScreenStore.getState().close();
    useProjectStore.getState().addLowerThird();
    const current = useProjectSetStore.getState().projectSet!;
    expect(current.settings).toEqual(oldDefaults);
    expect(resolveProjectSetTemplate(current, id)).toEqual(oldTemplate);
    expect(active()).toMatchObject({ width: 1280, height: 720, frameRate: 50 });
    expect(lifecycle().end - lifecycle().step).toBe(8);
    const createdId = useProjectSetStore.getState().activeTemplateId!;
    const shortTimeline = structuredClone({
      keyframes: active().keyframes,
      transitions: active().transitions,
      components: active().components,
      layers: active().layers.map(({ id, animationTracks, keyframes, bindings }) => ({
        id,
        animationTracks,
        keyframes,
        bindings,
      })),
    });
    expect(activateProjectSetTemplate(id)).toBe(true);
    expect(useProjectStore.getState().project).toEqual(oldTemplate);
    expect(activateProjectSetTemplate(createdId)).toBe(true);
    expect(active()).toMatchObject(shortTimeline);
    expect(lifecycle().end - lifecycle().step).toBe(8);
    expect(useProjectSetStore.getState().projectSet!.settings).toEqual(oldDefaults);
  });

  it('remembers a new blank set template across navigation until its first recipe is added', () => {
    const project = useProjectStore.getState().project;
    const set = createProjectSet('News', project);
    const originalId = set.templates[0]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(originalId);
    requestStartupCreation('set-template', originalId, 'after');
    expect(commitStartupCreation({ width: 1280, height: 720, frameRate: 50 }, () => true)).toBe(
      true,
    );
    useStartupScreenStore.getState().close();
    const createdId = useProjectSetStore.getState().activeTemplateId!;
    expect(activateProjectSetTemplate(originalId)).toBe(true);
    expect(activateProjectSetTemplate(createdId)).toBe(true);
    useProjectStore.getState().addLowerThird();
    expect(lifecycle().out).toBe(8);
    expect(active()).toMatchObject({ width: 1280, height: 720, frameRate: 50 });
  });

  it('does not treat a loaded blank template as fresh when switching within its set', () => {
    const project = structuredClone(useProjectStore.getState().project);
    const set = createProjectSet('Loaded set', project);
    const originalId = set.templates[0]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(originalId);
    useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, originalId));
    const savedOut = lifecycle().out;
    requestStartupCreation('set-template', originalId, 'after');
    expect(commitStartupCreation({ width: 1920, height: 1080, frameRate: 25 }, () => true)).toBe(
      true,
    );
    useStartupScreenStore.getState().close();
    expect(activateProjectSetTemplate(originalId)).toBe(true);
    useProjectStore.getState().addLowerThird();
    expect(lifecycle().out).toBe(savedOut);
  });

  it('forgets fresh-template markers when the same set is loaded as a document', () => {
    const project = useProjectStore.getState().project;
    const set = createProjectSet('News', project);
    const originalId = set.templates[0]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(originalId);
    requestStartupCreation('set-template', originalId, 'after');
    expect(commitStartupCreation({ width: 1280, height: 720, frameRate: 50 }, () => true)).toBe(
      true,
    );
    useStartupScreenStore.getState().close();
    const createdId = useProjectSetStore.getState().activeTemplateId!;
    const reopenedSet = structuredClone(useProjectSetStore.getState().projectSet!);
    useProjectSetStore.getState().setProjectSet(reopenedSet);
    useProjectSetStore.getState().setActiveTemplateId(createdId);
    // A file open uses the ordinary loader, even if the saved set keeps the same IDs.
    useProjectStore.getState().loadProject(resolveProjectSetTemplate(reopenedSet, createdId));
    const savedOut = lifecycle().out;
    expect(activateProjectSetTemplate(originalId)).toBe(true);
    expect(activateProjectSetTemplate(createdId)).toBe(true);
    useProjectStore.getState().addLowerThird();
    expect(lifecycle().out).toBe(savedOut);
  });

  it('does not mark an imported copy fresh merely because it shares a project ID', () => {
    const project = useProjectStore.getState().project;
    const set = createProjectSet('News', project);
    const originalId = set.templates[0]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(originalId);
    requestStartupCreation('set-template', originalId, 'after');
    expect(commitStartupCreation({ width: 1920, height: 1080, frameRate: 25 }, () => true)).toBe(
      true,
    );
    useStartupScreenStore.getState().close();
    const freshTemplateId = useProjectSetStore.getState().activeTemplateId!;
    const savedOut = lifecycle().out;
    const importedCopy = structuredClone(useProjectStore.getState().project);
    insertTemplateProject(importedCopy, freshTemplateId, 'after');
    expect(useProjectSetStore.getState().activeTemplateId).not.toBe(freshTemplateId);
    expect(useProjectStore.getState().project.id).toBe(importedCopy.id);
    useProjectStore.getState().addLowerThird();
    expect(lifecycle().out).toBe(savedOut);
  });

  it('undoes the recipe and the shortened timeline in one history step', () => {
    const before = structuredClone(useProjectStore.getState().project);
    history.runDiscreteHistoryStep(
      () => useProjectStore.getState().addLowerThird(),
      'Add lower third',
    );
    expect(lifecycle().out).toBe(8);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('holds indefinitely at the Step and advances immediately to a full Out with the real frame player', () => {
    useProjectStore.getState().addLowerThird();
    const composition = active();
    const { step, end, out } = lifecycle();
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const frames: number[] = [];
    const player = new FramePlayer({
      frameRate: composition.frameRate,
      durationFrames: end,
      renderFrame: (frame) => frames.push(frame),
    });
    try {
      player.seek(step);
      now += 20_000;
      tickFramePlayers(now);
      expect(player.frame()).toBe(step);
      const completed = vi.fn();
      player.animateTo(end, { onComplete: completed });
      now += 1000 / composition.frameRate;
      tickFramePlayers(now);
      expect(player.frame()).toBeCloseTo(step + 1);
      now += ((out - 1) * 1000) / composition.frameRate;
      tickFramePlayers(now);
      expect(player.frame()).toBeCloseTo(end);
      expect(completed).toHaveBeenCalledOnce();
      // Non-realtime exact and backward samples must preserve the authored full Out.
      player.seek(step + out / 2);
      const midpoint = player.frame();
      player.seek(step);
      player.seek(step + out / 2);
      expect(player.frame()).toBe(midpoint);
      expect(frames.at(-1)).toBe(midpoint);
    } finally {
      player.dispose();
      clock.mockRestore();
    }
  });
});
