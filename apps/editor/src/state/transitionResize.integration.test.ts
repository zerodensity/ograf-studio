import { describe, expect, it } from 'vitest';
import {
  replayTransitionLogic,
  sampleTransitionLogic,
  transitionLogicErrors,
  type TransitionLogicDefinition,
  type TransitionLogicEvent,
  type TransitionLogicReferences,
  type TransitionLogicSample,
} from '@ograf-editor/scene-model';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { buildCoordinatedProjectSetArtifacts } from './coordinatedExport';
import { createProjectSetArchive, openProjectSetArchive } from './projectSet';
import { applyResize, clearResize, readResizeSetting, resizeTargets } from './transitionResize';
import { resizeTiming, setResizeTiming } from './transitionResizeTiming';
import { overlapWithLayout, templateLayouts } from './transitionsDesign';

function newsFixture() {
  const set = createTransitionLogicNewsExample(0);
  const components = set.componentAssets!;
  const references: TransitionLogicReferences = {
    templateIds: set.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      components.map((asset) => [asset.id, asset.layers.map((layer) => layer.id)]),
    ),
  };
  const target = resizeTargets(set.transitionLogic!, components, 'lower-third', 'name').find(
    (entry) => entry.sourceLayerId === 'news-glass',
  )!;
  const clockOffsets = set.transitionLogic!.layoutRules![0]!.sharedOffsets.filter(
    (entry) => entry.instanceId === 'news-clock-asset-on-air',
  );
  return { set, components, references, target, clockOffsets };
}

function newsWithResize() {
  const { set, components, references, target, clockOffsets } = newsFixture();
  let definition = applyResize(
    set.transitionLogic!,
    'ticker',
    'lower-third',
    target,
    { width: 1400, height: 180, anchor: 'bottom-right' },
    references,
  );
  definition = setResizeTiming(
    definition,
    'ticker',
    'ticker',
    'enter',
    { startFrame: 10, durationFrames: 40 },
    references,
  );
  definition = setResizeTiming(
    definition,
    'ticker',
    'ticker',
    'exit',
    { startFrame: 40, durationFrames: 30 },
    references,
  );
  set.transitionLogic = definition;
  return { set, components, references, definition, target, clockOffsets };
}

function newsWithHeightResize() {
  const { set, components, references, target, clockOffsets } = newsFixture();
  const definition = applyResize(
    set.transitionLogic!,
    'ticker',
    'lower-third',
    target,
    { width: target.width, height: target.height - 62, anchor: 'top-left' },
    references,
  );
  set.transitionLogic = definition;
  return { set, components, references, definition, target, clockOffsets };
}

const events: TransitionLogicEvent[] = [
  { type: 'request', frame: 0, slotId: 'lower-third', stateId: 'name', requestId: 'lower-in' },
  { type: 'ready', frame: 0, slotId: 'lower-third', requestId: 'lower-in' },
  { type: 'request', frame: 100, slotId: 'ticker', stateId: 'ticker', requestId: 'ticker-in' },
  { type: 'ready', frame: 100, slotId: 'ticker', requestId: 'ticker-in' },
  { type: 'request', frame: 300, slotId: 'ticker', stateId: null, requestId: 'ticker-out' },
];

function sampleAt(
  definition: TransitionLogicDefinition,
  frame: number,
  sequence: TransitionLogicEvent[] = events,
) {
  return sampleTransitionLogic(
    definition,
    replayTransitionLogic(definition, sequence, frame),
    frame,
  );
}

function property(sample: TransitionLogicSample, sourceLayerId: string, name: string): number {
  const value = sample.sharedValues.find(
    (entry) => entry.sourceLayerId === sourceLayerId && entry.property === name,
  );
  expect(value, `${sourceLayerId}.${name} at frame ${sample.frame}`).toBeDefined();
  return value!.value as number;
}

function glassPose(sample: TransitionLogicSample) {
  return Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((name) => [name, property(sample, 'news-glass', name)]),
  ) as { x: number; y: number; width: number; height: number };
}

describe('news resize through authoring, planner and export', () => {
  it('reserves ticker space by reducing only panel height, then grows back after the ticker is gone', () => {
    const { set, definition, target } = newsWithHeightResize();
    expect(overlapWithLayout(definition, templateLayouts(set), 'name', 'ticker')).toBe(-14);

    const original = { x: target.x, y: target.y, width: target.width, height: target.height };
    const occupied = { ...original, height: target.height - 62 };
    expect(glassPose(sampleAt(definition, 100))).toEqual(original);
    const shrinking = glassPose(sampleAt(definition, 115));
    expect(shrinking).toEqual({ ...original, height: target.height - 31 });
    expect(
      sampleAt(definition, 115).slots.find((slot) => slot.slotId === 'ticker')!.incomingOpacity,
    ).toBe(0);

    // Reserve finishes at 130; the ticker's authored reveal starts at 134.
    expect(glassPose(sampleAt(definition, 130))).toEqual(occupied);
    expect(
      sampleAt(definition, 134).slots.find((slot) => slot.slotId === 'ticker')!.incomingOpacity,
    ).toBe(0);
    expect(
      sampleAt(definition, 135).slots.find((slot) => slot.slotId === 'ticker')!.incomingOpacity,
    ).toBeGreaterThan(0);
    expect(glassPose(sampleAt(definition, 300))).toEqual(occupied);
    expect(glassPose(sampleAt(definition, 335))).toEqual(occupied);
    expect(
      sampleAt(definition, 335).slots.find((slot) => slot.slotId === 'ticker')!.outgoingOpacity,
    ).toBe(0);
    expect(glassPose(sampleAt(definition, 339))).toEqual(occupied);
    expect(glassPose(sampleAt(definition, 354))).toEqual({
      ...original,
      height: target.height - 31,
    });
    expect(glassPose(sampleAt(definition, 369))).toEqual(original);
    expect(property(sampleAt(definition, 369), 'news-clock', 'y')).toBe(982);
  });

  it('returns to the same panel and clock geometry across repeated ticker on/off cycles', () => {
    const { definition, target } = newsWithHeightResize();
    const sequence: TransitionLogicEvent[] = [
      ...events,
      { type: 'request', frame: 500, slotId: 'ticker', stateId: 'ticker', requestId: 'again-in' },
      { type: 'ready', frame: 500, slotId: 'ticker', requestId: 'again-in' },
      { type: 'request', frame: 700, slotId: 'ticker', stateId: null, requestId: 'again-out' },
      { type: 'request', frame: 900, slotId: 'ticker', stateId: 'ticker', requestId: 'third-in' },
      { type: 'ready', frame: 900, slotId: 'ticker', requestId: 'third-in' },
      { type: 'request', frame: 1100, slotId: 'ticker', stateId: null, requestId: 'third-out' },
    ];
    const unchanged = structuredClone(definition);
    const original = { x: target.x, y: target.y, width: target.width, height: target.height };
    for (const frame of [200, 600, 1000]) {
      const occupied = sampleAt(definition, frame, sequence);
      expect(glassPose(occupied)).toEqual({ ...original, height: target.height - 62 });
      expect(property(occupied, 'news-clock', 'y')).toBe(920);
    }
    for (const frame of [400, 800, 1200]) {
      const restored = sampleAt(definition, frame, sequence);
      expect(glassPose(restored)).toEqual(original);
      expect(property(restored, 'news-clock', 'y')).toBe(982);
      expect(property(restored, 'news-clock-label', 'y')).toBe(982);
    }
    expect(definition).toEqual(unchanged);
  });

  it('keeps resize relative to the current template when switching the lower third with ticker on air', () => {
    const { definition } = newsWithHeightResize();
    const sequence: TransitionLogicEvent[] = [
      ...events.slice(0, 4),
      {
        type: 'request',
        frame: 220,
        slotId: 'lower-third',
        stateId: 'headline',
        requestId: 'headline',
      },
      { type: 'ready', frame: 220, slotId: 'lower-third', requestId: 'headline' },
      ...events.slice(4),
    ];
    const headline = { x: 96, y: 756, width: 1728, height: 274 };
    expect(glassPose(sampleAt(definition, 252, sequence))).toEqual({ ...headline, height: 212 });
    expect(glassPose(sampleAt(definition, 339, sequence))).toEqual({ ...headline, height: 212 });
    expect(glassPose(sampleAt(definition, 354, sequence))).toEqual({ ...headline, height: 243 });
    expect(glassPose(sampleAt(definition, 369, sequence))).toEqual(headline);
    expect(property(sampleAt(definition, 369, sequence), 'news-clock', 'x')).toBe(1614);
    expect(property(sampleAt(definition, 369, sequence), 'news-clock', 'y')).toBe(982);
  });

  it('retains an otherwise ambiguous anchor and resets panel size without changing clock or timing', async () => {
    const { set, components, references, target, clockOffsets } = newsWithHeightResize();
    set.transitionLogic = applyResize(
      set.transitionLogic!,
      'ticker',
      'lower-third',
      target,
      { width: target.width, height: 180, anchor: 'bottom-center' },
      references,
    );
    const archive = await createProjectSetArchive(set);
    const loaded = (await openProjectSetArchive(await archive.arrayBuffer())).transitionLogic!;
    const loadedTarget = resizeTargets(loaded, components, 'lower-third', 'name').find(
      (entry) => entry.sourceLayerId === 'news-glass',
    )!;
    // Unchanged width makes horizontal anchor position impossible to infer from x alone.
    expect(readResizeSetting(loaded, 'ticker', 'lower-third', loadedTarget).anchor).toBe(
      'bottom-center',
    );
    const reset = clearResize(loaded, 'ticker', 'lower-third', loadedTarget, references);
    expect(reset.layoutRules!.flatMap((rule) => rule.sharedOffsets)).toEqual(clockOffsets);
    for (const phase of ['enter', 'exit'] as const)
      expect(resizeTiming(reset, 'ticker', 'ticker', phase, 50)).toEqual(
        resizeTiming(loaded, 'ticker', 'ticker', phase, 50),
      );
    expect(glassPose(sampleAt(reset, 200))).toEqual({
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    });
    expect(property(sampleAt(reset, 200), 'news-clock', 'y')).toBe(920);
  });

  it('resizes the selected panel around its bottom-right anchor on the explicit entrance schedule', () => {
    const { definition, references, target, clockOffsets } = newsWithResize();
    expect(transitionLogicErrors(definition, references)).toEqual([]);
    expect(readResizeSetting(definition, 'ticker', 'lower-third', target)).toEqual({
      width: 1400,
      height: 180,
      anchor: 'bottom-right',
      configured: true,
    });
    expect(
      definition
        .layoutRules!.flatMap((rule) => rule.sharedOffsets)
        .filter((entry) => entry.instanceId === 'news-clock-asset-on-air'),
    ).toEqual(clockOffsets);

    const full = { x: target.x, y: target.y, width: target.width, height: target.height };
    expect(glassPose(sampleAt(definition, 99))).toEqual(full);
    expect(glassPose(sampleAt(definition, 100))).toEqual(full);
    expect(glassPose(sampleAt(definition, 110))).toEqual(full);

    const middle = glassPose(sampleAt(definition, 130));
    expect(middle.width).toBeCloseTo((target.width + 1400) / 2);
    expect(middle.height).toBeCloseTo((target.height + 180) / 2);
    expect(middle.x + middle.width).toBeCloseTo(target.x + target.width);
    expect(middle.y + middle.height).toBeCloseTo(target.y + target.height);
    expect(property(sampleAt(definition, 130), 'news-clock', 'y')).toBeCloseTo(982 - 62 / 2);

    const endSample = sampleAt(definition, 150);
    const end = glassPose(endSample);
    expect(end).toEqual({
      x: target.x + target.width - 1400,
      y: target.y + target.height - 180,
      width: 1400,
      height: 180,
    });
    expect(end.x + end.width).toBe(target.x + target.width);
    expect(end.y + end.height).toBe(target.y + target.height);
    expect(endSample.slots.find((slot) => slot.slotId === 'ticker')!.incomingOpacity).toBe(0);
    expect(property(endSample, 'news-clock', 'y')).toBe(920);
  });

  it('keeps the resized layout after ticker exit starts, then restores all offsets on schedule', () => {
    const { definition, target } = newsWithResize();
    const occupied = glassPose(sampleAt(definition, 200));
    expect(glassPose(sampleAt(definition, 339))).toEqual(occupied);
    expect(glassPose(sampleAt(definition, 340))).toEqual(occupied);
    const middle = glassPose(sampleAt(definition, 355));
    expect(middle.width).toBeCloseTo((target.width + 1400) / 2);
    expect(middle.height).toBeCloseTo((target.height + 180) / 2);
    expect(middle.x + middle.width).toBeCloseTo(target.x + target.width);
    expect(middle.y + middle.height).toBeCloseTo(target.y + target.height);
    expect(property(sampleAt(definition, 355), 'news-clock', 'y')).toBeCloseTo(951);
    const restored = sampleAt(definition, 370);
    expect(glassPose(restored)).toEqual({
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    });
    expect(property(restored, 'news-clock', 'y')).toBe(982);
    expect(property(restored, 'news-clock-label', 'y')).toBe(982);
  });

  it('preserves the chosen anchor, exact timing and planner output through JSON and a real .ogs archive', async () => {
    const { set, definition, components, references } = newsWithResize();
    const json = JSON.parse(JSON.stringify(definition)) as TransitionLogicDefinition;
    expect(transitionLogicErrors(json, references)).toEqual([]);
    const archive = await createProjectSetArchive(set);
    const reopened = await openProjectSetArchive(await archive.arrayBuffer());
    const loaded = reopened.transitionLogic!;
    expect(loaded).toEqual(json);
    const target = resizeTargets(loaded, components, 'lower-third', 'name').find(
      (entry) => entry.sourceLayerId === 'news-glass',
    )!;
    expect(readResizeSetting(loaded, 'ticker', 'lower-third', target).anchor).toBe('bottom-right');
    expect(resizeTiming(loaded, 'ticker', 'ticker', 'enter', 50)).toEqual({
      startFrame: 10,
      durationFrames: 40,
      waitForResize: true,
    });
    expect(resizeTiming(loaded, 'ticker', 'ticker', 'exit', 50)).toEqual({
      startFrame: 40,
      durationFrames: 30,
      waitForResize: true,
    });
    for (const frame of [99, 110, 130, 150, 339, 355, 370]) {
      expect(sampleAt(loaded, frame)).toEqual(sampleAt(definition, frame));
    }
  });

  it('includes the exact authored geometry and timing in coordinated export without altering the set', () => {
    const { set, definition, target } = newsWithResize();
    const before = structuredClone(set);
    const artifacts = buildCoordinatedProjectSetArtifacts(set);
    expect(artifacts.valid).toBe(true);
    expect(artifacts.errors).toEqual([]);
    const exported = artifacts.transitionDescriptor!.definition;
    expect(exported).toEqual(definition);
    expect(readResizeSetting(exported, 'ticker', 'lower-third', target)).toMatchObject({
      width: 1400,
      height: 180,
      anchor: 'bottom-right',
    });
    expect(resizeTiming(exported, 'ticker', 'ticker', 'enter', 50)).toMatchObject({
      startFrame: 10,
      durationFrames: 40,
    });
    expect(resizeTiming(exported, 'ticker', 'ticker', 'exit', 50)).toMatchObject({
      startFrame: 40,
      durationFrames: 30,
    });
    expect(glassPose(sampleAt(exported, 130))).toEqual(glassPose(sampleAt(definition, 130)));
    expect(set).toEqual(before);
  });

  it('clears only the selected panel adjustment and measures the actual authored overlap', () => {
    const { set, definition, target, references, clockOffsets } = newsWithResize();
    const layouts = templateLayouts(set);
    // Keeping the bottom fixed leaves this panel in the ticker area. A resize is not
    // automatically sufficient clearance, so the authored-layout check must still report it.
    expect(overlapWithLayout(definition, layouts, 'name', 'ticker')).toBe(48);
    const reset = clearResize(definition, 'ticker', 'lower-third', target, references);
    expect(transitionLogicErrors(reset, references)).toEqual([]);
    expect(reset.layoutRules!.flatMap((rule) => rule.sharedOffsets)).toEqual(clockOffsets);
    expect(readResizeSetting(reset, 'ticker', 'lower-third', target).configured).toBe(false);
    expect(glassPose(sampleAt(reset, 200))).toEqual({
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    });
    expect(property(sampleAt(reset, 200), 'news-clock', 'y')).toBe(920);
  });
});
